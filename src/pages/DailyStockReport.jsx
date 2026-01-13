import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { useToast } from "../ui/toast.jsx";
import StockAdjustmentModal from "../components/StockAdjustmentModal";

/* -------------------------------------------------
   Helpers
------------------------------------------------- */
function fmtDateTime(d) {
    if (!d) return "—";
    try {
        return new Date(d).toLocaleString();
    } catch {
        return String(d);
    }
}

export default function DailyStockReport() {
    const { push } = useToast();

    const todayIso = new Date().toISOString().split("T")[0];

    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [adjustRow, setAdjustRow] = useState(null);

    const [filterByDate, setFilterByDate] = useState(false);
    const [selectedDate, setSelectedDate] = useState(todayIso);
    const [refreshKey, setRefreshKey] = useState(0);

    /* -------------------------------------------------
       Main Loader
    ------------------------------------------------- */
    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            /* 1️⃣ Active raw materials */
            const { data: rms, error: rmErr } = await supabase
                .from("raw_materials")
                .select("id, name, unit")
                .eq("is_active", true)
                .order("name");

            if (rmErr) throw rmErr;
            if (!rms?.length) {
                setRows([]);
                return;
            }

            const rmIds = rms.map(r => r.id);

            /* 2️⃣ Live inventory */
            const { data: inv, error: invErr } = await supabase
                .from("v_raw_inventory")
                .select("rm_id, qty_on_hand")
                .in("rm_id", rmIds);

            if (invErr) throw invErr;

            const liveQty = {};
            for (const r of inv || []) {
                liveQty[r.rm_id] = Number(r.qty_on_hand ?? 0);
            }

            /* 3️⃣ Latest stock checks (optional date filter) */
            let checksQuery = supabase
                .from("v_latest_stock_checks")
                .select(
                    "id, raw_material_id, measured_qty, system_qty, created_at, is_adjusted"
                )
                .in("raw_material_id", rmIds);

            if (filterByDate) {
                checksQuery = checksQuery
                    .gte("created_at", `${selectedDate}T00:00:00`)
                    .lte("created_at", `${selectedDate}T23:59:59`);
            }

            const { data: checks, error: chkErr } = await checksQuery;
            if (chkErr) throw chkErr;

            /* 4️⃣ Reduce to latest check per RM */
            const latestByRm = {};
            for (const c of checks || []) {
                if (!latestByRm[c.raw_material_id]) {
                    latestByRm[c.raw_material_id] = c;
                }
            }

            /* 5️⃣ Build final rows */
            const result = [];

            for (const rm of rms) {
                const chk = latestByRm[rm.id];
                if (filterByDate && !chk) continue;

                const measured = chk?.measured_qty ?? null;
                const snapshot = chk?.system_qty ?? null;

                result.push({
                    id: rm.id,
                    name: rm.name,
                    unit: rm.unit,
                    system_live: liveQty[rm.id] ?? 0,
                    system_snapshot: snapshot,
                    measured_latest: measured,
                    variance:
                        measured !== null && snapshot !== null
                            ? Number(measured) - Number(snapshot)
                            : null,
                    last_checked_at: chk?.created_at ?? null,
                    check_id: chk?.id ?? null,
                    is_adjusted: chk?.is_adjusted ?? false
                });
            }

            setRows(result);
        } catch (e) {
            console.error(e);
            push(e.message || "Failed to load stock report", "err");
        } finally {
            setLoading(false);
        }
    }, [filterByDate, selectedDate, push]);

    useEffect(() => {
        loadData();
    }, [loadData, refreshKey]);

    /* -------------------------------------------------
       Render
    ------------------------------------------------- */
    return (
        <div className="grid">
            <div className="card">
                <div className="hd" style={{ display: "flex", gap: 12 }}>
                    <b>Daily Stock — Snapshot vs Live</b>
                    <span className="badge">{rows.length}</span>

                    <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                        <label style={{ display: "flex", gap: 6 }}>
                            <input
                                type="checkbox"
                                checked={filterByDate}
                                onChange={e => setFilterByDate(e.target.checked)}
                            />
                            Filter by Date
                        </label>

                        <input
                            type="date"
                            value={selectedDate}
                            disabled={!filterByDate}
                            onChange={e => setSelectedDate(e.target.value)}
                        />

                        <button
                            className="btn"
                            disabled={loading}
                            onClick={() => setRefreshKey(k => k + 1)}
                        >
                            {loading ? "Loading…" : "Refresh"}
                        </button>
                    </div>
                </div>

                <div className="bd" style={{ overflow: "auto" }}>
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Raw Material</th>
                                <th style={{ textAlign: "right" }}>System (Live)</th>
                                <th style={{ textAlign: "right" }}>System (Snapshot)</th>
                                <th style={{ textAlign: "right" }}>Measured</th>
                                <th style={{ textAlign: "right" }}>Variance</th>
                                <th>Last Checked</th>
                                <th>Action</th>
                            </tr>
                        </thead>

                        <tbody>
                            {rows.map(r => {
                                const hasVariance =
                                    r.variance !== null &&
                                    Math.abs(r.variance) > 0.0001;

                                return (
                                    <tr key={r.id}>
                                        <td>
                                            {r.name}
                                            {r.unit && (
                                                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                                                    {" "}({r.unit})
                                                </span>
                                            )}
                                        </td>

                                        <td style={{ textAlign: "right" }}>
                                            {r.system_live.toFixed(2)}
                                        </td>

                                        <td style={{ textAlign: "right" }}>
                                            {r.system_snapshot === null
                                                ? "—"
                                                : r.system_snapshot.toFixed(2)}
                                        </td>

                                        <td style={{ textAlign: "right", fontWeight: 600 }}>
                                            {r.measured_latest === null
                                                ? "—"
                                                : r.measured_latest.toFixed(2)}
                                        </td>

                                        <td
                                            style={{
                                                textAlign: "right",
                                                fontWeight: 600,
                                                color:
                                                    r.variance === null
                                                        ? "var(--muted)"
                                                        : r.variance < 0
                                                            ? "var(--err)"
                                                            : "var(--ok)"
                                            }}
                                        >
                                            {r.variance === null
                                                ? "—"
                                                : `${r.variance > 0 ? "+" : ""}${r.variance.toFixed(2)}`}
                                        </td>

                                        <td>
                                            {fmtDateTime(r.last_checked_at)}
                                        </td>

                                        <td>
                                            {hasVariance && r.check_id && !r.is_adjusted && (
                                                <button
                                                    className="btn small outline"
                                                    onClick={() =>
                                                        setAdjustRow({
                                                            id: r.check_id,
                                                            raw_material_id: r.id,
                                                            variance: r.variance,
                                                            measured_qty: r.measured_latest,
                                                            system_qty: r.system_snapshot,
                                                            raw_materials: {
                                                                name: r.name,
                                                                unit: r.unit
                                                            }
                                                        })
                                                    }
                                                >
                                                    Adjust
                                                </button>
                                            )}

                                            {r.is_adjusted && (
                                                <span className="badge success">
                                                    Adjusted
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}

                            {!rows.length && (
                                <tr>
                                    <td colSpan={7} style={{ textAlign: "center", color: "var(--muted)" }}>
                                        {loading ? "Loading…" : "No data"}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <StockAdjustmentModal
                isOpen={!!adjustRow}
                row={adjustRow}
                onClose={() => setAdjustRow(null)}
                onSuccess={() => {
                    setAdjustRow(null);
                    setRefreshKey(k => k + 1);
                }}
            />
        </div>
    );
}
