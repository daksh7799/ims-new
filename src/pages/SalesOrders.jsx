import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { supabase } from '../supabaseClient'
import { downloadCSV } from '../utils/csv'
import AsyncFGSelect from '../components/AsyncFGSelect.jsx'
import { saveAs } from 'file-saver'
import { useToast } from '../ui/toast.jsx'

function normalizeName(s) { return String(s || '').trim().toLowerCase() }

async function getBinsForFgNames(names) {
  if (!names.length) return {}
  // OPTIMIZATION: Filter by names on server side
  const { data: allBins, error } = await supabase
    .from('v_bin_inventory')
    .select('finished_good_name, bin_code, produced_at')
    .in('finished_good_name', names)

  if (error) { console.error('v_bin_inventory', error); return {} }

  const out = {}
  const wanted = new Set(names.map(normalizeName))
    ; (allBins || []).forEach(r => {
      const fgKey = normalizeName(r.finished_good_name)
      if (!wanted.has(fgKey)) return
      if (!out[fgKey]) out[fgKey] = {}
      const bin = r.bin_code || '—'
      if (!out[fgKey][bin]) out[fgKey][bin] = { qty: 0 }
      out[fgKey][bin].qty += 1
    })
  const agg = {}
  Object.entries(out).forEach(([fgKey, bins]) => {
    agg[fgKey] = Object.entries(bins).map(([bin_code, v]) => ({
      bin_code, qty: v.qty
    }))
  })
  return agg
}

function extractBrand(fgName) {
  if (!fgName) return 'UNKNOWN'
  // take the first token (letters/numbers/&/-) before a space or punctuation, uppercase it
  const m = String(fgName || '').trim().match(/^([A-Za-z0-9&-]+)/)
  return (m && m[1]) ? String(m[1]).toUpperCase() : String(fgName).split(' ')[0].toUpperCase()
}

