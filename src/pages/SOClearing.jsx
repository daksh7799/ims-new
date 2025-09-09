import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useParams, Link } from 'react-router-dom'

export default function SOClearing(){
  const { id } = useParams() // sales_order_id
  const [order,setOrder]=useState(null)
  const [lines,setLines]=useState([])
  const [scan,setScan]=useState('')
  const [auto,setAuto]=useState(true)
  const typing = useRef(null)
  const inFlight = useRef(false)
  const inputRef = useRef(null)

  async function load(){
    const { data: so } = await supabase.from('v_sales_orders').select('*').eq('id', id).maybeSingle()
    setOrder(so||null)
    const { data: ls } = await supabase.from('v_so_lines').select('*').eq('sales_order_id', id).order('id')
    setLines(ls||[])
  }
  useEffect(()=>{ load() },[id])

  useEffect(()=>{
    const ch = supabase
      .channel('realtime:soclear')
      .on('postgres_changes',{event:'*',schema:'public',table:'outward_allocations',filter:`sales_order_id=eq.${id}`},()=>load())
      .subscribe()
    return ()=>supabase.removeChannel(ch)
  },[id])

  const totals = useMemo(()=>{
    const ordered = lines.reduce((n,l)=>n+Number(l.qty_ordered||0),0)
    const shipped = lines.reduce((n,l)=>n+Number(l.qty_shipped||0),0)
    return {ordered, shipped, pending: Math.max(ordered - shipped, 0)}
  },[lines])

  async function assign(code){
    if(inFlight.current) return
    const pkt = (code||'').trim()
    if(!pkt) return
    try{
      inFlight.current = true
      const { error } = await supabase.rpc('allocate_packet_to_order', {
        p_so_id: Number(id),
        p_packet_code: pkt
      })
      if(error){ alert(error.message); return }
      setScan('')
      await load()
    } finally {
      inFlight.current = false
      inputRef.current?.focus()
    }
  }

  function onKeyDown(e){
    if(e.key==='Enter'){ e.preventDefault(); assign(scan) }
  }

  useEffect(()=>{
    if(!auto) return
    if(!scan.trim()) return
    clearTimeout(typing.current)
    typing.current = setTimeout(()=>assign(scan), 150)
    return ()=>clearTimeout(typing.current)
  },[scan, auto])

  async function undo(){
    const { error } = await supabase.rpc('undo_last_allocation', { p_so_id: Number(id) })
    if(error){ alert(error.message); return }
    await load()
  }

  const cleared = totals.shipped >= totals.ordered && totals.ordered>0

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Sales Order {order?.so_number || id}</b>
          <div className="row">
            <span className="badge">{order?.customer_name || '-'}</span>
            <span className="badge">{order?.status || '-'}</span>
            <span className="badge">Scanned: {totals.shipped}/{totals.ordered}</span>
            <label style={{display:'inline-flex',alignItems:'center',gap:6}}>
              <input type="checkbox" checked={auto} onChange={e=>setAuto(e.target.checked)} />
              Auto-assign on scan
            </label>
            <button className="btn ghost" onClick={undo} disabled={totals.shipped===0}>Undo last</button>
            <Link to="/sales" className="btn outline">Back</Link>
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
              disabled={cleared}
              title={cleared ? 'Order cleared' : ''}
            />
            <button className="btn" disabled={cleared}>Assign</button>
          </form>
        </div>
      </div>

      {/* Lines */}
      <div className="card">
        <div className="hd"><b>Lines</b></div>
        <div className="bd" style={{overflow:'auto'}}>
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th style={{textAlign:'right'}}>Shipped / Ordered</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l=>{
                const done = Number(l.qty_shipped)>=Number(l.qty_ordered)
                return (
                  <tr key={l.id}>
                    <td>{l.finished_good_name}</td>
                    <td style={{textAlign:'right'}}>{l.qty_shipped} / {l.qty_ordered}</td>
                    <td><span className="badge" style={{borderColor: done?'var(--ok)':'var(--border)'}}>{done?'Cleared':'Pending'}</span></td>
                  </tr>
                )
              })}
              {lines.length===0 && (
                <tr><td colSpan="3" style={{color:'var(--muted)'}}>No lines</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
