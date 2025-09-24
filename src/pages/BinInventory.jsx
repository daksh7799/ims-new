import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { downloadCSV } from '../utils/csv'

function fmt(d){
  if(!d) return '—'
  const t = typeof d === 'string' ? Date.parse(d) : d
  if (Number.isNaN(t)) return '—'
  return new Date(t).toLocaleString()
}

export default function BinInventory(){
  const [rows, setRows] = useState([])
  const [bins, setBins] = useState([])
  const [q, setQ] = useState('')
  const [binFilter, setBinFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  async function load(){
    setLoading(true)
    try{
      const [{ data:inv, error:e1 }, { data:binRows, error:e2 }] = await Promise.all([
        supabase
          .from('v_bin_inventory')
          .select('bin_code, packet_code, finished_good_name, status, produced_at, added_at')
          .order('bin_code', { ascending: true })
          .order('added_at', { ascending: false }),
        supabase
          .from('v_bin_counts')
          .select('bin_code, packets')
          .order('bin_code', { ascending: true })
      ])
      if(e1) throw e1
      if(e2) console.warn(e2)
      setRows(inv || [])
      setBins((binRows || []).map(b => ({ code: b.bin_code, count: b.packets })))
      setErrorMsg('')
    }catch(e){
      console.error(e)
      setErrorMsg(e.message || String(e))
      setRows([])
      setBins([])
    }finally{
      setLoading(false)
    }
  }

  useEffect(()=>{ load() }, [])

  useEffect(()=>{
    const ch1 = supabase
      .channel('realtime:putaway')
      .on('postgres_changes', { event:'*', schema:'public', table:'packet_putaway' }, () => load())
    const ch2 = supabase
      .channel('realtime:packets')
      .on('postgres_changes', { event:'*', schema:'public', table:'packets' }, () => load())
    ch1.subscribe()
    ch2.subscribe()
    return () => { try{ supabase.removeChannel(ch1) }catch{}; try{ supabase.removeChannel(ch2) }catch{} }
  }, [])

  const filtered = useMemo(()=>{
    const qq = q.trim().toLowerCase()
    const bf = (binFilter || '').trim().toUpperCase()
    return (rows || []).filter(r=>{
      if(bf && String(r.bin_code || '').toUpperCase() !== bf) return false
      if(!qq) return true
      return (
        (r.packet_code || '').toLowerCase().includes(qq) ||
        (r.finished_good_name || '').toLowerCase().includes(qq) ||
        (r.bin_code || '').toLowerCase().includes(qq)
      )
    })
  }, [rows, q, binFilter])

  function exportCSV(){
    downloadCSV('bin_inventory.csv', filtered.map(r => ({
      bin: r.bin_code,
      barcode: r.packet_code,
      item: r.finished_good_name,
      status: r.status,
      produced_at: r.produced_at,
      added_at: r.added_at
    })))
  }

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Bin Inventory</b>
          <div className="row" style={{ gap:8 }}>
            <input
              placeholder="Search barcode / item / bin…"
              value={q}
              onChange={e=>setQ(e.target.value)}
              style={{ minWidth:280 }}
            />
            <select value={binFilter} onChange={e=>setBinFilter(e.target.value)}>
              <option value="">All Bins</option>
              {bins.map(b=>(
                <option key={b.code} value={b.code}>{b.code} ({b.count})</option>
              ))}
            </select>
            <button className="btn outline" onClick={exportCSV} disabled={loading || !filtered.length}>Export CSV</button>
            <button className="btn" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        </div>

        <div className="bd" style={{ overflow:'auto' }}>
          {!!errorMsg && <div className="badge err" style={{marginBottom:8}}>{errorMsg}</div>}
          <table className="table">
            <thead>
              <tr>
                <th>Bin</th>
                <th>Barcode</th>
                <th>Item</th>
                <th>Status</th>
                <th>Produced</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i)=>(
                <tr key={`${r.packet_code}-${i}`}>
                  <td><span className="badge">{r.bin_code}</span></td>
                  <td style={{ fontFamily:'monospace' }}>{r.packet_code}</td>
                  <td>{r.finished_good_name}</td>
                  <td><span className="badge">{r.status}</span></td>
                  <td>{fmt(r.produced_at)}</td>
                  <td>{fmt(r.added_at)}</td>
                </tr>
              ))}
              {filtered.length===0 && (
                <tr>
                  <td colSpan="6" style={{ color:'var(--muted)' }}>
                    {loading ? 'Loading…' : 'No packets in bins'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
