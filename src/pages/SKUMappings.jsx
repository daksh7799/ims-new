import { useEffect, useState, useCallback, Fragment } from 'react'
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

    // Pagination state
    const [page, setPage] = useState(0)
    const [pageSize, setPageSize] = useState(100)
    const [totalCount, setTotalCount] = useState(0)

    // Form state for creating new SKU
    const [sku, setSku] = useState('')
    const [description, setDescription] = useState('')
    const [items, setItems] = useState([{ finished_good_id: '', qty_per_sku: 1 }])
    const [expandedRows, setExpandedRows] = useState(new Set())

    // Edit mode state
    const [editingSku, setEditingSku] = useState(null)
    const [editDescription, setEditDescription] = useState('')
    const [editItems, setEditItems] = useState([])

    // Bulk import mode state
    const [importMode, setImportMode] = useState('update') // 'update' or 'replace'

    const load = useCallback(async () => {
        setLoading(true)
        try {
            let countQuery = supabase
                .from('sku_mappings')
                .select('sku', { count: 'exact', head: true })

            let dataQuery = supabase
                .from('sku_mappings')
                .select('*')
                .order('created_at', { ascending: false })

            if (q.trim()) {
                const searchTerm = `%${q.trim()}%`
                countQuery = countQuery.ilike('sku', searchTerm)
                dataQuery = dataQuery.ilike('sku', searchTerm)
            }

            const [countRes, dataRes] = await Promise.all([
                countQuery,
                dataQuery.range(page * pageSize, (page + 1) * pageSize - 1),
            ])

            const { count, error: countErr } = countRes
            if (countErr) throw countErr
            setTotalCount(count || 0)

            const { data: skuData, error: err1 } = dataRes
            if (err1) throw err1

            if (!skuData || skuData.length === 0) {
                setMappings([])
                return
            }

            const skuCodes = skuData.map(s => s.sku)
            const { data: itemsData, error: err2 } = await supabase
                .from('sku_mapping_items')
                .select('*, finished_goods(id, name)')
                .in('sku', skuCodes)
                .order('id')

            if (err2) throw err2

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

            const merged = (skuData || []).map(s => ({
                ...s,
                items: itemsBySku[s.sku] || []
            }))

            setMappings(merged)
        } catch (err) {
            console.error('Load error:', err)
            push(err.message, 'err')
        } finally {
            setLoading(false)
        }
    }, [page, pageSize, q, push])

    useEffect(() => { load() }, [load])

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

    async function exportCurrentSKUs() {
        try {
            push('Exporting SKU mappings...', 'ok')

            let dataQuery = supabase.from('sku_mappings').select('*').order('sku', { ascending: true })

            if (q.trim()) {
                const searchTerm = `%${q.trim()}%`
                dataQuery = dataQuery.ilike('sku', searchTerm)
            }

            // Parallel fetch: SKUs and then items (we need SKUs first to get codes, but we can optimize)
            // Actually, we need SKUs first to filter items. But we can fetch all items if we are exporting ALL.
            // If filtered, we need SKUs first. Let's keep it sequential but optimized or use Promise.all if we can.
            // Since we need skuCodes for the second query, we can't fully parallelize without fetching ALL items which might be huge.
            // However, we can use the same filter on items if we joined, but Supabase join syntax is different.
            // Let's stick to the current logic but maybe optimize if possible. 
            // Actually, the user suggested parallelizing like load().
            // In load() we do count and data in parallel. Here we don't need count.
            // We can't parallelize items fetch because it depends on skuData.
            // So we'll keep it as is, but maybe clean up.

            const { data: skuData, error: err1 } = await dataQuery
            if (err1) throw err1
            if (!skuData || skuData.length === 0) return push('No SKU mappings to export', 'warn')

            const skuCodes = skuData.map(s => s.sku)

            // Fetch items
            const { data: itemsData, error: err2 } = await supabase
                .from('sku_mapping_items')
                .select('*, finished_goods(id, name)')
                .in('sku', skuCodes)
                .order('sku')
                .order('id')

            if (err2) throw err2

            const exportRows = []
            itemsData?.forEach(item => {
                const skuMapping = skuData.find(s => s.sku === item.sku)
                exportRows.push({
                    'SKU': item.sku,
                    'Finished Good': item.finished_goods?.name || '',
                    'Qty per SKU': item.qty_per_sku,
                    'Description': skuMapping?.description || ''
                })
            })

            const ws = XLSX.utils.json_to_sheet(exportRows)
            const wb = XLSX.utils.book_new()
            XLSX.utils.book_append_sheet(wb, ws, 'SKU Mappings')

            const maxWidth = 50
            const colWidths = [
                { wch: Math.min(maxWidth, Math.max(10, ...exportRows.map(r => String(r.SKU || '').length))) },
                { wch: Math.min(maxWidth, Math.max(15, ...exportRows.map(r => String(r['Finished Good'] || '').length))) },
                { wch: 12 },
                { wch: Math.min(maxWidth, Math.max(15, ...exportRows.map(r => String(r.Description || '').length))) }
            ]
            ws['!cols'] = colWidths

            XLSX.writeFile(wb, `sku_mappings_export_${new Date().toISOString().split('T')[0]}.xlsx`)
            push(`Exported ${exportRows.length} SKU mapping items (${skuCodes.length} unique SKUs)`, 'ok')
        } catch (err) {
            console.error('Export error:', err)
            push(err.message, 'err')
        }
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

                if (!skuCode || !fgName || !(qty > 0)) continue

                if (!skuGroups[skuCode]) {
                    skuGroups[skuCode] = { description: desc, items: [] }
                }
                skuGroups[skuCode].items.push({ fgName, qty })
            }

            const skuCodes = Object.keys(skuGroups)
            if (skuCodes.length === 0) throw new Error('No valid SKU rows found')

            // Fetch all unique FG names
            const allFgNames = [...new Set(
                Object.values(skuGroups).flatMap(g => g.items.map(i => i.fgName))
            )]

            push(`Resolving ${allFgNames.length} finished goods...`, 'ok')

            const fgMap = {}
            const CHUNK_SIZE_FG = 200
            const fgChunks = []
            for (let i = 0; i < allFgNames.length; i += CHUNK_SIZE_FG) {
                fgChunks.push(allFgNames.slice(i, i + CHUNK_SIZE_FG))
            }

            // Parallel fetch FGs with limited concurrency
            const CONCURRENCY = 5
            for (let i = 0; i < fgChunks.length; i += CONCURRENCY) {
                const slice = fgChunks.slice(i, i + CONCURRENCY)
                await Promise.all(slice.map(async (chunk) => {
                    const { data: foundFGs, error: fetchErr } = await supabase
                        .from('finished_goods')
                        .select('id, name')
                        .in('name', chunk)
                        .eq('is_active', true)

                    if (fetchErr) throw fetchErr
                    foundFGs?.forEach(fg => {
                        fgMap[fg.name.toLowerCase().trim()] = fg.id
                    })
                }))
            }

            // Validate and separate
            const validSkuCodes = []
            const failedRows = []

            for (const skuCode of skuCodes) {
                const data = skuGroups[skuCode]
                let isValid = true
                let errorMsg = ''

                for (const item of data.items) {
                    if (!fgMap[item.fgName.toLowerCase().trim()]) {
                        isValid = false
                        errorMsg = `Finished Good not found: ${item.fgName}`
                        break
                    }
                }

                if (isValid) {
                    validSkuCodes.push(skuCode)
                } else {
                    for (const item of data.items) {
                        failedRows.push({
                            SKU: skuCode,
                            'Finished Good': item.fgName,
                            'Qty per SKU': item.qty,
                            Description: data.description,
                            Error: errorMsg
                        })
                    }
                }
            }

            if (validSkuCodes.length === 0 && failedRows.length > 0) {
                const sample = failedRows.slice(0, 3).map(r => `${r.SKU}: ${r.Error}`).join(', ')
                throw new Error(`All ${skuCodes.length} SKUs failed validation. Sample errors: ${sample}`)
            }

            // Handle Full Replace Mode
            if (importMode === 'replace') {
                if (!confirm('WARNING: You are about to DELETE ALL existing SKU mappings and replace them with this file. This action cannot be undone. Are you sure?')) {
                    return
                }

                push('Clearing all existing mappings...', 'warn')

                // Delete all items first (cascade should handle it but let's be safe)
                const { error: clearItemsErr } = await supabase
                    .from('sku_mapping_items')
                    .delete()
                    .neq('id', 0) // Delete all

                if (clearItemsErr) throw new Error(`Failed to clear items: ${clearItemsErr.message}`)

                const { error: clearSkuErr } = await supabase
                    .from('sku_mappings')
                    .delete()
                    .neq('sku', 'PLACEHOLDER') // Delete all

                if (clearSkuErr) throw new Error(`Failed to clear SKUs: ${clearSkuErr.message}`)
            }

            // Insert VALID SKUs and items in chunks
            const modeLabel = importMode === 'update' ? 'Updating' : 'Importing'
            push(`${modeLabel} ${validSkuCodes.length} valid SKUs...`, 'ok')

            const CHUNK_SIZE_SKU = 200
            let processed = 0
            let successCount = 0

            for (let i = 0; i < validSkuCodes.length; i += CHUNK_SIZE_SKU) {
                const chunkCodes = validSkuCodes.slice(i, i + CHUNK_SIZE_SKU)

                try {
                    // 1. Upsert SKUs
                    const skuUpserts = chunkCodes.map(code => ({
                        sku: code,
                        description: skuGroups[code].description || null,
                        is_active: true
                    }))

                    const { error: err1 } = await supabase
                        .from('sku_mappings')
                        .upsert(skuUpserts, { onConflict: 'sku' })

                    if (err1) throw new Error(`Upsert failed: ${err1.message}`)

                    // 2. Delete existing items
                    const { error: err2 } = await supabase
                        .from('sku_mapping_items')
                        .delete()
                        .in('sku', chunkCodes)

                    if (err2) throw new Error(`Cleanup failed: ${err2.message}`)

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

                        if (err3) throw new Error(`Insert items failed: ${err3.message}`)
                    }

                    successCount += chunkCodes.length
                    processed += chunkCodes.length
                    if (processed % 200 === 0) push(`${modeLabel} ${processed}/${validSkuCodes.length} SKUs...`, 'ok')

                } catch (chunkErr) {
                    console.error('Chunk error:', chunkErr)
                    // Add these SKUs to failedRows
                    for (const code of chunkCodes) {
                        const data = skuGroups[code]
                        for (const item of data.items) {
                            failedRows.push({
                                SKU: code,
                                'Finished Good': item.fgName,
                                'Qty per SKU': item.qty,
                                Description: data.description,
                                Error: chunkErr.message
                            })
                        }
                    }
                    processed += chunkCodes.length
                }
            }

            // Handle failures
            const successMsg = importMode === 'update'
                ? `Successfully updated ${successCount} SKUs!`
                : `Successfully imported ${successCount} SKUs!`

            if (failedRows.length > 0) {
                const actionLabel = importMode === 'update' ? 'Updated' : 'Imported'
                push(`${actionLabel} ${successCount} SKUs. ${skuCodes.length - successCount} SKUs failed. Downloading error report...`, 'warn')

                // Generate error CSV
                const headers = ['SKU', 'Finished Good', 'Qty per SKU', 'Description', 'Error']
                const csvContent = [
                    headers.join(','),
                    ...failedRows.map(r => [
                        `"${r.SKU}"`,
                        `"${r['Finished Good']}"`,
                        r['Qty per SKU'],
                        `"${r.Description}"`,
                        `"${r.Error}"`
                    ].join(','))
                ].join('\n')

                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
                saveAs(blob, 'sku_import_errors.csv')
            } else {
                push(successMsg, 'ok')
            }

            load()
        } catch (err) {
            console.error(err)
            push(err.message, 'err')
        } finally {
            e.target.value = ''
        }
    }

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

            {/* Bulk Import/Export */}
            <div className="card">
                <div className="hd"><b>Bulk Import/Export SKU Mappings</b></div>
                <div className="bd" style={{ display: 'grid', gap: 12 }}>
                    {/* Export Section */}
                    <div style={{ paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                            <button className="btn" onClick={exportCurrentSKUs}>📥 Export to Excel</button>
                            <button className="btn ghost" onClick={downloadSampleCSV}>📄 Download Sample CSV</button>
                        </div>
                        <div className="s" style={{ color: 'var(--muted)' }}>
                            Export current SKU mappings to Excel. {q ? 'Will export filtered results only.' : 'Will export all SKU mappings.'}
                        </div>
                    </div>

                    {/* Import Section */}
                    <div>
                        <div style={{ marginBottom: 12 }}>
                            <div className="s" style={{ marginBottom: 8, fontWeight: 500 }}>Import Mode:</div>
                            <div className="row" style={{ gap: 16 }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                                    <input
                                        type="radio"
                                        name="importMode"
                                        value="update"
                                        checked={importMode === 'update'}
                                        onChange={e => setImportMode(e.target.value)}
                                    />
                                    <span>Update Only</span>
                                    <span className="s" style={{ color: 'var(--muted)' }}>(Recommended - Only updates uploaded SKUs)</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                                    <input
                                        type="radio"
                                        name="importMode"
                                        value="replace"
                                        checked={importMode === 'replace'}
                                        onChange={e => setImportMode(e.target.value)}
                                    />
                                    <span>Full Replace</span>
                                    <span className="s" style={{ color: 'var(--danger)' }}>⚠️ (Caution - For initial setup only)</span>
                                </label>
                            </div>
                        </div>

                        <div className="row" style={{ gap: 8 }}>
                            <input type="file" accept=".xlsx,.xls,.csv" onChange={onBulkImport} />
                        </div>

                        {importMode === 'update' ? (
                            <div className="s" style={{ color: 'var(--muted)', marginTop: 8 }}>
                                ✅ <b>Update Mode:</b> Only the SKUs in your file will be updated. All other SKUs remain unchanged.
                                Safe for editing a subset of your 20k+ SKU mappings.
                            </div>
                        ) : (
                            <div className="s" style={{ color: 'var(--danger)', marginTop: 8, padding: 8, background: 'var(--bg-secondary)', borderRadius: 4 }}>
                                ⚠️ <b>Full Replace Mode:</b> This mode is for initial bulk setup only.
                                It will replace ALL existing SKU mappings with the uploaded data. Use with extreme caution!
                            </div>
                        )}

                        <div className="s" style={{ color: 'var(--muted)', marginTop: 8 }}>
                            Columns: <code>SKU</code>, <code>Finished Good</code>, <code>Qty per SKU</code>, <code>Description</code> (optional).
                            For combo SKUs, use multiple rows with the same SKU code.
                        </div>
                    </div>
                </div>
            </div>

            {/* List SKU Mappings */}
            <div className="card">
                <div className="hd">
                    <b>SKU Mappings</b>
                    <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                            placeholder="Search SKU name…"
                            value={q}
                            onChange={e => { setQ(e.target.value); setPage(0) }}
                            style={{ minWidth: 300 }}
                        />
                        <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }}>
                            <option value="50">50 per page</option>
                            <option value="100">100 per page</option>
                            <option value="200">200 per page</option>
                            <option value="500">500 per page</option>
                        </select>
                        <span className="s">
                            Total: {totalCount} SKUs | Showing {totalCount === 0 ? 0 : page * pageSize + 1}-{Math.min((page + 1) * pageSize, totalCount)}
                        </span>
                        <div className="row" style={{ gap: 4 }}>
                            <button
                                className="btn ghost"
                                onClick={() => setPage(p => Math.max(0, p - 1))}
                                disabled={page === 0}
                            >
                                ← Prev
                            </button>
                            <span className="s">Page {page + 1} of {Math.ceil(totalCount / pageSize)}</span>
                            <button
                                className="btn ghost"
                                onClick={() => setPage(p => p + 1)}
                                disabled={(page + 1) * pageSize >= totalCount}
                            >
                                Next →
                            </button>
                        </div>
                    </div>
                </div>
                <div className="bd" style={{ overflow: 'auto' }}>
                    <table className="table">
                        <thead>
                            <tr>
                                <th>SKU</th>
                                <th>Description</th>
                                <th>Items</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {mappings.map(m => (
                                <Fragment key={m.sku}>
                                    <tr>
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
                                            <div className="row" style={{ gap: 4 }}>
                                                {editingSku === m.sku ? (
                                                    <>
                                                        <button className="btn" onClick={saveEdit}>Save</button>
                                                        <button className="btn outline" onClick={cancelEdit}>Cancel</button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button className="btn outline" onClick={() => startEdit(m)}>Edit</button>
                                                        <button className="btn ghost" onClick={() => deleteSKU(m.sku)}>Delete</button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                    {expandedRows.has(m.sku) && (
                                        <tr>
                                            <td colSpan="4" style={{ background: 'var(--bg-secondary)', padding: 12 }}>
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
                                                                                onChange={e => {
                                                                                    const val = Number(e.target.value)
                                                                                    updateEditItem(idx, { qty_per_sku: val > 0 ? val : 1 })
                                                                                }}
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
                                </Fragment>
                            ))}
                            {mappings.length === 0 && (
                                <tr>
                                    <td colSpan="4" style={{ color: 'var(--muted)' }}>
                                        {loading ? 'Loading…' : q ? 'No SKUs found matching your search' : 'No SKU mappings found'}
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
