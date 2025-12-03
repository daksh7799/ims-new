import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { downloadCSV } from "../utils/csv";
import { useNavigate } from "react-router-dom";
import { useToast } from "../ui/toast.jsx";

// Format date/time to local (IST)
function fmtDate(d) {
  if (!d) return "—";
  const t = typeof d === "string" ? Date.parse(d) : d;
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString(); // auto local time (IST in browser)
}

const PAGE_SIZE = 50;

export default function LiveBarcodes() {
  const { push } = useToast();
  const [rows, setRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Debounced search: separate input value from actual search query
  const [searchInput, setSearchInput] = useState(""); // What user types
  const [q, setQ] = useState(""); // Actual search query (debounced)

  // all / available / returned / returned_no_barcode
  const [statusFilter, setStatusFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selected, setSelected] = useState(() => new Set());

  // Sort directions for both columns
  const [returnedSortDir, setReturnedSortDir] = useState("desc"); // asc / desc
  const [producedSortDir, setProducedSortDir] = useState("desc"); // asc / desc - newest first by default
  const [activeSort, setActiveSort] = useState("produced"); // "produced" or "returned"

  // Debounce search input - only update q after user stops typing for 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(searchInput);
    }, 500);

    return () => clearTimeout(timer);
  }, [searchInput]);

  const navigate = useNavigate();

  /** -------------------- LOAD (SERVER-SIDE) -------------------- **/
  async function load(includeCount = true) {
    setLoading(true);
    try {
      let query = supabase
        .from("v_live_barcodes_enriched")
        .select("*", { count: includeCount ? "exact" : undefined });

      // 1. Status Filter
      if (statusFilter === "available") {
        query = query.eq("status", "available");
      } else if (statusFilter === "returned") {
        query = query.eq("status", "returned").not("is_no_barcode_return", "eq", true);
      } else if (statusFilter === "returned_no_barcode") {
        query = query.eq("status", "returned").eq("is_no_barcode_return", true);
      } else {
        // "all" -> usually implies available + returned, based on original code
        query = query.in("status", ["available", "returned"]);
      }

      // 2. Date Range (produced_at)
      if (fromDate) {
        query = query.gte("produced_at", fromDate);
      }
      if (toDate) {
        query = query.lte("produced_at", toDate);
      }

      // 3. Search (q)
      if (q.trim()) {
        const term = `%${q.trim()}%`;
        // ILIKE on multiple columns using OR syntax
        query = query.or(`packet_code.ilike.${term},finished_good_name.ilike.${term},bin_code.ilike.${term}`);
      }

      // 4. Sorting
      if (activeSort === "returned") {
        query = query.order("returned_at", { ascending: returnedSortDir === "asc", nullsFirst: false });
      } else {
        query = query.order("produced_at", { ascending: producedSortDir === "asc", nullsFirst: false });
      }

      // 5. Pagination
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) throw error;

      setRows(data || []);
      if (count !== null && count !== undefined) setTotalCount(count);
    } catch (e) {
      console.error(e);
      push(e.message || String(e), "err");
      setRows([]);
      if (includeCount) setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }

  /** -------------------- REALTIME + REFRESH -------------------- **/
  // Load with count when filters change
  useEffect(() => {
    setPage(1); // Reset to page 1 when filters change
    load(true); // Include count
  }, [q, statusFilter, fromDate, toDate, returnedSortDir, producedSortDir, activeSort]);

  // Load without count when only page changes
  useEffect(() => {
    load(false); // Skip count for faster pagination
  }, [page]);

  // Realtime subscriptions - FIXED: preserve page position
  useEffect(() => {
    const c1 = supabase
      .channel("rt:packets_live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "packets" },
        () => load(false) // Changed from load(true) to preserve page position
      )
      .subscribe();

    const c2 = supabase
      .channel("rt:ledger_live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stock_ledger" },
        () => load(false) // Changed from load(true) to preserve page position
      )
      .subscribe();

    return () => {
      supabase.removeChannel(c1);
      supabase.removeChannel(c2);
    };
  }, []);

  /** -------------------- SELECTION -------------------- **/
  const allVisibleSelected =
    rows.length > 0 && rows.every((r) => selected.has(r.packet_code));
  const someVisibleSelected =
    rows.some((r) => selected.has(r.packet_code)) && !allVisibleSelected;

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
    if (checked) rows.forEach((r) => next.add(r.packet_code));
    else rows.forEach((r) => next.delete(r.packet_code));
    setSelected(next);
  }

  /** -------------------- CLEAR FILTER -------------------- **/
  function clearFilters() {
    setSearchInput("");
    setQ("");
    setFromDate("");
    setToDate("");
    setStatusFilter("all");
    setPage(1);
    // Reset sort to default
    setActiveSort("produced");
    setProducedSortDir("desc");
  }

  /** -------------------- EXPORT / PRINT -------------------- **/
  async function exportRows() {
    // For export, we probably want ALL matching rows, not just the current page.
    // We need to fetch them.
    push("Fetching all rows for export...", "ok");
    try {
      let query = supabase
        .from("v_live_barcodes_enriched")
        .select("*");

      // Re-apply filters (duplicate logic, could be extracted)
      if (statusFilter === "available") query = query.eq("status", "available");
      else if (statusFilter === "returned") query = query.eq("status", "returned").not("is_no_barcode_return", "eq", true);
      else if (statusFilter === "returned_no_barcode") query = query.eq("status", "returned").eq("is_no_barcode_return", true);
      else query = query.in("status", ["available", "returned"]);

      if (fromDate) query = query.gte("produced_at", fromDate);
      if (toDate) query = query.lte("produced_at", toDate);
      if (q.trim()) {
        const term = `%${q.trim()}%`;
        query = query.or(`packet_code.ilike.${term},finished_good_name.ilike.${term},bin_code.ilike.${term}`);
      }

      const { data, error } = await query;
      if (error) throw error;

      const csvData = (data || []).map((r) => ({
        barcode: r.packet_code,
        item: r.finished_good_name,
        bin: r.bin_code,
        status: r.status,
        returned_at: fmtDate(r.returned_at),
        produced_at: fmtDate(r.produced_at),
      }));
      downloadCSV("live_barcodes.csv", csvData);
      push("Export complete", "ok");
    } catch (e) {
      push("Export failed: " + e.message, "err");
    }
  }

  function downloadSelected() {
    // For selected, we have the IDs (packet_codes) in `selected` Set.
    // But we need the names. We might not have all names if selected items are on other pages.
    // However, the previous implementation assumed we had them in `filtered`.
    // With server-side pagination, we only have `rows`.
    // If the user selects items, goes to next page, selects more, then downloads...
    // We need to fetch the details for ALL selected items.
    // Better approach: Fetch details for all selected codes.

    if (!selected.size) return push("Select barcodes first", "warn");

    (async () => {
      const codes = Array.from(selected);
      const { data, error } = await supabase
        .from("v_live_barcodes_enriched")
        .select("packet_code, finished_good_name")
        .in("packet_code", codes);

      if (error) {
        push("Failed to prepare download: " + error.message, "err");
        return;
      }

      const namesByCode = Object.fromEntries(
        (data || []).map(r => [r.packet_code, r.finished_good_name || ""])
      );
      navigate("/labels", { state: { codes, namesByCode, mode: "download" } });
    })();
  }

  function printSelected() {
    if (!selected.size) return push("Select barcodes first", "warn");

    (async () => {
      const codes = Array.from(selected);
      const { data, error } = await supabase
        .from("v_live_barcodes_enriched")
        .select("packet_code, finished_good_name")
        .in("packet_code", codes);

      if (error) {
        push("Failed to prepare print: " + error.message, "err");
        return;
      }

      const namesByCode = Object.fromEntries(
        (data || []).map(r => [r.packet_code, r.finished_good_name || ""])
      );
      navigate("/labels", { state: { codes, namesByCode, mode: "print" } });
    })();
  }

  /** -------------------- SORT HANDLERS -------------------- **/
  function toggleReturnedSort() {
    if (activeSort !== "returned") setActiveSort("returned");
    setReturnedSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
  }

  function toggleProducedSort() {
    if (activeSort !== "produced") setActiveSort("produced");
    setProducedSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
  }

  const returnedArrow = activeSort === "returned" ? (returnedSortDir === "asc" ? "↑" : "↓") : "↕";
  const producedArrow = activeSort === "produced" ? (producedSortDir === "asc" ? "↑" : "↓") : "↕";
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Live Barcodes</b>

          {/* Filter Controls */}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input
              placeholder="Search barcode / item / bin…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{ minWidth: 240 }}
            />

            {/* Date-time with seconds */}
            <input
              type="datetime-local"
              step="1"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
            />
            <input
              type="datetime-local"
              step="1"
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); setPage(1); }}
            />

            {/* Status + No-barcode filter */}
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
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
              Download Selected ({selected.size})
            </button>

            <button
              className="btn ok"
              onClick={printSelected}
              disabled={!selected.size}
            >
              🖨️ Print ({selected.size})
            </button>
          </div>
        </div>

        {/* TABLE */}
        <div className="bd" style={{ overflow: "auto" }}>
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
                {/* Clickable Produced header with arrow */}
                <th
                  onClick={toggleProducedSort}
                  style={{ cursor: "pointer", whiteSpace: "nowrap" }}
                  title="Sort by Produced date/time"
                >
                  Produced {producedArrow}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
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

              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ color: "var(--muted)" }}>
                    {loading ? "Loading…" : "No barcodes found"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div
          className="row"
          style={{ justifyContent: "center", marginTop: 12, gap: 10 }}
        >
          <button
            className="btn ghost"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
          >
            ← Prev
          </button>
          <span>
            Page {page} / {totalPages} ({totalCount} total)
          </span>
          <button
            className="btn ghost"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
