import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { downloadCSV } from '../utils/csv'

export default function RawConsumed() {
    const [rows, setRows] = useState([])
    const [loading, setLoading] = useState(true)
    const [days, setDays] = useState(7) // Locked to 7 days

    useEffect(() => {
        async function load() {
            setLoading(true)
            try {
                // 1. Fetch Master List of Raw Materials
                const { data: masters, error: masterError } = await supabase
                    .from('raw_materials')
                    .select('id, name, unit, low_threshold')
                    .eq('is_active', true)
                    .order('name')

                if (masterError) throw masterError

                // 2. Fetch inventory view
                const { data: inventoryData, error: invError } = await supabase
                    .from('v_raw_inventory')
                    .select('*')

                if (invError) throw invError

                const invMap = {}
                inventoryData.forEach(r => {
                    if (r.id) invMap[r.id] = r
                    else if (r.raw_material_name) invMap[r.raw_material_name] = r
                })

                // 3. Fetch consumption (outward) with CHUNKED loading
                // Logic: Exclude today. Fetch last 7 COMPLETE days.
                // If today is Dec 7, we want Nov 30 00:00 to Dec 7 00:00 (exclusive of Dec 7 events)
                const today = new Date()
                today.setHours(0, 0, 0, 0) // Midnight today (Upper bound)
                const endDateStr = today.toISOString()

                const start = new Date(today)
                start.setDate(start.getDate() - days) // 7 days ago
                const startDateStr = start.toISOString()

                let allLedger = []
                let from = 0
                const batchSize = 1000
                let keepFetching = true

                while (keepFetching) {
                    const { data: batch, error: ledError } = await supabase
                        .from('stock_ledger')
                        .select('rm_id, item_kind, qty, created_at')
                        .eq('item_kind', 'rm')
                        .eq('movement', 'out')
                        .eq('reason', 'manufacture_consume')
                        .gte('created_at', startDateStr)
                        .lt('created_at', endDateStr) // 👈 Strictly less than today
                        .range(from, from + batchSize - 1)

                    if (ledError) throw ledError

                    if (batch && batch.length > 0) {
                        allLedger = allLedger.concat(batch)
                        if (batch.length < batchSize) {
                            keepFetching = false
                        } else {
                            from += batchSize
                        }
                    } else {
                        keepFetching = false
                    }
                }

                // 4. Process Consumption
                const consMap = {}
                masters.forEach(m => {
                    consMap[m.id] = 0
                })

                allLedger.forEach(entry => {
                    const id = entry.rm_id || entry.item_id
                    if (consMap[id] !== undefined) {
                        consMap[id] += (Number(entry.qty) || 0)
                    }
                })

                // 5. Merge everything
                const finalRows = masters.map(m => {
                    let inv = invMap[m.id]
                    if (!inv) inv = invMap[m.name]

                    const current = Number(inv?.qty_on_hand || 0)
                    const consumed = consMap[m.id]

                    return {
                        id: m.id,
                        raw_material_name: m.name,
                        unit: m.unit,
                        current: current,
                        consumed: consumed,
                        diff: current - consumed
                    }
                })

                setRows(finalRows)

            } catch (err) {
                alert(err.message)
            } finally {
                setLoading(false)
            }
        }

        load()
    }, [days]) // Re-run when 'days' changes

    function exportData() {
        const dataToExport = rows.map(r => ({
            'Material': r.raw_material_name,
            'Consumed (7d)': r.consumed,
            'Current Stock': r.current,
            'Net Balance': r.diff
        }))
        downloadCSV('raw_consumed_7d.csv', dataToExport)
    }

    return (
        <div className="grid">
            <div className="card">
                <div className="hd" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                    <b>Raw Material Consumption (Last 7 Days)</b>
                    <button className="btn small" onClick={exportData} disabled={!rows.length}>
                        Export CSV
                    </button>
                </div>
                <div className="bd" style={{ overflowX: 'auto' }}>
                    {loading ? (
                        <div className="s">Loading 7 days of data...</div>
                    ) : (
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Material</th>
                                    <th className="r">Consumed (7d)</th>
                                    <th className="r" style={{ borderLeft: '2px solid #eee' }}>Current Stock</th>
                                    <th className="r">Net (Current - Consumed)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(r => (
                                    <tr key={r.id}>
                                        <td>{r.raw_material_name}</td>
                                        <td className="r">{r.consumed.toFixed(2)}</td>
                                        <td className="r" style={{ borderLeft: '2px solid #eee', fontWeight: 'bold' }}>
                                            {r.current}
                                        </td>
                                        <td className="r" style={{
                                            color: r.diff < 0 ? 'var(--err)' : 'inherit',
                                            fontWeight: 'bold'
                                        }}>
                                            {r.diff.toFixed(2)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    {!loading && rows.length === 0 && (
                        <div className="s">No data found.</div>
                    )}
                </div>
            </div>
        </div>
    )
}