export default function SalesOrders() {
  const { push } = useToast()
  const [orders, setOrders] = useState([])
  const [customers, setCustomers] = useState([])
  // REMOVED: fgIndex state (we fetch on demand now)

  const [customer, setCustomer] = useState('')
  const [soNumber, setSoNumber] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState([{ type: 'finished_good', finished_good_id: '', sku: '', qty: '' }])

  const [impCustomer, setImpCustomer] = useState('')
  const [impSoNumber, setImpSoNumber] = useState('')
  const [impNote, setImpNote] = useState('')
  const [importing, setImporting] = useState(false)

  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [hideShipped, setHideShipped] = useState(true)

  async function load() {
    setLoading(true)
    // pull from our new view
    const [{ data: list, error: err1 }, { data: cust, error: err2 }] = await Promise.all([
      supabase
        .from('v_so_summary')
        .select('*')
        .order('id', { ascending: false }),
      supabase
        .from('customers')
        .select('id,name')
        .eq('is_active', true)
        .order('name')
    ])
    if (err1) console.error(err1)
    if (err2) console.error(err2)
    setOrders(list || [])
    setCustomers(cust || [])
    setLoading(false)
  }

  // REMOVED: buildFgIndex

  useEffect(() => { load() }, [])

  useEffect(() => {
    const ch = supabase
      .channel('rt:sales')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_orders' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outward_allocations' }, () => load())
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [])

  function addLine() { setLines(ls => [...ls, { type: 'finished_good', finished_good_id: '', sku: '', qty: '' }]) }
  function removeLine(i) { setLines(ls => ls.filter((_, idx) => idx !== i)) }
  function updateLine(i, patch) { setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l)) }

  async function createSO() {
    if (!customer.trim()) return push('Pick a customer', 'warn')

    // Separate FG and SKU lines
    const fgLines = lines.filter(l => l.type === 'finished_good' && l.finished_good_id && Number(l.qty) > 0)
    const skuLines = lines.filter(l => l.type === 'sku' && l.sku && Number(l.qty) > 0)

    if (fgLines.length === 0 && skuLines.length === 0) {
      return push('Add at least one item with qty>0', 'warn')
    }

    try {
      // Expand SKUs
      const qtyByFgId = {}

      // Add FG lines directly
      for (const line of fgLines) {
        const fgId = String(line.finished_good_id).trim()
        qtyByFgId[fgId] = (qtyByFgId[fgId] || 0) + Number(line.qty)
      }

      // Expand and add SKU lines
      for (const line of skuLines) {
        const { data: expanded, error } = await supabase.rpc('expand_sku', { p_sku: line.sku.trim() })
        if (error) throw new Error(`Failed to expand SKU "${line.sku}": ${error.message}`)
        if (!expanded || expanded.length === 0) {
          throw new Error(`SKU "${line.sku}" not found or inactive`)
        }

        for (const item of expanded) {
          const fgId = item.finished_good_id
          const qtyToAdd = item.qty_per_sku * Number(line.qty)
          qtyByFgId[fgId] = (qtyByFgId[fgId] || 0) + qtyToAdd
        }
      }

      const payload = Object.entries(qtyByFgId).map(([fgId, qty]) => ({
        finished_good_id: fgId,
        qty: Math.floor(qty)
      }))

      const { error } = await supabase.rpc('so_api_create', {
        p_customer_name: customer.trim(),
        p_lines: payload,
        p_so_number: soNumber.trim() || null,
        p_note: note.trim() || null
      })
      if (error) throw error

      setCustomer(''); setSoNumber(''); setNote('')
      setLines([{ type: 'finished_good', finished_good_id: '', sku: '', qty: '' }])
      push('Sales Order created!', 'ok')
      load()
    } catch (err) {
      push(err.message, 'err')
    }
  }

  async function onImportOneSO(e) {
    const f = e.target.files?.[0]; if (!f) return
    if (!impCustomer.trim()) { push('Pick Customer first', 'warn'); e.target.value = ''; return }
    setImporting(true)
    try {
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
      if (rows.length === 0) throw new Error('No rows found')

      // 1. Extract all unique names/SKUs from rows
      const uniqueNames = new Set()
      const rowData = [] // Store parsed row data

      for (const r of rows) {
        const name = String(r['Finished Good'] ?? r['finished good'] ?? r['FG'] ?? r['fg'] ?? '').trim()
        const qty = Number(r['Qty'] ?? r['qty'] ?? 0)
        if (!name || !(qty > 0)) throw new Error('Need "Finished Good" and positive "Qty"')

        uniqueNames.add(name)
        rowData.push({ name, qty })
      }

      // 2. Bulk resolve SKUs and FGs
      const uniqueNamesList = [...uniqueNames]
      const skuMap = {} // name -> [{finished_good_id, qty_per_sku}]
      const foundSkuNames = new Set()

      // A. Bulk fetch SKUs in chunks
      const CHUNK_SIZE = 100
      for (let i = 0; i < uniqueNamesList.length; i += CHUNK_SIZE) {
        const chunk = uniqueNamesList.slice(i, i + CHUNK_SIZE)

        const { data: skuItems, error: skuErr } = await supabase
          .from('sku_mapping_items')
          .select('sku, finished_good_id, qty_per_sku, sku_mappings!inner(is_active)')
          .in('sku', chunk)
          .eq('sku_mappings.is_active', true)

        if (skuErr) throw skuErr

        skuItems?.forEach(item => {
          if (!skuMap[item.sku]) skuMap[item.sku] = []
          skuMap[item.sku].push(item)
          foundSkuNames.add(item.sku)
        })
      }

      // B. Identify remaining names (potential direct FGs)
      const potentialFgNames = uniqueNamesList.filter(n => !foundSkuNames.has(n))
      const fgMap = {} // normalizeName -> id

      // C. Bulk fetch FGs in chunks
      if (potentialFgNames.length > 0) {
        for (let i = 0; i < potentialFgNames.length; i += CHUNK_SIZE) {
          const chunk = potentialFgNames.slice(i, i + CHUNK_SIZE)

          const { data: foundFGs, error: fetchErr } = await supabase
            .from('finished_goods')
            .select('id, name')
            .in('name', chunk)
            .eq('is_active', true)

          if (fetchErr) throw fetchErr

          foundFGs?.forEach(fg => {
            fgMap[normalizeName(fg.name)] = fg.id
          })
        }
      }

      // 3. Validate ALL items exist (all-or-nothing)
      const missing = []
      for (const name of uniqueNames) {
        const isSku = foundSkuNames.has(name)
        const isFg = fgMap[normalizeName(name)]
        if (!isSku && !isFg) {
          missing.push(name)
        }
      }

      if (missing.length > 0) {
        throw new Error(`SKU/Finished Good not found: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}`)
      }

      // 4. Build payload by expanding SKUs and aggregating by FG ID
      const qtyByFgId = {} // fg_id -> total_qty

      for (const row of rowData) {
        if (foundSkuNames.has(row.name)) {
          // It's a SKU - expand it
          const expanded = skuMap[row.name]
          for (const item of expanded) {
            const fgId = item.finished_good_id
            const qtyToAdd = item.qty_per_sku * row.qty
            qtyByFgId[fgId] = (qtyByFgId[fgId] || 0) + qtyToAdd
          }
        } else {
          // It's a direct FG name
          const fgId = fgMap[normalizeName(row.name)]
          qtyByFgId[fgId] = (qtyByFgId[fgId] || 0) + row.qty
        }
      }

      // 7. Create payload
      const payload = Object.entries(qtyByFgId).map(([fgId, qty]) => ({
        finished_good_id: String(fgId),
        qty: Math.floor(qty)
      }))

      if (payload.length === 0) {
        throw new Error('No valid items to create')
      }

      // 8. Create the sales order
      const { error } = await supabase.rpc('so_api_create', {
        p_customer_name: impCustomer.trim(),
        p_lines: payload,
        p_so_number: impSoNumber.trim() || null,
        p_note: impNote.trim() || null
      })
      if (error) throw error

      push('SO created from file', 'ok')
      setImpSoNumber(''); setImpNote(''); load()
    } catch (err) {
      push(err.message, 'err')
    }
    finally { setImporting(false); e.target.value = '' }
  }


  function downloadSampleCSV() {
    const headers = ['Finished Good', 'Qty']
    const csvContent = headers.join(',') + '\n'
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    saveAs(blob, 'sales_order_sample.csv')
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (orders || []).filter(o =>
      (hideShipped ? o.status !== 'Cleared' : true) &&  // our view uses Pending/Partial/Cleared
      (
        !s ||
        String(o.so_number || '').toLowerCase().includes(s) ||
        String(o.customer_name || '').toLowerCase().includes(s)
      )
    )
  }, [orders, q, hideShipped])

  function exportOrders() {
    downloadCSV('sales_orders.csv', filtered.map(o => ({
      id: o.id,
      so_number: o.so_number,
      customer: o.customer_name,
      status: o.status,
      shipped: o.qty_shipped_total,
      ordered: o.qty_ordered_total,
      note: o.note,
      created_at: o.created_at || ''
    })))
  }

  // ---- PRINT: grouped-by-brand, denser (~50 rows/page), darker borders, qty left-aligned,
  //          and FINISHED GOODS sorted alphabetically within each brand ----
  async function printSO(order, { onlyPending = true } = {}) {
    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable')
      ])

      // use points for fine control and generate A4
      const doc = new jsPDF({ unit: 'pt', format: 'a4' })
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const leftMargin = 12
      const rightMargin = 12
      const topMargin = 14
      const usableWidth = pageWidth - leftMargin - rightMargin

      // header
      doc.setFontSize(14)
      doc.text(`Sales Order ${order.so_number || order.id}`, leftMargin, topMargin + 6)
      doc.setFontSize(11)
      doc.text(`Customer: ${order.customer_name || '-'}`, leftMargin, topMargin + 22)

      let currentY = topMargin + 34
      if (order.note) {
        const splitNote = doc.splitTextToSize(`Note: ${order.note}`, usableWidth)
        doc.setFontSize(10)
        doc.text(splitNote, leftMargin, currentY)
        currentY += splitNote.length * 10
      }
      if (order.created_at) {
        doc.setFontSize(10)
        doc.text(`Created: ${new Date(order.created_at).toLocaleString()}`, leftMargin, currentY)
        currentY += 12
      }

      // fetch fresh lines
      const { data: lines } = await supabase
        .from('v_so_lines')
        .select('*')
        .eq('sales_order_id', order.id)
      let rows = (lines || [])
      if (onlyPending) rows = rows.filter(l => Number(l.qty_shipped || 0) < Number(l.qty_ordered || 0))
      if (!rows.length) { push('No lines to print', 'warn'); return }

      const fgNames = rows.map(l => l.finished_good_name).filter(Boolean)
      const binsByFg = await getBinsForFgNames(fgNames)

      // group by brand
      const byBrand = {}
      for (const l of rows) {
        const brand = extractBrand(l.finished_good_name)
        if (!byBrand[brand]) byBrand[brand] = []
        byBrand[brand].push(l)
      }
      const brands = Object.keys(byBrand).sort((a, b) => a.localeCompare(b))

      // tuned column widths: finished good reduced, qty narrow, bins increased
      const col1 = 44                              // ordered (narrow)
      const col0 = Math.floor(usableWidth * 0.56) // finished good (reduced)
      const col2 = usableWidth - col0 - col1      // bins (increased)

      for (const brand of brands) {
        // brand header
        doc.setFontSize(11)
        doc.text(brand, leftMargin, currentY + 12)
        doc.setFontSize(9)

        // sort finished goods alphabetically (case-insensitive)
        const items = (byBrand[brand] || []).slice().sort((a, b) => {
          const A = String(a.finished_good_name || '').toLowerCase()
          const B = String(b.finished_good_name || '').toLowerCase()
          return A.localeCompare(B)
        })

        const body = items.map(l => {
          const fgName = l.finished_good_name || ''
          const bins = binsByFg[normalizeName(fgName)] || []
          const binsText = bins.length ? bins.map(b => `${b.bin_code}: ${b.qty}`).join(', ') : '—'
          return [fgName, String(Number(l.qty_ordered || 0)), binsText]
        })

        autoTable(doc, {
          startY: currentY + 16,
          margin: { left: leftMargin, right: rightMargin },
          head: [['Finished Good', 'Ordered', 'Bins']],
          body,
          styles: {
            fontSize: 9,         // readable
            cellPadding: 1.2,    // tighter rows
            overflow: 'ellipsize',
            valign: 'middle',
            lineWidth: 0.6,      // darker/thicker border
            lineColor: [110, 110, 110] // darker gray border
          },
          headStyles: { fillColor: [250, 250, 250], textColor: 20, fontStyle: 'bold', halign: 'left', fontSize: 9 },
          columnStyles: {
            0: { cellWidth: col0, overflow: 'ellipsize' },         // finished good (reduced)
            1: { halign: 'left', cellWidth: col1 },                // ordered now LEFT aligned
            2: { cellWidth: col2, overflow: 'ellipsize' }          // bins (increased)
          },
          tableWidth: 'auto',
          theme: 'grid',
          willDrawCell: (data) => {
            if (data.section === 'body') {
              data.cell.styles.minCellHeight = 8
            }
          }
        })

        // move cursor after table
        currentY = doc.lastAutoTable?.finalY || (currentY + 16 + body.length * 9)
        currentY += 6

        // page break if needed
        if (currentY > pageHeight - 36) {
          doc.addPage()
          currentY = topMargin + 8
        }
      }

      // create blob + open print dialog; keep iframe so print dialog doesn't auto-close
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
        catch (e) { doc.save(`SO_${order.so_number || order.id}.pdf`) }
        // leave iframe in DOM so user closes print dialog manually
      }
    } catch (err) {
      push('Failed to print: ' + (err?.message || String(err)), 'err')
    }
  }

  return (
    <div className="grid">
      {/* Import ONE SO */}
      <div className="card">
        <div className="hd"><b>Import ONE Sales Order</b></div>
        <div className="bd">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select value={impCustomer} onChange={e => setImpCustomer(e.target.value)}>
              <option value="">Select Customer</option>
              {customers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <input
              placeholder="SO Number (auto-generated)"
              value={impSoNumber}
              readOnly
              style={{ background: '#f8f8f8', color: '#777', cursor: 'not-allowed' }}
            />
            <input
              placeholder="Add note (optional)"
              value={impNote}
              onChange={e => setImpNote(e.target.value)}
              style={{ width: 220 }}
            />
            <input type="file" accept=".xlsx,.xls,.csv" onChange={onImportOneSO} disabled={importing} />
            <button className="btn ghost" onClick={downloadSampleCSV}>📄 Download Sample CSV</button>
          </div>
          <div className="s" style={{ color: 'var(--muted)' }}>
            Columns required: <code>Finished Good</code>, <code>Qty</code>.
          </div>
        </div>
      </div>

      {/* Manual create */}
      <div className="card">
        <div className="hd"><b>Create Sales Order (Manual)</b></div>
        <div className="bd" style={{ display: 'grid', gap: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <select value={customer} onChange={e => setCustomer(e.target.value)} style={{ minWidth: 260 }}>
              <option value="">Select Customer</option>
              {customers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <input
              placeholder="SO Number (auto-generated)"
              value={soNumber}
              readOnly
              style={{ background: '#f8f8f8', color: '#777', cursor: 'not-allowed' }}
            />
          </div>

          <textarea
            placeholder="Add note (optional)"
            value={note}
            onChange={e => setNote(e.target.value)}
            style={{ width: '100%', minHeight: 60 }}
          />

          <table className="table">
            <thead><tr><th style={{ width: 100 }}>Type</th><th style={{ width: '45%' }}>Finished Good / SKU</th><th style={{ width: 120 }}>Qty</th><th></th></tr></thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={idx}>
                  <td>
                    <select
                      value={l.type}
                      onChange={e => updateLine(idx, { type: e.target.value, finished_good_id: '', sku: '' })}
                    >
                      <option value="finished_good">FG</option>
                      <option value="sku">SKU</option>
                    </select>
                  </td>
                  <td>
                    {l.type === 'finished_good' ? (
                      <AsyncFGSelect
                        value={l.finished_good_id}
                        onChange={(id) => updateLine(idx, { finished_good_id: String(id || '') })}
                        placeholder="Search finished goods…"
                        minChars={1}
                        pageSize={25}
                      />
                    ) : (
                      <input
                        type="text"
                        placeholder="Enter SKU code"
                        value={l.sku}
                        onChange={e => updateLine(idx, { sku: e.target.value })}
                      />
                    )}
                  </td>
                  <td><input type="number" min="1" value={l.qty} onChange={e => updateLine(idx, { qty: e.target.value })} /></td>
                  <td><button className="btn ghost" onClick={() => removeLine(idx)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="row" style={{ marginTop: 4 }}>
            <button className="btn outline" onClick={addLine}>+ Add Line</button>
            <button className="btn" onClick={createSO}>Create Order</button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="card">
        <div className="hd">
          <b>Orders</b>
          <div className="row">
            <input placeholder="Search SO / Customer…" value={q} onChange={e => setQ(e.target.value)} />
            <label className="row" style={{ gap: 6, marginLeft: 8 }}>
              <input
                type="checkbox"
                checked={hideShipped}
                onChange={e => setHideShipped(e.target.checked)}
                title="Hide fully shipped orders"
              />
              Hide shipped
            </label>
            <button className="btn" onClick={exportOrders} disabled={!filtered.length}>Export CSV</button>
            <Link to="/outward" className="btn outline">Open Outward</Link>
          </div>
        </div>
        <div className="bd" style={{ overflow: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>SO</th><th>Customer</th><th>Status</th>
                <th style={{ textAlign: 'right' }}>Shipped / Ordered</th>
                <th>Note</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(o => (
                <tr key={o.id}>
                  <td><Link to={`/outward?so=${o.id}`}>{o.so_number || o.id}</Link></td>
                  <td>{o.customer_name}</td>
                  <td><span className="badge">{o.status}</span></td>
                  <td style={{ textAlign: 'right' }}>{o.qty_shipped_total} / {o.qty_ordered_total}</td>
                  <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.note || ''}</td>
                  <td>{o.created_at ? new Date(o.created_at).toLocaleString() : '—'}</td>
                  <td>
                    <button className="btn outline" onClick={() => printSO(o)}>Print</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan="7" style={{ color: 'var(--muted)' }}>{loading ? 'Loading…' : 'No orders'}</td></tr>
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
