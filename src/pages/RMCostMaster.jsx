import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../supabaseClient'
import { useToast } from '../ui/toast'
import { downloadCSV } from '../utils/csv'

export default function RMCostMaster() {
    const { push } = useToast()
    const [costs, setCosts] = useState([])
    const [loading, setLoading] = useState(true)
    const [searchQ, setSearchQ] = useState('')
    const [saving, setSaving] = useState({})
    const [newItem, setNewItem] = useState({ rm_name: '', cost_per_kg: '', profit_pct: '', gst_pct: '5' })
    const searchTimer = useRef(null)
    const [activeSearch, setActiveSearch] = useState('')

    const load = useCallback(async (q) => {
        setLoading(true)
        try {
            let query = supabase
                .from('rm_cost_per_kg')
                .select('*')
                .order('rm_name')
            if (q) query = query.ilike('rm_name', `%${q}%`)
            const { data, error } = await query
            if (error) throw error

            const [
                { data: allCosts },
                { data: checkedRates },
                { data: blendsList },
                { data: blendRecipes },
                { data: activeRMs }
            ] = await Promise.all([
                supabase.from('rm_cost_per_kg').select('rm_name, cost_per_kg'),
                supabase.from('v_checked_rm_rates').select('*'),
                supabase.from('v_blends_list').select('*').eq('is_active', true),
                supabase.from('v_blend_recipe_for_output').select('*'),
                supabase.from('raw_materials').select('name').eq('is_active', true)
            ])

            const activeNames = new Set((activeRMs || []).map(r => (r.name || '').trim().toLowerCase()))

            // Build map of actual rm_cost_per_kg entries
            const costMap = new Map((allCosts || []).map(c => [(c.rm_name || '').trim().toLowerCase(), Number(c.cost_per_kg) || 0]))

            // Group recipes by output raw material id
            const recipesByOutput = {}
            for (const r of (blendRecipes || [])) {
                if (!recipesByOutput[r.output_rm_id]) recipesByOutput[r.output_rm_id] = []
                recipesByOutput[r.output_rm_id].push(r)
            }

            const blendCosts = new Map() // lowercased output name -> calculated cost
            let changed = true
            let iterations = 0
            while(changed && iterations < 10) {
                changed = false
                iterations++
                for (const blend of (blendsList || [])) {
                    const outNameKey = (blend.output_name || '').trim().toLowerCase()
                    const comps = recipesByOutput[blend.output_raw_material_id] || []
                    let blendCost = 0
                    for (const comp of comps) {
                        const compKey = (comp.component_name || '').trim().toLowerCase()
                        // Component could be another blend or a basic RM
                        const compCost = blendCosts.has(compKey) ? blendCosts.get(compKey) : (costMap.get(compKey) || 0)
                        blendCost += (Number(comp.qty_per_kg) || 0) * compCost
                    }
                    if (blendCosts.get(outNameKey) !== blendCost) {
                        blendCosts.set(outNameKey, blendCost)
                        changed = true
                    }
                }
            }

            const merged = (data || [])
                .filter(c => activeNames.has((c.rm_name || '').trim().toLowerCase()))
                .map(c => {
                const key = (c.rm_name || '').trim().toLowerCase()
                let refPrice = 0
                let isBlend = false

                if (blendCosts.has(key)) {
                    refPrice = blendCosts.get(key)
                    isBlend = true
                } else {
                    const ref = checkedRates?.find(r => r.rm_name_key === key)
                    refPrice = ref?.checked_rate || 0
                }

                return { ...c, ref_price: refPrice, is_blend: isBlend }
            })

            setCosts(merged)
        } catch (err) {
            push(err.message, 'err')
        } finally {
            setLoading(false)
        }
    }, [push])

    useEffect(() => { load(activeSearch) }, [activeSearch, load])

    function handleSearch(val) {
        setSearchQ(val)
        clearTimeout(searchTimer.current)
        searchTimer.current = setTimeout(() => setActiveSearch(val), 350)
    }

    async function saveCost(item) {
        setSaving(prev => ({ ...prev, [item.id]: true }))
        try {
            const { error } = await supabase
                .from('rm_cost_per_kg')
                .update({
                    cost_per_kg: Number(item.cost_per_kg) || 0,
                    profit_pct: Number(item.profit_pct) || 0,
                    gst_pct: Number(item.gst_pct) || 0,
                    updated_at: new Date().toISOString()
                })
                .eq('id', item.id)
            if (error) throw error
            // Auto sync NLC
            await supabase.rpc('sync_all_nlc_costs')
            push(`Saved: ${item.rm_name}`, 'ok')
        } catch (err) {
            push(err.message, 'err')
        } finally {
            setSaving(prev => ({ ...prev, [item.id]: false }))
        }
    }

    function updateLocal(id, field, value) {
        setCosts(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
    }

    async function addItem() {
        if (!newItem.rm_name.trim()) return push('Name required', 'warn')
        const { error } = await supabase
            .from('rm_cost_per_kg')
            .upsert({
                rm_name: newItem.rm_name.trim(),
                cost_per_kg: Number(newItem.cost_per_kg) || 0,
                profit_pct: Number(newItem.profit_pct) || 0,
                gst_pct: Number(newItem.gst_pct) || 0
            }, { onConflict: 'rm_name' })
        if (error) return push(error.message, 'err')
        // Auto sync NLC
        await supabase.rpc('sync_all_nlc_costs')
        push('Item saved!', 'ok')
        setNewItem({ rm_name: '', cost_per_kg: '', profit_pct: '', gst_pct: '5' })
        load(activeSearch)
    }

    async function deleteItem(id, name) {
        if (!confirm(`Delete "${name}"?`)) return
        const { error } = await supabase.from('rm_cost_per_kg').delete().eq('id', id)
        if (error) return push(error.message, 'err')
        // Auto sync NLC
        await supabase.rpc('sync_all_nlc_costs')
        push('Deleted', 'ok')
        setCosts(prev => prev.filter(c => c.id !== id))
    }

    function handleExport() {
        const headers = [
            'Item Name',
            'Ref Price (₹)',
            'GST %',
            'Ref Total (₹)',
            'Base Cost (₹)',
            'Profit %',
            'Effective Cost/kg (₹)'
        ]

        const rows = costs.map(c => ({
            'Item Name': c.rm_name,
            'Ref Price (₹)': Number(c.ref_price || 0).toFixed(2),
            'GST %': c.gst_pct,
            'Ref Total (₹)': (Number(c.ref_price || 0) * (1 + (c.gst_pct || 0) / 100)).toFixed(2),
            'Base Cost (₹)': Number(c.cost_per_kg || 0).toFixed(2),
            'Profit %': c.profit_pct,
            'Effective Cost/kg (₹)': (Number(c.cost_per_kg || 0) * (1 + (Number(c.profit_pct) || 0) / 100)).toFixed(2)
        }))

        downloadCSV(`RM_Cost_Master_${new Date().toISOString().split('T')[0]}.csv`, rows, headers)
    }

    return (
        <div className="grid">
            {/* Add new item */}
            <div className="card">
                <div className="hd"><b>Raw Material Cost / KG</b></div>
                <div className="bd">
                    <div className="s" style={{ marginBottom: 10, color: 'var(--muted)' }}>
                        These costs are used by the NLC Matrix & Costing Matrix to calculate BOM cost.
                        Costs set here take priority over bill rates.
                    </div>

                    {/* Add row */}
                    <div className="row" style={{ gap: 10, marginBottom: 16, alignItems: 'flex-end' }}>
                        <div>
                            <label>Item Name</label>
                            <input
                                placeholder="e.g. CHIA SEED"
                                value={newItem.rm_name}
                                onChange={e => setNewItem(n => ({ ...n, rm_name: e.target.value }))}
                                style={{ width: 280, display: 'block' }}
                            />
                        </div>
                        <div>
                            <label>Cost per KG (₹)</label>
                            <input
                                type="number"
                                placeholder="e.g. 260"
                                value={newItem.cost_per_kg}
                                onChange={e => setNewItem(n => ({ ...n, cost_per_kg: e.target.value }))}
                                style={{ width: 130, display: 'block' }}
                            />
                        </div>
                        <div>
                            <label>Profit %</label>
                            <input
                                type="number"
                                placeholder="20"
                                value={newItem.profit_pct}
                                onChange={e => setNewItem(n => ({ ...n, profit_pct: e.target.value }))}
                                style={{ width: 80, display: 'block' }}
                            />
                        </div>
                        <div>
                            <label>GST %</label>
                            <input
                                type="number"
                                value={newItem.gst_pct}
                                onChange={e => setNewItem(n => ({ ...n, gst_pct: e.target.value }))}
                                style={{ width: 80, display: 'block' }}
                            />
                        </div>
                        <button className="btn" onClick={addItem}>Add / Update</button>
                    </div>

                    {/* Search */}
                    <div className="row" style={{ marginBottom: 10, gap: 10 }}>
                        <input
                            placeholder="Search item name…"
                            value={searchQ}
                            onChange={e => handleSearch(e.target.value)}
                            style={{ width: 280 }}
                        />
                        <span className="badge">{costs.length} items</span>
                        <button className="btn small outline" onClick={handleExport} disabled={costs.length === 0}>
                            Export CSV
                        </button>
                    </div>

                    {/* Table */}
                    <div style={{ overflowX: 'auto', maxHeight: 600, overflow: 'auto' }}>
                        <table className="table" style={{ fontSize: '0.9em' }}>
                            <thead>
                                <tr>
                                    <th>Item Name</th>
                                    <th style={{ textAlign: 'right', width: 110 }}>Ref Price</th>
                                    <th style={{ textAlign: 'right', width: 80 }}>GST %</th>
                                    <th style={{ textAlign: 'right', width: 110 }}>Ref Total</th>
                                    <th style={{ textAlign: 'right', width: 110, borderLeft: '1px solid var(--border)' }}>Base Cost (₹)</th>
                                    <th style={{ textAlign: 'right', width: 90 }}>Profit %</th>
                                    <th style={{ textAlign: 'right', width: 130 }}>Effective Cost/kg</th>
                                    <th style={{ width: 100 }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && (
                                    <tr><td colSpan="5" style={{ textAlign: 'center', padding: 20 }}>Loading…</td></tr>
                                )}
                                {!loading && costs.map(c => (
                                    <tr key={c.id}>
                                        <td>
                                            <b>{c.rm_name}</b>
                                            {c.is_blend && (
                                                <span className="badge" style={{ marginLeft: 8, fontSize: '0.7em', padding: '2px 6px', color: 'var(--primary)', borderColor: 'var(--primary)', backgroundColor: 'transparent' }}>
                                                    Blend
                                                </span>
                                            )}
                                        </td>
                                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>₹{Number(c.ref_price || 0).toFixed(2)}</td>
                                        <td style={{ textAlign: 'right' }}>
                                            <input
                                                type="number"
                                                value={c.gst_pct}
                                                onChange={e => updateLocal(c.id, 'gst_pct', e.target.value)}
                                                onBlur={() => saveCost(c)}
                                                style={{ width: 60, textAlign: 'right' }}
                                            />
                                        </td>
                                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                                            ₹{(Number(c.ref_price || 0) * (1 + (c.gst_pct || 0) / 100)).toFixed(2)}
                                        </td>

                                        <td style={{ textAlign: 'right', borderLeft: '1px solid var(--border)' }}>
                                            <input
                                                type="number"
                                                value={c.cost_per_kg}
                                                onChange={e => updateLocal(c.id, 'cost_per_kg', e.target.value)}
                                                onBlur={() => saveCost(c)}
                                                style={{ width: 85, textAlign: 'right' }}
                                            />
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <input
                                                type="number"
                                                value={c.profit_pct}
                                                onChange={e => updateLocal(c.id, 'profit_pct', e.target.value)}
                                                onBlur={() => saveCost(c)}
                                                style={{ width: 70, textAlign: 'right' }}
                                            />
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--primary)' }}>
                                            ₹{(c.cost_per_kg * (1 + (c.profit_pct || 0) / 100)).toFixed(2)}
                                        </td>
                                        <td>
                                            <div className="row" style={{ gap: 4 }}>
                                                <button
                                                    className="btn small"
                                                    onClick={() => saveCost(c)}
                                                    disabled={saving[c.id]}
                                                >
                                                    {saving[c.id] ? '…' : 'Save'}
                                                </button>
                                                <button
                                                    className="btn ghost small"
                                                    onClick={() => deleteItem(c.id, c.rm_name)}
                                                >✕</button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {!loading && costs.length === 0 && (
                                    <tr><td colSpan="5" style={{ textAlign: 'center', padding: 20, color: 'var(--muted)' }}>
                                        {activeSearch ? `No items matching "${activeSearch}"` : 'No items found'}
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    )
}
