import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { downloadCSV } from '../utils/csv'

function fmt(d) {
  if (!d) return '—'
  const t = typeof d === 'string' ? Date.parse(d) : d
  if (Number.isNaN(t)) return '—'
  return new Date(t).toLocaleString()
}

export default function BinInventory() {
  const [rows, setRows] = useState([])
  const [bins, setBins] = useState([])
  const [q, setQ] = useState('')
  const [binFilter, setBinFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 200

  async function loadAll() {
    setLoading(true)
    try {
      // 🟢 fetch all data in chunks
      const limit = 1000
      let from = 0
      let to = limit - 1
      let all = []
      while (true) {
        const { data, error } = await supabase
          .from('v_bin_inventory')
          .select('bin_code, packet_code, finished_good_name, status, produced_at, added_at')
          .order('bin_code', { ascending: true })
          .order('added_at', { ascending: false })
          .range(from, to)
        if (error) throw error
        if (!data?.length) break
        all.push(...data)
        if (data.length < limit) break
        from += limit
        to += limit
      }

      // Extract unique bin codes from the data
      const uniqueBins = [...new Set(all.map(r => r.bin_code).filter(Boolean))].sort()

      setRows(all)
      setBins(uniqueBins.map(code => ({ code })))
      setErrorMsg('')
    } catch (e) {
      console.error(e)
      setErrorMsg(e.message || String(e))
      setRows([])
      setBins([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  // realtime refresh
  useEffect(() => {
    const ch1 = supabase
      .channel('realtime:putaway')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'packet_putaway' }, () => loadAll())
    const ch2 = supabase
      .channel('realtime:packets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'packets' }, () => loadAll())
    ch1.subscribe()
    ch2.subscribe()
    return () => { try { supabase.removeChannel(ch1) } catch { }; try { supabase.removeChannel(ch2) } catch { } }
  }, [])

  // client-side filter + pagination
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase()
    const bf = (binFilter || '').trim().toUpperCase()
    return (rows || []).filter(r => {
      if (bf && String(r.bin_code || '').toUpperCase() !== bf) return false
      if (!qq) return true
      return (
        (r.packet_code || '').toLowerCase().includes(qq) ||
        (r.finished_good_name || '').toLowerCase().includes(qq) ||
        (r.bin_code || '').toLowerCase().includes(qq)
      )
    })
  }, [rows, q, binFilter])

  const totalUnits = rows.length
  const filteredUnits = filtered.length

  const totalPages = Math.max(1, Math.ceil(filteredUnits / pageSize))
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize)

  function exportCSV() {
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
        <div className="hd row space-between">
          <b>Bin Inventory</b>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>
            Total Units: <b>{totalUnits}</b> &nbsp;|&nbsp; Showing: <b>{filteredUnits}</b> &nbsp;|&nbsp; Page {page}/{totalPages}
          </span>
        </div>

        <div className="row" style={{ gap: 8, margin: '8px 0' }}>
          <input
            placeholder="Search barcode / item / bin…"
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1) }}
            style={{ minWidth: 280 }}
          />
          <select value={binFilter} onChange={e => { setBinFilter(e.target.value); setPage(1) }}>
            <option value="">All Bins</option>
            {bins.map(b => (
              <option key={b.code} value={b.code}>{b.code}</option>
            ))}
          </select>
          <button className="btn outline" onClick={exportCSV} disabled={loading || !filtered.length}>Export CSV</button>
          <button className="btn" onClick={loadAll} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>

        <div className="bd" style={{ overflow: 'auto' }}>
          {!!errorMsg && <div className="badge err" style={{ marginBottom: 8 }}>{errorMsg}</div>}
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
              {paged.map((r, i) => (
                <tr key={`${r.packet_code}-${i}`}>
                  <td><span className="badge">{r.bin_code}</span></td>
                  <td style={{ fontFamily: 'monospace' }}>{r.packet_code}</td>
                  <td>{r.finished_good_name}</td>
                  <td><span className="badge">{r.status}</span></td>
                  <td>{fmt(r.produced_at)}</td>
                  <td>{fmt(r.added_at)}</td>
                </tr>
              ))}
              {paged.length === 0 && (
                <tr>
                  <td colSpan="6" style={{ color: 'var(--muted)' }}>
                    {loading ? 'Loading…' : 'No packets in bins'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="row center" style={{ marginTop: 10, gap: 10 }}>
          <button
            className="btn outline"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
          >
            ← Prev
          </button>
          <button
            className="btn outline"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  )
}
