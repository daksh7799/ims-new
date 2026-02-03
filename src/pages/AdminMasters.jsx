// src/pages/AdminMasters.jsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import AsyncRMSelect from '../components/AsyncRMSelect'

/* ---------------- generic paged list loader ----------------
   - Server-side search on one or more columns (searchCols)
   - Prev/Next pagination with total count
---------------------------------------------------------------- */
function usePagedList({
  table,
  orderBy = 'name',
  searchCols = ['name'],
  initialPageSize = 100,
}) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [total, setTotal] = useState(0)

  async function load() {
    setLoading(true)
    try {
      const from = page * pageSize
      const to = from + pageSize - 1

      let query = supabase
        .from(table)
        .select('*', { count: 'exact' })
        .order(orderBy, { ascending: true })
        .range(from, to)

      const s = q.trim()
      if (s) {
        // Build Supabase .or() filter: "col.ilike.%term%,other.ilike.%term%"
        const like = `%${s}%`
        const orExpr = searchCols.map(c => `${c}.ilike.${like}`).join(',')
        query = query.or(orExpr)
      }

      const { data, error, count } = await query
      if (error) throw error
      setRows(data || [])
      setTotal(count ?? 0)
    } catch (err) {
      alert(err.message || String(err))
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [table, orderBy, page, pageSize, q])

  // UI helpers
  const pageCount = Math.max(1, Math.ceil((total || 0) / Math.max(1, pageSize)))
  const canPrev = page > 0
  const canNext = page + 1 < pageCount

  function nextPage() { if (canNext) setPage(p => p + 1) }
  function prevPage() { if (canPrev) setPage(p => p - 1) }
  function changePageSize(n) { setPageSize(n); setPage(0) } // reset to page 0 on size change
  function onSearchChange(v) { setQ(v); setPage(0) } // reset page on new search

  return {
    rows, setRows, loading, reload: load,
    q, setQ: onSearchChange,
    page, pageSize, setPage, setPageSize: changePageSize,
    total, pageCount, canPrev, canNext, nextPage, prevPage,
  }
}

export default function AdminMasters() {
  const [tab, setTab] = useState('rm')

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Master Data</b>
          <div className="row" style={{ gap: 8 }}>
            <button className={`btn small ${tab === 'rm' ? '' : 'outline'}`} onClick={() => setTab('rm')}>Raw Materials</button>
            <button className={`btn small ${tab === 'fg' ? '' : 'outline'}`} onClick={() => setTab('fg')}>Finished Goods</button>
            <button className={`btn small ${tab === 'ven' ? '' : 'outline'}`} onClick={() => setTab('ven')}>Vendors</button>
            <button className={`btn small ${tab === 'cust' ? '' : 'outline'}`} onClick={() => setTab('cust')}>Customers</button>
            <button className={`btn small ${tab === 'pairs' ? '' : 'outline'}`} onClick={() => setTab('pairs')}>Processing Pairs</button>
            <button className={`btn small ${tab === 'raw_outward' ? '' : 'outline'}`} onClick={() => setTab('raw_outward')}>Raw Outward</button>
          </div>
        </div>
        <div className="bd">
          {tab === 'rm' && <RMSection />}
          {tab === 'fg' && <FGSection />}
          {tab === 'ven' && <SimpleSection table="vendors" title="Vendors" />}
          {tab === 'cust' && <SimpleSection table="customers" title="Customers" />}
          {tab === 'pairs' && <PairsSection />}
          {tab === 'raw_outward' && <RawOutwardSection />}
        </div>
      </div>
    </div>
  )
}

