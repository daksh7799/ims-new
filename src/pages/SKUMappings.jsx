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
    const [allMatchSelected, setAllMatchSelected] = useState(false) // true when "select all across pages" is active
    const [bulkMeta, setBulkMeta] = useState({
        portal: '',
        category: 'Other',
        is_category_fee: true,
        is_weight_fee: true,
        is_amount_fee: true
    })
    const [bulkSaving, setBulkSaving] = useState(false)
    const [bulkProgress, setBulkProgress] = useState(null) // { done, total, label }

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
    }, [bulkMeta.portal, dbCategories, bulkMeta.category])

    const load = useCallback(async () => {
        setLoading(true)
        try {
            let countQuery = supabase
                .from('sku_mappings')
                .select('sku', { count: 'estimated', head: true })

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
        setBulkProgress({ done: 0, total: selectedSkus.size, label: 'Preparing...' })
        try {
            let skuList = Array.from(selectedSkus)

            if (allMatchSelected && skuList.length < totalCount) {
                setBulkProgress({ done: 0, total: totalCount, label: 'Fetching all matching SKUs...' })
                skuList = []
                let offset = 0
                const FETCH_SIZE = 1000
                while (true) {
                    let fetchQuery = supabase.from('sku_mappings').select('sku').order('sku')
                    if (q.trim()) fetchQuery = fetchQuery.ilike('sku', `%${q.trim()}%`)
                    const { data, error } = await fetchQuery.range(offset, offset + FETCH_SIZE - 1)
                    if (error) throw error
                    if (!data || data.length === 0) break
                    skuList.push(...data.map(d => d.sku))
                    offset += FETCH_SIZE
                    setBulkProgress({ done: 0, total: totalCount, label: `Fetched ${skuList.length} of ${totalCount} SKUs...` })
                    if (data.length < FETCH_SIZE) break
                }
            }

            const totalSkus = skuList.length
            setBulkProgress({ done: 0, total: totalSkus, label: `Assigning portal to ${totalSkus} SKUs...` })

            const CHUNK = 500
            let successCount = 0
            const uploadChunks = []

            for (let i = 0; i < skuList.length; i += CHUNK) {
                const chunk = skuList.slice(i, i + CHUNK)
                const upserts = chunk.map(s => ({
                    sku: s,
                    portal: bulkMeta.portal,
                    category: bulkMeta.category,
                    is_category_fee: bulkMeta.is_category_fee,
                    is_weight_fee: bulkMeta.is_weight_fee,
                    is_amount_fee: bulkMeta.is_amount_fee,
                    updated_at: new Date().toISOString()
                }))
                uploadChunks.push(upserts)
            }

            // Execute parallel assignments across throttled pools
            const CONCURRENCY_LIMIT = 4
            for (let i = 0; i < uploadChunks.length; i += CONCURRENCY_LIMIT) {
                const slice = uploadChunks.slice(i, i + CONCURRENCY_LIMIT)
                await Promise.all(slice.map(async (chunk) => {
                    const { error } = await supabase
                        .from('sku_portal_metadata')
                        .upsert(chunk, { onConflict: 'sku,portal' })
                    if (error) throw error
                    successCount += chunk.length
                }))
                setBulkProgress({ done: successCount, total: totalSkus, label: `Assigned ${successCount}/${totalSkus} SKUs...` })
            }

            push(`Configured ${successCount} SKUs for ${bulkMeta.portal} successfully!`, 'ok')
            setSelectedSkus(new Set())
            setAllMatchSelected(false)

            load()
            setBulkProgress({ done: totalSkus, total: totalSkus, label: 'Syncing costs (background)...' })
            supabase.rpc('sync_all_nlc_costs').then(() => {
                setBulkProgress(null)
            }).catch(() => {
                setBulkProgress(null)
            })
        } catch (err) {
            push(err.message, 'err')
            setBulkProgress(null)
        } finally {
            setBulkSaving(false)
        }
    }

    function toggleSelectAll() {
        if (selectedSkus.size >= mappings.length) {
            setSelectedSkus(new Set())
            setAllMatchSelected(false)
        } else {
            setSelectedSkus(new Set(mappings.map(m => m.sku)))
        }
    }

    async function selectAllMatching() {
        push('Selecting all matching SKUs...', 'ok')
        try {
            let allSkuCodes = []
            let offset = 0
            const FETCH_SIZE = 1000
            while (true) {
                let fetchQuery = supabase.from('sku_mappings').select('sku').order('sku')
                if (q.trim()) fetchQuery = fetchQuery.ilike('sku', `%${q.trim()}%`)
                const { data, error } = await fetchQuery.range(offset, offset + FETCH_SIZE - 1)
                if (error) throw error
                if (!data || data.length === 0) break
                allSkuCodes.push(...data.map(d => d.sku))
                offset += FETCH_SIZE
                if (data.length < FETCH_SIZE) break
            }
            setSelectedSkus(new Set(allSkuCodes))
            setAllMatchSelected(true)
            push(`Selected all ${allSkuCodes.length} matching SKUs across all pages`, 'ok')
        } catch (err) {
            push(`Error selecting all: ${err.message}`, 'err')
        }
    }

    function toggleSelectOne(skuCode) {
        setSelectedSkus(prev => {
            const next = new Set(prev)
            if (next.has(skuCode)) next.delete(skuCode)
            else next.add(skuCode)
            return next
        })
        setAllMatchSelected(false)
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
            const { error: err1 } = await supabase
                .from('sku_mappings')
                .insert({
                    sku: trimmedSku,
                    description: description.trim() || null
                })

            if (err1) throw err1

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
            const { error: err1 } = await supabase
                .from('sku_mappings')
                .update({ description: editDescription.trim() || null })
                .eq('sku', editingSku)

            if (err1) throw err1

            const { error: err2 } = await supabase
                .from('sku_mapping_items')
                .delete()
                .eq('sku', editingSku)

            if (err2) throw err2

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

            const rawUpserts = []
            const failedRows = []

            for (const r of rows) {
                const skuCode = String(r['SKU'] ?? r['sku'] ?? '').trim()
                const portal = String(r['Portal'] ?? r['portal'] ?? '').trim().toLowerCase()
                const category = String(r['Category'] ?? r['category'] ?? 'Other').trim() || 'Other'

                if (!skuCode || !portal) {
                    failedRows.push({ SKU: skuCode || '(blank)', Portal: portal || '(blank)', Category: category, Error: 'SKU and Portal are required' })
                    continue
                }

                rawUpserts.push({
                    sku: skuCode,
                    portal,
                    category,
                    updated_at: new Date().toISOString()
                })
            }

            if (rawUpserts.length === 0) {
                throw new Error('No valid rows found. Make sure columns are: SKU, Portal, Category')
            }

            // Deduplicate early in memory to prevent Postgres unique indexing lock delays
            const deduplicatedMap = new Map()
            for (const u of rawUpserts) {
                deduplicatedMap.set(`${u.sku}_${u.portal}`, u)
            }
            const uniqueUpserts = Array.from(deduplicatedMap.values())

            push(`Validating ${uniqueUpserts.length} unique assignments…`, 'ok')
            const uniqueSkuCodes = [...new Set(uniqueUpserts.map(u => u.sku))]
            const existingSkuSet = new Set()
            const CHUNK = 500

            for (let i = 0; i < uniqueSkuCodes.length; i += CHUNK) {
                const { data: found, error: skuErr } = await supabase
                    .from('sku_mappings')
                    .select('sku')
                    .in('sku', uniqueSkuCodes.slice(i, i + CHUNK))
                if (skuErr) throw skuErr
                found?.forEach(r => existingSkuSet.add(r.sku))
            }

            const finalUpserts = []
            for (const u of uniqueUpserts) {
                if (existingSkuSet.has(u.sku)) {
                    finalUpserts.push(u)
                } else {
                    failedRows.push({ SKU: u.sku, Portal: u.portal, Category: u.category, Error: 'SKU not found in system — create the SKU mapping first' })
                }
            }

            if (finalUpserts.length === 0) {
                throw new Error(`All rows failed validation: none of the SKU codes exist in your database records.`)
            }

            setBulkProgress({ done: 0, total: finalUpserts.length, label: `Assigning ${finalUpserts.length} portal configurations…` })

            let successCount = 0
            const uploadChunks = []
            for (let i = 0; i < finalUpserts.length; i += CHUNK) {
                uploadChunks.push(finalUpserts.slice(i, i + CHUNK))
            }

            const CONCURRENCY_LIMIT = 3
            for (let i = 0; i < uploadChunks.length; i += CONCURRENCY_LIMIT) {
                const currentSlice = uploadChunks.slice(i, i + CONCURRENCY_LIMIT)
                await Promise.all(currentSlice.map(async (chunk) => {
                    const { error } = await supabase
                        .from('sku_portal_metadata')
                        .upsert(chunk, { onConflict: 'sku,portal' })
                    if (error) {
                        chunk.forEach(u => failedRows.push({ SKU: u.sku, Portal: u.portal, Category: u.category, Error: error.message }))
                    } else {
                        successCount += chunk.length
                    }
                }))

                const currentDone = successCount + failedRows.filter(r => r.Error !== 'SKU not found in system — create the SKU mapping first').length
                setBulkProgress({ 
                    done: Math.min(currentDone, finalUpserts.length), 
                    total: finalUpserts.length, 
                    label: `Assigned ${successCount}/${finalUpserts.length} portal configurations…` 
                })
            }

            if (failedRows.length > 0) {
                push(`Assigned ${successCount} portal configurations. ${failedRows.length} failed. Exporting trace log…`, 'warn')
                const headers = ['SKU', 'Portal', 'Category', 'Error']
                const csvContent = [
                    headers.join(','),
                    ...failedRows.map(r => [`"${r.SKU}"`, `"${r.Portal}"`, `"${r.Category}"`, `"${r.Error}"`].join(','))
                ].join('\n')
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
                saveAs(blob, 'portal_assign_errors.csv')
            } else {
                push(`Successfully assigned all ${successCount} portal configurations!`, 'ok')
            }

            load()
            setBulkProgress({ done: finalUpserts.length, total: finalUpserts.length, label: 'Syncing costs (background)...' })
            supabase.rpc('sync_all_nlc_costs').then(() => setBulkProgress(null)).catch(() => setBulkProgress(null))
        } catch (err) {
            console.error(err)
            push(err.message, 'err')
            setBulkProgress(null)
        } finally {
            e.target.value = ''
        }
    }

    async function exportCurrentSKUs() {
        try {
            push('Exporting SKU mappings...', 'ok')

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
                const { data: skuChunk, error: skuErr } = await baseQuery
                    .range(skuOffset, skuOffset + SKU_FETCH_SIZE - 1)
                if (skuErr) throw skuErr
                if (skuChunk && skuChunk.length > 0) {
                    allSkuData = allSkuData.concat(skuChunk)
                    skuOffset += SKU_FETCH_SIZE
                    if (skuChunk.length < SKU_FETCH_SIZE) hasMoreSKUs = false
                } else {
                    hasMoreSKUs = false
                }
            }

            const skuData = allSkuData
            if (!skuData || skuData.length === 0) return push('No SKU mappings to export', 'warn')

            const skuCodes = skuData.map(s => s.sku)
            const skuSet = new Set(skuCodes)

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
                    const filteredItems = chunkItems.filter(item => skuSet.has(item.sku))
                    allItemsData = allItemsData.concat(filteredItems)
                    currentOffset += ROWS_PER_FETCH
                    if (chunkItems.length < ROWS_PER_FETCH) hasMore = false
                } else {
                    hasMore = false
                }
            }

            const itemsData = allItemsData
            if (err2) throw err2

            const skuMap = {}
            skuData.forEach(s => { skuMap[s.sku] = s })

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
            push(`Exported ${exportRows.length} items successfully!`, 'ok')
        } catch (err) {
            console.error('Export error:', err)
            push(err.message, 'err')
        }
    }

    async function exportPivotedSKUs() {
        try {
            push('Generating detailed pivoted export...', 'ok')

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

            const headers = ['SKU', 'Description']
            for (let i = 1; i <= maxItems; i++) {
                headers.push(`Finished Good ${i}`)
                headers.push(`Qty per SKU ${i}`)
            }

            const rows = allSkuData.map(s => {
                const row = [`"${s.sku}"`, `"${s.description || ''}"`]
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

    async function exportMasterSKUBOM() {
        try {
            push('Generating Master SKU-BOM export...', 'ok')

            let allSkuData = []
            let skuOffset = 0
            while (true) {
                const { data, error } = await supabase.from('sku_mappings').select('*').order('sku').range(skuOffset, skuOffset + 999)
                if (error) throw error
                if (!data || data.length === 0) break
                allSkuData = allSkuData.concat(data)
                if (data.length < 1000) break
                skuOffset += 1000
            }

            let allMappingItems = []
            let itemOffset = 0
            while (true) {
                const { data, error } = await supabase.from('sku_mapping_items').select('*, finished_goods(name)').range(itemOffset, itemOffset + 999)
                if (error) throw error
                if (!data || data.length === 0) break
                allMappingItems = allMappingItems.concat(data)
                if (data.length < 1000) break
                itemOffset += 1000
            }

            let allRMs = []
            let rmOffset = 0
            while (true) {
                const { data, error } = await supabase.from('raw_materials').select('id, name, accounting_name').range(rmOffset, rmOffset + 999)
                if (error) throw error
                if (!data || data.length === 0) break
                allRMs = allRMs.concat(data)
                if (data.length < 1000) break
                rmOffset += 1000
            }
            const rmMap = {}
            allRMs.forEach(r => { rmMap[r.id] = r })

            let allBomData = []
            let bomOffset = 0
            while (true) {
                const { data, error } = await supabase
                    .from('bom')
                    .select('finished_good_id, raw_material_id, qty_per_unit')
                    .range(bomOffset, bomOffset + 999)
                if (error) throw error
                if (!data || data.length === 0) break
                allBomData = allBomData.concat(data)
                if (data.length < 1000) break
                bomOffset += 1000
            }

            const itemsBySku = {}
            allMappingItems.forEach(item => {
                if (!itemsBySku[item.sku]) itemsBySku[item.sku] = []
                itemsBySku[item.sku].push(item)
            })

            const bomByFg = {}
            allBomData.forEach(b => {
                if (!bomByFg[b.finished_good_id]) bomByFg[b.finished_good_id] = []
                bomByFg[b.finished_good_id].push(b)
            })

            let maxFGsPerSKU = 0
            let maxRMsPerFG = 0
            
            allSkuData.forEach(s => {
                const items = itemsBySku[s.sku] || []
                if (items.length > maxFGsPerSKU) maxFGsPerSKU = items.length
                items.forEach(item => {
                    const rms = bomByFg[item.finished_good_id] || []
                    if (rms.length > maxRMsPerFG) maxRMsPerFG = rms.length
                })
            })

            const headers = ['SKU', 'Description']
            for (let i = 1; i <= maxFGsPerSKU; i++) {
                headers.push(`Finished Good ${i}`, `Qty per SKU ${i}`)
                for (let j = 1; j <= maxRMsPerFG; j++) {
                    headers.push(`RM ${i}-${j}`, `Qty ${i}-${j}`)
                }
            }

            const rows = allSkuData.map(s => {
                const row = [`"${s.sku}"`, `"${s.description || ''}"`]
                const items = itemsBySku[s.sku] || []
                for (let i = 0; i < maxFGsPerSKU; i++) {
                    const item = items[i]
                    if (item) {
                        row.push(`"${item.finished_goods?.name || ''}"`)
                        row.push(item.qty_per_sku)
                        const rms = bomByFg[item.finished_good_id] || []
                        for (let j = 0; j < maxRMsPerFG; j++) {
                            const rm = rms[j]
                            if (rm) {
                                const rawMat = rmMap[rm.raw_material_id]
                                const rmName = rawMat?.accounting_name || rawMat?.name || 'Unknown'
                                const totalQty = (Number(item.qty_per_sku) || 0) * (Number(rm.qty_per_unit) || 0)
                                row.push(`"${rmName}"`)
                                row.push(totalQty)
                            } else {
                                row.push('""', '""')
                            }
                        }
                    } else {
                        row.push('""', '""')
                        for (let j = 0; j < maxRMsPerFG; j++) {
                            row.push('""', '""')
                        }
                    }
                }
                return row.join(',')
            })

            const csvContent = [headers.join(','), ...rows].join('\n')
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
            saveAs(blob, `master_sku_bom_export_${new Date().toISOString().split('T')[0]}.csv`)
            push(`Exported ${allSkuData.length} SKUs in Master format`, 'ok')
        } catch (err) {
            console.error(err)
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

            if (importMode === 'replace') {
                if (!confirm('WARNING: You are about to DELETE ALL existing SKU mappings and replace them with this file. This action cannot be undone. Are you sure?')) {
                    return
                }

                push('Clearing all existing mappings...', 'warn')

                const { error: clearItemsErr } = await supabase
                    .from('sku_mapping_items')
                    .delete()
                    .neq('id', 0)

                if (clearItemsErr) throw new Error(`Failed to clear items: ${clearItemsErr.message}`)

                const { error: clearSkuErr } = await supabase
                    .from('sku_mappings')
                    .delete()
                    .neq('sku', 'PLACEHOLDER')

                if (clearSkuErr) throw new Error(`Failed to clear SKUs: ${clearSkuErr.message}`)
            }

            const modeLabel = importMode === 'update' ? 'Updating' : 'Importing'
            push(`${modeLabel} ${validSkuCodes.length} valid SKUs...`, 'ok')

            const CHUNK_SIZE_SKU = 200
            let processed = 0
            let successCount = 0

            for (let i = 0; i < validSkuCodes.length; i += CHUNK_SIZE_SKU) {
                const chunkCodes = validSkuCodes.slice(i, i + CHUNK_SIZE_SKU)

                try {
                    const skuUpserts = chunkCodes.map(code => ({
                        sku: code,
                        description: skuGroups[code].description || null,
                        is_active: true
                    }))

                    const { error: err1 } = await supabase
                        .from('sku_mappings')
                        .upsert(skuUpserts, { onConflict: 'sku' })

                    if (err1) throw new Error(`Upsert failed: ${err1.message}`)

                    const { error: err2 } = await supabase
                        .from('sku_mapping_items')
                        .delete()
                        .in('sku', chunkCodes)

                    if (err2) throw new Error(`Cleanup failed: ${err2.message}`)

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

            const successMsg = importMode === 'update'
                ? `Successfully updated ${successCount} SKUs!`
                : `Successfully imported ${successCount} SKUs!`

            if (failedRows.length > 0) {
                const actionLabel = importMode === 'update' ? 'Updated' : 'Imported'
                push(`${actionLabel} ${successCount} SKUs. ${skuCodes.length - successCount} SKUs failed. Downloading error report...`, 'warn')

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
                            <button className="btn outline" onClick={exportMasterSKUBOM}>📦 Download Master SKU-BOM</button>
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
                                ✅ <b>Update Mode:</b> Only the SKUs in your file will be updated. All other SKUs remain unchanged. Safe for editing a subset of your SKU mappings.
                            </div>
                        ) : (
                            <div className="s" style={{ color: 'var(--danger)', marginTop: 8, padding: 8, background: 'var(--bg-secondary)', borderRadius: 4 }}>
                                ⚠️ <b>Full Replace Mode:</b> This mode is for initial bulk setup only. It will replace ALL existing SKU mappings with the uploaded data. Use with extreme caution!
                            </div>
                        )}

                        <div className="s" style={{ color: 'var(--muted)', marginTop: 8 }}>
                            Columns: <code>SKU</code>, <code>Finished Good</code>, <code>Qty per SKU</code>, <code>Description</code> (optional). For combo SKUs, use multiple rows with the same SKU code.
                        </div>
                    </div>

                    {/* Bulk Portal Assignment via CSV */}
                    <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                        <div style={{ marginBottom: 8 }}>
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>🏪 Bulk Portal Assignment via CSV</div>
                            <div className="s" style={{ color: 'var(--muted)' }}>
                                Assign portals to many SKUs at once by uploading a CSV with columns:
                                {' '}<code>SKU</code>, <code>Portal</code>, <code>Category</code> (optional, defaults to &quot;Other&quot;). One row per SKU-portal pair. Existing assignments will be updated.
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
                                    <input type="checkbox" checked={mappings.length > 0 && (allMatchSelected || selectedSkus.size >= mappings.length)} onChange={toggleSelectAll} />
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
                                    <td colSpan="5" style={{ color: 'var(--muted)' }}>
                                        {loading ? 'Loading…' : q ? 'No SKUs found matching your search' : 'No SKU mappings found'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Bulk Progress Bar */}
            {bulkProgress && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1100,
                    background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
                    padding: '8px 24px', display: 'flex', alignItems: 'center', gap: 16,
                    boxShadow: '0 2px 12px rgba(0,0,0,0.2)'
                }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: '0.85em', fontWeight: 600 }}>{bulkProgress.label}</span>
                            <span style={{ fontSize: '0.85em', color: 'var(--muted)' }}>
                                {bulkProgress.total > 0 ? Math.round((bulkProgress.done / bulkProgress.total) * 100) : 0}%
                            </span>
                        </div>
                        <div style={{ height: 6, background: 'var(--bg-alt)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{
                                height: '100%', borderRadius: 3,
                                background: 'linear-gradient(90deg, var(--primary), var(--success))',
                                width: bulkProgress.total > 0 ? `${(bulkProgress.done / bulkProgress.total) * 100}%` : '0%',
                                transition: 'width 0.3s ease'
                            }} />
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Action Bar */}
            {selectedSkus.size > 0 && (
                <div style={{
                    position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
                    background: 'var(--bg-card)', border: '2px solid var(--primary)', borderRadius: 12,
                    padding: '12px 24px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', zIndex: 1000,
                    display: 'flex', flexDirection: 'column', gap: 10, minWidth: 600, maxWidth: '90vw'
                }}>
                    {!allMatchSelected && selectedSkus.size >= mappings.length && totalCount > mappings.length && (
                        <div style={{
                            background: 'var(--primary-subtle, rgba(99,102,241,0.1))', borderRadius: 8,
                            padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            border: '1px solid var(--primary)', fontSize: '0.85em'
                        }}>
                            <span>All <b>{mappings.length}</b> SKUs on this page are selected.</span>
                            <button
                                className="btn small"
                                onClick={selectAllMatching}
                                style={{ padding: '4px 14px', fontSize: '0.85em' }}
                            >
                                Select all {totalCount} matching SKUs
                            </button>
                        </div>
                    )}
                    {allMatchSelected && (
                        <div style={{
                            background: 'var(--success-subtle, rgba(16,185,129,0.1))', borderRadius: 8,
                            padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            border: '1px solid var(--success)', fontSize: '0.85em'
                        }}>
                            <span>✅ All <b>{selectedSkus.size}</b> matching SKUs selected across all pages.</span>
                            <button
                                className="btn ghost small"
                                onClick={() => { setAllMatchSelected(false); setSelectedSkus(new Set()) }}
                                style={{ padding: '4px 14px', fontSize: '0.85em' }}
                            >
                                Clear selection
                            </button>
                        </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                        <div style={{ fontWeight: 700, color: 'var(--primary)', whiteSpace: 'nowrap' }}>
                            {selectedSkus.size} SKU{selectedSkus.size !== 1 ? 's' : ''} Selected
                        </div>

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
                            <button className="btn ghost small" onClick={() => { setSelectedSkus(new Set()); setAllMatchSelected(false) }}>Cancel</button>
                            <button className="btn" onClick={bulkSaveMeta} disabled={bulkSaving}>
                                {bulkSaving ? 'Saving…' : `Apply to ${selectedSkus.size} SKUs`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
