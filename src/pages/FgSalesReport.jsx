import { useEffect, useState, useMemo } from "react";
import { supabase } from "../supabaseClient";
import { format, subDays, startOfDay } from "date-fns";

export default function FgSalesReport() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterDays, setFilterDays] = useState(0); // 0 = today, 3,7,15,30
  const [error, setError] = useState("");

  const filters = [
    { label: "Today", days: 0 },
    { label: "Last 3 Days", days: 3 },
    { label: "Last 7 Days", days: 7 },
    { label: "Last 15 Days", days: 15 },
    { label: "Last 30 Days", days: 30 },
  ];

  async function load() {
    try {
      setLoading(true);
      setError("");

      // ✅ Compute date filter
      let fromDate = startOfDay(new Date());
      if (filterDays > 0) fromDate = subDays(fromDate, filterDays);
      const isoFrom = fromDate.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from("v_fg_sales_summary")
        .select("finished_good_name, qty_shipped, sale_date")
        .gte("sale_date", isoFrom);

      if (error) throw error;

      // ✅ Aggregate totals by Finished Good
      const totals = {};
      (data || []).forEach((r) => {
        const key = r.finished_good_name || "—";
        totals[key] = (totals[key] || 0) + Number(r.qty_shipped || 0);
      });

      const grouped = Object.entries(totals).map(([finished_good_name, qty]) => ({
        finished_good_name,
        qty_shipped: qty,
      }));

      setRows(grouped);
    } catch (err) {
      console.error("load", err);
      setError(err.message || "Error loading data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [filterDays]);

  const totalQty = useMemo(
    () => rows.reduce((sum, r) => sum + Number(r.qty_shipped || 0), 0),
    [rows]
  );

  function handlePrint() {
    window.print();
  }

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Finished Goods Sales Report</b>
          <div className="row" style={{ gap: 8 }}>
            {filters.map((f) => (
              <button
                key={f.days}
                className={`btn small ${
                  filterDays === f.days ? "" : "outline"
                }`}
                onClick={() => setFilterDays(f.days)}
              >
                {f.label}
              </button>
            ))}
            <button className="btn ghost" onClick={load} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button className="btn outline small" onClick={handlePrint}>
              🖨 Print
            </button>
          </div>
        </div>

        <div className="bd" style={{ overflow: "auto" }}>
          {error && (
            <div style={{ color: "var(--err)", marginBottom: 8 }}>{error}</div>
          )}
          <table className="table">
            <thead>
              <tr>
                <th>Finished Good</th>
                <th style={{ textAlign: "right" }}>Qty Shipped</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan="2" style={{ color: "var(--muted)" }}>
                    No data found
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.finished_good_name}</td>
                  <td style={{ textAlign: "right" }}>{r.qty_shipped}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length > 0 && (
          <div className="ft row" style={{ justifyContent: "space-between" }}>
            <span>
              Showing {rows.length} records (Total Qty: {totalQty})
            </span>
            <span className="s">
              Updated at {format(new Date(), "dd-MMM-yyyy hh:mm a")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