/* ---------------- Raw Materials ---------------- */
function RMSection() {
  const {
    rows, setRows, loading, reload,
    q, setQ, page, pageSize, setPageSize, total, pageCount,
    canPrev, canNext, nextPage, prevPage,
  } = usePagedList({ table: 'raw_materials', orderBy: 'name', searchCols: ['name'], initialPageSize: 100 })

  const [name, setName] = useState('')
  const [unit, setUnit] = useState('kg')
  const [low, setLow] = useState('')
  const [gstRate, setGstRate] = useState('5')
  const [accName, setAccName] = useState('')

  async function add() {
    const payload = {
      name: name.trim(),
      unit: unit.trim() || null,
      low_threshold: low ? Number(low) : null,
      gst_rate: gstRate ? Number(gstRate) : 5,
      accounting_name: accName.trim() || null,
      is_active: true
    }
    if (!payload.name) return alert('Enter name')
    const { error } = await supabase.from('raw_materials').insert(payload)
    if (error) { alert(error.message); return }
    setName(''); setUnit('kg'); setLow(''); setGstRate('5'); setAccName('')
    reload()
  }

  async function save(row) {
    const { error } = await supabase
      .from('raw_materials')
      .update({
        name: row.name,
        unit: row.unit || null,
        low_threshold: row.low_threshold ? Number(row.low_threshold) : null,
        gst_rate: row.gst_rate ? Number(row.gst_rate) : 5,
        accounting_name: row.accounting_name || null,
        is_active: !!row.is_active
      })
      .eq('id', row.id)
    if (error) { alert(error.message); return }
  }

  async function remove(row) {
    if (!confirm(`Disable raw material "${row.name}"?`)) return
    const { error } = await supabase.from('raw_materials').update({ is_active: false }).eq('id', row.id)
    if (error) { alert(error.message); return }
    reload()
  }

  return (
    <>
      {/* Toolbar */}
      <div className="row" style={{ marginBottom: 10, gap: 8, alignItems: 'center' }}>
        <input placeholder="Search raw materials…" value={q} onChange={e => setQ(e.target.value)} />
        <span className="badge">Page {page + 1} / {pageCount}</span>
        <span className="badge">Loaded {rows.length} • Total {total}</span>
        <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} title="Rows per page">
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
          <option value={200}>200 / page</option>
        </select>
        <button className="btn small" onClick={prevPage} disabled={!canPrev}>Prev</button>
        <button className="btn small" onClick={nextPage} disabled={!canNext}>Next</button>
        <button className="btn ghost" onClick={reload} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'
          }</button>
      </div>

      {/* Add row */}
      <div className="row" style={{ marginBottom: 10, gap: 8 }}>
        <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} style={{ minWidth: 200 }} />
        <input placeholder="Unit" value={unit} onChange={e => setUnit(e.target.value)} style={{ width: 80 }} />
        <input placeholder="Low" type="number" value={low} onChange={e => setLow(e.target.value)} style={{ width: 80 }} />
        <input placeholder="GST %" type="number" value={gstRate} onChange={e => setGstRate(e.target.value)} style={{ width: 80 }} />
        <input placeholder="Accounting Name" value={accName} onChange={e => setAccName(e.target.value)} style={{ minWidth: 150 }} />
        <button className="btn" onClick={add}>Add</button>
      </div>

      {/* Table */}
      <div style={{ overflow: 'auto', maxHeight: 520 }}>
        <table className="table">
          <thead><tr><th>Name</th><th>Unit</th><th>Low</th><th>GST %</th><th>Accounting Name</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td><input value={r.name || ''} onChange={e => setRows(list => list.map(x => x.id === r.id ? { ...x, name: e.target.value } : x))} /></td>
                <td><input value={r.unit || ''} onChange={e => setRows(list => list.map(x => x.id === r.id ? { ...x, unit: e.target.value } : x))} style={{ width: 80 }} /></td>
                <td><input type="number" value={r.low_threshold ?? ''} onChange={e => setRows(list => list.map(x => x.id === r.id ? { ...x, low_threshold: e.target.value } : x))} style={{ width: 80 }} /></td>
                <td><input type="number" value={r.gst_rate ?? ''} onChange={e => setRows(list => list.map(x => x.id === r.id ? { ...x, gst_rate: e.target.value } : x))} style={{ width: 80 }} /></td>
                <td><input value={r.accounting_name || ''} onChange={e => setRows(list => list.map(x => x.id === r.id ? { ...x, accounting_name: e.target.value } : x))} /></td>
                <td><input type="checkbox" checked={!!r.is_active}
                  onChange={e => setRows(list => list.map(x => x.id === r.id ? { ...x, is_active: e.target.checked } : x))}
                /></td>
                <td className="row">
                  <button className="btn small" onClick={() => save(r)}>Save</button>
                  <button className="btn small outline" onClick={() => remove(r)}>Disable</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan="7" className="s">{loading ? 'Loading…' : 'No raw materials'}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ---------------- Finished Goods (search in name + barcode_prefix) ---------------- */
