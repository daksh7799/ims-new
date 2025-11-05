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

// --- helper to load bins per FG (no date in output) ---
async function getBinsForFgNames(names){
  if(!names.length) return {}
  const { data: allBins, error } = await supabase
    .from('v_bin_inventory')
    .select('finished_good_name, bin_code, produced_at')
  if(error){ console.error('v_bin_inventory', error); return {} }

  const out = {}
  const wanted = new Set(names.map(normalizeName))
  ;(allBins||[]).forEach(r=>{
    const fgKey = normalizeName(r.finished_good_name)
    if(!wanted.has(fgKey)) return
    if(!out[fgKey]) out[fgKey] = {}
    const bin = r.bin_code || '—'
    if(!out[fgKey][bin]) out[fgKey][bin] = { qty:0 }
    out[fgKey][bin].qty += 1
  })
  const agg = {}
  Object.entries(out).forEach(([fgKey,bins])=>{
    agg[fgKey] = Object.entries(bins).map(([bin_code,v])=>({
      bin_code, qty:v.qty
    }))
  })
  return agg
}

export default function SalesOrders(){
  const [orders,setOrders]=useState([])
  const [customers,setCustomers]=useState([])
  const [fgIndex,setFgIndex]=useState(new Map())

  const [customer,setCustomer]=useState('')
  const [soNumber,setSoNumber]=useState('')
  const [lines,setLines]=useState([{ finished_good_id:'', qty:'' }])

  const [impCustomer,setImpCustomer]=useState('')
  const [impSoNumber,setImpSoNumber]=useState('')
  const [importing,setImporting]=useState(false)

  const [q,setQ]=useState('')
  const [loading,setLoading]=useState(true)
  const [hideShipped, setHideShipped] = useState(true)

  async function load(){
    setLoading(true)
    const [{ data: list }, { data: cust }] = await Promise.all([
      supabase.rpc('so_api_list'),
      supabase.from('customers').select('id,name').eq('is_active',true).order('name')
    ])
    setOrders(list||[]); setCustomers(cust||[]); setLoading(false)
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
      p_so_number: soNumber.trim() || null
    })
    if(error) return alert(error.message)

    setCustomer(''); setSoNumber('')
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
        p_so_number: impSoNumber.trim() || null
      })
      if(error) throw error
      alert('SO created from file')
      setImpSoNumber(''); load()
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
      (hideShipped ? o.status !== 'shipped' : true) &&
      (
        !s ||
        String(o.so_number||'').toLowerCase().includes(s) ||
        String(o.customer_name||'').toLowerCase().includes(s)
      )
    )
  },[orders,q,hideShipped])

  function exportOrders(){
    downloadCSV('sales_orders.csv', filtered.map(o=>({
      id:o.id, so_number:o.so_number, customer:o.customer_name,
      status:o.status, shipped:o.qty_shipped_total, ordered:o.qty_ordered_total, created_at:o.created_at
    })))
  }

  // ✅ Print stays open until user closes it
  async function printSO(order){
    try{
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable')
      ])
      const doc = new jsPDF()
      doc.setFontSize(14)
      doc.text(`Sales Order ${order.so_number || order.id}`, 14, 16)
      doc.setFontSize(11)
      doc.text(`Customer: ${order.customer_name || '-'}`, 14, 24)
      if(order.created_at){
        doc.text(`Created: ${new Date(order.created_at).toLocaleString()}`, 14, 31)
      }

      const { data: lines } = await supabase
        .from('v_so_lines')
        .select('*')
        .eq('sales_order_id', order.id)
      const fgNames = (lines||[]).map(l=>l.finished_good_name).filter(Boolean)
      const binsByFg = await getBinsForFgNames(fgNames)

      const body = (lines||[]).map(l=>{
        const fgName = l.finished_good_name || ''
        const bins = binsByFg[normalizeName(fgName)] || []
        const binsText = bins.length
          ? bins.map(b => `${b.bin_code}: ${b.qty}`).join(', ')
          : '—'
        return [fgName, Number(l.qty_ordered||0), binsText]
      })

      autoTable(doc, {
        startY: 38,
        head: [['Finished Good', 'Ordered', 'Bins']],
        body,
        styles: { fontSize: 10, cellPadding: 2 },
        columnStyles: { 1: { halign:'right', cellWidth: 25 } }
      })

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
        iframe.contentWindow.focus()
        iframe.contentWindow.print()
        // ✅ do not auto-close iframe
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
                  <td>{new Date(o.created_at).toLocaleString()}</td>
                  <td>
                    <button className="btn outline" onClick={()=>printSO(o)}>Print</button>
                  </td>
                </tr>
              ))}
              {filtered.length===0 && (
                <tr><td colSpan="6" style={{color:'var(--muted)'}}>{loading ? 'Loading…' : 'No orders'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
