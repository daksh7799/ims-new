import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { downloadCSV } from "../utils/csv";

export default function FGInventory() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [minQty, setMinQty] = useState("");
  const [maxQty, setMaxQty] = useState("");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("v_fg_inventory")
      .select("*")
      .order("finished_good_name");
    if (error) {
      alert(error.message);
      setLoading(false);
      return;
    }
    setRows(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const min = minQty === "" ? -Infinity : Number(minQty);
    const max = maxQty === "" ? Infinity : Number(maxQty);
    return (rows || []).filter((r) => {
      const matchQ =
        !qq ||
        String(r.finished_good_name || "").toLowerCase().includes(qq);
      const qty = Number(r.qty_on_hand || 0);
      return matchQ && qty >= min && qty <= max;
    });
  }, [rows, q, minQty, maxQty]);

  function exportCSV() {
    downloadCSV(
      "fg_inventory.csv",
      filtered.map((r) => ({
        id: r.finished_good_id,
        finished_good_name: r.finished_good_name,
        qty_on_hand: r.qty_on_hand,
      }))
    );
  }

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Finished Goods Inventory</b>
        </div>

        <div className="bd">
          <div className="row" style={{ marginBottom: 10 }}>
            <input
              placeholder="Search item name…"
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

          <table className="table">
            <thead>
              <tr>
                <th>Finished Good</th>
                <th style={{ textAlign: "right" }}>On Hand</th>
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
