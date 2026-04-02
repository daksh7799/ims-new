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

    // Master lists from DB
    const [dbPortals, setDbPortals] = useState([])
    const [dbCategories, setDbCategories] = useState([]) // All categories for all portals
    const [portalCategories, setPortalCategories] = useState([]) // Filtered for current bulk portal

    // Bulk selection
    const [selectedSkus, setSelectedSkus] = useState(new Set())
    const [bulkMeta, setBulkMeta] = useState({
        portal: '',
        category: 'Other',
        is_category_fee: true,
        is_weight_fee: true,
        is_amount_fee: true
    })
    const [bulkSaving, setBulkSaving] = useState(false)

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

    // SKU meta (category + portals)
    const [metaMap, setMetaMap] = useState({}) // {sku: {category, portals}}

    const loadConfig = useCallback(async () => {
        const { data: pData } = await supabase.from('costing_portals').select('code, name').order('name')
        setDbPortals(pData || [])
        if (pData?.length && !bulkMeta.portal) {
            setBulkMeta(prev => ({ ...prev, portal: pData[0].code }))
        }

        const { data: cData } = await supabase.from('costing_categories').select('*').order('name')
        setDbCategories(cData || [])
    }, [bulkMeta.portal])

    useEffect(() => { loadConfig() }, [loadConfig])

    // Update available categories when bulk portal changes
    useEffect(() => {
        if (!bulkMeta.portal) return
        const filtered = dbCategories.filter(c => c.portal === bulkMeta.portal).map(c => c.name)
        if (!filtered.includes('Other')) filtered.push('Other')
        setPortalCategories(filtered)
        if (!filtered.includes(bulkMeta.category)) {
            setBulkMeta(prev => ({ ...prev, category: 'Other' }))
        }
    }, [bulkMeta.portal, dbCategories])

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

            // Load sku_portal_metadata for these SKUs to show which portals they are on
            const { data: metaData } = await supabase
                .from('sku_portal_metadata')
                .select('sku, portal, category')
                .in('sku', skuCodes)

            const mm = {}
            metaData?.forEach(m => {
                if (!mm[m.sku]) mm[m.sku] = { portalMeta: {} }
                mm[m.sku].portalMeta[m.portal] = m.category || ''
            })
            setMetaMap(mm)
        } catch (err) {
            console.error('Load error:', err)
            push(err.message, 'err')
        } finally {
            setLoading(false)
        }
    }, [page, pageSize, q, push])

    async function saveSkuMeta(skuCode, portal, category, toggles = {}) {
        const { error } = await supabase
            .from('sku_portal_metadata')
            .upsert({
                sku: skuCode,
                portal,
                category,
                ...toggles,
                updated_at: new Date().toISOString()
            }, { onConflict: 'sku,portal' })

        if (error) { push(`Meta save error: ${error.message}`, 'err'); return }
        load() // Reload to refresh the indicators
    }

    async function removeSkuPortalMeta(skuCode, portal) {
        const { error } = await supabase
            .from('sku_portal_metadata')
            .delete()
            .eq('sku', skuCode)
            .eq('portal', portal)

        if (error) { push(`Meta delete error: ${error.message}`, 'err'); return }
        load()
    }

    async function bulkSaveMeta() {
        if (selectedSkus.size === 0 || !bulkMeta.portal) return
        setBulkSaving(true)
        try {
            const skuList = Array.from(selectedSkus)
            const upserts = skuList.map(s => ({
                sku: s,
                portal: bulkMeta.portal,
                category: bulkMeta.category,
                is_category_fee: bulkMeta.is_category_fee,
                is_weight_fee: bulkMeta.is_weight_fee,
                is_amount_fee: bulkMeta.is_amount_fee,
                updated_at: new Date().toISOString()
            }))

            const CHUNK = 500
            for (let i = 0; i < upserts.length; i += CHUNK) {
                const { error } = await supabase
                    .from('sku_portal_metadata')
                    .upsert(upserts.slice(i, i + CHUNK), { onConflict: 'sku,portal' })
                if (error) throw error
            }

            // Auto sync NLC
            await supabase.rpc('sync_all_nlc_costs')

            push(`Configured ${skuList.length} SKUs for ${bulkMeta.portal} successfully!`, 'ok')
            setSelectedSkus(new Set())
            load()
        } catch (err) {
            push(err.message, 'err')
        } finally {
            setBulkSaving(false)
        }
    }

    function toggleSelectAll() {
        if (selectedSkus.size >= mappings.length) {
            setSelectedSkus(new Set())
        } else {
            setSelectedSkus(new Set(mappings.map(m => m.sku)))
        }
    }

    function toggleSelectOne(skuCode) {
        setSelectedSkus(prev => {
            const next = new Set(prev)
            if (next.has(skuCode)) next.delete(skuCode)
            else next.add(skuCode)
            return next
        })
    }

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

            // Auto sync NLC
            await supabase.rpc('sync_all_nlc_costs')

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

            // Auto sync NLC
            await supabase.rpc('sync_all_nlc_costs')

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

    function downloadSamplePortalCSV() {
        const headers = ['SKU', 'Portal', 'Category']
        const rows = [
            ['gs_ragi_atta_1kgx5', 'amazon', 'Grocery & Gourmet Foods'],
            ['gs_chilli_oregano_combo', 'flipkart', 'Other'],
            ['gs_chilli_oregano_combo', 'amazon', 'Grocery & Gourmet Foods']
        ]
        const csvContent = [headers, ...rows].map(r => r.join(',')).join('\n')
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        saveAs(blob, 'sku_portal_assignment_sample.csv')
    }

    async function onBulkPortalImport(e) {
        const f = e.target.files?.[0]
        if (!f) return

        try {
            const buf = await f.arrayBuffer()
            const wb = XLSX.read(buf, { type: 'array' })
            const ws = wb.Sheets[wb.SheetNames[0]]
            const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })

            if (rows.length === 0) throw new Error('No rows found in file')

            push(`Parsing ${rows.length} rows…`, 'ok')

            const upserts = []
            const failedRows = []

            for (const r of rows) {
                const skuCode = String(r['SKU'] ?? r['sku'] ?? '').trim()
                const portal = String(r['Portal'] ?? r['portal'] ?? '').trim().toLowerCase()
                const category = String(r['Category'] ?? r['category'] ?? 'Other').trim() || 'Other'

                if (!skuCode || !portal) {
                    failedRows.push({ SKU: skuCode || '(blank)', Portal: portal || '(blank)', Category: category, Error: 'SKU and Portal are required' })
                    continue
                }

                upserts.push({
                    sku: skuCode,
                    portal,
                    category,
                    updated_at: new Date().toISOString()
                })
            }

            if (upserts.length === 0) {
                throw new Error('No valid rows found. Make sure columns are: SKU, Portal, Category')
            }

            // Validate that all SKU codes exist in sku_mappings (FK constraint check)
            push(`Validating ${upserts.length} SKU codes…`, 'ok')
            const uniqueSkus = [...new Set(upserts.map(u => u.sku))]
            const existingSkuSet = new Set()
            const CHUNK = 500
            for (let i = 0; i < uniqueSkus.length; i += CHUNK) {
                const { data: found, error: skuErr } = await supabase
                    .from('sku_mappings')
                    .select('sku')
                    .in('sku', uniqueSkus.slice(i, i + CHUNK))
                if (skuErr) throw skuErr
                found?.forEach(r => existingSkuSet.add(r.sku))
            }

            // Split upserts into valid (SKU exists) vs failed (SKU not in system)
            const validUpserts = []
            for (const u of upserts) {
                if (existingSkuSet.has(u.sku)) {
                    validUpserts.push(u)
                } else {
                    failedRows.push({ SKU: u.sku, Portal: u.portal, Category: u.category, Error: 'SKU not found in system — create the SKU mapping first' })
                }
            }

            if (validUpserts.length === 0) {
                throw new Error(`All ${upserts.length} rows failed: none of the SKU codes exist in the system.`)
            }

            // Deduplicate by sku+portal to avoid Postgres "cannot affect row a second time" error
            // (If the CSV has duplicates, the last one wins)
            const deduplicatedMap = new Map()
            for (const u of validUpserts) {
                deduplicatedMap.set(`${u.sku}_${u.portal}`, u)
            }
            const finalUpserts = Array.from(deduplicatedMap.values())

            push(`Assigning ${finalUpserts.length} portal mappings…`, 'ok')

            let successCount = 0
            for (let i = 0; i < finalUpserts.length; i += CHUNK) {
                const { error } = await supabase
                    .from('sku_portal_metadata')
                    .upsert(finalUpserts.slice(i, i + CHUNK), { onConflict: 'sku,portal' })
                if (error) {
                    const chunk = finalUpserts.slice(i, i + CHUNK)
                    chunk.forEach(u => failedRows.push({ SKU: u.sku, Portal: u.portal, Category: u.category, Error: error.message }))
                } else {
                    successCount += Math.min(CHUNK, finalUpserts.length - i)
                }
            }

            if (failedRows.length > 0) {
                push(`Assigned ${successCount} portal mappings. ${failedRows.length} failed. Downloading error report…`, 'warn')
                const headers = ['SKU', 'Portal', 'Category', 'Error']
                const csvContent = [
                    headers.join(','),
                    ...failedRows.map(r => [`"${r.SKU}"`, `"${r.Portal}"`, `"${r.Category}"`, `"${r.Error}"`].join(','))
                ].join('\n')
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
                saveAs(blob, 'portal_assign_errors.csv')
            } else {
                push(`Successfully assigned ${successCount} portal mappings!`, 'ok')
            }

            // Auto sync NLC
            await supabase.rpc('sync_all_nlc_costs')

            load()
        } catch (err) {
            console.error(err)
            push(err.message, 'err')
        } finally {
            e.target.value = ''
        }
    }

    async function exportCurrentSKUs() {
        try {
            push('Exporting SKU mappings...', 'ok')

            // Fetch ALL SKUs using range-based pagination (not limited by page/pageSize)
            let allSkuData = []
            let skuOffset = 0
            const SKU_FETCH_SIZE = 1000
            let hasMoreSKUs = true

            let baseQuery = supabase.from('sku_mappings').select('*').order('sku', { ascending: true })
            if (q.trim()) {
                const searchTerm = `%${q.trim()}%`
                baseQuery = baseQuery.ilike('sku', searchTerm)
            }

            // Fetch all SKUs in chunks
            while (hasMoreSKUs) {
                const { data: skuChunk, error: skuErr } = await baseQuery
                    .range(skuOffset, skuOffset + SKU_FETCH_SIZE - 1)

                if (skuErr) throw skuErr

                if (skuChunk && skuChunk.length > 0) {
                    allSkuData = allSkuData.concat(skuChunk)
                    skuOffset += SKU_FETCH_SIZE

                    if (skuChunk.length < SKU_FETCH_SIZE) {
                        hasMoreSKUs = false
                    }
                } else {
                    hasMoreSKUs = false
                }
            }

            const skuData = allSkuData
            if (!skuData || skuData.length === 0) return push('No SKU mappings to export', 'warn')

            const skuCodes = skuData.map(s => s.sku)
            const skuSet = new Set(skuCodes) // For fast lookup

            // Fetch ALL items using range-based pagination (not filtered by SKU in query)
            // This is more reliable than trying to use .in() with large arrays
            let allItemsData = []
            let err2 = null

            push(`Fetching all SKU mapping items...`, 'ok')

            const ROWS_PER_FETCH = 1000
            let currentOffset = 0
            let hasMore = true

            while (hasMore) {
                const { data: chunkItems, error: chunkErr } = await supabase
                    .from('sku_mapping_items')
                    .select('*, finished_goods(id, name)')
                    .order('sku')
                    .order('id')
                    .range(currentOffset, currentOffset + ROWS_PER_FETCH - 1)

                if (chunkErr) {
                    err2 = chunkErr
                    break
                }

                if (chunkItems && chunkItems.length > 0) {
                    // Filter to only include items for SKUs we're exporting
                    const filteredItems = chunkItems.filter(item => skuSet.has(item.sku))
                    allItemsData = allItemsData.concat(filteredItems)

                    currentOffset += ROWS_PER_FETCH

                    // Show progress
                    if (currentOffset % 5000 === 0 || chunkItems.length < ROWS_PER_FETCH) {
                        push(`Fetched ${currentOffset} rows... (${allItemsData.length} matching items)`, 'ok')
                    }

                    // If we got less than ROWS_PER_FETCH, we've reached the end
                    if (chunkItems.length < ROWS_PER_FETCH) {
                        hasMore = false
                    }
                } else {
                    hasMore = false
                }
            }

            const itemsData = allItemsData

            if (err2) throw err2

            // Build SKU map for O(1) lookup instead of O(n) find
            const skuMap = {}
            skuData.forEach(s => {
                skuMap[s.sku] = s
            })

            const exportRows = []
            itemsData?.forEach(item => {
                const skuMapping = skuMap[item.sku]
                exportRows.push({
                    'SKU': item.sku,
                    'Finished Good': item.finished_goods?.name || '',
                    'Qty per SKU': item.qty_per_sku,
                    'Description': skuMapping?.description || ''
                })
            })

            // Export as CSV (faster and smaller for large datasets)
            const headers = ['SKU', 'Finished Good', 'Qty per SKU', 'Description']
            const csvContent = [
                headers.join(','),
                ...exportRows.map(r => [
                    `"${r.SKU}"`,
                    `"${r['Finished Good']}"`,
                    r['Qty per SKU'],
                    `"${r.Description}"`
                ].join(','))
            ].join('\n')

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
            saveAs(blob, `sku_mappings_export_${new Date().toISOString().split('T')[0]}.csv`)
            push(`Exported ${exportRows.length} SKU mapping items (${skuCodes.length} unique SKUs)`, 'ok')
        } catch (err) {
            console.error('Export error:', err)
            push(err.message, 'err')
        }
    }

    async function exportPivotedSKUs() {
        try {
            push('Generating detailed pivoted export...', 'ok')

            // 1. Fetch SKUs (Chunked)
            let allSkuData = []
            let skuOffset = 0
            const SKU_FETCH_SIZE = 1000
            let hasMoreSKUs = true

            let baseQuery = supabase.from('sku_mappings').select('*').order('sku', { ascending: true })
            if (q.trim()) {
                const searchTerm = `%${q.trim()}%`
                baseQuery = baseQuery.ilike('sku', searchTerm)
            }

            while (hasMoreSKUs) {
                const { data: skuChunk, error: skuErr } = await baseQuery.range(skuOffset, skuOffset + SKU_FETCH_SIZE - 1)
                if (skuErr) throw skuErr
                if (skuChunk && skuChunk.length > 0) {
                    allSkuData = allSkuData.concat(skuChunk)
                    skuOffset += SKU_FETCH_SIZE
                    if (skuChunk.length < SKU_FETCH_SIZE) hasMoreSKUs = false
                } else {
                    hasMoreSKUs = false
                }
            }

            if (allSkuData.length === 0) return push('No SKU mappings to export', 'warn')

            // 2. Fetch mapping items (Chunked)
            const skuSet = new Set(allSkuData.map(s => s.sku))
            let allItemsData = []
            let currentOffset = 0
            let hasMore = true
            const ROWS_PER_FETCH = 1000

            push(`Fetching mapping items...`, 'ok')
            while (hasMore) {
                const { data: chunkItems, error: chunkErr } = await supabase
                    .from('sku_mapping_items')
                    .select('*, finished_goods(id, name)')
                    .order('sku')
                    .order('id')
                    .range(currentOffset, currentOffset + ROWS_PER_FETCH - 1)

                if (chunkErr) throw chunkErr
                if (chunkItems && chunkItems.length > 0) {
                    const filteredItems = chunkItems.filter(item => skuSet.has(item.sku))
                    allItemsData = allItemsData.concat(filteredItems)
                    currentOffset += ROWS_PER_FETCH
                    if (chunkItems.length < ROWS_PER_FETCH) hasMore = false
                } else {
                    hasMore = false
                }
            }

            // 3. Group by SKU and determine max columns
            const itemsBySku = {}
            let maxItems = 0
            allItemsData.forEach(item => {
                if (!itemsBySku[item.sku]) itemsBySku[item.sku] = []
                itemsBySku[item.sku].push({
                    name: item.finished_goods?.name || 'Unknown',
                    qty: item.qty_per_sku
                })
                if (itemsBySku[item.sku].length > maxItems) maxItems = itemsBySku[item.sku].length
            })

            // 4. Generate dynamic headers
            const headers = ['SKU & Description']
            for (let i = 1; i <= maxItems; i++) {
                headers.push(`Finished Good ${i}`)
                headers.push(`Qty per SKU ${i}`)
            }

            // 5. Generate rows
            const rows = allSkuData.map(s => {
                const skuDisplay = `"${s.sku}${s.description ? ' - ' + s.description : ''}"`
                const row = [skuDisplay]
                const items = itemsBySku[s.sku] || []
                
                for (let i = 0; i < maxItems; i++) {
                    if (items[i]) {
                        row.push(`"${items[i].name}"`)
                        row.push(items[i].qty)
                    } else {
                        row.push('""')
                        row.push('""')
                    }
                }
                return row.join(',')
            })

            const csvContent = [headers.join(','), ...rows].join('\n')
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
            saveAs(blob, `sku_mappings_pivoted_${new Date().toISOString().split('T')[0]}.csv`)
            push(`Exported ${allSkuData.length} SKUs in pivoted format`, 'ok')

        } catch (err) {
            console.error('Pivoted export error:', err)
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

            // Auto sync NLC
            await supabase.rpc('sync_all_nlc_costs')

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
                            <button className="btn" onClick={exportCurrentSKUs}>📤 Export Flat CSV</button>
                            <button className="btn" onClick={exportPivotedSKUs} style={{ background: 'var(--success)', borderColor: 'var(--success)' }}>📊 Download Detailed CSV (Pivoted)</button>
                            <button className="btn ghost" onClick={downloadSampleCSV}>📄 Download Sample CSV</button>
                        </div>
                        <div className="s" style={{ color: 'var(--muted)' }}>
                            Export current SKU mappings to CSV. {q ? 'Will export filtered results only.' : 'Will export all SKU mappings.'}
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

                    {/* Bulk Portal Assignment via CSV */}
                    <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                        <div style={{ marginBottom: 8 }}>
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>🏪 Bulk Portal Assignment via CSV</div>
                            <div className="s" style={{ color: 'var(--muted)' }}>
                                Assign portals to many SKUs at once by uploading a CSV with columns:
                                {' '}<code>SKU</code>, <code>Portal</code>, <code>Category</code> (optional, defaults to &quot;Other&quot;).
                                One row per SKU-portal pair. Existing assignments will be updated.
                            </div>
                        </div>
                        <div className="row" style={{ gap: 8 }}>
                            <label className="btn" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                📤 Upload Portal CSV
                                <input type="file" accept=".xlsx,.xls,.csv" onChange={onBulkPortalImport} style={{ display: 'none' }} />
                            </label>
                            <button className="btn ghost" onClick={downloadSamplePortalCSV}>📄 Sample Portal CSV</button>
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
                                <th style={{ width: 40 }}>
                                    <input type="checkbox" checked={mappings.length > 0 && selectedSkus.size >= mappings.length} onChange={toggleSelectAll} />
                                </th>
                                <th style={{ width: '25%' }}>SKU & Description</th>
                                <th style={{ width: '45%' }}>Marketplace Configurations</th>
                                <th style={{ width: '15%' }}>Portal Assignment</th>
                                <th style={{ width: '15%' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {mappings.map(m => (
                                <Fragment key={m.sku}>
                                    <tr className={selectedSkus.has(m.sku) ? 'selected-row' : ''}>
                                        <td>
                                            <input type="checkbox" checked={selectedSkus.has(m.sku)} onChange={() => toggleSelectOne(m.sku)} />
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                <code style={{ fontSize: '1em', color: 'var(--primary)', fontWeight: 600 }}>{m.sku}</code>
                                                <div className="s" style={{ color: 'var(--muted)', fontSize: '0.85em' }}>{m.description || 'No description'}</div>
                                                <div style={{ marginTop: 4 }}>
                                                    <button
                                                        className="btn ghost xsmall"
                                                        onClick={() => toggleExpand(m.sku)}
                                                        style={{ padding: '2px 8px', fontSize: '0.75em', background: 'var(--bg-alt)' }}
                                                    >
                                                        {expandedRows.has(m.sku) ? '▼' : '▶'} {m.items.length} item{m.items.length !== 1 ? 's' : ''}
                                                    </button>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                                {Object.entries(metaMap[m.sku]?.portalMeta || {}).map(([p, cat]) => (
                                                    <div key={p} style={{
                                                        background: 'var(--bg-card)',
                                                        border: '1px solid var(--border)',
                                                        borderRadius: 8,
                                                        padding: '6px 10px',
                                                        minWidth: 140,
                                                        boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: 2
                                                    }}>
                                                        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 2 }}>
                                                            <b style={{ fontSize: '0.7em', color: 'var(--primary)', letterSpacing: '0.05em' }}>{p.toUpperCase()}</b>
                                                            <button className="btn ghost xsmall" onClick={() => removeSkuPortalMeta(m.sku, p)} style={{ padding: 0, height: 14, width: 14 }}>✕</button>
                                                        </div>
                                                        <select
                                                            value={cat}
                                                            onChange={e => saveSkuMeta(m.sku, p, e.target.value)}
                                                            style={{ fontSize: '0.85em', border: 'none', background: 'transparent', padding: 0, color: 'var(--text-main)', cursor: 'pointer', fontWeight: 500 }}
                                                        >
                                                            {[...new Set(dbCategories.filter(c => c.portal === p).map(c => c.name).concat(['Other']))].map(c => <option key={c} value={c}>{c}</option>)}
                                                        </select>
                                                    </div>
                                                ))}
                                                {Object.keys(metaMap[m.sku]?.portalMeta || {}).length === 0 && (
                                                    <div className="s" style={{ padding: '8px 12px', background: 'var(--bg-alt)', borderRadius: 8, border: '1px dashed var(--border)', color: 'var(--muted)', width: '100%', textAlign: 'center' }}>
                                                        No marketplaces assigned. Use the checklist on the right.
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                                                {dbPortals.map(portalObj => {
                                                    const p = portalObj.code
                                                    const checked = !!metaMap[m.sku]?.portalMeta?.[p]
                                                    return (
                                                        <label key={p} style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 6,
                                                            fontSize: '0.75em',
                                                            cursor: 'pointer',
                                                            padding: '4px 6px',
                                                            borderRadius: 6,
                                                            background: checked ? 'var(--primary-subtle)' : 'var(--bg-alt)',
                                                            border: `1px solid ${checked ? 'var(--primary)' : 'transparent'}`,
                                                            color: checked ? 'var(--primary-dark)' : 'var(--text-main)',
                                                            transition: 'all 0.2s'
                                                        }}>
                                                            <input type="checkbox" checked={checked} onChange={() => {
                                                                if (checked) removeSkuPortalMeta(m.sku, p)
                                                                else saveSkuMeta(m.sku, p, 'Other')
                                                            }} style={{ width: 12, height: 12 }} />
                                                            {portalObj.name}
                                                        </label>
                                                    )
                                                })}
                                            </div>
                                        </td>
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
                                            <td colSpan="6" style={{ background: 'var(--bg-secondary)', padding: 12 }}>
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
                                    <td colSpan="6" style={{ color: 'var(--muted)' }}>
                                        {loading ? 'Loading…' : q ? 'No SKUs found matching your search' : 'No SKU mappings found'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Bulk Action Bar */}
            {selectedSkus.size > 0 && (
                <div style={{
                    position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
                    background: 'var(--bg-card)', border: '2px solid var(--primary)', borderRadius: 12,
                    padding: '12px 24px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', zIndex: 1000,
                    display: 'flex', alignItems: 'center', gap: 20, minWidth: 600
                }}>
                    <div style={{ fontWeight: 700, color: 'var(--primary)' }}>{selectedSkus.size} SKUs Selected</div>

                    <div className="row" style={{ gap: 10, flex: 1, flexWrap: 'nowrap', overflowX: 'auto' }}>
                        <select
                            value={bulkMeta.portal}
                            onChange={e => setBulkMeta(prev => ({ ...prev, portal: e.target.value }))}
                            style={{ padding: '6px 12px', borderColor: 'var(--primary)', fontWeight: 600 }}
                        >
                            {dbPortals.map(p => <option key={p.code} value={p.code}>Target: {p.name}</option>)}
                        </select>

                        <select
                            value={bulkMeta.category}
                            onChange={e => setBulkMeta(prev => ({ ...prev, category: e.target.value }))}
                            style={{ padding: '6px 12px' }}
                        >
                            {portalCategories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>

                        <div className="row" style={{ gap: 6 }}>
                            <label className="badge xsmall outline" style={{ cursor: 'pointer', borderColor: bulkMeta.is_category_fee ? 'var(--primary)' : 'var(--border)', opacity: bulkMeta.is_category_fee ? 1 : 0.5 }}>
                                <input type="checkbox" checked={bulkMeta.is_category_fee} onChange={e => setBulkMeta(p => ({ ...p, is_category_fee: e.target.checked }))} style={{ display: 'none' }} />
                                Cat Fee
                            </label>
                            <label className="badge xsmall outline" style={{ cursor: 'pointer', borderColor: bulkMeta.is_weight_fee ? 'var(--primary)' : 'var(--border)', opacity: bulkMeta.is_weight_fee ? 1 : 0.5 }}>
                                <input type="checkbox" checked={bulkMeta.is_weight_fee} onChange={e => setBulkMeta(p => ({ ...p, is_weight_fee: e.target.checked }))} style={{ display: 'none' }} />
                                Wgt Fee
                            </label>
                            <label className="badge xsmall outline" style={{ cursor: 'pointer', borderColor: bulkMeta.is_amount_fee ? 'var(--primary)' : 'var(--border)', opacity: bulkMeta.is_amount_fee ? 1 : 0.5 }}>
                                <input type="checkbox" checked={bulkMeta.is_amount_fee} onChange={e => setBulkMeta(p => ({ ...p, is_amount_fee: e.target.checked }))} style={{ display: 'none' }} />
                                Amt Fee
                            </label>
                        </div>
                    </div>

                    <div className="row" style={{ gap: 10 }}>
                        <button className="btn ghost small" onClick={() => setSelectedSkus(new Set())}>Cancel</button>
                        <button className="btn" onClick={bulkSaveMeta} disabled={bulkSaving}>
                            {bulkSaving ? 'Saving…' : 'Apply Bulk Update'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
