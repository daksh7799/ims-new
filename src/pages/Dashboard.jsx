import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'

export default function Dashboard(){
  const [rawInv, setRawInv] = useState([])
  const [fgInv, setFgInv]   = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  async function load(){
    setLoading(true)
    const [{ data: raw }, { data: fg }] = await Promise.all([
      supabase.from('v_raw_inventory').select('*').order('name'),
      supabase.from('v_fg_inventory').select('*').order('name')
    ])
    setRawInv(raw || [])
    setFgInv(fg || [])
    setLoading(false)
  }

  useEffect(()=>{ load() },[])

  // Realtime: reload when stock_ledger changes
  useEffect(()=>{
    const ch = supabase
      .channel('realtime:stock')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_ledger' }, () => {
        load()
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  },[])

  const q = search.trim().toLowerCase()
  const rawFiltered = useMemo(()=> rawInv.filter(r => !q || r.name.toLowerCase().includes(q)), [rawInv, q])
  const fgFiltered  = useMemo(()=> fgInv.filter(r => !q || r.name.toLowerCase().includes(q)), [fgInv, q])

  const rawLow = rawFiltered.filter(r => r.low_threshold && Number(r.qty_on_hand) <= Number(r.low_threshold)).length
  const fgLow  = fgFiltered.filter(r => r.low_threshold && Number(r.qty_on_hand) <= Number(r.low_threshold)).length

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Inventory Dashboard</b>
          <div className="row">
            <input placeholder="Search items…" value={search} onChange={e=>setSearch(e.target.value)} />
            <button className="btn ghost" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        </div>
        <div className="bd">
          <div className="grid cols-2">
            <KPI title="Raw Materials (items)" value={rawFiltered.length} sub={`${rawLow} low`} />
            <KPI title="Finished Goods (items)" value={fgFiltered.length} sub={`${fgLow} low`} />
          </div>
        </div>
      </div>

      <div className="grid cols-2">
        <InventoryCard title="Raw Materials" rows={rawFiltered} kind="raw" />
        <InventoryCard title="Finished Goods" rows={fgFiltered} kind="fg" />
      </div>
    </div>
  )
}

function KPI({ title, value, sub }){
  return (
    <div className="card">
      <div className="bd kpi" style={{justifyContent:'space-between'}}>
        <div>
          <div className="s">{title}</div>
          <div className="n">{value}</div>
        </div>
        <span className="badge">{sub}</span>
      </div>
    </div>
  )
}

function InventoryCard({ title, rows, kind }){
  return (
    <div className="card">
      <div className="hd"><b>{title}</b><span className="badge">{rows.length} items</span></div>
      <div className="bd" style={{overflow:'auto'}}>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th style={{textAlign:'right'}}>On Hand</th>
              <th style={{textAlign:'right'}}>Threshold</th>
              <th>Unit</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r=>{
              const qty = Number(r.qty_on_hand || 0)
              const thr = Number(r.low_threshold || 0)
              const low = thr > 0 && qty <= thr
              return (
                <tr key={`${kind}-${r.id}`}>
                  <td>{r.name}</td>
                  <td style={{textAlign:'right', fontWeight:700}}>{qty}</td>
                  <td style={{textAlign:'right'}}>{thr || '-'}</td>
                  <td>{r.unit || '-'}</td>
                  <td>
                    <span className="badge" style={{borderColor: low ? 'var(--error)' : 'var(--border)', color: low ? 'var(--error)' : 'var(--muted)'}}>
                      {low ? 'Low' : 'OK'}
                    </span>
                  </td>
                </tr>
              )
            })}
            {rows.length===0 && (
              <tr><td colSpan={5} style={{color:'var(--muted)'}}>No items</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
