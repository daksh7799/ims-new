// src/pages/Outward.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { Link } from 'react-router-dom'

export default function Outward(){
  // SO list + selected
  const [orders,setOrders]=useState([])
  const [selectedId,setSelectedId]=useState('')
  // SO data
  const [order,setOrder]=useState(null)
  const [lines,setLines]=useState([])

  // scanning
  const [scan,setScan]=useState('')
  const [auto,setAuto]=useState(true)
  const typing = useRef(null)
  const inFlight = useRef(false)
  const inputRef = useRef(null)

  // -------- LOADERS

  // Load orders: pending/partial, newest first
  async function loadOrders(){
    const { data, error } = await supabase
      .from('v_sales_orders')
      .select('*')
      .in('status', ['pending','partial'])
      .order('id', { ascending:false })
    if(error){ console.error(error); setOrders([]); return }
    setOrders(data||[])
  }

  // Load selected SO header + lines (with bin availability)
  async function loadSO(soId){
    if(!soId){ setOrder(null); setLines([]); return }
    const [{ data: so }, { data: ls, error: e2 }] = await Promise.all([
      supabase.from('v_sales_orders').select('*').eq('id', soId).maybeSingle(),
      supabase.from('v_so_lines_availability')
        .select('line_id, sales_order_id, finished_good_id, finished_good_name, qty_ordered, qty_shipped, line_status, bins')
        .eq('sales_order_id', soId)
        .order('line_id', { ascending:true })
    ])
    if(e2){ console.error(e2) }
    setOrder(so||null)
    setLines(ls||[])
    setTimeout(()=>inputRef.current?.focus(),0)
  }

  // initial load
  useEffect(()=>{ loadOrders() },[])

  // subscribe to allocations & line updates for this SO
  useEffect(()=>{
    if(!selectedId) return
    const ch = supabase
      .channel('realtime:outward')
      .on('postgres_changes',{event:'*',schema:'public',table:'outward_allocations', filter:`sales_order_id=eq.${selectedId}`}, ()=>loadSO(selectedId))
      .on('postgres_changes',{event:'*',schema:'public',table:'sales_order_lines',   filter:`sales_order_id=eq.${selectedId}`}, ()=>loadSO(selectedId))
      .on('postgres_changes',{event:'*',schema:'public',table:'sales_orders',       filter:`id=eq.${selectedId}`}, ()=>{ loadSO(selectedId); loadOrders(); })
      .subscribe()
    return ()=>supabase.removeChannel(ch)
  },[selectedId])

  // Totals from lines
  const totals = useMemo(()=>{
    const ordered = lines.reduce((n,l)=>n+Number(l.qty_ordered||0),0)
    const shipped = lines.reduce((n,l)=>n+Number(l.qty_shipped||0),0)
    return { ordered, shipped, pending: Math.max(ordered-shipped,0) }
  },[lines])

  // -------- ASSIGN / UNDO

  async function assign(code){
    if(inFlight.current) return
    const pkt = (code||'').trim()
    if(!pkt || !selectedId) return
    try{
      inFlight.current = true
      const { error } = await supabase.rpc('allocate_packet_to_order', {
        p_so_id: Number(selectedId),
        p_packet_code: pkt
      })
      if(error){ alert(error.message); return }
      setScan('')
      await loadSO(selectedId)
      await loadOrders() // status might flip to partial/cleared
    } finally {
      inFlight.current = false
      inputRef.current?.focus()
    }
  }

  function onKeyDown(e){
    if(e.key==='Enter'){ e.preventDefault(); assign(scan) }
  }

  // Auto-assign when scanning
  useEffect(()=>{
    if(!auto) return
    const s = scan.trim()
    if(!s) return
    clearTimeout(typing.current)
    // scanners typically paste whole code; short debounce prevents double-fire
    typing.current = setTimeout(()=>assign(s), 140)
    return ()=>clearTimeout(typing.current)
  },[scan, auto])

  async function undo(){
    if(!selectedId) return
    const { error } = await supabase.rpc('undo_last_allocation', { p_so_id: Number(selectedId) })
    if(error){ alert(error.message); return }
    await loadSO(selectedId)
    await loadOrders()
  }

  const cleared = totals.shipped >= totals.ordered && totals.ordered>0

  // -------- UI

  return (
    <div className="grid">
      {/* PICK SO */}
      <div className="card">
        <div className="hd">
          <b>Outward / Sales Order Clearing</b>
          <div className="row">
            <span className="s">Pick order to clear</span>
            <button className="btn ghost" onClick={loadOrders}>Refresh List</button>
            <Link className="btn outline" to="/sales">Open Sales Orders</Link>
          </div>
        </div>
        <div className="bd">
          <select
            value={selectedId}
            onChange={e=>{ const v=e.target.value; setSelectedId(v); loadSO(v) }}
            style={{minWidth:480}}
          >
            <option value="">-- Select Pending/Partial SO --</option>
            {orders.map(o=>(
              <option key={o.id} value={o.id}>
                {(o.so_number || `SO-${o.id}`)} — {o.customer_name || '—'} — {o.qty_shipped_total}/{o.qty_ordered_total} ({o.status})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* SCAN BAR */}
      <div className="card">
        <div className="hd">
          <b>{selectedId ? (order?.so_number || `SO ${selectedId}`) : 'No order selected'}</b>
          <div className="row">
            <span className="badge">{order?.customer_name || '-'}</span>
            <span className="badge">{order?.status || '-'}</span>
            <span className="badge">Scanned: {totals.shipped}/{totals.ordered}</span>
            <label style={{display:'inline-flex',alignItems:'center',gap:6}}>
              <input type="checkbox" checked={auto} onChange={e=>setAuto(e.target.checked)} />
              Auto-assign on scan
            </label>
            <button className="btn ghost" onClick={undo} disabled={!selectedId || totals.shipped===0}>Undo last</button>
          </div>
        </div>
        <div className="bd">
          <form onSubmit={(e)=>{e.preventDefault(); assign(scan)}} className="row">
            <input
              ref={inputRef}
              placeholder="Scan / Enter packet barcode"
              value={scan}
              onChange={e=>setScan(e.target.value)}
              onKeyDown={onKeyDown}
              autoFocus
              style={{minWidth:360}}
              disabled={!selectedId || cleared}
              title={!selectedId ? 'Pick an order first' : (cleared ? 'Order cleared' : '')}
            />
            <button className="btn" disabled={!selectedId || cleared}>Assign</button>
          </form>
        </div>
      </div>

      {/* LINES + BIN AVAILABILITY */}
      <div className="card">
        <div className="hd"><b>Lines & Bin Availability</b></div>
        <div className="bd" style={{overflow:'auto'}}>
          <table className="table">
            <thead>
              <tr>
                <th>Finished Good</th>
                <th style={{textAlign:'right'}}>Shipped / Ordered</th>
                <th>Status</th>
                <th>Bins (qty available)</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l=>{
                const done = Number(l.qty_shipped)>=Number(l.qty_ordered)
                const bins = Array.isArray(l.bins) ? l.bins : []
                return (
                  <tr key={l.line_id}>
                    <td>{l.finished_good_name}</td>
                    <td style={{textAlign:'right'}}>{l.qty_shipped} / {l.qty_ordered}</td>
                    <td>
                      <span className="badge" style={{borderColor: done?'var(--ok)':'var(--border)'}}>
                        {l.line_status || (done ? 'cleared' : 'pending')}
                      </span>
                    </td>
                    <td>
                      {bins.length===0 && <span className="s" style={{color:'var(--muted)'}}>—</span>}
                      {bins.map((b,i)=>(
                        <span key={i} className="badge" style={{marginRight:6}}>
                          {b.bin}: {b.qty}
                        </span>
                      ))}
                    </td>
                  </tr>
                )
              })}
              {lines.length===0 && (
                <tr><td colSpan="4" style={{color:'var(--muted)'}}>{selectedId ? 'No lines on this order' : 'Pick an order to view lines'}</td></tr>
              )}
            </tbody>
          </table>
          <div className="s" style={{marginTop:8, color:'var(--muted)'}}>
            Tip: You can scan from any bin or new packets — bin tags here are just for quick picking.
          </div>
        </div>
      </div>
    </div>
  )
}
