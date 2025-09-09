import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { Link } from 'react-router-dom'
import { downloadCSV } from '../utils/csv'
import * as XLSX from 'xlsx'
import AsyncFGSelect from '../components/AsyncFGSelect.jsx'

// Normalize header access
function getCell(row, keys){
  for(const k of keys){ if(row[k] !== undefined) return row[k] }
  return ''
}

export default function SalesOrders(){
  const [orders,setOrders]=useState([])
  const [customers,setCustomers]=useState([])

  // create SO (manual small form)
  const [customer,setCustomer]=useState('')
  const [lines,setLines]=useState([{ finished_good_id:'', qty:'' }])
  const [q,setQ]=useState('')

  // import ONE SO
  const [impCustomer,setImpCustomer]=useState('') // customer name
  const [impSoNumber,setImpSoNumber]=useState('') // optional custom SO number
  const [importing,setImporting]=useState(false)

  async function load(){
    const [{data:orders0},{data:cust0}] = await Promise.all([
      supabase
        .from('v_sales_orders')
        .select('*')
        .in('status', ['pending','partial'])  // <-- hide "cleared"
        .order('id',{ascending:false}),
      supabase
        .from('customers')
        .select('id,name')
        .eq('is_active',true)
        .order('name')
        .range(0, 9999) // fetch all customers
    ])
    setOrders(orders0||[])
    setCustomers(cust0||[])
  }

  useEffect(()=>{ load() },[])

  // realtime refresh on allocations/orders
  useEffect(()=>{
    const ch = supabase
      .channel('realtime:so')
      .on('postgres_changes',{event:'*',schema:'public',table:'outward_allocations'},()=>load())
      .on('postgres_changes',{event:'*',schema:'public',table:'sales_orders'},()=>load())
      .subscribe()
    return ()=>supabase.removeChannel(ch)
  },[])

  // ====== CREATE (manual) ======
  function addLine(){ setLines(ls=>[...ls,{finished_good_id:'', qty:''}]) }
  function removeLine(i){ setLines(ls=>ls.filter((_,idx)=>idx!==i)) }
  function updateLine(i,patch){ setLines(ls=>ls.map((l,idx)=>idx===i?{...l,...patch}:l)) }

  async function createSO(){
    const payload = lines
      .map(l=>({ finished_good_id:Number(l.finished_good_id), qty:Number(l.qty) }))
      .filter(l=>l.finished_good_id && l.qty>0)
    if(!customer.trim()) return alert('Select/enter customer')
    if(payload.length===0) return alert('Add at least one line')
    const { error } = await supabase.rpc('create_sales_order_with_number', {
      p_so_number: null,
      p_customer_name: customer.trim(),
      p_lines: payload
    })
    if(error){ alert(error.message); return }
    setCustomer(''); setLines([{finished_good_id:'',qty:''}])
    await load()   // stay on list
  }

  const filtered = useMemo(()=>{
    const qq=q.trim().toLowerCase()
    return (orders||[]).filter(o=>{
      return !qq || String(o.so_number||'').toLowerCase().includes(qq) || String(o.customer_name||'').toLowerCase().includes(qq)
    })
  },[orders,q])

  function exportOrders(){
    downloadCSV('sales_orders.csv', filtered.map(o=>({
      id:o.id, so_number:o.so_number, customer:o.customer_name, status:o.status,
      qty_ordered:o.qty_ordered_total, qty_shipped:o.qty_shipped_total, created_at:o.created_at
    })))
  }

  // ====== IMPORT ONE SO (CSV/Excel with FG + Qty) ======
  async function onImportOneSO(e){
    const file = e.target.files?.[0]
    if(!file) return
    if(!impCustomer.trim()){
      alert('Please select a Customer first for this SO.')
      e.target.value=''
      return
    }
    setImporting(true)
    try{
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type:'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { defval:'' })

      if(rows.length===0){ alert('No rows found'); return }

      // Accept flexible headers
      // "Finished Good" | "finished_good" | "FG" etc.
      // "Qty" | "qty"
      const merged = {} // finished_good_id => qty sum
      const namesNeeded = new Set()

      // First pass: collect product names, basic validation for qty
      for(const r of rows){
        const rawName = String(getCell(r, ['Finished Good','finished_good','finished good','FG','fg'])).trim()
        const qtyVal  = Number(getCell(r, ['Qty','qty']))
        if(!rawName || !qtyVal || qtyVal<=0){
          alert(`Invalid row. Need "Finished Good" and positive "Qty". Row: ${JSON.stringify(r)}`)
          return
        }
        namesNeeded.add(rawName)
      }

      // Resolve FG names -> ids using a single query with IN (scales to thousands)
      const nameList = Array.from(namesNeeded)
      // If you have > 10k names in one file (unlikely), split into chunks
      const { data:fgs, error:fgErr } = await supabase
        .from('finished_goods')
        .select('id,name')
        .in('name', nameList)
      if(fgErr){ alert(fgErr.message); return }

      const fgMap = new Map(fgs.map(f=>[f.name.toLowerCase(), f.id]))

      // Second pass: build payload merging duplicate items
      for(const r of rows){
        const rawName = String(getCell(r, ['Finished Good','finished_good','finished good','FG','fg'])).trim()
        const qtyVal  = Number(getCell(r, ['Qty','qty']))
        const id = fgMap.get(rawName.toLowerCase())
        if(!id){
          alert(`Finished Good not found: "${rawName}" — check exact name`)
          return
        }
        merged[id] = (merged[id]||0) + qtyVal
      }

      const payload = Object.keys(merged).map(k=>({
        finished_good_id: Number(k),
        qty: merged[k]
      }))

      const { error } = await supabase.rpc('create_sales_order_with_number', {
        p_so_number: impSoNumber.trim() || null,       // optional custom number
        p_customer_name: impCustomer.trim(),           // chosen from dropdown
        p_lines: payload
      })
      if(error){ alert(error.message); return }

      await load()
      alert('Sales Order created from file')
      setImpSoNumber('')
    } finally {
      setImporting(false)
      e.target.value='' // reset file input
    }
  }

  return (
    <div className="grid">

      {/* IMPORT ONE SO */}
      <div className="card">
        <div className="hd"><b>Import ONE Sales Order (CSV/Excel)</b></div>
        <div className="bd">
          <div className="row" style={{gap:8, marginBottom:8}}>
            <select value={impCustomer} onChange={e=>setImpCustomer(e.target.value)}>
              <option value="">Select Customer</option>
              {customers.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <input placeholder="SO Number (optional)" value={impSoNumber} onChange={e=>setImpSoNumber(e.target.value)} />
            <input type="file" accept=".xlsx,.xls,.csv" onChange={onImportOneSO} disabled={importing}/>
          </div>
          <div className="s" style={{color:'var(--muted)'}}>
            File columns required: <code>Finished Good</code>, <code>Qty</code>.  
            All rows go into <b>one</b> SO for the selected customer. Duplicate items are merged.  
            Finished Goods are resolved by name on the server (no 1k cap).
          </div>
        </div>
      </div>

      {/* CREATE MANUALLY */}
      <div className="card">
        <div className="hd"><b>Create Sales Order (Manual)</b></div>
        <div className="bd">
          <div className="row">
            <select value={customer} onChange={e=>setCustomer(e.target.value)}>
              <option value="">Select Customer</option>
              {customers.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <table className="table" style={{marginTop:8}}>
            <thead><tr><th>Finished Good</th><th>Qty</th><th></th></tr></thead>
            <tbody>
              {lines.map((l,idx)=>(
                <tr key={idx}>
                  <td>
                    {/* Dynamic, type-to-search dropdown (no preload cap) */}
                    <AsyncFGSelect
                      value={l.finished_good_id}
                      onChange={(id)=>updateLine(idx,{ finished_good_id:id })}
                      placeholder="Search finished goods by name…"
                      minChars={1}
                      pageSize={25}
                    />
                  </td>
                  <td>
                    <input type="number" min="1" value={l.qty} onChange={e=>updateLine(idx,{qty:e.target.value})}/>
                  </td>
                  <td>
                    <button className="btn ghost" onClick={()=>removeLine(idx)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{marginTop:8}}>
            <button className="btn outline" onClick={()=>addLine()}>+ Add Line</button>
            <button className="btn" onClick={createSO}>Create Order</button>
          </div>
        </div>
      </div>

      {/* LIST */}
      <div className="card">
        <div className="hd">
          <b>Orders</b>
          <div className="row">
            <input placeholder="Search SO / Customer…" value={q} onChange={e=>setQ(e.target.value)} />
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
              </tr>
            </thead>
            <tbody>
              {filtered.map(o=>{
                return (
                  <tr key={o.id}>
                    <td>{o.so_number || o.id}</td>
                    <td>{o.customer_name}</td>
                    <td><span className="badge">{o.status}</span></td>
                    <td style={{textAlign:'right'}}>{o.qty_shipped_total} / {o.qty_ordered_total}</td>
                    <td>{new Date(o.created_at).toLocaleString()}</td>
                  </tr>
                )
              })}
              {filtered.length===0 && (
                <tr><td colSpan="5" style={{color:'var(--muted)'}}>No orders</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
