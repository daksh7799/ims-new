import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { downloadCSV } from '../utils/csv'

export default function RMInventory(){
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [minQty, setMinQty] = useState('')
  const [maxQty, setMaxQty] = useState('')

  async function load(){
    setLoading(true)
    const { data, error } = await supabase.from('v_raw_inventory').select('*').order('name')
    if(error){ alert(error.message); setLoading(false); return }
    setRows(data || [])
    setLoading(false)
  }
  useEffect(()=>{ load() },[])

  const filtered = useMemo(()=>{
    const qq = q.trim().toLowerCase()
    const min = minQty==='' ? -Infinity : Number(minQty)
    const max = maxQty==='' ?  Infinity : Number(maxQty)
    return (rows||[]).filter(r=>{
      const matchQ = !qq || String(r.name||'').toLowerCase().includes(qq) || String(r.unit||'').toLowerCase().includes(qq)
      const qty = Number(r.qty_on_hand||0)
      return matchQ && qty >= min && qty <= max
    })
  },[rows,q,minQty,maxQty])

  const lowCount = filtered.filter(r => r.low_threshold && Number(r.qty_on_hand) <= Number(r.low_threshold)).length

  function exportCSV(){
    downloadCSV('rm_inventory.csv', filtered.map(r=>({
      id: r.id, name: r.name, unit: r.unit || '', qty_on_hand: r.qty_on_hand, low_threshold: r.low_threshold || ''
    })))
  }

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Raw Materials Inventory</b>
        </div>

        <div className="bd">
          {/* 🔎 Filters */}
          <div className="row" style={{marginBottom:10}}>
            <input placeholder="Search name / unit…" value={q} onChange={e=>setQ(e.target.value)} />
            <input type="number" placeholder="Min qty" value={minQty} onChange={e=>setMinQty(e.target.value)} style={{width:110}} />
            <input type="number" placeholder="Max qty" value={maxQty} onChange={e=>setMaxQty(e.target.value)} style={{width:110}} />
            <button className="btn ghost" onClick={load} disabled={loading}>{loading?'Refreshing…':'Refresh'}</button>
            <button className="btn" onClick={exportCSV} disabled={!filtered.length}>Export CSV</button>
          </div>

          <div className="row" style={{marginBottom:8}}>
            <span className="badge">Items: {filtered.length}</span>
            <span className="badge">Low: {lowCount}</span>
          </div>

          {/* Table */}
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
              {filtered.map(r=>{
                const qty = Number(r.qty_on_hand||0)
                const thr = Number(r.low_threshold||0)
                const low = thr>0 && qty<=thr
                return (
                  <tr key={`rm-${r.id}`}>
                    <td>{r.name}</td>
                    <td style={{textAlign:'right', fontWeight:700}}>{qty}</td>
                    <td style={{textAlign:'right'}}>{thr || '-'}</td>
                    <td>{r.unit || '-'}</td>
                    <td>
                      <span className="badge" style={{borderColor: low ? 'var(--err)' : 'var(--border)', color: low ? 'var(--err)' : 'var(--muted)'}}>
                        {low ? 'Low' : 'OK'}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {filtered.length===0 && (
                <tr><td colSpan={5} style={{color:'var(--muted)'}}>No items</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
