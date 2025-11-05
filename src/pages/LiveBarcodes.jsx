import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { downloadCSV } from "../utils/csv";
import { useNavigate } from "react-router-dom";

// Format date/time to local (IST)
function fmtDate(d) {
  if (!d) return "—";
  const t = typeof d === "string" ? Date.parse(d) : d;
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString(); // auto local time (IST in browser)
}

const PAGE_SIZE = 1000; // ✅ Show 1000 per page

export default function LiveBarcodes() {
  const [rows, setRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [q, setQ] = useState("");
  const [onlyNoBarcode, setOnlyNoBarcode] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const navigate = useNavigate();

  /** -------------------- LOAD -------------------- **/
  async function load() {
    setLoading(true);
    setErr("");
    try {
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      // get total count first
      const { count } = await supabase
        .from("v_live_barcodes_enriched")
        .select("*", { count: "exact", head: true })
        .in("status", ["available", "returned"]);

      setTotalCount(count || 0);

      // fetch actual page slice
      const { data, error } = await supabase
        .from("v_live_barcodes_enriched")
        .select("*")
        .in("status", ["available", "returned"])
        .order("id", { ascending: false })
        .range(from, to);

      if (error) {
        console.error(error);
        setErr(error.message || String(error));
        setRows([]);
      } else {
        setRows(data || []);
      }
    } catch (e) {
      console.error(e);
      setErr(String(e));
      setRows([]);
    } finally {
      setLoading(false);
      setSelected(new Set());
    }
  }

  /** -------------------- REALTIME + REFRESH -------------------- **/
  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000); // auto refresh every 30s

    const c1 = supabase
      .channel("rt:packets")
      .on("postgres_changes", { event: "*", schema: "public", table: "packets" }, load)
      .subscribe();

    const c2 = supabase
      .channel("rt:ledger")
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_ledger" }, load)
      .subscribe();

    return () => {
      clearInterval(timer);
      try { supabase.removeChannel(c1); } catch {}
      try { supabase.removeChannel(c2); } catch {}
    };
  }, [page]);

  /** -------------------- FILTERING -------------------- **/
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();

    return (rows || []).filter((r) => {
      if (onlyNoBarcode && !r.is_no_barcode_return) return false;

      const pd = r.produced_at ? new Date(r.produced_at) : null;

      // ✅ Date-time filtering accurate to seconds
      if (fromDate) {
        const f = new Date(fromDate);
        if (!pd || pd < f) return false;
      }
      if (toDate) {
        const t = new Date(toDate);
        // include up to the exact second
        if (!pd || pd > t) return false;
      }

      return (
        !qq ||
        r.packet_code?.toLowerCase().includes(qq) ||
        (r.finished_good_name || "").toLowerCase().includes(qq) ||
        (r.bin_code || "").toLowerCase().includes(qq)
      );
    });
  }, [rows, q, onlyNoBarcode, fromDate, toDate]);

  /** -------------------- SELECTION -------------------- **/
  const allVisibleSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.packet_code));
  const someVisibleSelected =
    filtered.some((r) => selected.has(r.packet_code)) && !allVisibleSelected;

  function toggleRow(code, checked) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  function toggleVisible(checked) {
    const next = new Set(selected);
    if (checked) filtered.forEach((r) => next.add(r.packet_code));
    else filtered.forEach((r) => next.delete(r.packet_code));
    setSelected(next);
  }

  /** -------------------- CLEAR FILTER -------------------- **/
  function clearFilters() {
    setQ("");
    setFromDate("");
    setToDate("");
    setOnlyNoBarcode(false);
  }

  /** -------------------- EXPORT / PRINT -------------------- **/
  function exportRows() {
    const data = filtered.map((r) => ({
      barcode: r.packet_code,
      item: r.finished_good_name,
      bin: r.bin_code,
      status: r.status,
      returned_at: fmtDate(r.returned_at),
      produced_at: fmtDate(r.produced_at),
    }));
    downloadCSV("live_barcodes.csv", data);
  }

  function downloadSelected() {
    const chosen = filtered.filter((r) => selected.has(r.packet_code));
    if (!chosen.length) return alert("Select barcodes first");
    const codes = chosen.map((r) => r.packet_code);
    const namesByCode = Object.fromEntries(
      chosen.map((r) => [r.packet_code, r.finished_good_name || ""])
    );
    navigate("/labels", { state: { codes, namesByCode, mode: "download" } });
  }

  function printSelected() {
    const chosen = filtered.filter((r) => selected.has(r.packet_code));
    if (!chosen.length) return alert("Select barcodes first");
    const codes = chosen.map((r) => r.packet_code);
    const namesByCode = Object.fromEntries(
      chosen.map((r) => [r.packet_code, r.finished_good_name || ""])
    );
    navigate("/labels", { state: { codes, namesByCode, mode: "print" } });
  }

  /** -------------------- UI -------------------- **/
  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Live Barcodes</b>

          {/* ✅ Filter Controls */}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input
              placeholder="Search barcode / item / bin…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: 240 }}
            />

            {/* ✅ Date-time with seconds */}
            <input
              type="datetime-local"
              step="1"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
            <input
              type="datetime-local"
              step="1"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />

            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={onlyNoBarcode}
                onChange={(e) => setOnlyNoBarcode(e.target.checked)}
              />
              No-Barcode Returns
            </label>

            <button className="btn ghost" onClick={clearFilters}>
              Clear Filters
            </button>

            <button className="btn outline" onClick={exportRows} disabled={loading}>
              Export CSV
            </button>

            <button
              className="btn"
              onClick={downloadSelected}
              disabled={!selected.size}
            >
              Download Selected
            </button>

            <button
              className="btn ok"
              onClick={printSelected}
              disabled={!selected.size}
            >
              🖨️ Print
            </button>
          </div>
        </div>

        {/* ✅ TABLE */}
        <div className="bd" style={{ overflow: "auto" }}>
          {!!err && <div className="badge err">{err}</div>}

          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={(el) => el && (el.indeterminate = someVisibleSelected)}
                    onChange={(e) => toggleVisible(e.target.checked)}
                  />
                </th>
                <th>Barcode</th>
                <th>Item</th>
                <th>Bin</th>
                <th>Status</th>
                <th>No-Barcode</th>
                <th>Returned</th>
                <th>Produced</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.packet_code}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(r.packet_code)}
                      onChange={(e) => toggleRow(r.packet_code, e.target.checked)}
                    />
                  </td>
                  <td style={{ fontFamily: "monospace" }}>{r.packet_code}</td>
                  <td>{r.finished_good_name}</td>
                  <td>{r.bin_code || "—"}</td>
                  <td><span className="badge">{r.status}</span></td>
                  <td>{r.is_no_barcode_return ? "Yes" : "—"}</td>
                  <td>{fmtDate(r.returned_at)}</td>
                  <td>{fmtDate(r.produced_at)}</td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ color: "var(--muted)" }}>
                    {loading ? "Loading…" : "No barcodes found"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ✅ Pagination */}
        <div
          className="row"
          style={{ justifyContent: "center", marginTop: 12, gap: 10 }}
        >
          <button
            className="btn ghost"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            ← Prev
          </button>
          <span>
            Page {page} / {totalPages} ({totalCount} total)
          </span>
          <button
            className="btn ghost"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
