import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { useToast } from "../ui/toast.jsx";

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

export default function DailyStockReport() {
  const { push } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      try {
        // 1️⃣ Fetch all RAW MATERIALS with system qty from view
        const { data: invRows, error: invErr } = await supabase
          .from("v_raw_inventory")
          .select("rm_id, raw_material_name, qty_on_hand, unit, is_active")
          .eq("is_active", true);

        if (invErr) throw invErr;

        // Build system qty map → rm_id → qty_on_hand
        const systemById = {};
        invRows.forEach((r) => {
          systemById[r.rm_id] = Number(r.qty_on_hand || 0);
        });

        // 2️⃣ Fetch today's daily stock entries
        const today = new Date().toISOString().split("T")[0];

        const { data: todayChecks, error: checkErr } = await supabase
          .from("daily_stock_checks")
          .select("raw_material_id, measured_qty")
          .eq("check_date", today);

        if (checkErr) throw checkErr;

        const measuredById = {};
        (todayChecks || []).forEach((r) => {
          measuredById[r.raw_material_id] = Number(r.measured_qty || 0);
        });

        // 3️⃣ Merge data → full RM list + today's measurements
        const finalRows = invRows.map((rm) => {
          const measured = measuredById[rm.rm_id] ?? null;
          const system = systemById[rm.rm_id] ?? 0;

          return {
            rm_id: rm.rm_id,
            name: rm.raw_material_name,
            unit: rm.unit,
            system_qty: system,
            measured_qty: measured,
            variance:
              measured === null
                ? null
                : Number(measured - system),
          };
        });

        if (!cancelled) setRows(finalRows);
      } catch (e) {
        console.error(e);
        if (!cancelled) push(e.message || String(e), "err");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [push]);

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Daily Stock Report (Today)</b>
          <span className="badge">{rows.length} Materials</span>
        </div>

        <div className="bd" style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Raw Material</th>
                <th style={{ textAlign: "right" }}>System</th>
                <th style={{ textAlign: "right" }}>Measured</th>
                <th style={{ textAlign: "right" }}>Variance</th>
                <th>Unit</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((r) => {
                const color =
                  r.variance === null
                    ? "var(--muted)"
                    : r.variance === 0
                    ? "var(--muted)"
                    : r.variance < 0
                    ? "var(--err)"
                    : "var(--ok)";

                return (
                  <tr key={r.rm_id}>
                    <td>{r.name}</td>

                    {/* System Qty */}
                    <td style={{ textAlign: "right" }}>
                      {Number(r.system_qty).toFixed(2)}
                    </td>

                    {/* Measured Qty */}
                    <td style={{ textAlign: "right", fontWeight: 600 }}>
                      {r.measured_qty === null
                        ? "—"
                        : Number(r.measured_qty).toFixed(2)}
                    </td>

                    {/* Variance */}
                    <td
                      style={{
                        textAlign: "right",
                        color: color,
                        fontWeight: 600,
                      }}
                    >
                      {r.variance === null
                        ? "—"
                        : `${r.variance > 0 ? "+" : ""}${r.variance.toFixed(2)}`}
                    </td>

                    <td>{r.unit}</td>
                  </tr>
                );
              })}

              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: "var(--muted)" }}>
                    {loading ? "Loading..." : "No data"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
