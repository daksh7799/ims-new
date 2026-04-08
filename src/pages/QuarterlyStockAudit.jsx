// src/pages/QuarterlyStockAudit.jsx
import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useToast } from '../ui/toast.jsx';

export default function QuarterlyStockAudit() {
    const { push } = useToast();
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [filterVal, setFilterVal] = useState('');

    useEffect(() => {
        let mounted = true;
        async function load() {
            setLoading(true);
            try {
                // Fetch active RMs
                const { data: rms, error: rmErr } = await supabase
                    .from('raw_materials')
                    .select('id, name, unit')
                    .eq('is_active', true)
                    .order('name');
                if (rmErr) throw rmErr;

                // Fetch live system qty
                const { data: invs, error: invErr } = await supabase
                    .from('v_raw_inventory')
                    .select('rm_id, qty_on_hand');
                if (invErr) throw invErr;

                const invMap = {};
                if (invs) {
                    invs.forEach(i => {
                        invMap[i.rm_id] = Number(i.qty_on_hand || 0);
                    });
                }

                const initialRows = (rms || []).map(rm => ({
                    id: rm.id,
                    name: rm.name,
                    unit: rm.unit,
                    system_qty: invMap[rm.id] || 0,
                    measured_qty: '', // String initially for input
                }));

                if (mounted) setRows(initialRows);
            } catch (err) {
                console.error(err);
                if (mounted) push(err.message || 'Failed to load data', 'err');
            } finally {
                if (mounted) setLoading(false);
            }
        }
        load();
        return () => { mounted = false; };
    }, [push]);

    function handleQtyChange(id, val) {
        setRows(prev => prev.map(r => r.id === id ? { ...r, measured_qty: val } : r));
    }

    const filteredRows = useMemo(() => {
        const q = filterVal.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter(r => r.name.toLowerCase().includes(q));
    }, [rows, filterVal]);

    // Rows that have a defined, valid number entered
    const rowsToProcess = useMemo(() => {
        return rows.filter(r => r.measured_qty !== '' && !isNaN(Number(r.measured_qty)));
    }, [rows]);

    async function handleSaveAndAdjust() {
        if (!rowsToProcess.length) {
            push('Please enter quantities for at least one item.', 'warn');
            return;
        }

        if (!confirm(`You are about to submit the audit for ${rowsToProcess.length} items and adjust stock for any variances. Proceed?`)) {
            return;
        }

        setSubmitting(true);
        try {
            // Get mismatch vendor for positive adjustments
            const { data: vendors, error: vError } = await supabase
                .from('vendors')
                .select('id')
                .eq('name', 'mismatch')
                .limit(1);

            if (vError) throw vError;
            const mismatchVendor = vendors?.[0];
            if (!mismatchVendor) {
                throw new Error("Vendor 'mismatch' not found. Please create it first to handle stock increments.");
            }

            const today = new Date().toISOString().split('T')[0];
            const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14); // e.g. 20231024153022

            let adjustmentsCount = 0;

            for (const item of rowsToProcess) {
                const measured = Number(item.measured_qty);
                const variance = Number((measured - item.system_qty).toFixed(4));
                const absVariance = Number(Math.abs(variance).toFixed(4));

                // 1. Log the stock check (similar to DailyStockCheck but directly via upsert)
                const { data: checkData, error: checkErr } = await supabase
                    .from('daily_stock_checks')
                    .upsert({
                        raw_material_id: item.id,
                        measured_qty: measured,
                        system_qty: item.system_qty,
                        check_date: today,
                        is_adjusted: variance !== 0 // we will adjust it right now
                    }, { onConflict: 'raw_material_id, check_date' })
                    .select('id')
                    .single();

                if (checkErr) throw checkErr;

                // 2. Adjust if variance != 0
                if (variance > 0) {
                    // POSITIVE: inward entry
                    const billNo = `Q-ADJ-${timestamp}-${item.id}`;
                    const { error: inErr } = await supabase.from('raw_inward').insert({
                        raw_material_id: item.id,
                        vendor_id: mismatchVendor.id,
                        qty: absVariance,
                        bill_no: billNo,
                        purchase_date: today,
                    });
                    if (inErr) throw inErr;
                    adjustmentsCount++;
                } else if (variance < 0) {
                    // NEGATIVE: ledger out
                    const { error: outErr } = await supabase.from('stock_ledger').insert({
                        rm_id: item.id,
                        item_kind: 'rm',
                        qty: absVariance,
                        movement: 'out',
                        reason: 'stock_check_adjustment',
                        note: `Adjustment from Quarterly Audit (Check ID: ${checkData?.id || 'Bulk'})`
                    });
                    if (outErr) throw outErr;
                    adjustmentsCount++;
                }
            }

            push(`Audit completed successfully! Made ${adjustmentsCount} adjustments.`, 'ok');
            
            // Clear inputs
            setRows(prev => prev.map(r => ({ ...r, measured_qty: '', system_qty: r.measured_qty !== '' && !isNaN(Number(r.measured_qty)) ? Number(r.measured_qty) : r.system_qty })));

        } catch (e) {
            console.error(e);
            push(e.message || String(e), 'err');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="grid">
            <div className="card">
                <div className="hd" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <b>Quarterly Stock Audit</b>
                    {loading ? <span className="badge">Loading...</span> : <span className="badge">{rows.length} materials</span>}
                </div>
                
                <div className="bd">
                    <p style={{ color: 'var(--muted)', marginBottom: 20 }}>
                        Enter the physical counted quantity for all materials. When you click <strong>Save & Adjust All</strong>, 
                        the system will log the counts and automatically adjust any discrepancies (positive variances add inward stock from 'mismatch', negative variances write out to ledger).
                    </p>

                    <div style={{ display: 'flex', gap: 10, marginBottom: 15, alignItems: 'center' }}>
                        <input 
                            type="text" 
                            placeholder="Filter materials..." 
                            value={filterVal}
                            onChange={(e) => setFilterVal(e.target.value)}
                            style={{ flex: 1, maxWidth: 300 }}
                        />
                        <button className="btn" onClick={handleSaveAndAdjust} disabled={submitting || loading || !rowsToProcess.length}>
                            {submitting ? 'Processing...' : `Save & Adjust ${rowsToProcess.length} Items`}
                        </button>
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Material Name</th>
                                    <th style={{ width: 100 }}>Unit</th>
                                    <th style={{ textAlign: 'right', width: 150 }}>System Qty</th>
                                    <th style={{ width: 200 }}>Measured Qty</th>
                                    <th style={{ textAlign: 'right', width: 150 }}>Variance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRows.map(r => {
                                    const measured = r.measured_qty !== '' ? Number(r.measured_qty) : null;
                                    const variance = measured !== null ? (measured - r.system_qty) : null;
                                    
                                    let vColor = 'inherit';
                                    if (variance !== null) {
                                        vColor = variance > 0.0001 ? 'var(--ok)' : variance < -0.0001 ? 'var(--err)' : 'inherit';
                                    }

                                    return (
                                        <tr key={r.id}>
                                            <td>{r.name}</td>
                                            <td>{r.unit}</td>
                                            <td style={{ textAlign: 'right' }}>{r.system_qty.toFixed(2)}</td>
                                            <td>
                                                <input
                                                    type="number"
                                                    placeholder="Physical Qty"
                                                    value={r.measured_qty}
                                                    onChange={e => handleQtyChange(r.id, e.target.value)}
                                                    style={{ width: '100%' }}
                                                />
                                            </td>
                                            <td style={{ textAlign: 'right', color: vColor, fontWeight: 'bold' }}>
                                                {variance !== null ? (variance > 0 ? '+' : '') + variance.toFixed(2) : '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {!loading && filteredRows.length === 0 && (
                                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>No materials found</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
