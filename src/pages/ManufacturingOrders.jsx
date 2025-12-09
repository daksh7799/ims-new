import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { useToast } from "../ui/toast";
import { useNavigate } from "react-router-dom";

export default function ManufacturingOrders() {
    const { push } = useToast();
    const navigate = useNavigate();

    // State
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedMO, setSelectedMO] = useState(null); // Full details of selected MO
    const [loadingMO, setLoadingMO] = useState(false);
    const [lines, setLines] = useState([]); // Lines for selected MO
    const [checkingStock, setCheckingStock] = useState(false);
    const [manufacturing, setManufacturing] = useState(false);
    const [selectedLines, setSelectedLines] = useState(new Set());

    // Initial load
    useEffect(() => {
        fetchOrders();
    }, []);

    async function fetchOrders() {
        setLoading(true);
        try {
            const { data, error } = await supabase.from("v_manufacturing_orders").select("*");
            if (error) throw error;
            setOrders(data || []);

            // If currently selected MO is gone (auto-deleted), clear selection
            if (selectedMO && data && !data.find(o => o.id === selectedMO.id)) {
                setSelectedMO(null);
                push("Order completed and removed", "ok");
            }
        } catch (err) {
            console.error(err);
            push("Failed to load orders", "err");
        } finally {
            setLoading(false);
        }
    }

    async function selectOrder(mo) {
        setSelectedMO(mo);
        setLoadingMO(true);
        setLines([]);
        setSelectedLines(new Set()); // Reset selection

        try {
            // 1. Fetch lines
            const { data, error } = await supabase
                .from("v_manufacturing_order_lines")
                .select("*")
                .eq("mo_id", mo.id);

            if (error) throw error;

            let fetchedLines = data || [];

            // 2. Check stock for each line
            setCheckingStock(true);
            const checkedLines = await Promise.all(fetchedLines.map(async (line) => {
                const { data: stockInfo } = await supabase.rpc("check_mo_line_stock", { p_line_id: line.id });
                return {
                    ...line,
                    can_manufacture: stockInfo?.can_manufacture || false,
                    stock_details: stockInfo?.insufficient_materials || []
                };
            }));

            setLines(checkedLines);
        } catch (err) {
            console.error(err);
            push("Failed to load order details", "err");
        } finally {
            setLoadingMO(false);
            setCheckingStock(false);
        }
    }

    function toggleLineSelection(id) {
        const next = new Set(selectedLines);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedLines(next);
    }

    function selectAllAvailable() {
        const available = lines.filter(l => l.can_manufacture).map(l => l.id);
        setSelectedLines(new Set(available));
    }

    async function manufactureSelected() {
        if (selectedLines.size === 0) return;

        setManufacturing(true);
        try {
            const lineIds = Array.from(selectedLines);
            const { data, error } = await supabase.rpc("manufacture_mo_lines", { p_line_ids: lineIds });

            if (error) throw error;

            const succeeded = data.succeeded || 0;
            const failed = data.failed || 0;

            if (succeeded > 0) {
                push(`Successfully manufactured ${succeeded} items!`, "ok");
            }
            if (failed > 0) {
                push(`Failed to manufacture ${failed} items`, "warn");
            }

            // Refresh everything
            await fetchOrders();
            if (selectedMO) {
                // If MO still exists (didn't auto-delete), refresh details
                // We verify existence by checking if it's in the fresh orders list
                // But fetchOrders is async, so we'll just try to reload details
                // If it fails (deleted), UI will handle it
                const { data: exists } = await supabase.from("manufacturing_orders").select("id").eq("id", selectedMO.id).single();
                if (exists) {
                    selectOrder(selectedMO);
                } else {
                    setSelectedMO(null); // Auto-redirect logic
                    push("Order completed and auto-deleted!", "ok");
                }
            }

        } catch (err) {
            console.error(err);
            push("Manufacturing failed: " + err.message, "err");
        } finally {
            setManufacturing(false);
        }
    }

    async function deleteOrder(id) {
        if (!confirm("Are you sure you want to delete this pending order? This cannot be undone.")) return;

        try {
            const { error } = await supabase.from("manufacturing_orders").delete().eq("id", id);
            if (error) throw error;
            push("Order deleted", "ok");
            setSelectedMO(null);
            fetchOrders();
        } catch (err) {
            console.error(err);
            push("Failed to delete order", "err");
        }
    }

    // --- Render ---

    if (loading) return <div className="p-4">Loading orders...</div>;

    return (
        <div className="grid">
            {/* Sidebar List */}
            <div className="card" style={{ alignSelf: "start" }}>
                <div className="hd">
                    <b>Pending Orders</b>
                    <button className="btn ghost small" onClick={fetchOrders}>↻</button>
                </div>
                <div className="bd p-0">
                    {orders.length === 0 ? (
                        <div className="p-4 text-muted">No pending orders</div>
                    ) : (
                        <div className="list">
                            {orders.map(o => (
                                <div
                                    key={o.id}
                                    className={`item ${selectedMO?.id === o.id ? 'active' : ''}`}
                                    onClick={() => selectOrder(o)}
                                    style={{ cursor: "pointer", padding: "12px", borderBottom: "1px solid var(--border)" }}
                                >
                                    <div className="row justify-between">
                                        <b>#{o.id}</b>
                                        <span className="badge">{o.pending_items} pending</span>
                                    </div>
                                    <div className="text-sm text-muted mt-1">
                                        {new Date(o.created_at).toLocaleString()}
                                    </div>
                                    {o.note && <div className="text-sm mt-1 truncate">{o.note}</div>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Main Content */}
            <div className="card" style={{ flex: 2 }}>
                {!selectedMO ? (
                    <div className="bd p-8 text-center text-muted">
                        Select an order to view details
                    </div>
                ) : (
                    <>
                        <div className="hd">
                            <div>
                                <b>Order #{selectedMO.id} details</b>
                                <div className="text-sm text-muted">{selectedMO.note}</div>
                            </div>
                            <div className="row">
                                <button className="btn outline dangerous" onClick={() => deleteOrder(selectedMO.id)}>Delete MO</button>
                            </div>
                        </div>

                        {loadingMO ? (
                            <div className="bd">Loading details...</div>
                        ) : (
                            <div className="bd">
                                <div className="row mb-4">
                                    <button
                                        className="btn"
                                        onClick={manufactureSelected}
                                        disabled={manufacturing || selectedLines.size === 0}
                                    >
                                        {manufacturing ? "Manufacturing..." : `Manufacture Selected (${selectedLines.size})`}
                                    </button>
                                    <button
                                        className="btn ghost"
                                        onClick={selectAllAvailable}
                                        disabled={manufacturing}
                                    >
                                        Select All Available
                                    </button>
                                </div>

                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: 40 }}>
                                                <input
                                                    type="checkbox"
                                                    onChange={(e) => {
                                                        if (e.target.checked) setSelectedLines(new Set(lines.map(l => l.id)));
                                                        else setSelectedLines(new Set());
                                                    }}
                                                    checked={lines.length > 0 && selectedLines.size === lines.length}
                                                />
                                            </th>
                                            <th>Item</th>
                                            <th>Qty</th>
                                            <th>Stock status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {lines.map(line => (
                                            <tr key={line.id} style={{ opacity: line.can_manufacture ? 1 : 0.7 }}>
                                                <td>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedLines.has(line.id)}
                                                        onChange={() => toggleLineSelection(line.id)}
                                                        disabled={manufacturing}
                                                    />
                                                </td>
                                                <td>
                                                    <div>{line.finished_good_name}</div>
                                                    {!line.can_manufacture && line.stock_details?.length > 0 && (
                                                        <div className="text-xs text-danger mt-1">
                                                            Missing: {line.stock_details.map(d => `${d.material} (${Number(d.short).toFixed(2)} kg)`).join(", ")}
                                                        </div>
                                                    )}
                                                </td>
                                                <td>{line.qty_requested}</td>
                                                <td>
                                                    {line.can_manufacture ? (
                                                        <span className="badge success">Available</span>
                                                    ) : (
                                                        <span className="badge danger">Insufficient</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
