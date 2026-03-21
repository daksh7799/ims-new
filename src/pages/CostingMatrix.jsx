import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../supabaseClient'
import { useToast } from '../ui/toast'

const PAGE_SIZE_OPTIONS = [25, 50, 100]

export default function CostingMatrix() {
    const { push } = useToast()
    const [loading, setLoading] = useState(true)
    const searchTimerRef = useRef(null)

    // Portal selection
    const [portals, setPortals] = useState([])
    const [newCategory, setNewCategory] = useState('')
    const [renamingCategory, setRenamingCategory] = useState({ old: '', new: '' })
    const [savingCats, setSavingCats] = useState(false)
    const [syncingNlc, setSyncingNlc] = useState(false)

    const [selectedPortal, setSelectedPortal] = useState('')

    // Portal settings
    const [settings, setSettings] = useState({
        technology_fee: 0,
        aba_variable_fee_pct: 0,
        indirect_cost_pct: 0,
        gst_on_shipping_pct: 18,
        extra_fixed_fee: 0,
        extra_percent_fee: 0,
        label_tech_fee: 'Tech Fee',
        label_aba_fee: 'ABA %',
        label_indirect_cost: 'Ind. %',
        label_gst_shipping: 'GST on Ship %',
        label_extra_fixed: 'Extra Fx',
        label_extra_percent: 'Extra %',
        has_category_fees: true
    })
    const [savingSettings, setSavingSettings] = useState(false)

    // Fee tables
    const [shippingSlabs, setShippingSlabs] = useState([])
    const [closingSlabs, setClosingSlabs] = useState([])
    const [referralFees, setReferralFees] = useState([])
    const [categories, setCategories] = useState([])

    // NLC packaging settings (from nlc_settings table)
    const [nlcPkg, setNlcPkg] = useState({ single_packet_cost: 15, extra_packet_cost: 10, jar_cost: 20 })

    // Settings panel toggle
    const [showSettings, setShowSettings] = useState(false)
    const [newPortal, setNewPortal] = useState({ code: '', name: '' })
    const [addingPortal, setAddingPortal] = useState(false)

    // Pagination
    const [page, setPage] = useState(0)
    const [pageSize, setPageSize] = useState(50)
    const [total, setTotal] = useState(0)
    const pageCount = Math.max(1, Math.ceil(total / pageSize))

    // Search
    const [searchQuery, setSearchQuery] = useState('')
    const [activeSearch, setActiveSearch] = useState('')
    const [categoryFilter, setCategoryFilter] = useState('')

    // Data
    const [matrixData, setMatrixData] = useState([])
    const [exporting, setExporting] = useState(false)

    // Load portals on mount
    useEffect(() => {
        async function init() {
            const { data } = await supabase.from('costing_portals').select('*').eq('is_active', true).order('name')
            setPortals(data || [])
            if (data?.length) setSelectedPortal(data[0].code)

            // Fetch NLC packaging settings
            const { data: nlcData } = await supabase.from('nlc_settings').select('*').eq('id', 1).maybeSingle()
            if (nlcData) setNlcPkg({
                single_packet_cost: Number(nlcData.single_packet_cost) || 15,
                extra_packet_cost: Number(nlcData.extra_packet_cost) || 10,
                jar_cost: Number(nlcData.jar_cost) || 20,
            })
        }
        init()
    }, [])

    // Refresh categories when portal changes
    useEffect(() => {
        if (!selectedPortal) return
        async function loadCats() {
            const { data } = await supabase.from('costing_categories').select('name').eq('portal', selectedPortal).order('name')
            const catNames = (data || []).map(c => c.name)
            setCategories(catNames)
        }
        loadCats()
    }, [selectedPortal])

    // Load portal settings + fee tables when portal changes
    useEffect(() => {
        if (!selectedPortal) return
        loadPortalConfig(selectedPortal)
    }, [selectedPortal])

    async function loadPortalConfig(portal) {
        const [settingsRes, shipRes, closeRes, refRes] = await Promise.all([
            supabase.from('costing_portal_settings').select('*').eq('portal', portal).maybeSingle(),
            supabase.from('costing_shipping_slabs').select('*').eq('portal', portal).order('max_weight_g'),
            supabase.from('costing_closing_slabs').select('*').eq('portal', portal).order('max_price'),
            supabase.from('costing_referral_fees').select('*').eq('portal', portal).order('category').order('max_price'),
        ])
        if (settingsRes.data) {
            setSettings({
                ...settingsRes.data,
                const_fees: settingsRes.data.const_fees || [],
                extra_column_labels: settingsRes.data.extra_column_labels || []
            })
        } else {
            // Default settings for new portal
            setSettings({
                const_fees: [
                    { label: 'Tech Fee', value: 17, unit: 'flat' },
                    { label: 'ABA %', value: 2.36, unit: 'pct' },
                    { label: 'Ind %', value: 3, unit: 'pct' },
                    { label: 'GST on Ship', value: 18, unit: 'pct' }
                ],
                extra_column_labels: [],
                has_category_fees: true,
                has_shipping_fees: true,
                has_closing_fees: true
            })
        }
        setShippingSlabs(shipRes.data || [])
        setClosingSlabs(closeRes.data || [])
        setReferralFees(refRes.data || [])
    }

    // Data fetch
    const fetchData = useCallback(async (p, ps, q, catF) => {
        if (!selectedPortal) return
        setLoading(true)
        try {
            const from = p * ps
            const to = from + ps - 1

            let query = supabase
                .from('v_costing_matrix')
                .select('*', { count: 'exact' })
                .eq('portal', selectedPortal)
                .order('sku', { ascending: true })
                .range(from, to)

            if (q) query = query.or(`sku.ilike.%${q}%,sku_description.ilike.%${q}%`)
            if (catF === 'UNCATEGORIZED') query = query.is('category', null)
            else if (catF) query = query.eq('category', catF)

            const { data, error, count } = await query
            if (error) throw error
            setMatrixData(data || [])
            setTotal(count ?? 0)
        } catch (err) {
            push(`Load error: ${err.message}`, 'err')
        } finally {
            setLoading(false)
        }
    }, [selectedPortal, push])

    useEffect(() => {
        fetchData(page, pageSize, activeSearch, categoryFilter)
    }, [page, pageSize, activeSearch, categoryFilter, fetchData])

    function handleSearchChange(val) {
        setSearchQuery(val)
        clearTimeout(searchTimerRef.current)
        searchTimerRef.current = setTimeout(() => { setPage(0); setActiveSearch(val) }, 400)
    }

    // --------- Calculation helpers ---------
    function getShippingFee(weightKg) {
        const weightG = weightKg * 1000
        const slab = shippingSlabs.find(s => weightG <= s.max_weight_g)
        return slab ? Number(slab.fee) : (shippingSlabs.length ? Number(shippingSlabs[shippingSlabs.length - 1].fee) : 0)
    }

    function getClosingFee(price) {
        const slab = closingSlabs.find(s => price <= s.max_price)
        return slab ? Number(slab.fee) : (closingSlabs.length ? Number(closingSlabs[closingSlabs.length - 1].fee) : 0)
    }

    function getReferralPct(category, price) {
        const catFees = referralFees.filter(r => r.category === category)
        const slab = catFees.find(r => price <= r.max_price)
        return slab ? Number(slab.referral_pct) : (catFees.length ? Number(catFees[catFees.length - 1].referral_pct) : 0)
    }

    function calculateRow(row) {
        const nlc = Number(row.sku_nlc) || 0
        const weightKg = Number(row.total_weight_kg) || 0
        const category = row.category || 'Other'

        // Dynamic constants
        const constFees = settings.const_fees || []
        let totalFlat = 0
        let totalPctOnCost = 0
        let totalPctOnMarket = 0
        let totalPctOnFinal = 0
        let indirectPct = 0

        constFees.forEach(f => {
            const val = Number(f.value) || 0
            if (f.target === 'indirect') {
                indirectPct += val
            } else {
                if (f.unit === 'flat') {
                    totalFlat += val
                } else {
                    if (f.target === 'cost') totalPctOnCost += val
                    else if (f.target === 'profit' || f.target === 'final') totalPctOnFinal += val
                    else totalPctOnMarket += val // Default to market (Price@NLC)
                }
            }
        })

        // Combine portal settings + per-SKU 3 major fee toggles
        const useCategoryFee = settings.has_category_fees && row.is_category_fee !== false
        const useWeightFee = settings.has_shipping_fees && row.is_weight_fee !== false
        const useAmountFee = settings.has_closing_fees && row.is_amount_fee !== false

        const shipFee = useWeightFee ? getShippingFee(weightKg) : 0
        const shipTotal = shipFee

        // Stage 1: Fixed Cost Base (NLC + Rupee Fees + Shipping)
        const fixedBase = nlc + totalFlat + shipTotal

        // Stage 2: Pure Deterministic Calculation of Selling Price without loops
        const costMarkup = 1 + totalPctOnCost / 100
        let closingFee = 0
        let referralPct = 0

        let validCandidates = [];
        
        const activeClosingSlabs = useAmountFee && closingSlabs.length > 0 ? closingSlabs : [{ max_price: 9999999, fee: 0 }];
        const catFees = referralFees.filter(r => r.category === category);
        const activeReferralSlabs = useCategoryFee && catFees.length > 0 ? catFees : [{ max_price: 9999999, referral_pct: 0 }];

        // Evaluate all possible slab combinations to find true mathematical candidates
        activeClosingSlabs.forEach((cItem, cIdx) => {
            activeReferralSlabs.forEach((rItem, rIdx) => {
                const cFee = Number(cItem.fee) || 0;
                const rPct = Number(rItem.referral_pct) || 0;
                
                const totalDeductionPct = (rPct + totalPctOnMarket + totalPctOnFinal) / 100;
                const divisor = Math.max(0.0001, 1 - totalDeductionPct);
                
                const baseSP = ((fixedBase + cFee) * costMarkup) / divisor;
                const exactSP = baseSP * (1 + indirectPct / 100);
                
                // MROUND to nearest 5 (just like Excel MROUND)
                const rawSP = Math.round(exactSP / 5) * 5;
                
                // Determine limits for these specific slabs
                const cMin = cIdx === 0 ? 0 : activeClosingSlabs[cIdx - 1].max_price;
                const cMax = cItem.max_price;
                
                const rMin = rIdx === 0 ? 0 : activeReferralSlabs[rIdx - 1].max_price;
                const rMax = rItem.max_price;
                
                const validClosing = !useAmountFee || (rawSP > cMin && rawSP <= cMax);
                const validReferral = !useCategoryFee || (rawSP > rMin && rawSP <= rMax);
                
                if (validClosing && validReferral) {
                    validCandidates.push({
                        sellingPrice: rawSP,
                        closingFee: cFee,
                        referralPct: rPct
                    });
                }
            });
        });

        // Filter valid candidates and pick the lowest valid selling price (to remain competitive and drop into cheaper fee slabs)
        if (validCandidates.length > 0) {
            validCandidates.sort((a, b) => a.sellingPrice - b.sellingPrice);
            const best = validCandidates[0];
            closingFee = best.closingFee;
            referralPct = best.referralPct;
        } else {
            // Fallback (e.g. if slabs don't cover the calculated range)
            closingFee = useAmountFee && closingSlabs.length ? Number(closingSlabs[closingSlabs.length - 1].fee) : 0;
            referralPct = useCategoryFee && catFees.length ? Number(catFees[catFees.length - 1].referral_pct) : 0;
        }

        // Price@NLC: Base / (1 - Marketplace%)
        const marketDeduction = (referralPct + totalPctOnMarket) / 100
        const priceAtNLC = (fixedBase + closingFee) / Math.max(0.0001, 1 - marketDeduction)

        // Stage 3: Final Selling Price using the accurately determined exact fees
        const totalFinalDeductionPct = (referralPct + totalPctOnMarket + totalPctOnFinal) / 100
        const baseSellingPrice = ((fixedBase + closingFee) * costMarkup) / Math.max(0.0001, 1 - totalFinalDeductionPct)
        const exactSellingPrice = baseSellingPrice * (1 + indirectPct / 100)
        
        // MROUND final selling price to nearest 5 as well to match candidates
        const sellingPrice = Math.round(exactSellingPrice / 5) * 5;

        return { shipFee, shipTotal, closingFee, referralPct, priceAtNLC, sellingPrice, useCategoryFee, useWeightFee, useAmountFee }
    }

    // --------- Settings save ---------
    async function savePortalSettings() {
        setSavingSettings(true)
        try {
            const { error } = await supabase
                .from('costing_portal_settings')
                .upsert({
                    portal: selectedPortal,
                    const_fees: settings.const_fees || [],
                    extra_column_labels: settings.extra_column_labels || [],
                    has_category_fees: Boolean(settings.has_category_fees),
                    has_shipping_fees: Boolean(settings.has_shipping_fees),
                    has_closing_fees: Boolean(settings.has_closing_fees)
                }, { onConflict: 'portal' })
            if (error) throw error
            push('Portal settings saved!', 'ok')
        } catch (err) {
            push(`Settings error: ${err.message}`, 'err')
        } finally {
            setSavingSettings(false)
        }
    }

    async function saveShippingSlab(slab) {
        const { error } = await supabase.from('costing_shipping_slabs').upsert(slab, { onConflict: 'id' })
        if (error) push(error.message, 'err'); else push('Slab saved', 'ok')
    }

    async function saveClosingSlab(slab) {
        const { error } = await supabase.from('costing_closing_slabs').upsert(slab, { onConflict: 'id' })
        if (error) push(error.message, 'err'); else push('Slab saved', 'ok')
    }

    async function saveReferralFee(fee) {
        const { error } = await supabase.from('costing_referral_fees').upsert(fee, { onConflict: 'id' })
        if (error) push(error.message, 'err'); else push('Fee saved', 'ok')
    }

    async function deleteShippingSlab(id) {
        if (!confirm('Are you sure you want to delete this shipping slab?')) return
        const { error } = await supabase.from('costing_shipping_slabs').delete().eq('id', id)
        if (error) push(error.message, 'err')
        else {
            push('Shipping slab deleted', 'ok')
            setShippingSlabs(prev => prev.filter(s => s.id !== id))
        }
    }

    async function deleteClosingSlab(id) {
        if (!confirm('Are you sure you want to delete this closing slab?')) return
        const { error } = await supabase.from('costing_closing_slabs').delete().eq('id', id)
        if (error) push(error.message, 'err')
        else {
            push('Closing slab deleted', 'ok')
            setClosingSlabs(prev => prev.filter(s => s.id !== id))
        }
    }

    async function deleteReferralSlab(id) {
        if (!confirm('Are you sure you want to delete this referral slab?')) return
        const { error } = await supabase.from('costing_referral_fees').delete().eq('id', id)
        if (error) push(error.message, 'err')
        else {
            push('Referral slab deleted', 'ok')
            setReferralFees(prev => prev.filter(s => s.id !== id))
        }
    }

    async function saveSkuPortalMeta(sku, field, value, isExtra = false) {
        try {
            const row = matrixData.find(r => r.sku === sku)
            if (!row) return

            let updateObj = { sku, portal: selectedPortal }
            if (isExtra) {
                const updatedExtra = { ...row.extra_meta, [field]: value === '' ? null : value }
                updateObj.extra_meta = updatedExtra
            } else {
                updateObj[field] = value
            }

            const { error } = await supabase.from('sku_portal_metadata').upsert(updateObj, { onConflict: 'sku,portal' })
            if (error) throw error

            setMatrixData(prev => prev.map(r => {
                if (r.sku !== sku) return r
                if (isExtra) return { ...r, extra_meta: { ...r.extra_meta, [field]: value } }
                return { ...r, [field]: value }
            }))
        } catch (err) {
            push(`Save failed for ${sku}: ` + err.message, 'err')
        }
    }

    // Category Management
    async function addCategory() {
        if (!newCategory.trim() || !selectedPortal) return
        setSavingCats(true)
        try {
            const { error } = await supabase
                .from('costing_categories')
                .insert({ portal: selectedPortal, name: newCategory.trim() })
            if (error) throw error
            setNewCategory('')
            push('Category added', 'ok')
            // Refresh categories list
            const { data } = await supabase.from('costing_categories').select('name').eq('portal', selectedPortal).order('name')
            const catNames = (data || []).map(c => c.name)
            if (!catNames.includes('Other')) catNames.push('Other')
            setCategories(catNames)
        } catch (err) {
            push(`Error adding category: ${err.message}`, 'err')
        } finally {
            setSavingCats(false)
        }
    }

    async function renameCategory(oldName) {
        if (!renamingCategory.new.trim() || oldName === renamingCategory.new.trim()) {
            setRenamingCategory({ old: '', new: '' })
            return
        }
        setSavingCats(true)
        try {
            // 1. Update master table
            const { error: err1 } = await supabase
                .from('costing_categories')
                .update({ name: renamingCategory.new.trim() })
                .eq('portal', selectedPortal)
                .eq('name', oldName)
            if (err1) throw err1

            // 2. Update SKU metadata
            const { error: err2 } = await supabase
                .from('sku_portal_metadata')
                .update({ category: renamingCategory.new.trim() })
                .eq('portal', selectedPortal)
                .eq('category', oldName)
            if (err2) throw err2

            // 3. Update Referral Fees
            const { error: err3 } = await supabase
                .from('costing_referral_fees')
                .update({ category: renamingCategory.new.trim() })
                .eq('portal', selectedPortal)
                .eq('category', oldName)
            if (err3) throw err3

            push('Category renamed', 'ok')
            setRenamingCategory({ old: '', new: '' })
            // Refresh
            const { data } = await supabase.from('costing_categories').select('name').eq('portal', selectedPortal).order('name')
            const catNames = (data || []).map(c => c.name)
            if (!catNames.includes('Other')) catNames.push('Other')
            setCategories(catNames)
            fetchData(page, pageSize, q, categoryFilter)
        } catch (err) {
            push(`Error renaming: ${err.message}`, 'err')
        } finally {
            setSavingCats(false)
        }
    }

    async function deleteCategory(catName) {
        if (catName === 'Other') return
        if (!confirm(`Are you sure you want to delete "${catName}"? Existing SKUs in this category will be reset to "Other".`)) return

        setSavingCats(true)
        try {
            // 1. Reset SKUs to 'Other'
            const { error: err1 } = await supabase
                .from('sku_portal_metadata')
                .update({ category: 'Other' })
                .eq('portal', selectedPortal)
                .eq('category', catName)
            if (err1) throw err1

            // 2. Delete from master
            const { error: err2 } = await supabase
                .from('costing_categories')
                .delete()
                .eq('portal', selectedPortal)
                .eq('name', catName)
            if (err2) throw err2

            // 3. Delete associated referral fees
            const { error: err3 } = await supabase
                .from('costing_referral_fees')
                .delete()
                .eq('portal', selectedPortal)
                .eq('category', catName)
            if (err3) throw err3

            push('Category deleted', 'ok')
            // Refresh
            const { data } = await supabase.from('costing_categories').select('name').eq('portal', selectedPortal).order('name')
            const catNames = (data || []).map(c => c.name)
            if (!catNames.includes('Other')) catNames.push('Other')
            setCategories(catNames)
            fetchData(page, pageSize, q, categoryFilter)
        } catch (err) {
            push(`Error deleting: ${err.message}`, 'err')
        } finally {
            setSavingCats(false)
        }
    }

    async function syncNlc() {
        setSyncingNlc(true)
        try {
            const { error } = await supabase.rpc('sync_all_nlc_costs')
            if (error) throw error
            push('NLC synchronized successfully!', 'ok')
            fetchData(page, pageSize, searchQuery, categoryFilter)
        } catch (err) {
            push(`Sync error: ${err.message}`, 'err')
        } finally {
            setSyncingNlc(false)
        }
    }

    async function exportToCSV() {
        if (!selectedPortal) return
        setExporting(true)
        try {
            let allData = []
            let currentFrom = 0
            const step = 1000
            
            while (true) {
                let query = supabase
                    .from('v_costing_matrix')
                    .select('*')
                    .eq('portal', selectedPortal)
                    .order('sku', { ascending: true })
                    .range(currentFrom, currentFrom + step - 1)

                if (activeSearch) query = query.or(`sku.ilike.%${activeSearch}%,sku_description.ilike.%${activeSearch}%`)
                if (categoryFilter === 'UNCATEGORIZED') query = query.is('category', null)
                else if (categoryFilter) query = query.eq('category', categoryFilter)

                const { data, error } = await query
                if (error) throw error
                if (!data || data.length === 0) break
                
                allData.push(...data)
                if (data.length < step) break
                currentFrom += step
            }

            if (allData.length === 0) {
                setExporting(false)
                return push('No data to export', 'warn')
            }
            const data = allData

            // Prepare CSV Headers
            const extraLabels = settings.extra_column_labels || []
            const marketFees = (settings.const_fees || []).filter(f => f.unit === 'pct' && f.target === 'market')
            const finalFees = (settings.const_fees || []).filter(f => f.unit === 'pct' && (f.target === 'profit' || f.target === 'final'))
            const costFees = (settings.const_fees || []).filter(f => f.unit === 'flat' || f.target === 'cost')

            const headers = [
                'SKU', 'Category', ...extraLabels, 'Weight (kg)', 'NLC (₹)',
                ...costFees.map(f => f.label),
                settings.has_shipping_fees ? 'Ship Fee' : null,
                settings.has_closing_fees ? 'Close Fee' : null,
                ...marketFees.map(f => f.label),
                settings.has_category_fees ? 'Ref %' : null,
                'Price@NLC',
                ...finalFees.map(f => f.label),
                'Selling Price'
            ].filter(v => v !== null)

            let csvContent = headers.join(',') + '\n'

            // Process Rows
            data.forEach(row => {
                const calc = calculateRow(row)
                const nlc = Number(row.sku_nlc) || 0

                const line = [
                    `"${row.sku}"`,
                    `"${row.category || ''}"`,
                    ...extraLabels.map(l => `"${row.extra_meta?.[l] || ''}"`),
                    Number(row.total_weight_kg || 0).toFixed(3),
                    nlc.toFixed(2),
                    ...costFees.map(f => f.unit === 'pct' ? `${f.value}%` : f.value),
                    settings.has_shipping_fees ? calc.shipTotal.toFixed(2) : null,
                    settings.has_closing_fees ? calc.closingFee.toFixed(2) : null,
                    ...marketFees.map(f => `${f.value}%`),
                    settings.has_category_fees ? `${calc.referralPct.toFixed(2)}%` : null,
                    Math.round(calc.priceAtNLC),
                    ...finalFees.map(f => `${f.value}%`),
                    calc.sellingPrice
                ].filter(v => v !== null)

                csvContent += line.join(',') + '\n'
            })

            // Download
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.setAttribute('href', url)
            link.setAttribute('download', `costing_matrix_${selectedPortal}_${new Date().toISOString().split('T')[0]}.csv`)
            link.style.visibility = 'hidden'
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            push('Export complete!', 'ok')
        } catch (err) {
            push(`Export failed: ${err.message}`, 'err')
        } finally {
            setExporting(false)
        }
    }

    async function addPortal() {
        const code = newPortal.code.trim().toLowerCase()
        const name = newPortal.name.trim()
        if (!code || !name) return push('Code and Name required', 'warn')
        setAddingPortal(true)
        try {
            const { error: err1 } = await supabase.from('costing_portals').insert({ code, name })
            if (err1) throw err1

            // Seed settings
            const { error: err2 } = await supabase.from('costing_portal_settings').insert({ portal: code })
            if (err2) throw err2

            push(`Portal ${name} added!`, 'ok')
            setNewPortal({ code: '', name: '' })
            // Reload portals
            const { data } = await supabase.from('costing_portals').select('*').eq('is_active', true).order('name')
            setPortals(data || [])
            setSelectedPortal(code)
        } catch (err) {
            push(err.message, 'err')
        } finally {
            setAddingPortal(false)
        }
    }

    function addSlabRow(type) {
        const base = { portal: selectedPortal }
        if (type === 'ship') setShippingSlabs([...shippingSlabs, { ...base, max_weight_g: 0, fee: 0 }])
        if (type === 'close') setClosingSlabs([...closingSlabs, { ...base, max_price: 0, fee: 0 }])
        if (type === 'ref') setReferralFees([...referralFees, { ...base, category: categories[0] || 'Other', max_price: 99999, referral_pct: 0 }])
    }

    // --------- Render ---------
    return (
        <div className="grid">
            <div className="card">
                <div className="hd">
                    <b>Costing Matrix</b>
                    <div className="row" style={{ gap: 10 }}>
                        <button className="btn outline small" onClick={syncNlc} disabled={syncingNlc || loading}>
                            {syncingNlc ? 'Syncing…' : '↺ Sync NLC'}
                        </button>
                        <button className="btn outline small" onClick={exportToCSV} disabled={exporting || loading}>
                            {exporting ? 'Generating CSV…' : '📥 Export All (CSV)'}
                        </button>
                        {portals.map(p => (
                            <button key={p.code}
                                className={`btn small ${selectedPortal === p.code ? '' : 'outline'}`}
                                onClick={() => { setSelectedPortal(p.code); setPage(0) }}
                            >{p.name}</button>
                        ))}
                        <button className={`btn ghost small`} onClick={() => setShowSettings(s => !s)}>
                            ⚙ Settings
                        </button>
                    </div>
                </div>

                {/* Settings Panel */}
                {showSettings && (
                    <div className="bd" style={{ background: 'var(--bg-alt)', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                            <h4 style={{ margin: 0 }}>Settings for {portals.find(p => p.code === selectedPortal)?.name || selectedPortal}</h4>

                            <div className="row" style={{ background: 'var(--bg-card)', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                                <b className="s">Add New Portal:</b>
                                <input placeholder="code (e.g. meesho)" value={newPortal.code} onChange={e => setNewPortal(p => ({ ...p, code: e.target.value }))} style={{ width: 120, minHeight: 30, padding: '4px 8px' }} />
                                <input placeholder="Name" value={newPortal.name} onChange={e => setNewPortal(p => ({ ...p, name: e.target.value }))} style={{ width: 120, minHeight: 30, padding: '4px 8px' }} />
                                <button className="btn small" onClick={addPortal} disabled={addingPortal}>+</button>
                            </div>
                        </div>

                        {/* Feature Toggles */}
                        <div className="card" style={{ padding: 12, marginBottom: 16 }}>
                            <div className="row" style={{ gap: 20 }}>
                                <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                                    <input type="checkbox" checked={settings.has_category_fees} onChange={e => setSettings(s => ({ ...s, has_category_fees: e.target.checked }))} />
                                    <b>Enable Category Referral Fees (%)</b>
                                </label>
                                <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                                    <input type="checkbox" checked={settings.has_shipping_fees} onChange={e => setSettings(s => ({ ...s, has_shipping_fees: e.target.checked }))} />
                                    <b>Enable Shipping Fees (Weight Slabs)</b>
                                </label>
                                <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                                    <input type="checkbox" checked={settings.has_closing_fees} onChange={e => setSettings(s => ({ ...s, has_closing_fees: e.target.checked }))} />
                                    <b>Enable Closing Fees (Price Slabs)</b>
                                </label>
                            </div>
                            <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
                                <button className="btn small" onClick={savePortalSettings} disabled={savingSettings}>
                                    {savingSettings ? 'Saving…' : 'Save Feature Config'}
                                </button>
                            </div>
                        </div>

                        {/* Global constants (Dynamic) */}
                        <div className="card" style={{ padding: 12, marginBottom: 16 }}>
                            <div className="hd" style={{ padding: 0, border: 0, marginBottom: 8 }}>
                                <b className="s">Constant Fees / Variables</b>
                                <button className="btn outline small" onClick={() => {
                                    const next = [...(settings.const_fees || []), { label: 'New Fee', value: 0, unit: 'flat' }]
                                    setSettings(s => ({ ...s, const_fees: next }))
                                }}>+ Add Constant</button>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                                {(settings.const_fees || []).map((f, i) => (
                                    <div key={i} className="row" style={{ gap: 4, background: 'var(--surface)', padding: 8, borderRadius: 6, border: '1px solid var(--border)' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                                            <input value={f.label} onChange={e => {
                                                const next = [...settings.const_fees]; next[i] = { ...next[i], label: e.target.value }
                                                setSettings(s => ({ ...s, const_fees: next }))
                                            }} style={{ fontSize: '0.8em', padding: '2px 6px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)' }} placeholder="Label" />
                                            <div className="row" style={{ gap: 4 }}>
                                                <input type="number" value={f.value} onChange={e => {
                                                    const next = [...settings.const_fees]; next[i] = { ...next[i], value: e.target.value }
                                                    setSettings(s => ({ ...s, const_fees: next }))
                                                }} style={{ width: 55, padding: '4px 6px' }} />
                                                <div className="row" style={{ gap: 0, border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                                                    <button className={`btn xsmall ${f.unit === 'flat' ? '' : 'ghost'}`} style={{ border: 0, borderRadius: 0, padding: '2px 6px' }} onClick={() => {
                                                        const next = [...settings.const_fees]; next[i] = { ...next[i], unit: 'flat' }
                                                        setSettings(s => ({ ...s, const_fees: next }))
                                                    }}>₹</button>
                                                    <button className={`btn xsmall ${f.unit === 'pct' ? '' : 'ghost'}`} style={{ border: 0, borderRadius: 0, padding: '2px 6px' }} onClick={() => {
                                                        const next = [...settings.const_fees]; next[i] = { ...next[i], unit: 'pct', target: f.target || 'price' }
                                                        setSettings(s => ({ ...s, const_fees: next }))
                                                    }}>%</button>
                                                </div>
                                                {f.unit === 'pct' && (
                                                    <select
                                                        value={f.target || 'market'}
                                                        onChange={e => {
                                                            const next = [...settings.const_fees]; next[i] = { ...next[i], target: e.target.value }
                                                            setSettings(s => ({ ...s, const_fees: next }))
                                                        }}
                                                        style={{ fontSize: '0.7em', padding: '2px 4px', border: '1px solid var(--border)' }}
                                                    >
                                                        <option value="market">on Market</option>
                                                        <option value="indirect">Indirect (×)</option>
                                                    </select>
                                                )}
                                            </div>
                                        </div>
                                        <button className="btn ghost small" onClick={() => {
                                            const next = settings.const_fees.filter((_, idx) => idx !== i)
                                            setSettings(s => ({ ...s, const_fees: next }))
                                        }} style={{ color: 'var(--danger)' }}>✕</button>
                                    </div>
                                ))}
                            </div>
                            <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
                                <button className="btn small" onClick={savePortalSettings} disabled={savingSettings}>
                                    {savingSettings ? 'Saving…' : 'Save Constants'}
                                </button>
                            </div>
                        </div>

                        {/* Extra Metadata Columns Manager */}
                        <div className="card" style={{ padding: 12, marginBottom: 16 }}>
                            <div className="hd" style={{ padding: 0, border: 0, marginBottom: 8 }}>
                                <b className="s">Extra Information Columns (e.g. FSN, MRP, Bank ₹)</b>
                            </div>
                            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
                                <input
                                    placeholder="Label (e.g. FSN)"
                                    id="new-extra-label-input"
                                    style={{ width: 180, padding: '6px 10px' }}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            const val = e.target.value.trim();
                                            if (val && !settings.extra_column_labels?.includes(val)) {
                                                const next = [...(settings.extra_column_labels || []), val];
                                                setSettings(s => ({ ...s, extra_column_labels: next }));
                                                e.target.value = '';
                                            }
                                        }
                                    }}
                                />
                                <span className="s" style={{ color: 'var(--muted)' }}>Press Enter to add</span>
                            </div>
                            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                                {(settings.extra_column_labels || []).map(label => (
                                    <div key={label} className="badge" style={{
                                        display: 'flex', gap: 6, alignItems: 'center',
                                        background: 'var(--bg-card)', border: '1px solid var(--border)'
                                    }}>
                                        {label}
                                        <button className="btn ghost xsmall" onClick={() => {
                                            const next = settings.extra_column_labels.filter(l => l !== label)
                                            setSettings(s => ({ ...s, extra_column_labels: next }))
                                        }} style={{ padding: 0, color: 'var(--danger)', height: 'auto', minWidth: 'auto' }}>✕</button>
                                    </div>
                                ))}
                                {(!settings.extra_column_labels || settings.extra_column_labels.length === 0) && (
                                    <div className="s" style={{ color: 'var(--muted)', padding: '4px 0' }}>No extra columns configured.</div>
                                )}
                            </div>
                            <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
                                <button className="btn small" onClick={savePortalSettings} disabled={savingSettings}>
                                    {savingSettings ? 'Saving…' : 'Save Column Config'}
                                </button>
                            </div>
                        </div>

                        {/* Category Manager */}
                        <div className="card" style={{ padding: 12, marginBottom: 16 }}>
                            <div className="hd" style={{ padding: 0, border: 0, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <b className="s">Manage Categories for {portals.find(p => p.code === selectedPortal)?.name}</b>
                            </div>

                            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
                                <input
                                    placeholder="New category name"
                                    value={newCategory}
                                    onChange={e => setNewCategory(e.target.value)}
                                    style={{ width: 250, padding: '6px 10px' }}
                                />
                                <button className="btn small" onClick={addCategory} disabled={savingCats || !newCategory.trim()}>+ Add Category</button>
                            </div>

                            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                                {categories.map(cat => (
                                    <div key={cat} className="badge" style={{
                                        padding: '6px 12px',
                                        display: 'flex',
                                        gap: 8,
                                        alignItems: 'center',
                                        background: 'var(--bg-card)',
                                        border: '1px solid var(--border)',
                                        borderRadius: 20
                                    }}>
                                        {renamingCategory.old === cat ? (
                                            <div className="row" style={{ gap: 4 }}>
                                                <input
                                                    autoFocus
                                                    value={renamingCategory.new}
                                                    onChange={e => setRenamingCategory(p => ({ ...p, new: e.target.value }))}
                                                    onKeyDown={e => e.key === 'Enter' && renameCategory(cat)}
                                                    style={{ border: 'none', background: 'transparent', width: 100, outline: 'none', font: 'inherit', borderBottom: '1px solid var(--primary)' }}
                                                />
                                                <button className="btn small" onClick={() => renameCategory(cat)} style={{ padding: '0 4px', height: 20 }}>Save</button>
                                            </div>
                                        ) : (
                                            <span
                                                onClick={() => setRenamingCategory({ old: cat, new: cat })}
                                                style={{ cursor: 'pointer', borderBottom: '1px dashed var(--muted)', paddingBottom: 1 }}
                                                title="Click to rename"
                                            >{cat}</span>
                                        )}
                                        <button
                                            className="btn ghost xsmall"
                                            onClick={() => deleteCategory(cat)}
                                            style={{ padding: 1, color: 'var(--danger)', marginLeft: 4 }}
                                        >✕</button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Shipping slabs */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 16 }}>
                            <div>
                                <h5 style={{ margin: '0 0 6px' }}>Shipping Slabs</h5>
                                <div style={{ maxHeight: 250, overflow: 'auto' }}>
                                    <table className="table" style={{ fontSize: '0.85em' }}>
                                        <thead><tr><th>Up to (g)</th><th>Fee (₹)</th><th></th></tr></thead>
                                        <tbody>
                                            {shippingSlabs.map((s, i) => (
                                                <tr key={s.id || i}>
                                                    <td><input type="number" value={s.max_weight_g} onChange={e => {
                                                        const v = [...shippingSlabs]; v[i] = { ...v[i], max_weight_g: e.target.value }; setShippingSlabs(v)
                                                    }} style={{ width: 80 }} /></td>
                                                    <td><input type="number" value={s.fee} onChange={e => {
                                                        const v = [...shippingSlabs]; v[i] = { ...v[i], fee: e.target.value }; setShippingSlabs(v)
                                                    }} style={{ width: 80 }} /></td>
                                                    <td>
                                                        <div className="row" style={{ gap: 4 }}>
                                                            <button className="btn ghost small" onClick={() => saveShippingSlab(s)}>Save</button>
                                                            {s.id && <button className="btn ghost small" style={{ color: 'var(--danger)' }} onClick={() => deleteShippingSlab(s.id)}>✕</button>}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    <button className="btn ghost small" onClick={() => addSlabRow('ship')} style={{ width: '100%', marginTop: 4, height: 30, fontSize: '0.8em' }}>+ Add weight slab</button>
                                </div>
                            </div>

                            {/* Closing fee slabs */}
                            <div>
                                <h5 style={{ margin: '0 0 6px' }}>Closing Fee Slabs</h5>
                                <div style={{ maxHeight: 250, overflow: 'auto' }}>
                                    <table className="table" style={{ fontSize: '0.85em' }}>
                                        <thead><tr><th>Up to Price (₹)</th><th>Fee (₹)</th><th></th></tr></thead>
                                        <tbody>
                                            {closingSlabs.map((s, i) => (
                                                <tr key={s.id || i}>
                                                    <td><input type="number" value={s.max_price} onChange={e => {
                                                        const v = [...closingSlabs]; v[i] = { ...v[i], max_price: e.target.value }; setClosingSlabs(v)
                                                    }} style={{ width: 100 }} /></td>
                                                    <td><input type="number" value={s.fee} onChange={e => {
                                                        const v = [...closingSlabs]; v[i] = { ...v[i], fee: e.target.value }; setClosingSlabs(v)
                                                    }} style={{ width: 80 }} /></td>
                                                    <td>
                                                        <div className="row" style={{ gap: 4 }}>
                                                            <button className="btn ghost small" onClick={() => saveClosingSlab(s)}>Save</button>
                                                            {s.id && <button className="btn ghost small" style={{ color: 'var(--danger)' }} onClick={() => deleteClosingSlab(s.id)}>✕</button>}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    <button className="btn ghost small" onClick={() => addSlabRow('close')} style={{ width: '100%', marginTop: 4, height: 30, fontSize: '0.8em' }}>+ Add price slab</button>
                                </div>
                            </div>
                        </div>

                        {/* Referral fee matrix */}
                        {/* Referral fee matrix */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                            <h5 style={{ margin: 0 }}>Category-wise Referral Fee %</h5>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85em', cursor: 'pointer' }}>
                                <input type="checkbox" checked={settings.has_category_fees} onChange={e => setSettings(s => ({ ...s, has_category_fees: e.target.checked }))} />
                                Enable for this portal
                            </label>
                            <button className="btn ghost xsmall" onClick={savePortalSettings}>Save Toggle</button>
                        </div>
                        {settings.has_category_fees && (
                            <div style={{ maxHeight: 300, overflow: 'auto', marginBottom: 8 }}>
                                <table className="table" style={{ fontSize: '0.85em' }}>
                                    <thead><tr><th>Category</th><th>Up to Price (₹)</th><th>Referral %</th><th></th></tr></thead>
                                    <tbody>
                                        {referralFees.map((r, i) => (
                                            <tr key={r.id}>
                                                <td>
                                                    <select
                                                        value={r.category}
                                                        onChange={e => {
                                                            const v = [...referralFees]; v[i] = { ...v[i], category: e.target.value }; setReferralFees(v)
                                                        }}
                                                        style={{ width: '100%', padding: 4, background: 'transparent', border: '1px solid var(--border)' }}
                                                    >
                                                        <option value="">— Select Category —</option>
                                                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                                    </select>
                                                </td>
                                                <td><input type="number" value={r.max_price} onChange={e => {
                                                    const v = [...referralFees]; v[i] = { ...v[i], max_price: e.target.value }; setReferralFees(v)
                                                }} style={{ width: 100 }} /></td>
                                                <td><input type="number" step="0.01" value={r.referral_pct} onChange={e => {
                                                    const v = [...referralFees]; v[i] = { ...v[i], referral_pct: e.target.value }; setReferralFees(v)
                                                }} style={{ width: 80 }} /></td>
                                                <td>
                                                    <div className="row" style={{ gap: 4 }}>
                                                        <button className="btn ghost small" onClick={() => saveReferralFee(r)}>Save</button>
                                                        {r.id && <button className="btn ghost small" style={{ color: 'var(--danger)' }} onClick={() => deleteReferralSlab(r.id)}>✕</button>}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <button className="btn ghost small" onClick={() => addSlabRow('ref')} style={{ width: '100%', marginTop: 4, height: 30, fontSize: '0.8em' }}>+ Add category fee</button>
                            </div>
                        )}
                    </div>
                )}

                <div className="bd">
                    {/* Filter bar */}
                    <div className="row" style={{ marginBottom: 12, gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input placeholder="Search SKU…" value={searchQuery}
                            onChange={e => handleSearchChange(e.target.value)} style={{ width: 250 }} />
                        <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(0) }}>
                            <option value="">All Categories</option>
                            <option value="UNCATEGORIZED">Uncategorized</option>
                            {categories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }}>
                            {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}/page</option>)}
                        </select>
                        <span className="badge">Page {page + 1}/{pageCount}</span>
                        <button className="btn small outline" onClick={() => setPage(p => p - 1)} disabled={page === 0 || loading}>Prev</button>
                        <button className="btn small outline" onClick={() => setPage(p => p + 1)} disabled={page + 1 >= pageCount || loading}>Next</button>
                        <span className="badge">{total} SKUs on {portals.find(p => p.code === selectedPortal)?.name}</span>
                    </div>

                    {/* Matrix table */}
                    <div style={{ overflowX: 'auto' }}>
                        <table className="table" style={{ fontSize: '0.88em', whiteSpace: 'nowrap' }}>
                            <thead>
                                <tr>
                                    <th>SKU</th>
                                    <th>Category</th>
                                    {(settings.extra_column_labels || []).map((label, i) => <th key={label || i}>{label}</th>)}
                                    <th style={{ textAlign: 'right' }}>Wt (kg)</th>
                                    <th style={{ textAlign: 'right' }}>NLC (₹)</th>

                                    {/* Dynamic Constants: Markups (on Cost) */}
                                    {(settings.const_fees || []).filter(f => f.unit === 'flat' || f.target === 'cost').map((f, i) => (
                                        <th key={f.label || i} style={{ textAlign: 'right' }}>{f.label}</th>
                                    ))}

                                    {settings.has_shipping_fees && (
                                        <th style={{ textAlign: 'right', opacity: settings.shippingSlabs?.length === 0 ? 0.3 : 1 }}>Ship Fee</th>
                                    )}
                                    {settings.has_closing_fees && (
                                        <th style={{ textAlign: 'right' }}>Close Fee</th>
                                    )}

                                    {/* Dynamic Constants: Stage 2 (Marketplace) */}
                                    {(settings.const_fees || []).filter(f => f.unit === 'pct' && f.target === 'market').map((f, i) => (
                                        <th key={f.label || i} style={{ textAlign: 'right' }}>{f.label}</th>
                                    ))}
                                    {settings.has_category_fees && <th style={{ textAlign: 'right' }}>Ref %</th>}

                                    <th style={{ textAlign: 'right', background: 'var(--bg-card)' }}>Price@NLC</th>

                                    {/* Indirect (×) fees — shown after Price@NLC */}
                                    {(settings.const_fees || []).filter(f => f.target === 'indirect').map((f, i) => (
                                        <th key={f.label || i} style={{ textAlign: 'right' }}>{f.label}</th>
                                    ))}
                                    <th style={{ textAlign: 'right', background: 'var(--bg-alt)', fontWeight: 700 }}>Selling Price</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && (
                                    <tr><td colSpan="13" className="s" style={{ textAlign: 'center', padding: 20 }}>Loading…</td></tr>
                                )}
                                {!loading && matrixData.map(row => {
                                    const nlcAmount = Number(row.sku_nlc) || 0
                                    const calc = calculateRow(row)

                                    return (
                                        <tr key={row.sku}>
                                            <td title={row.sku_description}>
                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                    <b>{row.sku}</b>
                                                    <div className="row" style={{ gap: 4, marginTop: 4 }}>
                                                        <span className="badge xsmall" style={{ cursor: 'pointer', opacity: calc.useCategoryFee ? 1 : 0.3 }} onClick={() => saveSkuPortalMeta(row.sku, 'is_category_fee', !calc.useCategoryFee)} title="Toggle Referral/Category Fee">Cat</span>
                                                        <span className="badge xsmall" style={{ cursor: 'pointer', opacity: calc.useWeightFee ? 1 : 0.3 }} onClick={() => saveSkuPortalMeta(row.sku, 'is_weight_fee', !calc.useWeightFee)} title="Toggle Shipping/Weight Fee">Wgt</span>
                                                        <span className="badge xsmall" style={{ cursor: 'pointer', opacity: calc.useAmountFee ? 1 : 0.3 }} onClick={() => saveSkuPortalMeta(row.sku, 'is_amount_fee', !calc.useAmountFee)} title="Toggle Closing/Amount Fee">Amt</span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td>
                                                <select
                                                    value={row.category}
                                                    onChange={e => saveSkuPortalMeta(row.sku, 'category', e.target.value)}
                                                    style={{ fontSize: '0.9em', padding: '2px 4px', border: '1px solid var(--border)', background: 'transparent', borderRadius: 4, width: '100%' }}
                                                >
                                                    <option value="">— Select —</option>
                                                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                                </select>
                                            </td>
                                            {(settings.extra_column_labels || []).map((label, i) => (
                                                <td key={label || i}>
                                                    <input
                                                        defaultValue={row.extra_meta?.[label] || ''}
                                                        onBlur={e => saveSkuPortalMeta(row.sku, label, e.target.value, true)}
                                                        style={{ width: 80, padding: 4 }}
                                                    />
                                                </td>
                                            ))}
                                            <td style={{ textAlign: 'right' }}>{Number(row.total_weight_kg).toFixed(3)}</td>
                                            <td style={{ textAlign: 'right' }}>{nlcAmount > 0 ? `₹${nlcAmount.toFixed(2)}` : <span style={{ color: 'var(--muted)' }}>—</span>}</td>

                                            {/* Dynamic Data: Markups (on Cost) */}
                                            {(settings.const_fees || []).filter(f => f.unit === 'flat' || f.target === 'cost').map((f, i) => (
                                                <td key={f.label || i} style={{ textAlign: 'right' }}>
                                                    {f.unit === 'pct' ? `${Number(f.value).toFixed(2)}%` : `₹${Number(f.value).toFixed(0)}`}
                                                </td>
                                            ))}

                                            {settings.has_shipping_fees && (
                                                <td style={{ textAlign: 'right', opacity: calc.useWeightFee ? 1 : 0.3 }}>₹{calc.shipTotal.toFixed(0)}</td>
                                            )}
                                            {settings.has_closing_fees && (
                                                <td style={{ textAlign: 'right', opacity: calc.useAmountFee ? 1 : 0.3 }}>₹{calc.closingFee.toFixed(2)}</td>
                                            )}

                                            {/* Dynamic Data: Stage 2 (Marketplace) */}
                                            {(settings.const_fees || []).filter(f => f.unit === 'pct' && f.target === 'market').map((f, i) => (
                                                <td key={f.label || i} style={{ textAlign: 'right' }}>{Number(f.value).toFixed(2)}%</td>
                                            ))}
                                            {settings.has_category_fees && <td style={{ textAlign: 'right', opacity: calc.useCategoryFee ? 1 : 0.3 }}>{calc.referralPct.toFixed(2)}%</td>}
                                            <td style={{ textAlign: 'right', fontWeight: 600, background: 'var(--bg-card)' }}>
                                                {nlcAmount > 0 ? `₹${Math.round(calc.priceAtNLC)}` : '—'}
                                            </td>


                                            {/* Indirect (×) fee values — after Price@NLC */}
                                            {(settings.const_fees || []).filter(f => f.target === 'indirect').map((f, i) => (
                                                <td key={f.label || i} style={{ textAlign: 'right' }}>{Number(f.value).toFixed(2)}%</td>
                                            ))}
                                            <td style={{ textAlign: 'right', fontWeight: 700, background: 'var(--bg-alt)', color: 'var(--primary)', fontSize: '1.05em' }}>
                                                {nlcAmount > 0 ? `₹${calc.sellingPrice}` : '—'}
                                            </td>
                                        </tr>
                                    )
                                })}
                                {!loading && matrixData.length === 0 && (
                                    <tr><td colSpan={selectedPortal === 'flipkart' ? "11" : "15"} className="s" style={{ textAlign: 'center', padding: 20 }}>
                                        {activeSearch || categoryFilter
                                            ? 'No matching SKUs found.'
                                            : `No SKUs assigned to ${portals.find(p => p.code === selectedPortal)?.name || selectedPortal}. Assign portals in SKU Mappings.`}
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {pageCount > 1 && (
                        <div className="row" style={{ marginTop: 12, gap: 8, justifyContent: 'flex-end' }}>
                            <button className="btn small outline" onClick={() => setPage(0)} disabled={page === 0}>First</button>
                            <button className="btn small outline" onClick={() => setPage(p => p - 1)} disabled={page === 0}>Prev</button>
                            <span className="badge">Page {page + 1}/{pageCount} ({total} total)</span>
                            <button className="btn small outline" onClick={() => setPage(p => p + 1)} disabled={page + 1 >= pageCount}>Next</button>
                            <button className="btn small outline" onClick={() => setPage(pageCount - 1)} disabled={page + 1 >= pageCount}>Last</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
