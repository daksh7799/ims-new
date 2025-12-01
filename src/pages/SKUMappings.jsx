import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useToast } from '../ui/toast.jsx'
import AsyncFGSelect from '../components/AsyncFGSelect.jsx'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'

export default function SKUMappings() {
    const { push } = useToast()
    const [mappings, setMappings] = useState([])
    const [loading, setLoading] = useState(true)
    const [q, setQ] = useState('')

    // Form state for creating new SKU
    const [sku, setSku] = useState('')
    const [description, setDescription] = useState('')
    const [items, setItems] = useState([{ finished_good_id: '', qty_per_sku: 1 }])
    const [expandedRows, setExpandedRows] = useState(new Set())

    // Edit mode state
    const [editingSku, setEditingSku] = useState(null)
    const [editDescription, setEditDescription] = useState('')
    const [editItems, setEditItems] = useState([])

    useEffect(() => { load() }, [])

    async function load() {
        setLoading(true)
        // Fetch all SKU mappings with their items
        const { data: skuData, error: err1 } = await supabase
            .from('sku_mappings')
            .select('*')
            .order('created_at', { ascending: false })

        if (err1) {
            console.error(err1)
            setLoading(false)
            return
        }

        // Fetch all SKU mapping items with FG names
        const { data: itemsData, error: err2 } = await supabase
            .from('sku_mapping_items')
            .select('*, finished_goods(id, name)')
            .order('id')

        if (err2) {
            console.error(err2)
            setLoading(false)
            return
        }

        // Group items by SKU
        const itemsBySku = {}
        itemsData?.forEach(item => {
            if (!itemsBySku[item.sku]) itemsBySku[item.sku] = []
            itemsBySku[item.sku].push({
                id: item.id,
                finished_good_id: item.finished_good_id,
                finished_good_name: item.finished_goods?.name || 'Unknown',
                qty_per_sku: item.qty_per_sku
            })
        })

        // Merge data
        const merged = (skuData || []).map(s => ({
            ...s,
            items: itemsBySku[s.sku] || []
        }))

        setMappings(merged)
        setLoading(false)
    }

    function addItem() {
        setItems(prev => [...prev, { finished_good_id: '', qty_per_sku: 1 }])
    }

    function removeItem(idx) {
        setItems(prev => prev.filter((_, i) => i !== idx))
    }

    function updateItem(idx, patch) {
        setItems(prev => prev.map((item, i) => i === idx ? { ...item, ...patch } : item))
    }

    async function createSKU() {
        const trimmedSku = sku.trim()
        if (!trimmedSku) return push('SKU code is required', 'warn')

        const validItems = items.filter(item =>
            item.finished_good_id &&
            Number.isFinite(Number(item.qty_per_sku)) &&
            Number(item.qty_per_sku) > 0
        )

        if (validItems.length === 0) {
            return push('Add at least one finished good with qty > 0', 'warn')
        }

        try {
            // Insert SKU mapping
            const { error: err1 } = await supabase
                .from('sku_mappings')
                .insert({
                    sku: trimmedSku,
                    description: description.trim() || null
                })

            if (err1) throw err1

            // Insert SKU mapping items
            const { error: err2 } = await supabase
                .from('sku_mapping_items')
                .insert(
                    validItems.map(item => ({
                        sku: trimmedSku,
                        finished_good_id: item.finished_good_id,
                        qty_per_sku: Number(item.qty_per_sku)
                    }))
                )

            if (err2) throw err2

            push('SKU mapping created!', 'ok')
            setSku('')
            setDescription('')
            setItems([{ finished_good_id: '', qty_per_sku: 1 }])
            load()
        } catch (err) {
            push(err.message, 'err')
        }
    }

    async function toggleActive(skuCode, currentActive) {
        const { error } = await supabase
            .from('sku_mappings')
            .update({ is_active: !currentActive })
            .eq('sku', skuCode)

        if (error) return push(error.message, 'err')
        push(`SKU ${!currentActive ? 'activated' : 'deactivated'}`, 'ok')
        load()
    }

    async function deleteSKU(skuCode) {
        if (!confirm(`Delete SKU "${skuCode}"? This will remove all its mappings.`)) return

        const { error } = await supabase
            .from('sku_mappings')
            .delete()
            .eq('sku', skuCode)

        if (error) return push(error.message, 'err')
        push('SKU deleted', 'ok')
        load()
    }

    function startEdit(mapping) {
        setEditingSku(mapping.sku)
        setEditDescription(mapping.description || '')
        setEditItems(mapping.items.map(item => ({
            id: item.id,
            finished_good_id: item.finished_good_id,
            finished_good_name: item.finished_good_name,
            qty_per_sku: item.qty_per_sku
        })))
        setExpandedRows(new Set([mapping.sku]))
    }

    function cancelEdit() {
        setEditingSku(null)
        setEditDescription('')
        setEditItems([])
    }

    async function saveEdit() {
        if (!editingSku) return

        const validItems = editItems.filter(item =>
            item.finished_good_id &&
            Number.isFinite(Number(item.qty_per_sku)) &&
            Number(item.qty_per_sku) > 0
        )

        if (validItems.length === 0) {
            return push('At least one item with qty > 0 is required', 'warn')
        }

        try {
            // Update description
            const { error: err1 } = await supabase
                .from('sku_mappings')
                .update({ description: editDescription.trim() || null })
                .eq('sku', editingSku)

            if (err1) throw err1

            // Delete all existing items
            const { error: err2 } = await supabase
                .from('sku_mapping_items')
                .delete()
                .eq('sku', editingSku)

            if (err2) throw err2

            // Insert new items
            const { error: err3 } = await supabase
                .from('sku_mapping_items')
                .insert(
                    validItems.map(item => ({
                        sku: editingSku,
                        finished_good_id: item.finished_good_id,
                        qty_per_sku: Number(item.qty_per_sku)
                    }))
                )

            if (err3) throw err3

            push('SKU mapping updated!', 'ok')
            cancelEdit()
            load()
        } catch (err) {
            push(err.message, 'err')
        }
    }

    function addEditItem() {
        setEditItems(prev => [...prev, { finished_good_id: '', qty_per_sku: 1 }])
    }

    function removeEditItem(idx) {
        setEditItems(prev => prev.filter((_, i) => i !== idx))
    }

    function updateEditItem(idx, patch) {
        setEditItems(prev => prev.map((item, i) => i === idx ? { ...item, ...patch } : item))
    }

    function toggleExpand(skuCode) {
        setExpandedRows(prev => {
            const next = new Set(prev)
            if (next.has(skuCode)) next.delete(skuCode)
            else next.add(skuCode)
            return next
        })
    }

    function downloadSampleCSV() {
        const headers = ['SKU', 'Finished Good', 'Qty per SKU', 'Description']
        const rows = [
            ['gs_ragi_atta_1kgx5', 'Ragi Atta 1kg', '5', 'Pack of 5'],
            ['gs_chilli_oregano_combo', 'Chilli Flakes 200g', '1', 'Combo Pack'],
            ['gs_chilli_oregano_combo', 'Oregano 200g', '1', 'Combo Pack']
        ]
        const csvContent = [headers, ...rows].map(r => r.join(',')).join('\n')
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        saveAs(blob, 'sku_mappings_sample.csv')
    }

    async function onBulkImport(e) {
        const f = e.target.files?.[0]
        if (!f) return

        try {
            const buf = await f.arrayBuffer()
            const wb = XLSX.read(buf, { type: 'array' })
            const ws = wb.Sheets[wb.SheetNames[0]]
            const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })

            if (rows.length === 0) throw new Error('No rows found')

            push(`Parsing ${rows.length} rows...`, 'ok')

            // Group by SKU
            const skuGroups = {}
            for (const r of rows) {
                const skuCode = String(r['SKU'] ?? r['sku'] ?? '').trim()
                const fgName = String(r['Finished Good'] ?? r['finished good'] ?? r['FG'] ?? '').trim()
                const qty = Number(r['Qty per SKU'] ?? r['qty per sku'] ?? r['Qty'] ?? 0)
                const desc = String(r['Description'] ?? r['description'] ?? '').trim()

                if (!skuCode || !fgName || !(qty > 0)) {
                    // skip empty rows or invalid data silently? or throw?
                    // for 40k rows, maybe just skip bad ones and report count?
                    // let's stick to strict for now but maybe log warning
                    continue
                }

                if (!skuGroups[skuCode]) {
                    skuGroups[skuCode] = { description: desc, items: [] }
                }
                skuGroups[skuCode].items.push({ fgName, qty })
            }

            const skuCodes = Object.keys(skuGroups)
            if (skuCodes.length === 0) throw new Error('No valid SKU rows found')

            // Fetch all unique FG names in chunks
            const allFgNames = [...new Set(
                Object.values(skuGroups).flatMap(g => g.items.map(i => i.fgName))
            )]

            push(`Resolving ${allFgNames.length} finished goods...`, 'ok')

            const fgMap = {}
            const CHUNK_SIZE_FG = 1000
            for (let i = 0; i < allFgNames.length; i += CHUNK_SIZE_FG) {
                const chunk = allFgNames.slice(i, i + CHUNK_SIZE_FG)
                const { data: foundFGs, error: fetchErr } = await supabase
                    .from('finished_goods')
                    .select('id, name')
                    .in('name', chunk)
                    .eq('is_active', true)

                if (fetchErr) throw fetchErr
                foundFGs?.forEach(fg => {
                    fgMap[fg.name.toLowerCase().trim()] = fg.id
                })
            }

            // Validate all FGs exist
            const missing = []
            for (const fgName of allFgNames) {
                if (!fgMap[fgName.toLowerCase().trim()]) {
                    missing.push(fgName)
                }
            }

            if (missing.length > 0) {
                throw new Error(`Finished goods not found: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}`)
            }

            // Insert SKUs and items in chunks
            push(`Importing ${skuCodes.length} SKUs...`, 'ok')

            const CHUNK_SIZE_SKU = 50 // smaller chunk for writes to avoid timeout
            let processed = 0

            for (let i = 0; i < skuCodes.length; i += CHUNK_SIZE_SKU) {
                const chunkCodes = skuCodes.slice(i, i + CHUNK_SIZE_SKU)

                // 1. Upsert SKUs
                const skuUpserts = chunkCodes.map(code => ({
                    sku: code,
                    description: skuGroups[code].description || null,
                    is_active: true
                }))

                const { error: err1 } = await supabase
                    .from('sku_mappings')
                    .upsert(skuUpserts, { onConflict: 'sku' })

                if (err1) throw new Error(`Failed to upsert SKUs: ${err1.message}`)

                // 2. Delete existing items for these SKUs (to handle updates/re-imports)
                const { error: err2 } = await supabase
                    .from('sku_mapping_items')
                    .delete()
                    .in('sku', chunkCodes)

                if (err2) throw new Error(`Failed to clean up old items: ${err2.message}`)

                // 3. Insert new items
                const itemInserts = []
                for (const code of chunkCodes) {
                    for (const item of skuGroups[code].items) {
                        itemInserts.push({
                            sku: code,
                            finished_good_id: fgMap[item.fgName.toLowerCase().trim()],
                            qty_per_sku: item.qty
                        })
                    }
                }

                if (itemInserts.length > 0) {
                    const { error: err3 } = await supabase
                        .from('sku_mapping_items')
                        .insert(itemInserts)

                    if (err3) throw new Error(`Failed to insert items: ${err3.message}`)
                }

                processed += chunkCodes.length
                if (processed % 500 === 0) {
                    push(`Imported ${processed}/${skuCodes.length} SKUs...`, 'ok')
                }
            }

            push(`Successfully imported ${skuCodes.length} SKUs!`, 'ok')
            load()
        } catch (err) {
            console.error(err)
            push(err.message, 'err')
        } finally {
            e.target.value = ''
        }
    }

    const filtered = mappings.filter(m => {
        const search = q.toLowerCase()
        return !search ||
            m.sku.toLowerCase().includes(search) ||
            (m.description || '').toLowerCase().includes(search) ||
            m.items.some(item => item.finished_good_name.toLowerCase().includes(search))
    })

    return (
        <div className="grid">
            {/* Create SKU Mapping */}
            <div className="card">
                <div className="hd"><b>Create SKU Mapping</b></div>
                <div className="bd" style={{ display: 'grid', gap: 10 }}>
                    <div className="row" style={{ gap: 8 }}>
                        <input
                            placeholder="SKU Code (e.g., gs_ragi_atta_1kgx5)"
                            value={sku}
                            onChange={e => setSku(e.target.value)}
                            style={{ minWidth: 300 }}
                        />
                        <input
                            placeholder="Description (optional)"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            style={{ minWidth: 300 }}
                        />
                    </div>

                    <table className="table">
                        <thead>
                            <tr>
                                <th style={{ width: '60%' }}>Finished Good</th>
                                <th style={{ width: 120 }}>Qty per SKU</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item, idx) => (
                                <tr key={idx}>
                                    <td>
                                        <AsyncFGSelect
                                            value={item.finished_good_id}
                                            onChange={id => updateItem(idx, { finished_good_id: String(id || '') })}
                                            placeholder="Search finished goods…"
                                            minChars={1}
                                            pageSize={25}
                                        />
                                    </td>
                                    <td>
                                        <input
                                            type="number"
                                            min="1"
                                            value={item.qty_per_sku}
                                            onChange={e => updateItem(idx, { qty_per_sku: e.target.value })}
                                        />
                                    </td>
                                    <td>
                                        <button className="btn ghost" onClick={() => removeItem(idx)}>✕</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <div className="row" style={{ marginTop: 4 }}>
                        <button className="btn outline" onClick={addItem}>+ Add Item</button>
                        <button className="btn" onClick={createSKU}>Create SKU Mapping</button>
                    </div>
                </div>
            </div>

            {/* Bulk Import */}
            <div className="card">
                <div className="hd"><b>Bulk Import SKU Mappings</b></div>
                <div className="bd">
                    <div className="row" style={{ gap: 8 }}>
                        <input type="file" accept=".xlsx,.xls,.csv" onChange={onBulkImport} />
                        <button className="btn ghost" onClick={downloadSampleCSV}>📄 Download Sample CSV</button>
                    </div>
                    <div className="s" style={{ color: 'var(--muted)', marginTop: 8 }}>
                        Columns: <code>SKU</code>, <code>Finished Good</code>, <code>Qty per SKU</code>, <code>Description</code> (optional).
                        For combo SKUs, use multiple rows with the same SKU code.
                    </div>
                </div>
            </div>

            {/* List SKU Mappings */}
            <div className="card">
                <div className="hd">
                    <b>SKU Mappings ({filtered.length})</b>
                    <input
                        placeholder="Search SKU, description, or finished good…"
                        value={q}
                        onChange={e => setQ(e.target.value)}
                        style={{ minWidth: 300 }}
                    />
                </div>
                <div className="bd" style={{ overflow: 'auto' }}>
                    <table className="table">
                        <thead>
                            <tr>
                                <th>SKU</th>
                                <th>Description</th>
                                <th>Items</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(m => (
                                <>
                                    <tr key={m.sku}>
                                        <td>
                                            <code style={{ fontSize: '0.9em' }}>{m.sku}</code>
                                        </td>
                                        <td>{m.description || '—'}</td>
                                        <td>
                                            <button
                                                className="btn ghost"
                                                onClick={() => toggleExpand(m.sku)}
                                                style={{ fontSize: '0.85em' }}
                                            >
                                                {expandedRows.has(m.sku) ? '▼' : '▶'} {m.items.length} item{m.items.length !== 1 ? 's' : ''}
                                            </button>
                                        </td>
                                        <td>
                                            <span className={`badge ${m.is_active ? '' : 'inactive'}`}>
                                                {m.is_active ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td>
                                            <div className="row" style={{ gap: 4 }}>
                                                {editingSku === m.sku ? (
                                                    <>
                                                        <button className="btn" onClick={saveEdit}>Save</button>
                                                        <button className="btn outline" onClick={cancelEdit}>Cancel</button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button className="btn outline" onClick={() => startEdit(m)}>Edit</button>
                                                        <button
                                                            className="btn outline"
                                                            onClick={() => toggleActive(m.sku, m.is_active)}
                                                        >
                                                            {m.is_active ? 'Deactivate' : 'Activate'}
                                                        </button>
                                                        <button className="btn ghost" onClick={() => deleteSKU(m.sku)}>Delete</button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                    {expandedRows.has(m.sku) && (
                                        <tr key={`${m.sku}-details`}>
                                            <td colSpan="5" style={{ background: 'var(--bg-secondary)', padding: 12 }}>
                                                {editingSku === m.sku ? (
                                                    <div style={{ display: 'grid', gap: 10 }}>
                                                        <input
                                                            placeholder="Description (optional)"
                                                            value={editDescription}
                                                            onChange={e => setEditDescription(e.target.value)}
                                                            style={{ width: '100%' }}
                                                        />
                                                        <table className="table" style={{ marginBottom: 0 }}>
                                                            <thead>
                                                                <tr>
                                                                    <th style={{ width: '60%' }}>Finished Good</th>
                                                                    <th style={{ width: 120 }}>Qty per SKU</th>
                                                                    <th></th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {editItems.map((item, idx) => (
                                                                    <tr key={idx}>
                                                                        <td>
                                                                            <AsyncFGSelect
                                                                                value={item.finished_good_id}
                                                                                onChange={id => updateEditItem(idx, { finished_good_id: String(id || '') })}
                                                                                placeholder="Search finished goods…"
                                                                                minChars={1}
                                                                                pageSize={25}
                                                                            />
                                                                        </td>
                                                                        <td>
                                                                            <input
                                                                                type="number"
                                                                                min="1"
                                                                                value={item.qty_per_sku}
                                                                                onChange={e => updateEditItem(idx, { qty_per_sku: e.target.value })}
                                                                            />
                                                                        </td>
                                                                        <td>
                                                                            <button className="btn ghost" onClick={() => removeEditItem(idx)}>✕</button>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                        <button className="btn outline" onClick={addEditItem}>+ Add Item</button>
                                                    </div>
                                                ) : (
                                                    <table className="table" style={{ marginBottom: 0 }}>
                                                        <thead>
                                                            <tr>
                                                                <th>Finished Good</th>
                                                                <th style={{ width: 120 }}>Qty per SKU</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {m.items.map(item => (
                                                                <tr key={item.id}>
                                                                    <td>{item.finished_good_name}</td>
                                                                    <td>{item.qty_per_sku}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                )}
                                            </td>
                                        </tr>
                                    )}
                                </>
                            ))}
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan="5" style={{ color: 'var(--muted)' }}>
                                        {loading ? 'Loading…' : 'No SKU mappings found'}
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
