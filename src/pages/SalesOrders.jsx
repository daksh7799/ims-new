import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { supabase } from '../supabaseClient'
import { downloadCSV } from '../utils/csv'
import AsyncFGSelect from '../components/AsyncFGSelect.jsx'
import { saveAs } from 'file-saver'

function normalizeName(s){ return String(s||'').trim().toLowerCase() }

async function fetchAllFinishedGoods(limit=1000){
  let from=0,to=limit-1,out=[]
  for(let i=0;i<20;i++){
    const { data, error } = await supabase
      .from('finished_goods')
      .select('id,name',{count:'exact'})
      .eq('is_active',true)
      .order('name',{ascending:true})
      .range(from,to)
    if(error) throw error
    out.push(...(data||[]))
    if(!data || data.length<limit) break
    from+=limit; to+=limit
  }
  return out
}

/**
 * New: server-side .in(...) with fallback to a large-range fetch.
 * Returns: { [normalizeName(finished_good_name)]: [{ bin_code, qty }, ...], ... }
 */
async function getBinsForFgNames(names){
  if(!names || !names.length) return {}

  // Ensure unique names and use raw names for server-side .in()
  const uniqueNames = Array.from(new Set(names.map(n => String(n || '').trim()).filter(Boolean)))
  if(!uniqueNames.length) return {}

  let allBins = null
  let err = null

  // 1) Preferred: ask server to return only rows for required finished_good_name values.
  try {
    const res = await supabase
      .from('v_bin_inventory')
      .select('finished_good_name, bin_code, produced_at')
      .in('finished_good_name', uniqueNames)
    allBins = res.data
    err = res.error
    console.debug('getBinsForFgNames: .in() returned', (allBins || []).length, 'rows for', uniqueNames.length, 'names')
  } catch (e) {
    console.warn('getBinsForFgNames: .in() failed', e)
    allBins = null
    err = e
  }

  // 2) Fallback: explicit large-range fetch to avoid silent truncation
  if(!allBins || allBins.length === 0) {
    console.debug('getBinsForFgNames: falling back to .range(0,50000)')
    try {
      const res2 = await supabase
        .from('v_bin_inventory')
        .select('finished_good_name, bin_code, produced_at')
        .range(0, 50000) // adjust upper bound if you have more rows
      allBins = res2.data
      err = err || res2.error
      console.debug('getBinsForFgNames: .range() returned', (allBins || []).length, 'rows')
    } catch (e) {
      console.warn('getBinsForFgNames: .range() failed', e)
      allBins = allBins || []
      err = err || e
    }
  }

  if(err) console.warn('getBinsForFgNames: fetch error', err)
  allBins = allBins || []

  // Aggregate by normalized finished_good_name
  const wanted = new Set(uniqueNames.map(normalizeName))
  const bucket = {}
  for(const r of allBins){
    const raw = String(r.finished_good_name || '').trim()
    if(!raw) continue
    const key = normalizeName(raw)
    if(!wanted.has(key)) continue
    const bin = r.bin_code || '—'
    bucket[key] = bucket[key] || {}
    bucket[key][bin] = (bucket[key][bin] || 0) + 1
  }

  const out = {}
  Object.entries(bucket).forEach(([k, bins])=>{
    out[k] = Object.entries(bins).map(([bin_code, qty])=>({ bin_code, qty }))
  })

  return out
}

function extractBrand(fgName) {
  if (!fgName) return 'UNKNOWN'
  // take the first token (letters/numbers/&/-) before a space or punctuation, uppercase it
  const m = String(fgName || '').trim().match(/^([A-Za-z0-9&-]+)/)
  return (m && m[1]) ? String(m[1]).toUpperCase() : String(fgName).split(' ')[0].toUpperCase()
}

