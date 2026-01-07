import { useEffect, useState, useCallback, useMemo, memo } from 'react'
import { supabase } from '../supabaseClient'
import { useToast } from '../ui/toast.jsx'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import { FileDown, Upload, Trash2, MapPin, Loader2, ChevronLeft, ChevronRight, Download, Filter, List, Search, Edit2, X, Check } from 'lucide-react'

// --- Sub-components (Memoized for performance) ---

const MappingTable = memo(({ mappings, editingState, editWarehouse, setEditWarehouse, startEdit, saveEdit, cancelEdit, deleteMapping }) => (
    <table className="table mini">
        <thead>
            <tr>
                <th>State</th>
                <th>Warehouse</th>
                <th style={{ width: 150 }}>Actions</th>
            </tr>
        </thead>
        <tbody>
            {mappings.map(m => (
                <tr key={m.state}>
                    <td>{m.state}</td>
                    <td>
                        {editingState === m.state ? (
                            <input
                                className="small full"
                                value={editWarehouse}
                                onChange={e => setEditWarehouse(e.target.value)}
                                autoFocus
                            />
                        ) : (
                            m.warehouse
                        )}
                    </td>
                    <td>
                        <div className="row" style={{ gap: 4 }}>
                            {editingState === m.state ? (
                                <>
                                    <button className="btn ghost small" onClick={saveEdit} style={{ color: 'var(--success)', gap: 4 }}>
                                        <Check size={14} /> Save
                                    </button>
                                    <button className="btn ghost small" onClick={cancelEdit} style={{ color: 'var(--muted)', gap: 4 }}>
                                        <X size={14} /> Cancel
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button className="btn ghost small" onClick={() => startEdit(m)} style={{ color: 'var(--primary)', gap: 4 }}>
                                        <Edit2 size={14} /> Edit
                                    </button>
                                    <button className="btn ghost small" onClick={() => deleteMapping(m.state)} style={{ color: 'var(--danger)', gap: 4 }}>
                                        <Trash2 size={14} /> Delete
                                    </button>
                                </>
                            )}
                        </div>
                    </td>
                </tr>
            ))}
            {mappings.length === 0 && (
                <tr>
                    <td colSpan="3" style={{ textAlign: 'center', padding: 20, color: 'var(--muted)' }}>
                        No mappings found.
                    </td>
                </tr>
            )}
        </tbody>
    </table>
))

const ReportTable = memo(({ data, selectedWarehouse, loading }) => (
    <table className="table mini">
        <thead>
            <tr>
                <th>SKU</th>
                <th>ITEM ID</th>
                <th>TITLE</th>
                <th>Total Quantity</th>
                {selectedWarehouse !== 'OVERALL' && <th>Warehouse</th>}
            </tr>
        </thead>
        <tbody>
            {data.map((d, idx) => (
                <tr key={idx}>
                    <td className="s" style={{ whiteSpace: 'nowrap' }}>{d.sku}</td>
                    <td className="s" style={{ whiteSpace: 'nowrap' }}>{d.item_id}</td>
                    <td className="s" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.title}>
                        {d.title}
                    </td>
                    <td>{d.total_qty}</td>
                    {selectedWarehouse !== 'OVERALL' && (
                        <td>
                            <span className={`badge ${d.warehouse === 'UNASSIGNED' ? 'danger' : ''}`}>
                                {d.warehouse}
                            </span>
                        </td>
                    )}
                </tr>
            ))}
            {data.length === 0 && !loading && (
                <tr>
                    <td colSpan={selectedWarehouse === 'OVERALL' ? 4 : 5} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
                        No data found for the selected filter.
                    </td>
                </tr>
            )}
        </tbody>
    </table>
))

// --- Main Component ---

