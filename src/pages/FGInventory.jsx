import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { downloadCSV } from "../utils/csv";

export default function FGInventory() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [minQty, setMinQty] = useState("");
  const [maxQty, setMaxQty] = useState("");

<<<<<<< HEAD
  // === Load Data
=======
>>>>>>> 3d382cf (Updated LiveBarcodes, archive cron jobs, and UI improvements)
  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("v_fg_inventory")
      .select("*")
      .order("finished_good_name");
<<<<<<< HEAD

=======
>>>>>>> 3d382cf (Updated LiveBarcodes, archive cron jobs, and UI improvements)
    if (error) {
      alert(error.message);
      setLoading(false);
      return;
    }
<<<<<<< HEAD

=======
>>>>>>> 3d382cf (Updated LiveBarcodes, archive cron jobs, and UI improvements)
    setRows(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

<<<<<<< HEAD
  // === Filter Logic
=======
>>>>>>> 3d382cf (Updated LiveBarcodes, archive cron jobs, and UI improvements)
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const min = minQty === "" ? -Infinity : Number(minQty);
    const max = maxQty === "" ? Infinity : Number(maxQty);
    return (rows || []).filter((r) => {
      const matchQ =
        !qq ||
<<<<<<< HEAD
        String(r.finished_good_name || "").toLowerCase().includes(qq) ||
        String(r.unit || "").toLowerCase().includes(qq);
=======
        String(r.finished_good_name || "").toLowerCase().includes(qq);
>>>>>>> 3d382cf (Updated LiveBarcodes, archive cron jobs, and UI improvements)
      const qty = Number(r.qty_on_hand || 0);
      return matchQ && qty >= min && qty <= max;
    });
  }, [rows, q, minQty, maxQty]);

<<<<<<< HEAD
  // === Low stock count
  const lowCount = filtered.filter(
    (r) => r.low_threshold && Number(r.qty_on_hand) <= Number(r.low_threshold)
  ).length;

  // === Export CSV
=======
>>>>>>> 3d382cf (Updated LiveBarcodes, archive cron jobs, and UI improvements)
  function exportCSV() {
    downloadCSV(
      "fg_inventory.csv",
      filtered.map((r) => ({
        id: r.finished_good_id,
<<<<<<< HEAD
        name: r.finished_good_name,
        qty_on_hand: r.qty_on_hand,
        unit: r.unit || "",
        low_threshold: r.low_threshold || "",
=======
        finished_good_name: r.finished_good_name,
        qty_on_hand: r.qty_on_hand,
>>>>>>> 3d382cf (Updated LiveBarcodes, archive cron jobs, and UI improvements)
      }))
    );
  }

<<<<<<< HEAD
  // === UI
=======
>>>>>>> 3d382cf (Updated LiveBarcodes, archive cron jobs, and UI improvements)
  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Finished Goods Inventory</b>
        </div>

        <div className="bd">
<<<<<<< HEAD
          {/* 🔍 Filters */}
          <div className="row" style={{ marginBottom: 10, flexWrap: "wrap" }}>
            <input
              placeholder="Search FG name / unit…"
=======
          <div className="row" style={{ marginBottom: 10 }}>
            <input
              placeholder="Search item name…"
>>>>>>> 3d382cf (Updated LiveBarcodes, archive cron jobs, and UI improvements)
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <input
              type="number"
              placeholder="Min qty"
              value={minQty}
              onChange={(e) => setMinQty(e.target.value)}
              style={{ width: 110 }}
            />
            <input
              type="number"
              placeholder="Max qty"
              value={maxQty}
              onChange={(e) => setMaxQty(e.target.value)}
              style={{ width: 110 }}
            />
            <button
              className="btn ghost"
              onClick={load}
              disabled={loading}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button
              className="btn"
              onClick={exportCSV}
              disabled={!filtered.length}
            >
              Export CSV
            </button>
          </div>

<<<<<<< HEAD
          {/* Counts */}
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="badge">Items: {filtered.length}</span>
            <span className="badge">Low: {lowCount}</span>
          </div>

          {/* 📦 Table */}
=======
>>>>>>> 3d382cf (Updated LiveBarcodes, archive cron jobs, and UI improvements)
          <table className="table">
            <thead>
              <tr>
                <th>Finished Good</th>
                <th style={{ textAlign: "right" }}>On Hand</th>
<<<<<<< HEAD
                <th style={{ textAlign: "right" }}>Threshold</th>
                <th>Unit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const qty = Number(r.qty_on_hand || 0);
                const thr = Number(r.low_threshold || 0);
                const low = thr > 0 && qty <= thr;
                return (
                  <tr key={`fg-${r.finished_good_id}`}>
                    <td>{r.finished_good_name}</td>
                    <td
                      style={{
                        textAlign: "right",
                        fontWeight: 700,
                      }}
                    >
                      {qty}
                    </td>
                    <td style={{ textAlign: "right" }}>{thr || "-"}</td>
                    <td>{r.unit || "-"}</td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          borderColor: low ? "var(--err)" : "var(--border)",
                          color: low ? "var(--err)" : "var(--muted)",
                        }}
                      >
                        {low ? "Low" : "OK"}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: "var(--muted)" }}>
=======
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.finished_good_id}>
                  <td>{r.finished_good_name}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>
                    {r.qty_on_hand}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={2} style={{ color: "var(--muted)" }}>
>>>>>>> 3d382cf (Updated LiveBarcodes, archive cron jobs, and UI improvements)
                    No items found
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