function FGSection() {
  const {
    rows, setRows, loading, reload,
    q, setQ, page, pageSize, setPageSize, total, pageCount,
    canPrev, canNext, nextPage, prevPage,
  } = usePagedList({ table: 'finished_goods', orderBy: 'name', searchCols: ['name', 'barcode_prefix'], initialPageSize: 100 })

  const [name, setName] = useState('')
  const [prefix, setPrefix] = useState('')
  const [low, setLow] = useState('')
  const [tracked, setTracked] = useState(false)

  async function add() {
    const payload = {
      name: name.trim(),
      barcode_prefix: prefix.trim(),
      is_active: true,
      low_threshold: low ? Number(low) : null,
      is_tracked_for_pending: tracked
    }
    if (!payload.name) return alert('Enter name')
    const { error } = await supabase.from('finished_goods').insert(payload)
    if (error) { alert(error.message); return }
    if (error) { alert(error.message); return }
    setName(''); setPrefix(''); setLow(''); setTracked(false)
    reload()
  }

  async function save(row) {
    const { error } = await supabase
      .from('finished_goods')
      .update({
        name: row.name,
        barcode_prefix: row.barcode_prefix || '',
        is_active: !!row.is_active,
        low_threshold: row.low_threshold ? Number(row.low_threshold) : null,
        is_tracked_for_pending: !!row.is_tracked_for_pending
      })
      .eq('id', row.id)
    if (error) { alert(error.message); return }
  }

  async function remove(row) {
    if (!confirm(`Disable finished good "${row.name}"?`)) return
    const { error } = await supabase.from('finished_goods').update({ is_active: false }).eq('id', row.id)
    if (error) { alert(error.message); return }
    reload()
  }

  return (
    <>
      {/* Toolbar */}
      <div className="row" style={{ marginBottom: 10, gap: 8, alignItems: 'center' }}>
        <input placeholder="Search finished goods (name / prefix)…" value={q} onChange={e => setQ(e.target.value)} />
        <span className="badge">Page {page + 1} / {pageCount}</span>
        <span className="badge">Loaded {rows.length} • Total {total}</span>
        <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} title="Rows per page">
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
          <option value={200}>200 / page</option>
        </select>
        <button className="btn small" onClick={prevPage} disabled={!canPrev}>Prev</button>
        <button className="btn small" onClick={nextPage} disabled={!canNext}>Next</button>
        <button className="btn ghost" onClick={reload} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Add row */}
      <div className="row" style={{ marginBottom: 10, gap: 8 }}>
        <input placeholder="Name" value={name} onChange={e => setName(e.target.value)} style={{ minWidth: 240 }} />
        <input placeholder="Barcode Prefix (e.g., RAGGI-1KG)" value={prefix} onChange={e => setPrefix(e.target.value)} style={{ minWidth: 220 }} />
        <input placeholder="Low threshold (optional)" type="number" value={low} onChange={e => setLow(e.target.value)} style={{ width: 180 }} />
        <label className="row" style={{ gap: 4, fontSize: 13 }}>
          <input type="checkbox" checked={tracked} onChange={e => setTracked(e.target.checked)} />
          Track Pending
        </label>
        <button className="btn" onClick={add}>Add Finished Good</button>
      </div>

      {/* Table */}
      <div style={{ overflow: 'auto', maxHeight: 520 }}>
        <table className="table">
          <thead><tr><th>Name</th><th>Barcode Prefix</th><th>Low Threshold</th><th>Track Pending</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td><input value={r.name || ''} onChange={e => setRows(list => list.map(x => x.id === r.id ? { ...x, name: e.target.value } : x))} /></td>
                <td><input value={r.barcode_prefix || ''} onChange={e => setRows(list => list.map(x => x.id === r.id ? { ...x, barcode_prefix: e.target.value } : x))} style={{ minWidth: 220 }} /></td>
                <td><input type="number" value={r.low_threshold ?? ''} onChange={e => setRows(list => list.map(x => x.id === r.id ? { ...x, low_threshold: e.target.value } : x))} style={{ width: 140 }} /></td>
                <td><input type="checkbox" checked={!!r.is_tracked_for_pending}
                  onChange={e => setRows(list => list.map(x => x.id === r.id ? { ...x, is_tracked_for_pending: e.target.checked } : x))}
                /></td>
                <td><input type="checkbox" checked={!!r.is_active}
                  onChange={e => setRows(list => list.map(x => x.id === r.id ? { ...x, is_active: e.target.checked } : x))}
                /></td>
                <td className="row">
                  <button className="btn small" onClick={() => save(r)}>Save</button>
                  <button className="btn small outline" onClick={() => remove(r)}>Disable</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan="6" className="s">{loading ? 'Loading…' : 'No finished goods'}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ---------------- Vendors/Customers (simple paged) ---------------- */