export default function Consignment() {
    const { push } = useToast()
    const [loading, setLoading] = useState(false)
    const [progress, setProgress] = useState(null)
    const [activeTab, setActiveTab] = useState('reports')
    const [processedData, setProcessedData] = useState([])
    const [mappings, setMappings] = useState([])

    // Mapping state
    const [newState, setNewState] = useState('')
    const [newWarehouse, setNewWarehouse] = useState('')
    const [mappingSearch, setMappingSearch] = useState('')
    const [editingState, setEditingState] = useState(null)
    const [editWarehouse, setEditWarehouse] = useState('')

    // Filter & Pagination
    const [selectedWarehouse, setSelectedWarehouse] = useState('ALL')
    const [page, setPage] = useState(0)
    const [pageSize] = useState(50)
    const [totalCount, setTotalCount] = useState(0)

    const loadMappings = useCallback(async () => {
        const { data, error } = await supabase.from('state_warehouse_mapping').select('*').order('state')
        if (error) push(error.message, 'err')
        else setMappings(data || [])
    }, [push])

    const loadData = useCallback(async () => {
        setLoading(true)
        try {
            const isOverall = selectedWarehouse === 'OVERALL'
            let query = supabase.from(isOverall ? 'v_consignment_overall_summary' : 'v_consignment_summary').select('*', { count: 'exact' })

            if (!isOverall && selectedWarehouse !== 'ALL') {
                query = query.eq('warehouse', selectedWarehouse)
            }

            const { data, count, error } = await query
                .order('total_qty', { ascending: false })
                .range(page * pageSize, (page + 1) * pageSize - 1)

            if (error) throw error
            setProcessedData(data || [])
            setTotalCount(count || 0)

        } catch (err) {
            push(err.message, 'err')
        } finally {
            setLoading(false)
        }
    }, [page, pageSize, selectedWarehouse, push])

    useEffect(() => { loadMappings() }, [loadMappings])
    useEffect(() => { if (activeTab === 'reports') loadData() }, [activeTab, loadData])

    const uniqueWarehouses = useMemo(() => Array.from(new Set(mappings.map(m => m.warehouse))).sort(), [mappings])

    const filteredMappings = useMemo(() => {
        if (!mappingSearch.trim()) return mappings
        const q = mappingSearch.toLowerCase()
        return mappings.filter(m => m.state.toLowerCase().includes(q) || m.warehouse.toLowerCase().includes(q))
    }, [mappings, mappingSearch])

    const handleAddMapping = async () => {
        if (!newState.trim() || !newWarehouse.trim()) return push('Required fields missing', 'warn')
        const { error } = await supabase.from('state_warehouse_mapping').upsert({ state: newState.trim(), warehouse: newWarehouse.trim() })
        if (error) push(error.message, 'err')
        else {
            push('Mapping saved', 'ok'); setNewState(''); setNewWarehouse(''); loadMappings()
        }
    }

    const handleSaveEdit = async () => {
        if (!editWarehouse.trim()) return push('Warehouse required', 'warn')
        const { error } = await supabase.from('state_warehouse_mapping').upsert({ state: editingState, warehouse: editWarehouse.trim() })
        if (error) push(error.message, 'err')
        else {
            push('Updated', 'ok'); setEditingState(null); await loadMappings(); loadData()
        }
    }

    const handleDeleteMapping = async (state) => {
        if (!confirm(`Delete ${state}?`)) return
        const { error } = await supabase.from('state_warehouse_mapping').delete().eq('state', state)
        if (error) push(error.message, 'err')
        else {
            push('Deleted', 'ok'); loadMappings()
        }
    }

    const handleFileUpload = async (e) => {
        const file = e.target.files[0]
        if (!file) return
        setLoading(true); setProgress({ current: 0, total: 100, label: 'Reading...' })
        try {
            const buffer = await file.arrayBuffer()
            const wb = XLSX.read(buffer)
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
            if (rows.length === 0) throw new Error('Empty file')

            let totalFileQty = 0
            const toInsert = rows.map(r => {
                const sku = String(r['SKU'] || r['sku'] || '').trim()
                const qty = Number(r['QTY'] || r['qty'] || 0)
                totalFileQty += qty
                return {
                    sku,
                    item_id: String(r['ITEM ID'] || r['item id'] || ''),
                    title: String(r['TITLE'] || r['title'] || ''),
                    qty,
                    state: String(r['STATE'] || r['state'] || '').trim()
                }
            })

            await supabase.from('consignment_data').delete().neq('sku', 'DUMMY')

            const CHUNK = 1000
            for (let i = 0; i < toInsert.length; i += CHUNK) {
                const chunk = toInsert.slice(i, i + CHUNK)
                setProgress({ current: i + chunk.length, total: toInsert.length, label: `Uploading...` })
                const { error } = await supabase.from('consignment_data').insert(chunk)
                if (error) throw error
            }
            push(`Uploaded ${toInsert.length} rows (Total Qty: ${totalFileQty.toLocaleString()})`, 'ok')
            setPage(0); loadData()
        } catch (err) { push(err.message, 'err') } finally { setLoading(false); setProgress(null); e.target.value = '' }
    }

    const handleExport = async () => {
        setLoading(true); setProgress({ current: 0, total: totalCount, label: 'Fetching...' })
        try {
            let allData = [], offset = 0, FETCH = 1000, hasMore = true
            const isOverall = selectedWarehouse === 'OVERALL'

            while (hasMore) {
                let query = supabase.from(isOverall ? 'v_consignment_overall_summary' : 'v_consignment_summary').select('*')
                if (!isOverall && selectedWarehouse !== 'ALL') query = query.eq('warehouse', selectedWarehouse)

                const { data, error } = await query.order('total_qty', { ascending: false }).range(offset, offset + FETCH - 1)
                if (error) throw error
                if (data?.length) {
                    allData = allData.concat(data); offset += FETCH
                    setProgress({ current: allData.length, total: totalCount, label: `Fetching ${allData.length}...` })
                    if (data.length < FETCH) hasMore = false
                } else hasMore = false
            }

            const wb = XLSX.utils.book_new()
            const formatRow = r => ({ SKU: r.sku, 'ITEM ID': r.item_id, TITLE: r.title, 'TOTAL QTY': r.total_qty, ...(selectedWarehouse !== 'OVERALL' && { WAREHOUSE: r.warehouse }) })

            if (selectedWarehouse !== 'ALL') {
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allData.map(formatRow)), selectedWarehouse.substring(0, 31))
            } else {
                const grouped = allData.reduce((acc, r) => { (acc[r.warehouse] = acc[r.warehouse] || []).push(r); return acc }, {})
                Object.entries(grouped).forEach(([wh, rows]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(formatRow)), wh.substring(0, 31)))
            }

            XLSX.writeFile(wb, `Consignment_${selectedWarehouse}_${new Date().toISOString().split('T')[0]}.xlsx`)
            push('Exported', 'ok')
        } catch (err) { push(err.message, 'err') } finally { setLoading(false); setProgress(null) }
    }

    return (
        <div style={{ padding: 20 }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 24 }}>
                <div className="row" style={{ gap: 12 }}>
                    <h2>Consignment Management</h2>
                    {loading && progress && (
                        <div className="row" style={{ gap: 8, padding: '4px 12px', background: 'var(--bg-secondary)', borderRadius: 20, border: '1px solid var(--border)' }}>
                            <Loader2 size={14} className="spin" color="var(--primary)" />
                            <span className="xs" style={{ fontWeight: 500 }}>{progress.label} {progress.total > 0 && `${Math.round((progress.current / progress.total) * 100)}%`}</span>
                        </div>
                    )}
                </div>
                <div className="row" style={{ gap: 12 }}>
                    <button className="btn outline" onClick={() => {
                        const csv = [['SKU', 'ITEM ID', 'TITLE', 'QTY', 'STATE'], ['SKU123', 'ITEM456', 'Product Title', '10', 'Odisha']].map(r => r.join(',')).join('\n')
                        saveAs(new Blob([csv], { type: 'text/csv' }), 'consignment_sample.csv')
                    }}><FileDown size={18} /> Sample</button>
                    <label className="btn">
                        <Upload size={18} /> Upload <input type="file" hidden accept=".csv,.xlsx" onChange={handleFileUpload} />
                    </label>
                </div>
            </div>

            <div className="tabs" style={{ marginBottom: 20, display: 'flex', gap: 20, borderBottom: '1px solid var(--border)' }}>
                {['reports', 'mappings'].map(t => (
                    <button key={t} className={`tab-btn ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)} style={{ padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer', borderBottom: activeTab === t ? '2px solid var(--primary)' : 'none', color: activeTab === t ? 'var(--primary)' : 'var(--muted)', fontWeight: 600, textTransform: 'capitalize' }}>
                        {t === 'reports' ? <List size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} /> : <MapPin size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />}
                        {t === 'reports' ? 'Reports & Split' : 'Warehouse Mappings'}
                    </button>
                ))}
            </div>

            {activeTab === 'mappings' ? (
                <div className="card" style={{ maxWidth: 800 }}>
                    <div className="hd" style={{ justifyContent: 'space-between' }}>
                        <div className="row" style={{ gap: 8 }}><MapPin size={18} /> <b>Mappings</b></div>
                        <div className="row" style={{ position: 'relative' }}>
                            <Search size={16} style={{ position: 'absolute', left: 8, color: 'var(--muted)' }} />
                            <input className="small" style={{ paddingLeft: 32, width: 200 }} placeholder="Search..." value={mappingSearch} onChange={e => setMappingSearch(e.target.value)} />
                        </div>
                    </div>
                    <div className="bd">
                        <div className="row" style={{ gap: 8, marginBottom: 16, background: 'var(--bg-secondary)', padding: 12, borderRadius: 8 }}>
                            <input className="small" placeholder="State" value={newState} onChange={e => setNewState(e.target.value)} />
                            <input className="small" placeholder="Warehouse" value={newWarehouse} onChange={e => setNewWarehouse(e.target.value)} />
                            <button className="btn small" onClick={handleAddMapping}>Add</button>
                        </div>
                        <MappingTable
                            mappings={filteredMappings}
                            editingState={editingState}
                            editWarehouse={editWarehouse}
                            setEditWarehouse={setEditWarehouse}
                            startEdit={m => { setEditingState(m.state); setEditWarehouse(m.warehouse) }}
                            saveEdit={handleSaveEdit}
                            cancelEdit={() => setEditingState(null)}
                            deleteMapping={handleDeleteMapping}
                        />
                    </div>
                </div>
            ) : (
                <div className="card">
                    <div className="hd" style={{ justifyContent: 'space-between' }}>
                        <div className="row" style={{ gap: 12 }}>
                            <b>Split Preview</b>
                            <span className="badge small outline">{totalCount} entries</span>
                        </div>
                        <div className="row" style={{ gap: 12 }}>
                            <select className="select small" value={selectedWarehouse} onChange={e => { setSelectedWarehouse(e.target.value); setPage(0) }}>
                                <option value="ALL">All Warehouses</option>
                                <option value="OVERALL">Overall Sum</option>
                                {uniqueWarehouses.map(w => <option key={w} value={w}>{w}</option>)}
                                <option value="UNASSIGNED">UNASSIGNED</option>
                            </select>
                            <button className="btn small outline" onClick={handleExport} disabled={loading || !totalCount}><Download size={16} /> Export</button>
                        </div>
                    </div>
                    <div className="bd">
                        <ReportTable data={processedData} selectedWarehouse={selectedWarehouse} loading={loading} />
                        {totalCount > pageSize && (
                            <div className="row" style={{ marginTop: 16, justifyContent: 'center', gap: 12 }}>
                                <button className="btn outline small" disabled={page === 0 || loading} onClick={() => setPage(p => p - 1)}><ChevronLeft size={16} /></button>
                                <span className="s">Page {page + 1} of {Math.ceil(totalCount / pageSize)}</span>
                                <button className="btn outline small" disabled={(page + 1) * pageSize >= totalCount || loading} onClick={() => setPage(p => p + 1)}><ChevronRight size={16} /></button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
