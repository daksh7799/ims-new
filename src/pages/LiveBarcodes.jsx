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

const PAGE_SIZE = 1000; // rows per UI page
const FETCH_CHUNK = 1000; // rows per Supabase request (fetch all in chunks)

export default function LiveBarcodes() {
  const [rows, setRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0); // total loaded
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [q, setQ] = useState("");
  // all / available / returned / returned_no_barcode
  const [statusFilter, setStatusFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selected, setSelected] = useState(() => new Set());

  // Sort direction for Returned column
  const [returnedSortDir, setReturnedSortDir] = useState("desc"); // asc / desc

  const navigate = useNavigate();

  /** -------------------- LOAD (ALL ROWS IN CHUNKS) -------------------- **/
  async function load() {
    setLoading(true);
    setErr("");
    try {
      const all = [];
      let from = 0;

      // fetch in chunks until we get less than FETCH_CHUNK rows
      // or no more rows
      // status limited to available + returned
      // (we’ll further filter on the frontend)
      // NOTE: no count here; we just use all.length at the end
      // to know how many we loaded.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const to = from + FETCH_CHUNK - 1;

        const { data, error } = await supabase
          .from("v_live_barcodes_enriched")
          .select("*")
          .in("status", ["available", "returned"])
          .range(from, to);

        if (error) {
          throw error;
        }

        if (!data || data.length === 0) {
          break;
        }

        all.push(...data);

        if (data.length < FETCH_CHUNK) {
          // last partial page -> done
          break;
        }

        from += FETCH_CHUNK;
      }

      setRows(all);
      setTotalCount(all.length);
    } catch (e) {
      console.error(e);
      setErr(String(e));
      setRows([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
      setSelected(new Set());
      setPage(1); // reset to first page when data refreshes
    }
  }

  /** -------------------- REALTIME + REFRESH -------------------- **/
  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000); // auto refresh every 30s

    const c1 = supabase
      .channel("rt:packets")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "packets" },
        load
      )
      .subscribe();

    const c2 = supabase
      .channel("rt:ledger")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stock_ledger" },
        load
      )
      .subscribe();

    return () => {
      clearInterval(timer);
      try {
        supabase.removeChannel(c1);
      } catch {}
      try {
        supabase.removeChannel(c2);
      } catch {}
    };
  }, []);

  /** -------------------- RESET PAGE WHEN FILTERS CHANGE -------------------- **/
  useEffect(() => {
    setPage(1);
  }, [q, statusFilter, fromDate, toDate]);

  /** -------------------- FILTERING + SORTING -------------------- **/
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();

    let result = (rows || []).filter((r) => {
      // Status + No-barcode combined filter
      if (statusFilter === "available" && r.status !== "available") return false;
      if (statusFilter === "returned" && r.status !== "returned") return false;
      if (
        statusFilter === "returned_no_barcode" &&
        !(r.status === "returned" && r.is_no_barcode_return)
      ) {
        return false;
      }

      const pd = r.produced_at ? new Date(r.produced_at) : null;

      // Date-time filtering accurate to seconds (using produced_at)
      if (fromDate) {
        const f = new Date(fromDate);
        if (!pd || pd < f) return false;
      }
      if (toDate) {
        const t = new Date(toDate);
        if (!pd || pd > t) return false;
      }

      // Search filter
      if (
        qq &&
        !(
          r.packet_code?.toLowerCase().includes(qq) ||
          (r.finished_good_name || "").toLowerCase().includes(qq) ||
          (r.bin_code || "").toLowerCase().includes(qq)
        )
      ) {
        return false;
      }

      return true;
    });

    // Sort by returned_at with asc/desc toggle
    result = [...result].sort((a, b) => {
      const ta = a.returned_at ? new Date(a.returned_at).getTime() : 0;
      const tb = b.returned_at ? new Date(b.returned_at).getTime() : 0;

      // Keep nulls at bottom
      if (!ta && !tb) return 0;
      if (!ta) return 1;
      if (!tb) return -1;

      return returnedSortDir === "asc" ? ta - tb : tb - ta;
    });

    return result;
  }, [rows, q, statusFilter, fromDate, toDate, returnedSortDir]);

  /** -------------------- CLIENT-SIDE PAGINATION (on filtered) -------------------- **/
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    return filtered.slice(start, end);
  }, [filtered, page]);

  /** -------------------- SELECTION -------------------- **/
  const allVisibleSelected =
    pageRows.length > 0 && pageRows.every((r) => selected.has(r.packet_code));
  const someVisibleSelected =
    pageRows.some((r) => selected.has(r.packet_code)) && !allVisibleSelected;

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
    if (checked) pageRows.forEach((r) => next.add(r.packet_code));
    else pageRows.forEach((r) => next.delete(r.packet_code));
    setSelected(next);
  }

  /** -------------------- CLEAR FILTER -------------------- **/
  function clearFilters() {
    setQ("");
    setFromDate("");
    setToDate("");
    setStatusFilter("all");
    setPage(1);
  }

  /** -------------------- EXPORT / PRINT -------------------- **/
  function exportRows() {
    // Export ALL filtered rows (across pages)
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

  /** -------------------- SORT HANDLER FOR RETURNED -------------------- **/
  function toggleReturnedSort() {
    setReturnedSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
  }

  const returnedArrow = returnedSortDir === "asc" ? "↑" : "↓";

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Live Barcodes</b>

          {/* Filter Controls */}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input
              placeholder="Search barcode / item / bin…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: 240 }}
            />

            {/* Date-time with seconds */}
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

            {/* Status + No-barcode filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Statuses</option>
              <option value="available">Available</option>
              <option value="returned">Returned</option>
              <option value="returned_no_barcode">Returned (No-Barcode)</option>
            </select>

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

        {/* TABLE */}
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
                {/* Clickable Returned header with arrow */}
                <th
                  onClick={toggleReturnedSort}
                  style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                  title="Sort by Returned date/time"
                >
                  Returned {returnedArrow}
                </th>
                <th>Produced</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
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
                  <td>
                    <span className="badge">{r.status}</span>
                  </td>
                  <td>{r.is_no_barcode_return ? "Yes" : "—"}</td>
                  <td>{fmtDate(r.returned_at)}</td>
                  <td>{fmtDate(r.produced_at)}</td>
                </tr>
              ))}

              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ color: "var(--muted)" }}>
                    {loading ? "Loading…" : "No barcodes found"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination on FILTERED rows */}
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
            Page {page} / {totalPages} ({filtered.length} filtered of {totalCount} total)
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
