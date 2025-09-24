// src/pages/Outward.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { Link, useLocation } from 'react-router-dom'

function fmtDT(ts){
  if(!ts) return '—'
  const t = typeof ts === 'string' ? Date.parse(ts) : ts
  if(Number.isNaN(t)) return '—'
  return new Date(t).toLocaleString()
}
function useQuery(){
  const { search } = useLocation()
  return useMemo(()=>new URLSearchParams(search),[search])
}
const norm = s => String(s ?? '').trim().toLowerCase()

export default function Outward(){
  const query = useQuery()
  const initialSO = query.get('so') || ''

  const [pendingOnly, setPendingOnly] = useState(true)
  const [orders, setOrders] = useState([])
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [filter, setFilter] = useState('')

  const [soId, setSoId] = useState(initialSO)
  const [orderHdr, setOrderHdr] = useState(null)
  const [lines, setLines] = useState([])

  const [scan, setScan] = useState('')
  const [auto, setAuto] = useState(true)
  const typing = useRef(null)
  const inFlight = useRef(false)
  const inputRef = useRef(null)
  const [lastMsg, setLastMsg] = useState('')

  // bins per FG
  const [binsByFg, setBinsByFg] = useState({})
  const [loadingBins, setLoadingBins] = useState(false)

  async function loadOrders(){
    setLoadingOrders(true)
    const view = pendingOnly ? 'v_so_pending' : 'v_so_summary'
    const { data, error } = await supabase.from(view).select('*').order('id', { ascending:false })
    if(error){ console.error('loadOrders', error); setOrders([]) } else { setOrders(data||[]) }
    setLoadingOrders(false)
  }
  async function loadOne(id){
    if(!id){ setOrderHdr(null); setLines([]); setBinsByFg({}); return }
    const [{ data: hdrs }, { data: ls, error: e2 }] = await Promise.all([
      supabase.from('v_so_summary').select('*').eq('id', id).limit(1),
      supabase.from('v_so_lines').select('*').eq('sales_order_id', id).order('id')
    ])
    setOrderHdr(hdrs?.[0] || null)
    if(e2){ console.error('v_so_lines', e2); setLines([]) } else { setLines(ls||[]) }
  }

  useEffect(()=>{ loadOrders() }, [pendingOnly])
  useEffect(()=>{ if(initialSO) setSoId(initialSO) }, [initialSO])
  useEffect(()=>{ loadOne(soId) }, [soId])

  useEffect(()=>{
    const ch = supabase
      .channel('rt:outward')
      .on('postgres_changes', { event:'*', schema:'public', table:'outward_allocations' }, ()=>{
        if(soId) { loadOne(soId); loadBinsForCurrentLines() }
        loadOrders()
      })
      .on('postgres_changes', { event:'*', schema:'public', table:'sales_orders' }, ()=> loadOrders())
      .subscribe()
    return ()=>supabase.removeChannel(ch)
  }, [soId, pendingOnly])

  const filtered = useMemo(()=>{
    const s = filter.trim().toLowerCase()
    return (orders||[]).filter(o =>
      !s ||
      String(o.so_number||'').toLowerCase().includes(s) ||
      String(o.customer_name||'').toLowerCase().includes(s)
    )
  }, [orders, filter])

  const totals = useMemo(()=>{
    const ordered = lines.reduce((n,l)=>n+Number(l.qty_ordered||0),0)
    const shipped = lines.reduce((n,l)=>n+Number(l.qty_shipped||0),0)
    return { ordered, shipped, pending: Math.max(ordered-shipped, 0) }
  }, [lines])
  const cleared = totals.shipped >= totals.ordered && totals.ordered>0

  async function assign(code){
    if(inFlight.current) return
    const pkt = (code||'').trim()
    if(!pkt || !soId) return
    try{
      inFlight.current = true
      const { error } = await supabase.rpc('allocate_packet_to_order', {
        p_so_id: Number(soId),
        p_packet_code: pkt
      })
      if(error){ setLastMsg(error.message); return }
      setScan(''); setLastMsg('OK')
      await loadOne(soId)
      await loadBinsForCurrentLines()
      if(pendingOnly){
        const approxCleared = (totals.shipped + 1) >= totals.ordered
        if(approxCleared) await loadOrders()
      }
    } finally {
      inFlight.current = false
      inputRef.current?.focus()
      setTimeout(()=>setLastMsg(''), 1500)
    }
  }
  function onKeyDown(e){ if(e.key==='Enter'){ e.preventDefault(); assign(scan) } }
  useEffect(()=>{
    if(!auto) return
    const s = scan.trim()
    if(!s || !soId) return
    clearTimeout(typing.current)
    typing.current = setTimeout(()=>assign(s), 120)
    return ()=>clearTimeout(typing.current)
  }, [scan, auto, soId])

  async function undo(){
    if(!soId) return
    const { error } = await supabase.rpc('undo_last_allocation', { p_so_id: Number(soId) })
    if(error){ setLastMsg(error.message); return }
    setLastMsg('Undone')
    await loadOne(soId)
    await loadBinsForCurrentLines()
    setTimeout(()=>setLastMsg(''), 1200)
  }

  // ---- BIN INVENTORY LOADER (correct version that shows bins) ----
  async function loadBinsForCurrentLines(){
    setBinsByFg({})
    const fgNames = Array.from(new Set((lines||[])
      .map(l => String(l.finished_good_name||'').trim())
      .filter(Boolean)))
    if(!fgNames.length) return

    setLoadingBins(true)
    try{
      const { data: allBins, error } = await supabase
        .from('v_bin_inventory')
        .select('finished_good_name, bin_code, produced_at')
      if(error){ console.warn('v_bin_inventory fetch error:', error); return }

      const results = {}
      for(const rawName of fgNames){
        const key = norm(rawName)
        const rows = (allBins||[]).filter(r => norm(r.finished_good_name) === key)

        const perBin = new Map()
        for(const r of rows){
          const bin = r.bin_code || '—'
          const prod = r.produced_at ? Date.parse(r.produced_at) : Number.POSITIVE_INFINITY
          const got = perBin.get(bin) || { qty:0, oldest:Number.POSITIVE_INFINITY }
          got.qty += 1
          if(prod < got.oldest) got.oldest = prod
          perBin.set(bin, got)
        }

        const arr = [...perBin.entries()].map(([bin_code,v])=>({
          bin_code,
          qty: v.qty,
          oldest_produced_at: isFinite(v.oldest) ? new Date(v.oldest).toISOString() : null
        }))
        arr.sort((a,b)=>{
          const ta = a.oldest_produced_at ? Date.parse(a.oldest_produced_at) : Number.POSITIVE_INFINITY
          const tb = b.oldest_produced_at ? Date.parse(b.oldest_produced_at) : Number.POSITIVE_INFINITY
          if(ta !== tb) return ta - tb
          return String(a.bin_code).localeCompare(String(b.bin_code))
        })
        results[key] = arr
      }

      setBinsByFg(results)
    } finally {
      setLoadingBins(false)
    }
  }

  useEffect(()=>{ loadBinsForCurrentLines() }, [JSON.stringify(lines)])

  // ---- Print current SO with bins (use autoTable function) ----
  // ---- Print current SO with bins (no dates in bins) ----
async function printCurrentSO(){
  if(!soId){ alert('Pick an order first'); return }
  try{
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')

    const doc = new jsPDF()
    doc.setFontSize(14)
    doc.text(`Sales Order ${orderHdr?.so_number || soId}`, 14, 16)
    doc.setFontSize(11)
    doc.text(`Customer: ${orderHdr?.customer_name || '-'}`, 14, 24)
    if(orderHdr?.created_at){
      doc.text(`Created: ${fmtDT(orderHdr.created_at)}`, 14, 31)
    }

    // Ensure bins are ready
    if(!Object.keys(binsByFg).length){
      await loadBinsForCurrentLines()
    }

    const body = (lines||[]).map(l=>{
      const fgName = l.finished_good_name || ''
      const bins = binsByFg[norm(fgName)] || []
      // ⬇️ No date hint here, only "BIN: QTY"
      const binsText = bins.length
        ? bins.map(b => `${b.bin_code}: ${b.qty}`).join(', ')
        : '—'
      return [
        fgName,
        `${Number(l.qty_shipped||0)} / ${Number(l.qty_ordered||0)}`,
        binsText
      ]
    })

    autoTable(doc, {
      startY: 38,
      head: [['Finished Good', 'Shipped / Ordered', 'Bins (oldest first)']],
      body,
      styles: { fontSize: 10, cellPadding: 2 },
      columnStyles: { 1: { halign:'right', cellWidth: 35 } }
    })

    doc.save(`SO_${orderHdr?.so_number || soId}.pdf`)
  }catch(err){
    alert('Failed to print: ' + (err?.message || String(err)))
  }
}


  return (
    <div className="grid">
      {/* Picker */}
      <div className="card">
        <div className="hd">
          <b>Outward / Sales Order Clearing</b>
          <div className="row" style={{gap:8}}>
            <input
              placeholder="Filter SO / Customer…"
              value={filter}
              onChange={e=>setFilter(e.target.value)}
              style={{minWidth:260}}
            />
            <label className="row" style={{gap:6}}>
              <input
                type="checkbox"
                checked={pendingOnly}
                onChange={e=>setPendingOnly(e.target.checked)}
                title="When ON, only pending orders appear"
              />
              Show only pending
            </label>
            <button className="btn" onClick={loadOrders} disabled={loadingOrders}>
              {loadingOrders ? 'Refreshing…' : 'Refresh List'}
            </button>
            <Link to="/sales" className="btn outline">Open Sales Orders</Link>
          </div>
        </div>
        <div className="bd">
          <select
            value={soId}
            onChange={e=>setSoId(e.target.value)}
            style={{minWidth:680}}
          >
            <option value="">
              — {pendingOnly ? 'Select Pending Sales Order' : 'Select Sales Order'} —
            </option>
            {filtered.map(o=>{
              const label = `${fmtDT(o.created_at)} — ${o.so_number || o.id} — ${o.customer_name} — ${o.qty_shipped_total}/${o.qty_ordered_total} (${o.status})`
              return <option key={o.id} value={o.id}>{label}</option>
            })}
          </select>
          {filtered.length===0 && (
            <div className="s" style={{marginTop:8, color:'var(--muted)'}}>
              {pendingOnly ? 'No pending orders found.' : 'No orders found.'}
            </div>
          )}
        </div>
      </div>

      {/* Scan / Assign */}
      <div className="card">
        <div className="hd">
          <b>{soId ? (`SO ${orderHdr?.so_number || soId}`) : 'No order selected'}</b>
          <div className="row" style={{gap:8}}>
            <span className="badge">{orderHdr?.customer_name || '-'}</span>
            {orderHdr?.created_at && <span className="badge">{fmtDT(orderHdr.created_at)}</span>}
            <span className="badge">Scanned: {totals.shipped}/{totals.ordered}</span>
            <label className="row" style={{gap:6}}>
              <input type="checkbox" checked={auto} onChange={e=>setAuto(e.target.checked)} />
              Auto-scan
            </label>
            <button className="btn outline" onClick={printCurrentSO} disabled={!soId || !lines.length}>Print (with bins)</button>
            <button className="btn ghost" onClick={undo} disabled={!soId || totals.shipped===0}>Undo last</button>
          </div>
        </div>
        <div className="bd">
          <form onSubmit={(e)=>{e.preventDefault(); assign(scan)}} className="row" style={{alignItems:'center', gap:8}}>
            <input
              ref={inputRef}
              placeholder={soId ? 'Scan / Enter packet barcode' : 'Pick an order first'}
              value={scan}
              onChange={e=>setScan(e.target.value)}
              onKeyDown={onKeyDown}
              autoFocus
              style={{minWidth:380}}
              disabled={!soId || cleared}
              title={!soId ? 'Pick an SO' : (cleared ? 'Order cleared' : '')}
            />
            <button className="btn" disabled={!soId || cleared}>Assign</button>
            {!!lastMsg && <span className="badge" style={{borderColor: lastMsg==='OK' ? 'var(--ok)' : 'var(--err)'}}>{lastMsg}</span>}
            {cleared && <span className="badge ok">Order Cleared</span>}
          </form>
        </div>
      </div>

      {/* Lines + Bin suggestions */}
      <div className="card">
        <div className="hd"><b>Items Required</b></div>
        <div className="bd" style={{overflow:'auto'}}>
          <table className="table">
            <thead>
              <tr>
                <th>Finished Good</th>
                <th style={{textAlign:'right'}}>Shipped / Ordered</th>
                <th>Bin Suggestions (oldest first)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l=>{
                const s = Number(l.qty_shipped||0), o = Number(l.qty_ordered||0)
                const done = s >= o && o>0
                const fgName = l.finished_good_name || ''
                const bins = binsByFg[norm(fgName)] || []
                return (
                  <tr key={l.id}>
                    <td>{fgName}</td>
                    <td style={{textAlign:'right'}}>{s} / {o}</td>
                    <td>
                      {loadingBins ? (
                        <span className="s" style={{color:'var(--muted)'}}>Loading bins…</span>
                      ) : bins.length ? (
                        <div className="row" style={{gap:8, flexWrap:'wrap'}}>
                          {bins.map(b=>(
                            <span
                              key={fgName + '|' + b.bin_code}
                              className="badge"
                              title={
                                b.oldest_produced_at
                                  ? `Oldest produced_at: ${fmtDT(b.oldest_produced_at)}`
                                  : 'No produced_at'
                              }
                            >
                              {b.bin_code}: {b.qty}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="s" style={{color:'var(--muted)'}}>No bins</span>
                      )}
                    </td>
                    <td><span className="badge" style={{borderColor: done ? 'var(--ok)' : 'var(--border)'}}>{done?'Cleared':'Pending'}</span></td>
                  </tr>
                )
              })}
              {(!lines.length) && (
                <tr><td colSpan="4" style={{color:'var(--muted)'}}>{soId ? 'No lines' : 'Pick an order to view lines'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
