import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { downloadCSV } from '../utils/csv'

export default function FGInventory(){
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [minQty, setMinQty] = useState('')
  const [maxQty, setMaxQty] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [total, setTotal] = useState(0)

  async function load(){
    setLoading(true)

    const from = (page - 1) * pageSize
    const to   = from + pageSize - 1

    let qy = supabase
      .from('v_fg_inventory')
      .select('*', { count: 'exact' })

    // server-side filters
    if (q.trim()) qy = qy.ilike('name', `%${q.trim()}%`)
    if (minQty !== '') qy = qy.gte('qty_on_hand', Number(minQty))
    if (maxQty !== '') qy = qy.lte('qty_on_hand', Number(maxQty))

    qy = qy.order('name').range(from, to)

    const { data, error, count } = await qy
    if (error){ alert(error.message); setLoading(false); return }

    setRows(data || [])
    setTotal(count || 0)
    setLoading(false)
  }

  // initial + whenever filters/pagination change
  useEffect(()=>{ load() }, [q, minQty, maxQty, page, pageSize])

  // live updates when packets change (recompute counts)
  useEffect(()=>{
    const ch = supabase
      .channel('realtime:fginv')
      .on('postgres_changes',{event:'*',schema:'public',table:'packets'}, ()=>load())
      .subscribe()
    return ()=>supabase.removeChannel(ch)
  },[])

  const lowCount = useMemo(
    () => rows.filter(r => r.low_threshold && Number(r.qty_on_hand) <= Number(r.low_threshold)).length,
    [rows]
  )

  function exportCSV(){
    // export the FULL filtered result, not just current page
    // (runs one big request; if too large, we can stream/paginate export as well)
    ;(async ()=>{
      let qy = supabase.from('v_fg_inventory').select('*').order('name')
      if (q.trim()) qy = qy.ilike('name', `%${q.trim()}%`)
      if (minQty !== '') qy = qy.gte('qty_on_hand', Number(minQty))
      if (maxQty !== '') qy = qy.lte('qty_on_hand', Number(maxQty))
      const { data, error } = await qy.range(0, 9999) // up to 10k for export
      if (error){ alert(error.message); return }
      const all = data || []
      const rows = all.map(r=>({
        id: r.id, name: r.name, unit: r.unit || '',
        qty_on_hand: r.qty_on_hand, low_threshold: r.low_threshold || ''
      }))
      downloadCSV('fg_inventory.csv', rows)
    })()
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Finished Goods Inventory</b>
        </div>

        <div className="bd">
          {/* Filters */}
          <div className="row" style={{marginBottom:10}}>
            <input placeholder="Search FG name…" value={q} onChange={e=>{ setPage(1); setQ(e.target.value) }} />
            <input type="number" placeholder="Min qty" value={minQty} onChange={e=>{ setPage(1); setMinQty(e.target.value) }} style={{width:110}} />
            <input type="number" placeholder="Max qty" value={maxQty} onChange={e=>{ setPage(1); setMaxQty(e.target.value) }} style={{width:110}} />

            <select value={pageSize} onChange={e=>{ setPage(1); setPageSize(Number(e.target.value)) }}>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
              <option value={200}>200 / page</option>
              <option value={500}>500 / page</option>
            </select>

            <button className="btn ghost" onClick={load} disabled={loading}>{loading?'Refreshing…':'Refresh'}</button>
            <button className="btn" onClick={exportCSV} disabled={!total}>Export CSV</button>
          </div>

          {/* Summary */}
          <div className="row" style={{marginBottom:8}}>
            <span className="badge">Total: {total}</span>
            <span className="badge">Page: {page}/{totalPages}</span>
            <span className="badge">This page low: {lowCount}</span>
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
              {rows.map(r=>{
                const qty = Number(r.qty_on_hand||0)
                const thr = Number(r.low_threshold||0)
                const low = thr>0 && qty<=thr
                return (
                  <tr key={`fg-${r.id}`}>
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
              {rows.length===0 && (
                <tr><td colSpan={5} style={{color:'var(--muted)'}}>No items</td></tr>
              )}
            </tbody>
          </table>

          {/* Pagination controls */}
          <div className="row" style={{justifyContent:'space-between', marginTop:12}}>
            <div className="s">Showing {(rows.length ? (page-1)*pageSize+1 : 0)}–{(page-1)*pageSize + rows.length} of {total}</div>
            <div className="row">
              <button className="btn outline" onClick={()=>setPage(1)} disabled={page===1}>« First</button>
              <button className="btn outline" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}>‹ Prev</button>
              <button className="btn outline" onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}>Next ›</button>
              <button className="btn outline" onClick={()=>setPage(totalPages)} disabled={page===totalPages}>Last »</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
