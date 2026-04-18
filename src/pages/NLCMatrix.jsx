import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../supabaseClient'
import { useToast } from '../ui/toast'

const PAGE_SIZE_OPTIONS = [25, 50, 100]

export default function NLCMatrix() {
    const { push } = useToast()
    const [loading, setLoading] = useState(true)
    const searchTimerRef = useRef(null)

    // Settings state
    const [settings, setSettings] = useState({
        single_packet_cost: 15,
        extra_packet_cost: 10,
        jar_cost: 20,
        katta_cost: 50
    })
    const [savingSettings, setSavingSettings] = useState(false)

    // Pagination state
    const [page, setPage] = useState(0)
    const [pageSize, setPageSize] = useState(50)
    const [total, setTotal] = useState(0)
    const pageCount = Math.max(1, Math.ceil(total / pageSize))

    // Search state — debounced
    const [searchQuery, setSearchQuery] = useState('')
    const [activeSearch, setActiveSearch] = useState('')

    // Data state
    const [matrixData, setMatrixData] = useState([])

    // Load settings once on mount
    useEffect(() => {
        async function fetchSettings() {
            const { data } = await supabase
                .from('nlc_settings')
                .select('*')
                .eq('id', 1)
                .maybeSingle()
            if (data) setSettings({
                single_packet_cost: data.single_packet_cost ?? 15,
                extra_packet_cost: data.extra_packet_cost ?? 10,
                jar_cost: data.jar_cost ?? 20,
                katta_cost: data.katta_cost ?? 50
            })
        }
        fetchSettings()
    }, [])

    // Server-side data fetch (page + search)
    const fetchData = useCallback(async (p, ps, q) => {
        setLoading(true)
        try {
            const from = p * ps
            const to = from + ps - 1

            let query = supabase
                .from('v_nlc_matrix_aggregated')
                .select('*', { count: 'estimated' })
                .order('sku', { ascending: true })
                .range(from, to)

            if (q) {
                query = query.or(`sku.ilike.%${q}%,sku_description.ilike.%${q}%`)
            }

            const { data, error, count } = await query
            if (error) throw error

            setMatrixData(data || [])
            setTotal(count ?? 0)
        } catch (err) {
            push(`Load error: ${err.message}`, 'err')
        } finally {
            setLoading(false)
        }
    }, [push])

    // Refetch when page, pageSize, or activeSearch changes
    useEffect(() => {
        fetchData(page, pageSize, activeSearch)
    }, [page, pageSize, activeSearch, fetchData])

    // Debounce search input — fires after 400ms idle
    function handleSearchChange(val) {
        setSearchQuery(val)
        clearTimeout(searchTimerRef.current)
        searchTimerRef.current = setTimeout(() => {
            setPage(0)
            setActiveSearch(val)
        }, 400)
    }

    // Packaging cost calc (runs client-side on fetched page only)
    function calcPkgCost(packagingType, qty) {
        const jarCost = Number(settings.jar_cost) || 0
        const singleCost = Number(settings.single_packet_cost) || 0
        const extraCost = Number(settings.extra_packet_cost) || 0
        if (packagingType === 'jar') {
            return jarCost * qty
        }
        if (qty <= 0) return 0
        if (qty === 1) return singleCost
        return qty * extraCost
    }

    async function saveSettings() {
        setSavingSettings(true)
        try {
            const { error } = await supabase.rpc('update_nlc_settings', {
                p_single: Number(settings.single_packet_cost) || 0,
                p_extra: Number(settings.extra_packet_cost) || 0,
                p_jar: Number(settings.jar_cost) || 0,
                p_katta: Number(settings.katta_cost) || 0
            })
            if (error) throw error
            push('Settings saved!', 'ok')
        } catch (err) {
            push(`Settings error: ${err.message}`, 'err')
        } finally {
            setSavingSettings(false)
        }
    }


    return (
        <div className="grid">
            <div className="card">
                <div className="hd">
                    <b>NLC Matrix</b>
                    <div className="row" style={{ gap: 8 }}>
                        <span className="badge">{total} SKUs</span>
                        <button className="btn ghost small" onClick={() => fetchData(page, pageSize, activeSearch)} disabled={loading}>
                            Refresh
                        </button>
                    </div>
                </div>

                {/* Settings panel */}
                <div style={{ padding: '12px 16px', background: 'var(--bg-alt)', borderBottom: '1px solid var(--border)' }}>
                    <div className="row" style={{ gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <b style={{ marginRight: 4 }}>Packaging Costs (₹):</b>
                        <div>
                            <label>Single Packet</label>
                            <input type="number" value={settings.single_packet_cost}
                                onChange={e => setSettings({ ...settings, single_packet_cost: e.target.value })}
                                style={{ width: 90, marginLeft: 6 }} />
                        </div>
                        <div>
                            <label>Extra Packet</label>
                            <input type="number" value={settings.extra_packet_cost}
                                onChange={e => setSettings({ ...settings, extra_packet_cost: e.target.value })}
                                style={{ width: 90, marginLeft: 6 }} />
                        </div>
                        <div>
                            <label>Jar</label>
                            <input type="number" value={settings.jar_cost}
                                onChange={e => setSettings({ ...settings, jar_cost: e.target.value })}
                                style={{ width: 90, marginLeft: 6 }} />
                        </div>
                        <div>
                            <label>Katta</label>
                            <input type="number" value={settings.katta_cost}
                                onChange={e => setSettings({ ...settings, katta_cost: e.target.value })}
                                style={{ width: 90, marginLeft: 6 }} />
                        </div>
                        <button className="btn small" onClick={saveSettings} disabled={savingSettings}>
                            {savingSettings ? 'Saving…' : 'Save Settings'}
                        </button>
                    </div>
                </div>

                <div className="bd">
                    {/* Search + Pagination top bar */}
                    <div className="row" style={{ marginBottom: 12, gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                            placeholder="Search SKU or description…"
                            value={searchQuery}
                            onChange={e => handleSearchChange(e.target.value)}
                            style={{ width: 280 }}
                        />
                        <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0) }}>
                            {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n} / page</option>)}
                        </select>
                        <span className="badge">Page {page + 1} / {pageCount}</span>
                        <button className="btn small outline" onClick={() => setPage(p => p - 1)} disabled={page === 0 || loading}>Prev</button>
                        <button className="btn small outline" onClick={() => setPage(p => p + 1)} disabled={page + 1 >= pageCount || loading}>Next</button>
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>SKU</th>
                                    <th>Finished Goods</th>
                                    <th style={{ textAlign: 'right' }}>Total Wt (kg)</th>
                                    <th style={{ textAlign: 'right' }}>Final Cost/kg (auto)</th>
                                    <th style={{ textAlign: 'right' }}>BOM Cost (₹)</th>
                                    <th style={{ textAlign: 'right' }}>Est. Total Cost</th>
                                    <th>Pkg Type</th>
                                    <th style={{ textAlign: 'right' }}>Pkg Cost</th>
                                    <th style={{ textAlign: 'right', background: 'var(--bg-alt)' }}>NLC</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && (
                                    <tr>
                                        <td colSpan="9" className="s" style={{ textAlign: 'center', padding: 20 }}>
                                            Loading...
                                        </td>
                                    </tr>
                                )}
                                {!loading && matrixData.map(row => {
                                    const items = Array.isArray(row.items) ? row.items : []
                                    const isCombo = items.length > 1
                                    const totalNormalQty = items.reduce((s, it) => s + (it.packaging_type !== 'jar' ? (Number(it.qty_per_sku) || 0) : 0), 0)
                                    const totalJarQty = items.reduce((s, it) => s + (it.packaging_type === 'jar' ? (Number(it.qty_per_sku) || 0) : 0), 0)

                                    const jarCost = Number(settings.jar_cost) || 0
                                    const singleCost = Number(settings.single_packet_cost) || 0
                                    const extraCost = Number(settings.extra_packet_cost) || 0
                                    const kattaCost = Number(settings.katta_cost) || 0
                                    const isKatta = /10kg|20kg/i.test(row.sku)

                                    // Total Pkg = Jars + (Either Katta, Single or Extra depending on total normal qty)
                                    let totalPkgCost = totalJarQty * jarCost
                                    if (isKatta) totalPkgCost += kattaCost
                                    else if (totalNormalQty === 1) totalPkgCost += singleCost
                                    else if (totalNormalQty > 1) totalPkgCost += totalNormalQty * extraCost

                                    let totalBomCost = 0
                                    const enrichedItems = items.map(it => {
                                        let pkgCost = 0
                                        if (it.packaging_type === 'jar') {
                                            pkgCost = jarCost * it.qty_per_sku
                                        } else {
                                            // If total packets > 1, this item's share is qty * extraCost
                                            if (isKatta) {
                                                // Prorate the katta cost among the normal items
                                                pkgCost = totalNormalQty > 0 ? (kattaCost / totalNormalQty) * it.qty_per_sku : 0
                                            }
                                            else if (totalNormalQty === 1) pkgCost = singleCost
                                            else pkgCost = it.qty_per_sku * extraCost
                                        }
                                        const bomLine = (Number(it.bom_cost) || 0) * it.qty_per_sku
                                        totalBomCost += bomLine
                                        return { ...it, pkgCost, bomLine }
                                    })

                                    const totalWeight = enrichedItems.reduce((s, it) => s + (Number(it.total_weight) || 0) * it.qty_per_sku, 0)

                                    // NLC = BOM Total Cost + Packaging
                                    const nlc = totalBomCost + totalPkgCost
                                    const derivedFinalCostPerKg = totalWeight > 0 ? (totalBomCost / totalWeight) : 0

                                    return (
                                        <tr key={row.sku}>
                                            <td>
                                                <b>{row.sku}</b>
                                                {row.sku_description && (
                                                    <div><small style={{ color: 'var(--muted)' }}>{row.sku_description}</small></div>
                                                )}
                                            </td>

                                            <td>
                                                {enrichedItems.map(it => (
                                                    <div key={it.finished_good_id} style={{ fontSize: '0.88em', padding: '1px 0' }}>
                                                        {it.qty_per_sku}x {it.finished_good_name}
                                                    </div>
                                                ))}
                                            </td>

                                            {/* Total Weight per item */}
                                            <td style={{ textAlign: 'right' }}>
                                                {enrichedItems.map(it => (
                                                    <div key={it.finished_good_id} style={{ fontSize: '0.88em', padding: '1px 0' }}>
                                                        {(Number(it.total_weight) * it.qty_per_sku).toFixed(3)}
                                                    </div>
                                                ))}
                                                {isCombo && <div style={{ borderTop: '1px solid var(--border)', fontWeight: 600 }}>{totalWeight.toFixed(3)}</div>}
                                            </td>

                                            {/* Final Cost/kg (derived from RM Master) */}
                                            <td style={{ textAlign: 'right', fontWeight: 700 }}>
                                                ₹{derivedFinalCostPerKg.toFixed(2)}
                                            </td>

                                            {/* BOM Cost (per item) */}
                                            <td style={{ textAlign: 'right', fontSize: '0.9em', color: 'var(--muted)' }}>
                                                {isCombo ? (
                                                    <>
                                                        {enrichedItems.map(it => (
                                                            <div key={it.finished_good_id} style={{ fontSize: '0.88em', padding: '1px 0' }}>
                                                                ₹{it.bomLine.toFixed(2)}
                                                            </div>
                                                        ))}
                                                        <div style={{ borderTop: '1px solid var(--border)', fontWeight: 600 }}>₹{totalBomCost.toFixed(2)}</div>
                                                    </>
                                                ) : `₹${totalBomCost.toFixed(2)}`}
                                            </td>

                                            {/* Est. Total Cost = BOM Total Cost */}
                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                                {totalBomCost > 0 ? `₹${totalBomCost.toFixed(2)}` : <span style={{ color: 'var(--muted)' }}>—</span>}
                                            </td>

                                            {/* Packaging type badge */}
                                            <td>
                                                {enrichedItems.map(it => (
                                                    <div key={it.finished_good_id} style={{ fontSize: '0.88em', padding: '1px 0' }}>
                                                        <span className={`badge ${it.packaging_type === 'jar' ? 'orange' : it.packaging_type === 'katta' ? 'green' : 'blue'}`}>
                                                            {it.packaging_type.toUpperCase()}
                                                        </span>
                                                    </div>
                                                ))}
                                            </td>

                                            {/* Packaging Cost */}
                                            <td style={{ textAlign: 'right' }}>
                                                {isCombo ? (
                                                    <>
                                                        {enrichedItems.map(it => (
                                                            <div key={it.finished_good_id} style={{ fontSize: '0.88em', color: 'var(--muted)', padding: '1px 0' }}>
                                                                ₹{it.pkgCost.toFixed(2)}
                                                            </div>
                                                        ))}
                                                        <div style={{ borderTop: '1px solid var(--border)', fontWeight: 600 }}>₹{totalPkgCost.toFixed(2)}</div>
                                                    </>
                                                ) : `₹${totalPkgCost.toFixed(2)}`}
                                            </td>

                                            {/* NLC = Est. Total Cost + Pkg Cost */}
                                            <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--primary)', background: 'var(--bg-alt)' }}>
                                                {totalBomCost > 0 ? `₹${nlc.toFixed(2)}` : <span style={{ color: 'var(--muted)' }}>—</span>}
                                            </td>
                                        </tr>
                                    )
                                })}
                                {!loading && matrixData.length === 0 && (
                                    <tr>
                                        <td colSpan="9" className="s" style={{ textAlign: 'center', padding: 20 }}>
                                            {activeSearch ? `No SKUs found for "${activeSearch}"` : 'No SKU Mappings found.'}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Bottom pagination */}
                    {pageCount > 1 && (
                        <div className="row" style={{ marginTop: 12, gap: 8, justifyContent: 'flex-end' }}>
                            <button className="btn small outline" onClick={() => setPage(0)} disabled={page === 0 || loading}>First</button>
                            <button className="btn small outline" onClick={() => setPage(p => p - 1)} disabled={page === 0 || loading}>Prev</button>
                            <span className="badge">Page {page + 1} / {pageCount} ({total} total)</span>
                            <button className="btn small outline" onClick={() => setPage(p => p + 1)} disabled={page + 1 >= pageCount || loading}>Next</button>
                            <button className="btn small outline" onClick={() => setPage(pageCount - 1)} disabled={page + 1 >= pageCount || loading}>Last</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
