// src/pages/DailyStockReport.jsx
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

  // Control for optional filtering by last_stock_check_date
  const todayIso = new Date().toISOString().split("T")[0];
  const [filterLastChecked, setFilterLastChecked] = useState(false);
  const [lastCheckedDate, setLastCheckedDate] = useState(todayIso);

  // manual refresh
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        // 1) Fetch active raw_materials with needed fields
        const { data: rms, error: rmsErr } = await supabase
          .from("raw_materials")
          .select("id, name, unit, is_active, last_stock_check_date")
          .eq("is_active", true)
          .order("name", { ascending: true });

        if (rmsErr) throw rmsErr;
        const rawMaterials = rms || [];

        // If filtering by last checked date is enabled, filter here (exact date match)
        const filteredRMs = filterLastChecked
          ? rawMaterials.filter((rm) => {
              if (!rm.last_stock_check_date) return false;
              // compare YYYY-MM-DD
              const d = new Date(rm.last_stock_check_date).toISOString().split("T")[0];
              return d === lastCheckedDate;
            })
          : rawMaterials;

        const rmIds = filteredRMs.map((r) => r.id);

        // 2) Fetch system qty from v_raw_inventory for those RM ids
        let systemById = {};
        if (rmIds.length) {
          const { data: invRows, error: invErr } = await supabase
            .from("v_raw_inventory")
            .select("rm_id, qty_on_hand")
            .in("rm_id", rmIds);

          if (invErr) throw invErr;

          systemById = Object.fromEntries(
            (invRows || []).map((r) => [r.rm_id, Number(r.qty_on_hand || 0)])
          );
        }

        // 3) Fetch latest measured_qty per RM (we pull recent checks and pick latest per RM)
        let measuredById = {};
        if (rmIds.length) {
          // fetch recent checks for these RM ids ordered by created_at desc
          const { data: checks, error: checksErr } = await supabase
            .from("daily_stock_checks")
            .select("raw_material_id, measured_qty, created_at")
            .in("raw_material_id", rmIds)
            .order("created_at", { ascending: false });

          if (checksErr) throw checksErr;

          // pick the first occurrence (latest) per raw_material_id
          for (const c of checks || []) {
            const key = c.raw_material_id;
            if (measuredById[key] === undefined) {
              measuredById[key] = Number(c.measured_qty ?? 0);
            }
          }
        }

        // 4) Merge into rows (one per filtered raw material)
        const merged = filteredRMs.map((rm) => {
          const systemQty =
            typeof systemById[rm.id] !== "undefined" ? systemById[rm.id] : 0;
          const measured =
            typeof measuredById[rm.id] !== "undefined" ? measuredById[rm.id] : null;
          const variance = measured === null ? null : Number(measured - systemQty);

          return {
            id: rm.id,
            name: rm.name,
            unit: rm.unit,
            last_stock_check_date: rm.last_stock_check_date,
            system_qty: systemQty,
            measured_qty: measured,
            variance,
          };
        });

        if (!cancelled) setRows(merged);
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
    // refresh whenever date/filter/refreshTick changes
  }, [filterLastChecked, lastCheckedDate, refreshTick, push]);

  return (
    <div className="grid">
      <div className="card">
        <div className="hd" style={{ alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <b>Daily Stock Report</b>
            <span className="badge">{rows.length} materials</span>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <label className="s" style={{ display: "flex", gap: 8, alignItems: "center", margin: 0 }}>
              <input
                type="checkbox"
                checked={filterLastChecked}
                onChange={(e) => setFilterLastChecked(e.target.checked)}
              />
              Filter by Last Checked:
            </label>

            <input
              type="date"
              value={lastCheckedDate}
              onChange={(e) => setLastCheckedDate(e.target.value)}
              disabled={!filterLastChecked}
            />

            <button className="btn" onClick={() => setRefreshTick((t) => t + 1)} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="bd" style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Raw Material</th>
                <th style={{ textAlign: "right" }}>System</th>
                <th style={{ textAlign: "right" }}>Measured (latest)</th>
                <th style={{ textAlign: "right" }}>Variance</th>
                <th>Last Checked</th>
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
                  <tr key={r.id}>
                    <td>{r.name}</td>

                    <td style={{ textAlign: "right" }}>
                      {Number(r.system_qty || 0).toFixed(2)}
                    </td>

                    <td style={{ textAlign: "right", fontWeight: 600 }}>
                      {r.measured_qty === null ? "—" : Number(r.measured_qty).toFixed(2)}
                    </td>

                    <td style={{ textAlign: "right", color, fontWeight: 600 }}>
                      {r.variance === null
                        ? "—"
                        : `${r.variance > 0 ? "+" : ""}${Number(r.variance).toFixed(2)}`}
                    </td>

                    <td>{r.last_stock_check_date ? fmtDate(r.last_stock_check_date) : "—"}</td>
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
