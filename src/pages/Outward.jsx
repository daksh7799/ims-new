import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { Link, useLocation } from 'react-router-dom'

function fmtDT(ts) {
  if (!ts) return '—'
  const t = typeof ts === 'string' ? Date.parse(ts) : ts
  if (Number.isNaN(t)) return '—'
  return new Date(t).toLocaleString()
}

function useQuery() {
  const { search } = useLocation()
  return useMemo(() => new URLSearchParams(search), [search])
}

// simple normalizer (used only for keys in the results map)
const norm = s => String(s ?? '').trim().toLowerCase()

function extractBrand(fgName) {
  if (!fgName) return 'UNKNOWN'
  const m = String(fgName || '').trim().match(/^([A-Za-z0-9&-]+)/)
  return (m && m[1]) ? String(m[1]).toUpperCase() : String(fgName).split(' ')[0].toUpperCase()
}

export default function Outward() {
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

  const [binsByFg, setBinsByFg] = useState({})
  const [loadingBins, setLoadingBins] = useState(false)

  /** -------------------- LOADERS -------------------- **/
  async function loadOrders() {
    setLoadingOrders(true)
    const view = pendingOnly ? 'v_so_pending' : 'v_so_summary'
    const { data, error } = await supabase
      .from(view)
      .select('*')
      .order('id', { ascending: false })
    if (error) console.error('loadOrders', error)
    setOrders(data || [])
    setLoadingOrders(false)
  }

  async function loadOne(id) {
    if (!id) {
      setOrderHdr(null)
      setLines([])
      setBinsByFg({})
      return
    }
    const [{ data: hdrs }, { data: ls, error: e2 }] = await Promise.all([
      supabase.from('v_so_summary').select('*').eq('id', id).limit(1),
      supabase.from('v_so_lines').select('*').eq('sales_order_id', id).order('id')
    ])
    setOrderHdr(hdrs?.[0] || null)
    if (e2) console.error('v_so_lines', e2)

    const sortedLines = (ls || []).sort((a, b) =>
      String(a.finished_good_name || '').localeCompare(String(b.finished_good_name || ''))
    )
    setLines(sortedLines)
    console.debug('loadOne: loaded lines', sortedLines.length)
  }

  useEffect(() => { loadOrders() }, [pendingOnly])
  useEffect(() => { if (initialSO) setSoId(initialSO) }, [initialSO])
  useEffect(() => { loadOne(soId) }, [soId])

  /** ---------- REALTIME REFRESH ON CHANGES ---------- **/
  useEffect(() => {
    const ch = supabase
      .channel('rt:outward')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outward_allocations' },
        () => { if (soId) { loadOne(soId); loadBinsForCurrentLines() }; loadOrders() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_orders' },
        () => loadOrders())
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [soId, pendingOnly])

  /** -------------------- FILTER + TOTALS -------------------- **/
  const filtered = useMemo(() => {
    const s = filter.trim().toLowerCase()
    return (orders || []).filter(o =>
      !s ||
      String(o.so_number || '').toLowerCase().includes(s) ||
      String(o.customer_name || '').toLowerCase().includes(s)
    )
  }, [orders, filter])

  const totals = useMemo(() => {
    const ordered = lines.reduce((n, l) => n + Number(l.qty_ordered || 0), 0)
    const shipped = lines.reduce((n, l) => n + Number(l.qty_shipped || 0), 0)
    return { ordered, shipped, pending: Math.max(ordered - shipped, 0) }
  }, [lines])

  const cleared = totals.shipped >= totals.ordered && totals.ordered > 0

  /** -------------------- OUTWARD SCAN -------------------- **/
  async function assign(code) {
    if (inFlight.current) return
    const pkt = (code || '').trim()
    if (!pkt || !soId) return

    try {
      inFlight.current = true

      // lightweight packet sanity check
      const { data: pktInfo, error: chkErr } = await supabase
        .from('v_live_barcodes_enriched')
        .select('packet_code, status')
        .eq('packet_code', pkt)
        .maybeSingle()

      if (chkErr) {
        window.alert(`❌ Could not verify packet status:\n${chkErr.message}`)
        return
      }

      if (!pktInfo) {
        window.alert(`🚫 Packet "${pkt}" not found in system.`)
        return
      }

      // only block scrapped; reuse is decided by backend
      if ((pktInfo.status || '').toLowerCase() === 'scrapped') {
        window.alert(`🚫 Packet "${pkt}" is scrapped and cannot be outwarded.`)
        return
      }

      // 1) allocate to SO
      const { error: allocErr } = await supabase.rpc('allocate_packet_to_order', {
        p_so_id: Number(soId),
        p_packet_code: pkt
      })
      if (allocErr) {
        window.alert(`❌ Allocation error:\n${allocErr.message}`)
        return
      }

      // 2) mark outward
      const { data, error: outErr } = await supabase.rpc('packet_outward_scan', {
        p_packet_code: pkt,
        p_note: `Outwarded for SO ${soId}`
      })
      if (outErr) {
        window.alert(`❌ Outward error:\n${outErr.message}`)
        return
      }

      setLastMsg(data?.message || `✅ Packet ${pkt} outwarded successfully`)
      setScan('')
      await loadOne(soId)
      await loadBinsForCurrentLines()

      if (pendingOnly) {
        const approxCleared = (totals.shipped + 1) >= totals.ordered
        if (approxCleared) await loadOrders()
      }
    } finally {
      inFlight.current = false
      inputRef.current?.focus()
      setTimeout(() => setLastMsg(''), 2000)
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      assign(scan)
    }
  }

  useEffect(() => {
    if (!auto) return
    const s = scan.trim()
    if (!s || !soId) return
    clearTimeout(typing.current)
    typing.current = setTimeout(() => assign(s), 120)
    return () => clearTimeout(typing.current)
  }, [scan, auto, soId])

  /** -------------------- BIN INVENTORY (exact server-side fetch, no fuzzy) -------------------- **/
  async function loadBinsForCurrentLines() {
    setBinsByFg({})
    const fgNames = Array.from(new Set((lines || [])
      .map(l => String(l.finished_good_name || '').trim())
      .filter(Boolean)))
    if (!fgNames.length) return

    setLoadingBins(true)
    try {
      let allBins = null
      let error = null

      // Preferred: server-side exact-match for only required finished_good_name values.
      try {
        const res = await supabase
          .from('v_bin_inventory')
          .select('finished_good_name, bin_code, produced_at')
          .in('finished_good_name', fgNames)
        allBins = res.data
        error = res.error
        console.debug('v_bin_inventory .in() returned rows:', (allBins || []).length)
      } catch (e) {
        console.warn('v_bin_inventory .in() failed', e)
        allBins = null
        error = e
      }

      // Fallback: explicitly fetch a large range to avoid silent truncation.
      if (!allBins || allBins.length === 0) {
        console.debug('Fallback range fetch (0..5000) because .in() returned 0 rows or failed')
        const res2 = await supabase
          .from('v_bin_inventory')
          .select('finished_good_name, bin_code, produced_at')
          .range(0, 8000) // adjust if you have >5k rows
        allBins = res2.data
        error = error || res2.error
        console.debug('v_bin_inventory .range() returned rows:', (allBins || []).length)
      }

      if (error) {
        console.warn('v_bin_inventory fetch error:', error)
        // continue with whatever we have
      }
      allBins = allBins || []

      console.debug('loadBinsForCurrentLines: wanted fgNames:', fgNames)
      console.debug('loadBinsForCurrentLines: sample normalized bin names:',
        (allBins || []).slice(0, 12).map(r => ({ raw: r.finished_good_name, n: norm(r.finished_good_name) })))

      const results = {}
      for (const rawName of fgNames) {
        // Use server-side exact matches only (raw string equality as returned by .in())
        // We still compute key using norm(rawName) so UI lookups match.
        const key = norm(rawName)
        const rows = (allBins || []).filter(r => String(r.finished_good_name || '').trim() === rawName)

        if (!rows.length) {
          console.debug('No bins found for (exact) ->', rawName)
        } else {
          console.debug('Exact matched', rows.length, 'rows for', rawName)
        }

        // aggregate per bin_code
        const perBin = new Map()
        for (const r of rows) {
          const bin = r.bin_code || '—'
          const prod = r.produced_at ? Date.parse(r.produced_at) : Number.POSITIVE_INFINITY
          const got = perBin.get(bin) || { qty: 0, oldest: Number.POSITIVE_INFINITY }
          got.qty += 1
          if (prod < got.oldest) got.oldest = prod
          perBin.set(bin, got)
        }

        const arr = [...perBin.entries()].map(([bin_code, v]) => ({
          bin_code,
          qty: v.qty,
          oldest_produced_at: isFinite(v.oldest) ? new Date(v.oldest).toISOString() : null
        }))
        arr.sort((a, b) => {
          const ta = a.oldest_produced_at ? Date.parse(a.oldest_produced_at) : Number.POSITIVE_INFINITY
          const tb = b.oldest_produced_at ? Date.parse(b.oldest_produced_at) : Number.POSITIVE_INFINITY
          return ta !== tb ? ta - tb : String(a.bin_code).localeCompare(String(b.bin_code))
        })

        results[key] = arr
      }

      setBinsByFg(results)
    } finally {
      setLoadingBins(false)
    }
  }

  useEffect(() => { loadBinsForCurrentLines() }, [JSON.stringify(lines)])

  /** -------------------- PRINT FEATURE (uses same server-side fetch) -------------------- **/
  async function printSO() {
    if (!orderHdr) return alert('No order selected')
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable')
      ])

      // create doc (A4 points)
      const doc = new jsPDF({ unit: 'pt', format: 'a4' })
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const leftMargin = 12
      const rightMargin = 12
      const topMargin = 14
      const usableWidth = pageWidth - leftMargin - rightMargin

      doc.setFontSize(14)
      doc.text(`Sales Order ${orderHdr.so_number || soId}`, leftMargin, topMargin + 6)
      doc.setFontSize(11)
      doc.text(`Customer: ${orderHdr.customer_name || '-'}`, leftMargin, topMargin + 22)
      if (orderHdr.created_at) {
        doc.setFontSize(10)
        doc.text(`Created: ${fmtDT(orderHdr.created_at)}`, leftMargin, topMargin + 34)
      }
      doc.setFontSize(10)
      doc.text(`Ordered: ${totals.ordered}`, leftMargin, topMargin + 48)

      let currentY = topMargin + 56

      // build rows grouped by brand, alphabetical within brand
      let rows = (lines || []).slice()
      // print only pending lines (qty_shipped < qty_ordered)
      rows = rows.filter(l => Number(l.qty_shipped || 0) < Number(l.qty_ordered || 0))

      if (!rows.length) { alert('No pending lines to print'); return }

      const fgNames = rows.map(l => l.finished_good_name).filter(Boolean)

      // ======== SAFER BIN FETCH FOR PRINT ========
      // Prefer server-side exact-match on finished_good_name so we don't hit page-size truncation.
      let allBinsForPrint = null
      let fetchErr = null
      try {
        const res = await supabase
          .from('v_bin_inventory')
          .select('finished_good_name, bin_code, produced_at')
          .in('finished_good_name', fgNames)
        allBinsForPrint = res.data
        fetchErr = res.error
        console.debug('printSO: v_bin_inventory .in() returned rows:', (allBinsForPrint || []).length)
      } catch (e) {
        console.warn('printSO: v_bin_inventory .in() failed', e)
        allBinsForPrint = null
        fetchErr = e
      }

      // fallback to large range if .in() didn't return results (adjust upper bound if needed)
      if (!allBinsForPrint || allBinsForPrint.length === 0) {
        console.debug('printSO: fallback range fetch (0..5000) to avoid truncation')
        const res2 = await supabase
          .from('v_bin_inventory')
          .select('finished_good_name, bin_code, produced_at')
          .range(0, 8000)
        allBinsForPrint = res2.data
        fetchErr = fetchErr || res2.error
        console.debug('printSO: v_bin_inventory .range() returned rows:', (allBinsForPrint || []).length)
      }
      allBinsForPrint = allBinsForPrint || []
      if (fetchErr) console.warn('printSO: v_bin_inventory fetch error:', fetchErr)

      // build binsByFgLocal keyed by normalized name (same normalization used elsewhere)
      const binsByFgLocal = {}
      const wantedNorms = new Set(fgNames.map(n => norm(n)))
        ; (allBinsForPrint || []).forEach(r => {
          const k = norm(r.finished_good_name)
          if (!wantedNorms.has(k)) return
          binsByFgLocal[k] = binsByFgLocal[k] || {}
          const bin = r.bin_code || '—'
          binsByFgLocal[k][bin] = (binsByFgLocal[k][bin] || 0) + 1
        })
      // convert to array-of-objects like the UI expects
      Object.entries(binsByFgLocal).forEach(([k, bins]) => {
        binsByFgLocal[k] = Object.entries(bins).map(([bin_code, qty]) => ({ bin_code, qty }))
      })
      // ======== end safer fetch ========

      const byBrand = {}
      for (const l of rows) {
        const brand = extractBrand(l.finished_good_name)
        if (!byBrand[brand]) byBrand[brand] = []
        byBrand[brand].push(l)
      }
      const brands = Object.keys(byBrand).sort((a, b) => a.localeCompare(b))

      // tuned column widths: finished good reduced, qty narrow and LEFT aligned, bins increased
      const col1 = 44
      const col0 = Math.floor(usableWidth * 0.56)
      const col2 = usableWidth - col0 - col1

      for (const brand of brands) {
        // brand header
        doc.setFontSize(11)
        doc.text(brand, leftMargin, currentY + 12)
        doc.setFontSize(9)

        // alphabetical within brand
        const items = (byBrand[brand] || []).slice().sort((a, b) => {
          const A = String(a.finished_good_name || '').toLowerCase()
          const B = String(b.finished_good_name || '').toLowerCase()
          return A.localeCompare(B)
        })

        const body = items.map(l => {
          const fg = l.finished_good_name || ''
          const bins = binsByFgLocal[norm(fg)] || []
          const binsText = bins.length ? bins.map(b => `${b.bin_code}: ${b.qty}`).join(', ') : '—'
          return [fg, String(Number(l.qty_ordered || 0)), binsText]
        })

        autoTable(doc, {
          startY: currentY + 16,
          margin: { left: leftMargin, right: rightMargin },
          head: [['Finished Good', 'Ordered', 'Bins']],
          body,
          styles: {
            fontSize: 9,
            cellPadding: 1.2,
            overflow: 'ellipsize',
            valign: 'middle',
            lineWidth: 0.6,
            lineColor: [110, 110, 110]
          },
          headStyles: { fillColor: [250, 250, 250], textColor: 20, fontStyle: 'bold', halign: 'left', fontSize: 9 },
          columnStyles: {
            0: { cellWidth: col0, overflow: 'ellipsize' },
            1: { halign: 'left', cellWidth: col1 }, // LEFT aligned qty
            2: { cellWidth: col2, overflow: 'ellipsize' }
          },
          tableWidth: 'auto',
          theme: 'grid',
          willDrawCell: (data) => {
            if (data.section === 'body') {
              data.cell.styles.minCellHeight = 8
            }
          }
        })

        currentY = doc.lastAutoTable?.finalY || (currentY + 16 + body.length * 9)
        currentY += 6

        if (currentY > pageHeight - 36) {
          doc.addPage()
          currentY = topMargin + 8
        }
      }

      // open print dialog, keep iframe in DOM (no auto-close)
      const blob = doc.output('blob')
      const blobURL = URL.createObjectURL(blob)
      const iframe = document.createElement('iframe')
      iframe.style.position = 'fixed'
      iframe.style.right = '0'
      iframe.style.bottom = '0'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = 'none'
      iframe.src = blobURL
      document.body.appendChild(iframe)
      iframe.onload = function () {
        try { iframe.contentWindow.focus(); iframe.contentWindow.print() }
        catch (e) { doc.save(`SO_${orderHdr.so_number || soId}.pdf`) }
        // leave iframe in DOM so print dialog remains until user closes
      }
    } catch (err) {
      alert('Failed to print: ' + (err?.message || String(err)))
    }
  }

  /** -------------------- CSV DOWNLOAD -------------------- **/
  function downloadSOAsCSV() {
    if (!soId) {
      alert('Pick an order first')
      return
    }
    const pendingLines = (lines || []).filter(l => Number(l.qty_shipped || 0) < Number(l.qty_ordered || 0))
    if (pendingLines.length === 0) {
      alert('No pending finished goods — everything is outwarded.')
      return
    }
    const header = ['finished_good', 'qty']
    const rowsCsv = pendingLines.map(l => {
      const fg = l.finished_good_name || ''
      const shipped = Number(l.qty_shipped || 0)
      const ordered = Number(l.qty_ordered || 0)
      const remaining = Math.max(ordered - shipped, 0)
      const safeFg = `"${fg.replace(/"/g, '""')}"`
      return `${safeFg},${remaining}`
    })
    const csv = [header.join(','), ...rowsCsv].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Pending_FG_${orderHdr?.so_number || soId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  /** -------------------- UI -------------------- **/
  return (
    <div className="grid">
      {/* === SALES ORDER PICKER === */}
      <div className="card">
        <div className="hd">
          <b>Outward / Sales Order Clearing</b>
          <div className="row" style={{ gap: 8 }}>
            <input
              placeholder="Filter SO / Customer…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{ minWidth: 260 }}
            />
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={pendingOnly} onChange={e => setPendingOnly(e.target.checked)} />
              Show only pending
            </label>
            <button className="btn" onClick={loadOrders} disabled={loadingOrders}>
              {loadingOrders ? 'Refreshing…' : 'Refresh List'}
            </button>
            <Link to="/sales" className="btn outline">Open Sales Orders</Link>
            {soId && (
              <>
                <button className="btn outline" onClick={printSO}>🖨️ Print</button>
                <button className="btn outline" onClick={downloadSOAsCSV}>⬇️ CSV</button>
              </>
            )}
          </div>
        </div>
        <div className="bd">
          <select value={soId} onChange={e => setSoId(e.target.value)} style={{ minWidth: 680 }}>
            <option value="">— Select Sales Order —</option>
            {filtered.map(o => {
              const label = `${fmtDT(o.created_at)} — ${o.so_number || o.id} — ${o.customer_name} — ${o.qty_shipped_total}/${o.qty_ordered_total} (${o.status})`
              return <option key={o.id} value={o.id}>{label}</option>
            })}
          </select>
        </div>
      </div>

      {/* === OUTWARD SCANNER === */}
      <div className="card">
        <div className="hd">
          <b>{soId ? (`SO ${orderHdr?.so_number || soId}`) : 'No order selected'}</b>
          <div className="row" style={{ gap: 8 }}>
            <span className="badge">{orderHdr?.customer_name || '-'}</span>
            {orderHdr?.created_at && <span className="badge">{fmtDT(orderHdr.created_at)}</span>}
            <span className="badge">Shipped: {totals.shipped}/{totals.ordered}</span>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />
              Auto-scan
            </label>
          </div>
        </div>
        <div className="bd">
          <form onSubmit={(e) => { e.preventDefault(); assign(scan) }} className="row" style={{ alignItems: 'center', gap: 8 }}>
            <input
              ref={inputRef}
              placeholder={soId ? 'Scan / Enter packet barcode' : 'Pick an order first'}
              value={scan}
              onChange={e => setScan(e.target.value)}
              onKeyDown={onKeyDown}
              autoFocus
              style={{ minWidth: 380 }}
              disabled={!soId || cleared}
            />
            <button className="btn" disabled={!soId || cleared}>Outward</button>
            {!!lastMsg && (
              <span className="badge" style={{ borderColor: lastMsg.includes('✅') ? 'var(--ok)' : 'var(--err)' }}>
                {lastMsg}
              </span>
            )}
            {cleared && <span className="badge ok">Cleared</span>}
          </form>
        </div>
      </div>

      {/* === ITEMS + BIN VIEW === */}
      <div className="card">
        <div className="hd"><b>Items Required</b></div>
        <div className="bd" style={{ overflow: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Finished Good</th>
                <th style={{ textAlign: 'right' }}>Shipped / Ordered</th>
                <th>Bins</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => {
                const s = Number(l.qty_shipped || 0), o = Number(l.qty_ordered || 0)
                const done = s >= o && o > 0
                const fgName = l.finished_good_name || ''
                const bins = binsByFg[norm(fgName)] || []
                return (
                  <tr key={l.id}>
                    <td>{fgName}</td>
                    <td style={{ textAlign: 'right' }}>{s} / {o}</td>
                    <td>
                      {loadingBins ? (
                        <span className="s" style={{ color: 'var(--muted)' }}>Loading…</span>
                      ) : bins.length ? (
                        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                          {bins.map(b => (
                            <span key={fgName + '|' + b.bin_code} className="badge">{b.bin_code}: {b.qty}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="s" style={{ color: 'var(--muted)' }}>No bins</span>
                      )}
                    </td>
                    <td>
                      <span className="badge" style={{ borderColor: done ? 'var(--ok)' : 'var(--border)' }}>
                        {done ? 'Cleared' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {!lines.length && (
                <tr>
                  <td colSpan="4" style={{ color: 'var(--muted)' }}>Pick an order to view lines</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <PendingItemsSummary />
    </div>
  )
}

function PendingItemsSummary() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    try {
      // 1. Get tracked items
      const { data: tracked, error: err1 } = await supabase
        .from('finished_goods')
        .select('id,name')
        .eq('is_tracked_for_pending', true)
        .eq('is_active', true)

      if (err1) throw err1
      if (!tracked || tracked.length === 0) {
        setItems([])
        setLoading(false)
        return
      }

      // 2. Get pending SO IDs (cleared_at IS NULL)
      const { data: pendingSOs, error: err2 } = await supabase
        .from('sales_orders')
        .select('id')
        .is('cleared_at', null)

      if (err2) throw err2
      const pendingIds = (pendingSOs || []).map(x => x.id)

      if (pendingIds.length === 0) {
        setItems([])
        setLoading(false)
        return
      }

      // 3. Get lines for these items in pending orders
      // We use v_so_lines which has qty_ordered and qty_shipped
      const { data: lines, error: err3 } = await supabase
        .from('v_so_lines')
        .select('finished_good_id, qty_ordered, qty_shipped')
        .in('finished_good_id', tracked.map(t => t.id))
        .in('sales_order_id', pendingIds)

      if (err3) throw err3

      // 4. Aggregate
      const agg = tracked.map(t => {
        const myLines = (lines || []).filter(l => l.finished_good_id === t.id)
        const totalOrdered = myLines.reduce((sum, l) => sum + (Number(l.qty_ordered) || 0), 0)
        const totalShipped = myLines.reduce((sum, l) => sum + (Number(l.qty_shipped) || 0), 0)
        const pending = Math.max(0, totalOrdered - totalShipped)
        return { name: t.name, pending }
      }).filter(x => x.pending > 0)

      setItems(agg)
    } catch (err) {
      console.error('PendingItemsSummary error:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const ch = supabase
      .channel('rt:pending_summary')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_orders' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_order_lines' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outward_allocations' }, () => load())
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  // Always render
  return (
    <div className="card">
      <div className="hd">
        <b>Pending Items Summary</b>
        <button className="btn small ghost" onClick={load} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      <div className="bd" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Finished Good</th>
              <th style={{ textAlign: 'right', width: 120 }}>Pending Qty</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan="2" className="s">Loading...</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan="2" className="s">No pending tracked items</td></tr>}
            {!loading && items.map(item => (
              <tr key={item.name}>
                <td>{item.name}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{item.pending}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
