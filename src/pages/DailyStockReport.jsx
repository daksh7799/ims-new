// src/pages/DailyStockReport.jsx
import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { useToast } from "../ui/toast.jsx";

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return String(d);
  }
}

export default function DailyStockReport() {
  const { push } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  // filter by raw_materials.last_stock_check_date (optional)
  const todayIso = new Date().toISOString().split("T")[0];
  const [filterLastChecked, setFilterLastChecked] = useState(false);
  const [lastCheckedDate, setLastCheckedDate] = useState(todayIso);

  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        // 1) fetch active raw materials with last_stock_check_date
        const { data: rms, error: rmsErr } = await supabase
          .from("raw_materials")
          .select("id, name, last_stock_check_date")
          .eq("is_active", true)
          .order("name", { ascending: true });

        if (rmsErr) throw rmsErr;
        const rawMaterials = Array.isArray(rms) ? rms : [];

        // 2) apply optional filter by last_stock_check_date (exact YYYY-MM-DD)
        const filteredRMs = filterLastChecked
          ? rawMaterials.filter((rm) => {
              if (!rm.last_stock_check_date) return false;
              const d = new Date(rm.last_stock_check_date).toISOString().split("T")[0];
              return d === lastCheckedDate;
            })
          : rawMaterials;

        const rmIds = filteredRMs.map((r) => r.id);
        if (!rmIds.length) {
          if (!cancelled) setRows([]);
          return;
        }

        // 3) fetch live system qty from v_raw_inventory
        const { data: invRows, error: invErr } = await supabase
          .from("v_raw_inventory")
          .select("rm_id, qty_on_hand")
          .in("rm_id", rmIds);

        if (invErr) throw invErr;

        const systemLiveById = Object.fromEntries(
          (invRows || []).map((r) => [r.rm_id, Number(r.qty_on_hand ?? 0)])
        );

        // 4) fetch daily_stock_checks for these RM ids, ordered by created_at desc
        const { data: checks, error: checksErr } = await supabase
          .from("daily_stock_checks")
          .select("raw_material_id, measured_qty, system_qty, created_at")
          .in("raw_material_id", rmIds)
          .order("created_at", { ascending: false });

        if (checksErr) throw checksErr;

        // 5) reduce to latest per RM (first occurrence because ordered desc)
        const latestById = {};
        for (const c of checks || []) {
          const id = c.raw_material_id;
          if (latestById[id] === undefined) {
            latestById[id] = {
              measured_qty:
                c.measured_qty === null || typeof c.measured_qty === "undefined"
                  ? null
                  : Number(c.measured_qty),
              system_snapshot:
                c.system_qty === null || typeof c.system_qty === "undefined"
                  ? null
                  : Number(c.system_qty),
              created_at: c.created_at,
            };
          }
        }

        // 6) compose final rows
        const final = filteredRMs.map((rm) => {
          const live = typeof systemLiveById[rm.id] !== "undefined" ? systemLiveById[rm.id] : 0;
          const latest = latestById[rm.id] ?? null;
          const measured_latest = latest ? latest.measured_qty : null;
          const system_snapshot = latest ? latest.system_snapshot : null;

          // variance defined only when both measured and snapshot exist
          const variance =
            measured_latest === null || system_snapshot === null
              ? null
              : Number(measured_latest - system_snapshot);

          return {
            id: rm.id,
            name: rm.name,
            system_live: live,
            system_snapshot,
            measured_latest,
            variance,
            last_stock_check_date: rm.last_stock_check_date,
            snapshot_checked_at: latest ? latest.created_at : null,
          };
        });

        if (!cancelled) setRows(final);
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
  }, [filterLastChecked, lastCheckedDate, tick, push]);

  return (
    <div className="grid">
      <div className="card">
        <div className="hd" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <b>Daily Stock — Snapshot vs Live</b>
          <span className="badge">{rows.length} materials</span>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
              <input
                type="checkbox"
                checked={filterLastChecked}
                onChange={(e) => setFilterLastChecked(e.target.checked)}
              />
              Filter by Last Checked
            </label>

            <input
              type="date"
              value={lastCheckedDate}
              disabled={!filterLastChecked}
              onChange={(e) => setLastCheckedDate(e.target.value)}
            />

            <button className="btn" onClick={() => setTick((t) => t + 1)} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="bd" style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Raw Material</th>
                <th style={{ textAlign: "right" }}>System (live)</th>
                <th style={{ textAlign: "right" }}>System (snapshot)</th>
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
                    : r.variance < 0
                    ? "var(--err)"
                    : "var(--ok)";

                return (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td style={{ textAlign: "right" }}>{Number(r.system_live ?? 0).toFixed(2)}</td>
                    <td style={{ textAlign: "right" }}>
                      {r.system_snapshot === null ? "—" : Number(r.system_snapshot).toFixed(2)}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>
                      {r.measured_latest === null ? "—" : Number(r.measured_latest).toFixed(2)}
                    </td>
                    <td style={{ textAlign: "right", color, fontWeight: 600 }}>
                      {r.variance === null ? "—" : `${r.variance > 0 ? "+" : ""}${r.variance.toFixed(2)}`}
                    </td>
                    <td>{r.last_stock_check_date ? fmtDate(r.last_stock_check_date) : "—"}</td>
                  </tr>
                );
              })}

              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", color: "var(--muted)" }}>
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