export default function SalesOrders(){
  const [orders,setOrders]=useState([])
  const [customers,setCustomers]=useState([])
  const [fgIndex,setFgIndex]=useState(new Map())

  const [customer,setCustomer]=useState('')
  const [soNumber,setSoNumber]=useState('')
  const [note,setNote]=useState('')
  const [lines,setLines]=useState([{ finished_good_id:'', qty:'' }])

  const [impCustomer,setImpCustomer]=useState('')
  const [impSoNumber,setImpSoNumber]=useState('')
  const [impNote,setImpNote]=useState('')
  const [importing,setImporting]=useState(false)

  const [q,setQ]=useState('')
  const [loading,setLoading]=useState(true)
  const [hideShipped, setHideShipped] = useState(true)

  async function load(){
    setLoading(true)
    // pull from our new view
    const [{ data: list, error: err1 }, { data: cust, error: err2 }] = await Promise.all([
      supabase
        .from('v_so_summary')
        .select('*')
        .order('id', { ascending: false }),
      supabase
        .from('customers')
        .select('id,name')
        .eq('is_active',true)
        .order('name')
    ])
    if(err1) console.error(err1)
    if(err2) console.error(err2)
    setOrders(list||[])
    setCustomers(cust||[])
    setLoading(false)
  }

  async function buildFgIndex(){
    try{
      const fgs = await fetchAllFinishedGoods(1000)
      setFgIndex(new Map(fgs.map(x=>[normalizeName(x.name), String(x.id)])))
    }catch(e){ alert('Failed to load FG list: '+e.message) }
  }

  useEffect(()=>{ load(); buildFgIndex() },[])

  useEffect(()=>{
    const ch = supabase
      .channel('rt:sales')
      .on('postgres_changes',{event:'*',schema:'public',table:'sales_orders'},()=>load())
      .on('postgres_changes',{event:'*',schema:'public',table:'outward_allocations'},()=>load())
      .subscribe()
    return ()=>supabase.removeChannel(ch)
  },[])

  function addLine(){ setLines(ls=>[...ls,{finished_good_id:'',qty:''}]) }
  function removeLine(i){ setLines(ls=>ls.filter((_,idx)=>idx!==i)) }
  function updateLine(i,patch){ setLines(ls=>ls.map((l,idx)=>idx===i?{...l,...patch}:l)) }

  async function createSO(){
    const payload = lines
      .map(l=>({ finished_good_id:String(l.finished_good_id||'').trim(), qty:Number(l.qty) }))
      .filter(l=>l.finished_good_id && Number.isFinite(l.qty) && l.qty>0)

    if(!customer.trim()) return alert('Pick a customer')
    if(payload.length===0) return alert('Add at least one item with qty>0')

    const { error } = await supabase.rpc('so_api_create', {
      p_customer_name: customer.trim(),
      p_lines: payload,
      p_so_number: soNumber.trim() || null,
      p_note: note.trim() || null   // works with our merged function
    })
    if(error) return alert(error.message)

    setCustomer(''); setSoNumber(''); setNote('')
    setLines([{finished_good_id:'',qty:''}])
    load()
  }

  async function onImportOneSO(e){
    const f=e.target.files?.[0]; if(!f) return
    if(!impCustomer.trim()){ alert('Pick Customer first'); e.target.value=''; return }
    setImporting(true)
    try{
      const buf=await f.arrayBuffer()
      const wb=XLSX.read(buf,{type:'array'})
      const ws=wb.Sheets[wb.SheetNames[0]]
      const rows=XLSX.utils.sheet_to_json(ws,{defval:''})
      if(rows.length===0) throw new Error('No rows found')

      const merged={}
      for(const r of rows){
        const name=String(r['Finished Good']??r['finished good']??r['FG']??r['fg']??'').trim()
        const qty=Number(r['Qty']??r['qty']??0)
        if(!name || !(qty>0)) throw new Error('Need "Finished Good" and positive "Qty"')
        const id=fgIndex.get(normalizeName(name)); if(!id) throw new Error(`FG not found: ${name}`)
        merged[id]=(merged[id]||0)+qty
      }
      const payload=Object.entries(merged).map(([id,qty])=>({finished_good_id:String(id),qty}))
      const { error } = await supabase.rpc('so_api_create', {
        p_customer_name: impCustomer.trim(),
        p_lines: payload,
        p_so_number: impSoNumber.trim() || null,
        p_note: impNote.trim() || null
      })
      if(error) throw error
      alert('SO created from file')
      setImpSoNumber(''); setImpNote(''); load()
    }catch(err){ alert(err.message) }
    finally{ setImporting(false); e.target.value='' }
  }

  function downloadSampleCSV() {
    const headers = ['Finished Good', 'Qty']
    const csvContent = headers.join(',') + '\n'
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    saveAs(blob, 'sales_order_sample.csv')
  }

  const filtered = useMemo(()=>{
    const s=q.trim().toLowerCase()
    return (orders||[]).filter(o =>
      (hideShipped ? o.status !== 'Cleared' : true) &&  // our view uses Pending/Partial/Cleared
      (
        !s ||
        String(o.so_number||'').toLowerCase().includes(s) ||
        String(o.customer_name||'').toLowerCase().includes(s)
      )
    )
  },[orders,q,hideShipped])

  function exportOrders(){
    downloadCSV('sales_orders.csv', filtered.map(o=>({
      id:o.id,
      so_number:o.so_number,
      customer:o.customer_name,
      status:o.status,
      shipped:o.qty_shipped_total,
      ordered:o.qty_ordered_total,
      note:o.note,
      created_at:o.created_at || ''
    })))
  }

  // ---- PRINT: grouped-by-brand, denser (~50 rows/page), darker borders, qty left-aligned,
  //          and FINISHED GOODS sorted alphabetically within each brand ----
  async function printSO(order, { onlyPending = true } = {}) {
    try{
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable')
      ])

      // use points for fine control and generate A4
      const doc = new jsPDF({ unit: 'pt', format: 'a4' })
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const leftMargin = 12
      const rightMargin = 12
      const topMargin = 14
      const usableWidth = pageWidth - leftMargin - rightMargin

      // header
      doc.setFontSize(14)
      doc.text(`Sales Order ${order.so_number || order.id}`, leftMargin, topMargin + 6)
      doc.setFontSize(11)
      doc.text(`Customer: ${order.customer_name || '-'}`, leftMargin, topMargin + 22)

      let currentY = topMargin + 34
      if (order.note) {
        const splitNote = doc.splitTextToSize(`Note: ${order.note}`, usableWidth)
        doc.setFontSize(10)
        doc.text(splitNote, leftMargin, currentY)
        currentY += splitNote.length * 10
      }
      if(order.created_at){
        doc.setFontSize(10)
        doc.text(`Created: ${new Date(order.created_at).toLocaleString()}`, leftMargin, currentY)
        currentY += 12
      }

      // fetch fresh lines
      const { data: lines } = await supabase
        .from('v_so_lines')
        .select('*')
        .eq('sales_order_id', order.id)
      let rows = (lines||[])
      if (onlyPending) rows = rows.filter(l => Number(l.qty_shipped || 0) < Number(l.qty_ordered || 0))
      if (!rows.length) { alert('No lines to print'); return }

      const fgNames = rows.map(l=>l.finished_good_name).filter(Boolean)
      const binsByFg = await getBinsForFgNames(fgNames)

      // group by brand
      const byBrand = {}
      for (const l of rows) {
        const brand = extractBrand(l.finished_good_name)
        if (!byBrand[brand]) byBrand[brand] = []
        byBrand[brand].push(l)
      }
      const brands = Object.keys(byBrand).sort((a,b)=>a.localeCompare(b))

      // tuned column widths: finished good reduced, qty narrow, bins increased
      const col1 = 44                              // ordered (narrow)
      const col0 = Math.floor(usableWidth * 0.56) // finished good (reduced)
      const col2 = usableWidth - col0 - col1      // bins (increased)

      for (const brand of brands) {
        // brand header
        doc.setFontSize(11)
        doc.text(brand, leftMargin, currentY + 12)
        doc.setFontSize(9)

        // sort finished goods alphabetically (case-insensitive)
        const items = (byBrand[brand] || []).slice().sort((a, b) => {
          const A = String(a.finished_good_name || '').toLowerCase()
          const B = String(b.finished_good_name || '').toLowerCase()
          return A.localeCompare(B)
        })

        const body = items.map(l=>{
          const fgName = l.finished_good_name || ''
          const bins = binsByFg[normalizeName(fgName)] || []
          const binsText = bins.length ? bins.map(b => `${b.bin_code}: ${b.qty}`).join(', ') : '—'
          return [fgName, String(Number(l.qty_ordered||0)), binsText]
        })

        autoTable(doc, {
          startY: currentY + 16,
          margin: { left: leftMargin, right: rightMargin },
          head: [['Finished Good', 'Ordered', 'Bins']],
          body,
          styles: {
            fontSize: 9,         // readable
            cellPadding: 1.2,    // tighter rows
            overflow: 'ellipsize',
            valign: 'middle',
            lineWidth: 0.6,      // darker/thicker border
            lineColor: [110,110,110] // darker gray border
          },
          headStyles: { fillColor: [250,250,250], textColor: 20, fontStyle: 'bold', halign: 'left', fontSize:9 },
          columnStyles: {
            0: { cellWidth: col0, overflow: 'ellipsize' },         // finished good (reduced)
            1: { halign: 'left', cellWidth: col1 },                // ordered now LEFT aligned
            2: { cellWidth: col2, overflow: 'ellipsize' }          // bins (increased)
          },
          tableWidth: 'auto',
          theme: 'grid',
          willDrawCell: (data) => {
            if (data.section === 'body') {
              data.cell.styles.minCellHeight = 8
            }
          }
        })

        // move cursor after table
        currentY = doc.lastAutoTable?.finalY || (currentY + 16 + body.length * 9)
        currentY += 6

        // page break if needed
        if (currentY > pageHeight - 36) {
          doc.addPage()
          currentY = topMargin + 8
        }
      }

      // create blob + open print dialog; keep iframe so print dialog doesn't auto-close
      const blob = doc.output('blob')
      const blobURL = URL.createObjectURL(blob)
      const iframe = document.createElement('iframe')
      iframe.style.position = 'fixed'
      iframe.style.right = '0'
      iframe.style.bottom = '0'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = 'none'
      iframe.src = blobURL
      document.body.appendChild(iframe)
      iframe.onload = function () {
        try { iframe.contentWindow.focus(); iframe.contentWindow.print() }
        catch(e){ doc.save(`SO_${order.so_number || order.id}.pdf`) }
        // leave iframe in DOM so user closes print dialog manually
      }
    }catch(err){
      alert('Failed to print: ' + (err?.message || String(err)))
    }
  }

  return (
    <div className="grid">
      {/* Import ONE SO */}
      <div className="card">
        <div className="hd"><b>Import ONE Sales Order</b></div>
        <div className="bd">
          <div className="row" style={{gap:8, flexWrap:'wrap'}}>
            <select value={impCustomer} onChange={e=>setImpCustomer(e.target.value)}>
              <option value="">Select Customer</option>
              {customers.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <input
              placeholder="SO Number (auto-generated)"
              value={impSoNumber}
              readOnly
              style={{ background: '#f8f8f8', color: '#777', cursor: 'not-allowed' }}
            />
            <input
              placeholder="Add note (optional)"
              value={impNote}
              onChange={e=>setImpNote(e.target.value)}
              style={{width:220}}
            />
            <input type="file" accept=".xlsx,.xls,.csv" onChange={onImportOneSO} disabled={importing}/>
            <button className="btn ghost" onClick={downloadSampleCSV}>📄 Download Sample CSV</button>
          </div>
          <div className="s" style={{color:'var(--muted)'}}>
            Columns required: <code>Finished Good</code>, <code>Qty</code>.
          </div>
        </div>
      </div>

      {/* Manual create */}
      <div className="card">
        <div className="hd"><b>Create Sales Order (Manual)</b></div>
        <div className="bd" style={{display:'grid', gap:10}}>
          <div className="row" style={{gap:8}}>
            <select value={customer} onChange={e=>setCustomer(e.target.value)} style={{minWidth:260}}>
              <option value="">Select Customer</option>
              {customers.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <input
              placeholder="SO Number (auto-generated)"
              value={soNumber}
              readOnly
              style={{ background: '#f8f8f8', color: '#777', cursor: 'not-allowed' }}
            />
          </div>

          <textarea
            placeholder="Add note (optional)"
            value={note}
            onChange={e=>setNote(e.target.value)}
            style={{width:'100%', minHeight:60}}
          />

          <table className="table">
            <thead><tr><th style={{width:'50%'}}>Finished Good</th><th style={{width:120}}>Qty</th><th></th></tr></thead>
            <tbody>
              {lines.map((l,idx)=>(
                <tr key={idx}>
                  <td>
                    <AsyncFGSelect
                      value={l.finished_good_id}
                      onChange={(id)=>updateLine(idx,{finished_good_id:String(id||'')})}
                      placeholder="Search finished goods…"
                      minChars={1}
                      pageSize={25}
                    />
                  </td>
                  <td><input type="number" min="1" value={l.qty} onChange={e=>updateLine(idx,{qty:e.target.value})}/></td>
                  <td><button className="btn ghost" onClick={()=>removeLine(idx)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="row" style={{marginTop:4}}>
            <button className="btn outline" onClick={addLine}>+ Add Line</button>
            <button className="btn" onClick={createSO}>Create Order</button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="card">
        <div className="hd">
          <b>Orders</b>
          <div className="row">
            <input placeholder="Search SO / Customer…" value={q} onChange={e=>setQ(e.target.value)} />
            <label className="row" style={{gap:6, marginLeft:8}}>
              <input
                type="checkbox"
                checked={hideShipped}
                onChange={e=>setHideShipped(e.target.checked)}
                title="Hide fully shipped orders"
              />
              Hide shipped
            </label>
            <button className="btn" onClick={exportOrders} disabled={!filtered.length}>Export CSV</button>
            <Link to="/outward" className="btn outline">Open Outward</Link>
          </div>
        </div>
        <div className="bd" style={{overflow:'auto'}}>
          <table className="table">
            <thead>
              <tr>
                <th>SO</th><th>Customer</th><th>Status</th>
                <th style={{textAlign:'right'}}>Shipped / Ordered</th>
                <th>Note</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(o=>(
                <tr key={o.id}>
                  <td><Link to={`/outward?so=${o.id}`}>{o.so_number || o.id}</Link></td>
                  <td>{o.customer_name}</td>
                  <td><span className="badge">{o.status}</span></td>
                  <td style={{textAlign:'right'}}>{o.qty_shipped_total} / {o.qty_ordered_total}</td>
                  <td style={{maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{o.note || ''}</td>
                  <td>{o.created_at ? new Date(o.created_at).toLocaleString() : '—'}</td>
                  <td>
                    <button className="btn outline" onClick={()=>printSO(o)}>Print</button>
                  </td>
                </tr>
              ))}
              {filtered.length===0 && (
                <tr><td colSpan="7" style={{color:'var(--muted)'}}>{loading ? 'Loading…' : 'No orders'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