function SimpleSection({ table, title }) {
  const {
    rows, setRows, loading, reload,
    q, setQ, page, pageSize, setPageSize, total, pageCount,
    canPrev, canNext, nextPage, prevPage,
  } = usePagedList({ table, orderBy: 'name', searchCols: ['name'], initialPageSize: 100 })

  const [name, setName] = useState('')

  async function add() {
    const payload = { name: name.trim(), is_active: true }
    if (!payload.name) return alert('Enter name')
    const { error } = await supabase.from(table).insert(payload)
    if (error) { alert(error.message); return }
    setName(''); reload()
  }

  async function save(row) {
    const { error } = await supabase
      .from(table)
      .update({ name: row.name, is_active: !!row.is_active })
      .eq('id', row.id)
    if (error) { alert(error.message); return }
  }

  async function remove(row) {
    if (!confirm(`Disable ${title.slice(0, -1).toLowerCase()} "${row.name}"?`)) return
    const { error } = await supabase.from(table).update({ is_active: false }).eq('id', row.id)
    if (error) { alert(error.message); return }
    reload()
  }

  return (
    <>
      {/* Toolbar */}
      <div className="row" style={{ marginBottom: 10, gap: 8, alignItems: 'center' }}>
        <input placeholder={`Search ${title.toLowerCase()}…`} value={q} onChange={e => setQ(e.target.value)} />
        <span className="badge">Page {page + 1} / {pageCount}</span>
        <span className="badge">Loaded {rows.length} • Total {total}</span>
        <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} title="Rows per page">
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
          <option value={200}>200 / page</option>
        </select>
        <button className="btn small" onClick={prevPage} disabled={!canPrev}>Prev</button>
        <button className="btn small" onClick={nextPage} disabled={!canNext}>Next</button>
        <button className="btn ghost" onClick={reload} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Add row */}
      <div className="row" style={{ marginBottom: 10, gap: 8 }}>
        <input placeholder={`${title.slice(0, -1)} name`} value={name} onChange={e => setName(e.target.value)} style={{ minWidth: 240 }} />
        <button className="btn" onClick={add}>Add {title.slice(0, -1)}</button>
      </div>

      {/* Table */}
      <div style={{ overflow: 'auto', maxHeight: 520 }}>
        <table className="table">
          <thead><tr><th>Name</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td><input value={r.name || ''} onChange={e => setRows(list => list.map(x => x.id === r.id ? { ...x, name: e.target.value } : x))} /></td>
                <td><input type="checkbox" checked={!!r.is_active} onChange={e => setRows(list => list.map(x => x.id === r.id ? { ...x, is_active: e.target.checked } : x))} /></td>
                <td className="row">
                  <button className="btn small" onClick={() => save(r)}>Save</button>
                  <button className="btn small outline" onClick={() => remove(r)}>Disable</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan="3" className="s">{loading ? 'Loading…' : `No ${title.toLowerCase()}`}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ---------------- Processing Pairs (kept simple) ---------------- */
