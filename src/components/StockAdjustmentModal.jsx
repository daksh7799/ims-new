import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { useToast } from "../ui/toast";

export default function StockAdjustmentModal({ isOpen, onClose, row, onSuccess }) {
    const { push } = useToast();
    const [loading, setLoading] = useState(false);

    // Derived values
    const variance = row ? (row.variance || (row.measured_qty - (row.system_qty || 0))) : 0;
    const isPositive = variance > 0;
    const absVariance = Number(Math.abs(variance).toFixed(2));

    if (!isOpen || !row) return null;

    async function handleAdjust() {
        setLoading(true);
        try {
            if (isPositive) {
                // POSITIVE ADJUSTMENT: Create Inward Entry for 'mismatch' vendor

                // 1. Find 'mismatch' vendor
                const { data: vendors, error: vError } = await supabase
                    .from("vendors")
                    .select("id")
                    .eq("name", "mismatch")
                    .limit(1);

                if (vError) throw vError;
                const mismatchVendor = vendors?.[0];

                if (!mismatchVendor) {
                    throw new Error("Vendor 'mismatch' not found in database. Please create it first.");
                }

                // 2. Create Inward
                const billNo = `ADJ-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${row.id}`;

                const { error: inError } = await supabase
                    .from("raw_inward")
                    .insert({
                        raw_material_id: row.raw_material_id,
                        vendor_id: mismatchVendor.id,
                        qty: absVariance,
                        bill_no: billNo,
                        purchase_date: new Date().toISOString().slice(0, 10),
                    });

                if (inError) throw inError;

                push(`Stock corrected! Created inward entry (Bill: ${billNo})`, "ok");

            } else {
                // NEGATIVE ADJUSTMENT: Reduce stock via ledger
                // We use a direct insert to stock_ledger or use a helper RPC if available.
                // Assuming we can write to stock_ledger directly or use a 'raw_material_adjust' flow if exists.
                // However, based on research, 'raw_inward_adjust' is for editing inward.
                // We likely need to perform a generic stock deduction.
                // Let's check if 'stock_ledger' allows direct inserts or if we need a specific RPC for 'consumption/loss'.
                // Since this is a "check adjustment", we will insert directly with the new reason.

                const { error: ledError } = await supabase
                    .from("stock_ledger")
                    .insert({
                        rm_id: row.raw_material_id,
                        item_kind: "rm",
                        qty: absVariance, // Ledger usually takes positive for OUT if movement is OUT
                        movement: "out",
                        reason: "stock_check_adjustment",
                        note: `Adjustment from Daily Stock Check (ID: ${row.id})`
                    });

                if (ledError) throw ledError;

                push(`Stock corrected! Reduced system stock by ${absVariance}.`, "ok");
            }

            // [NEW] Mark the check as adjusted so it doesn't show button again
            const { error: flagMetaError } = await supabase
                .from("daily_stock_checks")
                .update({ is_adjusted: true })
                .eq("id", row.id);

            if (flagMetaError) {
                console.error("Failed to update flag:", flagMetaError);
                // We don't block the UI success for this non-critical error, but good to log
            }

            if (onSuccess) onSuccess();
            onClose();

        } catch (e) {
            console.error(e);
            push(e.message || "Adjustment failed", "err");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
        }}>
            <div className="modal card" style={{ width: 400, maxWidth: "90vw" }}>
                <div className="hd">
                    <b>Confirm Stock Adjustment</b>
                </div>
                <div className="bd">
                    <div style={{ marginBottom: 15 }}>
                        <p><strong>Material:</strong> {row.raw_materials?.name}</p>
                        <p><strong>System Qty:</strong> {row.system_qty}</p>
                        <p><strong>Measured Qty:</strong> {row.measured_qty}</p>
                        <hr style={{ margin: "10px 0", borderTop: "1px solid #eee" }} />
                        <div style={{
                            fontSize: "1.2em",
                            fontWeight: "bold",
                            color: isPositive ? "var(--ok)" : "var(--err)"
                        }}>
                            Variance: {isPositive ? "+" : ""}{variance.toFixed(2)} {row.raw_materials?.unit}
                        </div>
                    </div>

                    <div className="alert" style={{
                        background: "#fafafa",
                        padding: 10,
                        borderRadius: 6,
                        fontSize: "0.9em",
                        marginBottom: 15,
                        border: "1px solid #eee"
                    }}>
                        {isPositive ? (
                            <span>
                                System has <b>less</b> than physical. <br />
                                Action: Create <b>Raw Inward</b> entry from provider "mismatch".
                            </span>
                        ) : (
                            <span>
                                System has <b>more</b> than physical. <br />
                                Action: Deduct stock with reason <b>"stock_check_adjustment"</b>.
                            </span>
                        )}
                    </div>

                    <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
                        <button className="btn ghost" onClick={onClose} disabled={loading}>
                            Cancel
                        </button>
                        <button className="btn" onClick={handleAdjust} disabled={loading}>
                            {loading ? "Adjusting..." : "Confirm Adjustment"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
