// src/pages/SOAdmin.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import AsyncFGSelect from '../components/AsyncFGSelect.jsx'

function fmtDT(ts) {
  if (!ts) return '—'
  const t = typeof ts === 'string' ? Date.parse(ts) : ts
  if (Number.isNaN(t)) return '—'
  return new Date(t).toLocaleString()
}

export default function SOAdmin() {
  // left pane: pick order
  const [pendingOnly, setPendingOnly] = useState(true)
  const [orders, setOrders] = useState([])
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [filter, setFilter] = useState('')
  const [soId, setSoId] = useState('')

  // right pane: editable lines
  const [hdr, setHdr] = useState(null)
  const [lines, setLines] = useState([]) // [{id?, finished_good_id, finished_good_name, qty_ordered, qty_shipped, _editFg?, _editFgId?, _dirty?}]
  const [busy, setBusy] = useState(false)
  const firstQtyRef = useRef(null)

  async function loadOrders() {
    setLoadingOrders(true)
    const { data, error } = await supabase
      .from('v_so_summary')
      .select('*')
      .is('cleared_at', null)
      .order('id', { ascending: false })
    if (error) { console.error(error); setOrders([]) } else { setOrders(data || []) }
    setLoadingOrders(false)
  }

  async function loadOne(id) {
    setHdr(null); setLines([])
    if (!id) return
    const [{ data: hdrs }, { data: ls, error: e2 }] = await Promise.all([
      supabase.from('v_so_summary').select('*').eq('id', id).limit(1),
      supabase.from('v_so_lines').select('*').eq('sales_order_id', id).order('id')
    ])
    setHdr(hdrs?.[0] || null)
    if (e2) { console.error(e2); setLines([]) }
    else {
      const shaped = (ls || []).map(l => ({
        id: l.id,
        finished_good_id: l.finished_good_id,
        finished_good_name: l.finished_good_name,
        qty_ordered: Number(l.qty_ordered || 0),
        qty_shipped: Number(l.qty_shipped || 0),
        _editFg: false,
        _editFgId: l.finished_good_id
      }))
      setLines(shaped)
    }
    setTimeout(() => firstQtyRef.current?.focus(), 0)
  }

  useEffect(() => { loadOrders() }, [])
  useEffect(() => { loadOne(soId) }, [soId])

  // realtime refresh
  useEffect(() => {
    const ch = supabase
      .channel('rt:so-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outward_allocations' }, () => {
        if (soId) loadOne(soId); loadOrders()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_orders' }, () => {
        if (soId) loadOne(soId); loadOrders()
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [soId])

  // filter list
  const filtered = useMemo(() => {
    const s = filter.trim().toLowerCase()
    const base = orders || []
    const base2 = pendingOnly
      ? base.filter(o => Number(o.qty_shipped_total || 0) < Number(o.qty_ordered_total || 0))
      : base
    return base2.filter(o =>
      !s ||
      String(o.so_number || '').toLowerCase().includes(s) ||
      String(o.customer_name || '').toLowerCase().includes(s)
    )
  }, [orders, filter, pendingOnly])

  // ---------- edit helpers ----------
  function setLine(idx, patch) {
    setLines(ls => ls.map((l, i) => i === idx ? ({ ...l, ...patch }) : l))
  }
  function markDirty(idx) {
    setLines(ls => ls.map((l, i) => i === idx ? ({ ...l, _dirty: true }) : l))
  }
  function startChangeFg(idx) {
    setLines(ls => ls.map((l, i) => i === idx ? ({ ...l, _editFg: true, _editFgId: l.finished_good_id }) : l))
  }
  function cancelChangeFg(idx) {
    setLines(ls => ls.map((l, i) => i === idx ? ({ ...l, _editFg: false, _editFgId: l.finished_good_id }) : l))
  }
  function applyChangeFg(idx, id, name) {
    setLines(ls => ls.map((l, i) => i === idx
      ? ({ ...l, finished_good_id: id, finished_good_name: (name || l.finished_good_name), _editFg: false, _editFgId: id, _dirty: true })
      : l
    ))
  }
  function removeLine(idx) {
    setLines(ls => ls.filter((_, i) => i !== idx))
  }
  function addLine() {
    setLines(ls => [
      ...ls,
      { _new: true, finished_good_id: '', finished_good_name: '', qty_ordered: 1, qty_shipped: 0, _editFg: true, _editFgId: '', _dirty: true }
    ])
  }

  async function saveChanges() {
    if (!soId) return

    // Validate: FG selected and qty >= shipped
    for (const l of lines) {
      if (!String(l.finished_good_id || '').trim()) {
        alert('Every line must have a Finished Good selected.')
        return
      }
      const qo = Number(l.qty_ordered || 0)
      const qs = Number(l.qty_shipped || 0)
      if (qo < qs) {
        alert(`Ordered qty cannot be less than shipped qty for ${l.finished_good_name || l.finished_good_id}.`)
        return
      }
    }

    const payload = lines.map(l => ({
      id: l.id || null,
      finished_good_id: String(l.finished_good_id),
      qty: Number(l.qty_ordered)
    }))

    setBusy(true)
    try {
      const { error } = await supabase.rpc('so_api_update', {
        p_so_id: Number(soId),
        p_lines: payload
      })
      if (error) throw error
      await loadOne(soId)
      alert('Sales order updated.')
    } catch (err) {
      alert(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  async function deleteSO() {
    if (!soId) return
    if (!confirm('Delete this Sales Order? Allowed only if no shipments.')) return
    setBusy(true)
    try {
      const { error } = await supabase.rpc('so_api_delete', { p_so_id: Number(soId) })
      if (error) throw error
      alert('Sales order deleted.')
      setSoId('')
      await loadOrders()
    } catch (err) {
      alert(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid">
      {/* LEFT: picker */}
      <div className="card">
        <div className="hd">
          <b>SO Admin</b>
          <div className="row" style={{ gap: 8 }}>
            <input
              placeholder="Filter SO / Customer…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{ minWidth: 240 }}
            />
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={pendingOnly}
                onChange={e => setPendingOnly(e.target.checked)}
              />
              Show only pending
            </label>
            <button className="btn ghost" onClick={loadOrders} disabled={loadingOrders}>
              {loadingOrders ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        <div className="bd">
          <select value={soId} onChange={e => setSoId(e.target.value)} style={{ minWidth: 700 }}>
            <option value="">— Select Sales Order —</option>
            {filtered.map(o => {
              const label = `${fmtDT(o.created_at)} — ${o.so_number || o.id} — ${o.customer_name} — ${o.qty_shipped_total}/${o.qty_ordered_total} (${o.status})`
              return <option key={o.id} value={o.id}>{label}</option>
            })}
          </select>
          {filtered.length === 0 && (
            <div className="s" style={{ marginTop: 8, color: 'var(--muted)' }}>No orders found.</div>
          )}
        </div>
      </div>

      {/* RIGHT: editor */}
      <div className="card">
        <div className="hd">
          <b>{soId ? `SO ${hdr?.so_number || soId}` : 'No order selected'}</b>
          <div className="row" style={{ gap: 8 }}>
            <span className="badge">{hdr?.customer_name || '-'}</span>
            {hdr?.created_at && <span className="badge">{fmtDT(hdr.created_at)}</span>}
            {soId && (
              <>
                <button className="btn" onClick={saveChanges} disabled={busy || !soId}>Save Changes</button>
                <button className="btn ghost" onClick={deleteSO} disabled={busy || !soId}>Delete SO</button>
              </>
            )}
          </div>
        </div>

        <div className="bd" style={{ display: 'grid', gap: 10 }}>
          {!soId && <div className="s" style={{ color: 'var(--muted)' }}>Pick an SO to edit its items.</div>}

          {soId && (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: '45%' }}>Finished Good</th>
                    <th style={{ textAlign: 'right', width: 140 }}>Ordered</th>
                    <th style={{ textAlign: 'right', width: 140 }}>Shipped</th>
                    <th style={{ width: 180 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => {
                    const bad = Number(l.qty_ordered || 0) < Number(l.qty_shipped || 0)
                    return (
                      <tr key={l.id || `new-${idx}`}>
                        <td>
                          {!l._editFg ? (
                            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              <div>{l.finished_good_name || <i>(Unnamed FG)</i>}</div>
                              <button className="btn ghost" onClick={() => startChangeFg(idx)}>Change</button>
                            </div>
                          ) : (
                            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              <AsyncFGSelect
                                value={l._editFgId}
                                onChange={(id, item) => setLine(idx, { _editFgId: id, _editFgName: item?.name || '' })}
                                placeholder="Select FG…"
                                minChars={1}
                                pageSize={25}
                              />
                              <button
                                className="btn"
                                onClick={() => applyChangeFg(idx, l._editFgId, l._editFgName)}
                                disabled={!String(l._editFgId || '').trim()}
                              >
                                Save FG
                              </button>
                              <button className="btn ghost" onClick={() => cancelChangeFg(idx)}>Cancel</button>
                            </div>
                          )}
                        </td>

                        <td style={{ textAlign: 'right' }}>
                          <input
                            ref={idx === 0 ? firstQtyRef : undefined}
                            type="number" min={l.qty_shipped || 0} step="1"
                            value={l.qty_ordered}
                            onChange={e => { setLine(idx, { qty_ordered: Number(e.target.value || 0) }); markDirty(idx) }}
                            style={{ width: 120, textAlign: 'right', borderColor: bad ? 'var(--error)' : undefined }}
                            title={bad ? 'Cannot be less than shipped' : ''}
                          />
                        </td>
                        <td style={{ textAlign: 'right', opacity: 0.7 }}>{l.qty_shipped}</td>
                        <td>
                          <button className="btn ghost" onClick={() => removeLine(idx)}>Remove</button>
                        </td>
                      </tr>
                    )
                  })}
                  {lines.length === 0 && (
                    <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>No lines (add items below)</td></tr>
                  )}
                </tbody>
              </table>

              <div className="row" style={{ gap: 8 }}>
                <button className="btn outline" onClick={addLine}>+ Add Item</button>
                <span className="s" style={{ color: 'var(--muted)' }}>Save to apply changes.</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