function PairsSection() {
  const [pairs, setPairs] = useState([])
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState('')
  const [output, setOutput] = useState('')
  const [raws, setRaws] = useState([])

  async function load() {
    setLoading(true)

    // pairs view
    const { data, error } = await supabase.from('v_processing_pairs_expanded').select('*')
    if (error) { alert(error.message); setPairs([]) } else setPairs(data || [])

    // all active raw materials for dropdowns (paged fetch)
    const all = []
    for (let i = 0; i < 50; i++) {
      const from = i * 1000, to = from + 999
      const { data: rms, error: e2 } = await supabase
        .from('raw_materials')
        .select('id,name')
        .eq('is_active', true)
        .order('name', { ascending: true })
        .range(from, to)
      if (e2) { alert(e2.message); break }
      if (!rms || rms.length === 0) break
      all.push(...rms)
      if (rms.length < 1000) break
    }
    setRaws(all)

    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function add() {
    if (!source || !output) return alert('Pick both source and output')
    const { error } = await supabase.from('processing_pairs').insert({
      source_rm_id: source,
      output_rm_id: output,
      is_active: true
    })
    if (error) { alert(error.message); return }
    setSource(''); setOutput('')
    load()
  }

  async function toggleActive(p) {
    const { error } = await supabase
      .from('processing_pairs')
      .update({ is_active: !p.is_active })
      .eq('id', p.id)
    if (error) { alert(error.message); return }
    load()
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 10, gap: 8, alignItems: 'center' }}>
        <span className="badge">Loaded {pairs.length} pairs</span>
        <button className="btn ghost" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      <div className="row" style={{ marginBottom: 10, gap: 8 }}>
        <select value={source} onChange={e => setSource(e.target.value)}>
          <option value="">-- Source RM --</option>
          {raws.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select value={output} onChange={e => setOutput(e.target.value)}>
          <option value="">-- Output RM --</option>
          {raws.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <button className="btn" onClick={add}>Add Pair</button>
      </div>

      <div style={{ overflow: 'auto', maxHeight: 520 }}>
        <table className="table">
          <thead><tr><th>Source RM</th><th>Output RM</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {pairs.map(p => (
              <tr key={p.id}>
                <td>{p.source_rm_name}</td>
                <td>{p.output_rm_name}</td>
                <td>{p.is_active ? 'Yes' : 'No'}</td>
                <td>
                  <button className="btn small" onClick={() => toggleActive(p)}>
                    {p.is_active ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
            {pairs.length === 0 && <tr><td colSpan="4" className="s">No pairs defined</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* ---------------- Raw Outward (Multi-line) ---------------- */
function RawOutwardSection() {
  const [lines, setLines] = useState([{ id: Date.now(), rm_id: null, qty: '', unit: '' }])
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)

  function addLine() {
    setLines([...lines, { id: Date.now(), rm_id: null, qty: '', unit: '' }])
  }

  function removeLine(id) {
    if (lines.length === 1) return
    setLines(lines.filter(l => l.id !== id))
  }

  function updateLine(id, patch) {
    setLines(lines.map(l => l.id === id ? { ...l, ...patch } : l))
  }

  async function handleOutward() {
    const validLines = lines.filter(l => l.rm_id && l.qty && !isNaN(Number(l.qty)) && Number(l.qty) > 0)
    if (validLines.length === 0) return alert('Please add at least one valid raw material and quantity')

    if (!confirm(`Are you sure you want to outward stock for ${validLines.length} items?`)) return

    setLoading(true)
    try {
      const { error } = await supabase.rpc('bulk_raw_outward', {
        p_lines: validLines.map(l => ({ rm_id: l.rm_id, qty: Number(l.qty) })),
        p_note: note.trim() || null
      })

      if (error) throw error

      alert('Stock outwarded successfully')
      setLines([{ id: Date.now(), rm_id: null, qty: '', unit: '' }])
      setNote('')
    } catch (err) {
      alert(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ width: '100%', marginTop: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 20, alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>Raw Material Outward (Bulk)</h2>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>
            Remove stock for multiple materials in one go. The note will be applied to all items.
          </p>
        </div>
        <div style={{ width: 400 }}>
          <label style={{ display: 'block', marginBottom: 6, fontWeight: 'bold', fontSize: 13 }}>Shared Note (Reason for Outward)</label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Damaged, Sample, Used for testing, etc."
            style={{
              width: '100%',
              minHeight: 60,
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              fontSize: 14,
              fontFamily: 'inherit',
              resize: 'vertical'
            }}
          />
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '60%' }}>Raw Material</th>
              <th style={{ width: '20%' }}>Quantity</th>
              <th style={{ width: '10%' }}>Unit</th>
              <th style={{ width: '10%', textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td>
                  <AsyncRMSelect
                    value={line.rm_id}
                    onChange={(id, item) => updateLine(line.id, { rm_id: id, unit: item?.unit || '' })}
                    placeholder="Search raw material..."
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.001"
                    value={line.qty}
                    onChange={e => updateLine(line.id, { qty: e.target.value })}
                    placeholder="0.00"
                    style={{ width: '100%', padding: '8px' }}
                  />
                </td>
                <td style={{ color: 'var(--muted)', fontSize: 13 }}>{line.unit || '—'}</td>
                <td style={{ textAlign: 'center' }}>
                  <button
                    className="btn small ghost err"
                    onClick={() => removeLine(line.id)}
                    disabled={lines.length === 1}
                    title="Remove Line"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: 15, borderTop: '1px solid var(--border)', background: 'var(--bg-faded)', display: 'flex', gap: 10 }}>
          <button className="btn outline small" onClick={addLine}>
            + Add Another Material
          </button>
        </div>
      </div>

      <div style={{ marginTop: 25, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          className="btn"
          onClick={handleOutward}
          disabled={loading || lines.every(l => !l.rm_id || !l.qty)}
          style={{ padding: '12px 40px', fontSize: 16 }}
        >
          {loading ? 'Processing...' : 'Complete Outward Transaction'}
        </button>
      </div>
    </div>
  )
}
