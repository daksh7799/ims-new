import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { downloadCSV } from "../utils/csv";
import { useNavigate } from "react-router-dom";

/** small debounce hook */
function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

function fmtDate(d) {
  if (!d) return "—";
  const t = typeof d === "string" ? Date.parse(d) : d;
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString();
}

const PAGE_SIZE = 100; // smaller UI pages when server paging
const FETCH_CHUNK = 1000; // chunk size used for full exports

export default function LiveBarcodes() {
  const [rows, setRows] = useState([]); // current page rows
  const [totalCount, setTotalCount] = useState(0); // total matching rows on server
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // filters
  const [q, setQ] = useState("");
  const debouncedQ = useDebounced(q, 350);
  const [statusFilter, setStatusFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const debouncedFrom = useDebounced(fromDate, 300);
  const debouncedTo = useDebounced(toDate, 300);

  // selection across pages (set of packet_code)
  const [selected, setSelected] = useState(() => new Set());

  // sort
  const [returnedSortDir, setReturnedSortDir] = useState("desc");

  const navigate = useNavigate();

  // keep a ref to the active subscription objects so we can remove them
  const subsRef = useRef([]);
  const abortRef = useRef(null);

  /** build server query filters */
  const buildQuery = useCallback((builder) => {
    // status filter mapping
    if (statusFilter === "available") builder.eq("status", "available");
    else if (statusFilter === "returned") builder.eq("status", "returned");
    else if (statusFilter === "returned_no_barcode") {
      builder.eq("status", "returned").eq("is_no_barcode_return", true);
    } else {
      // 'all' - but if you want to restrict to available/returned only:
      // builder.in("status", ["available","returned"]);
    }

    // date filters on produced_at (server side)
    if (debouncedFrom) {
      // expecting local datetime-local string -> convert to ISO
      builder.gte("produced_at", new Date(debouncedFrom).toISOString());
    }
    if (debouncedTo) {
      builder.lte("produced_at", new Date(debouncedTo).toISOString());
    }

    // search: try packet_code, finished_good_name, bin_code
    if (debouncedQ && debouncedQ.trim()) {
      const like = `%${debouncedQ.trim()}%`;
      // Use ilike for case-insensitive matching (Postgres)
      builder.or(
        `packet_code.ilike.${like},finished_good_name.ilike.${like},bin_code.ilike.${like}`
      );
    }

    return builder;
  }, [statusFilter, debouncedFrom, debouncedTo, debouncedQ]);

  /** fetch one page (server side pagination) */
  const loadPage = useCallback(
    async (pageToLoad = page) => {
      setLoading(true);
      setErr("");
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch {}
      }
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const from = (pageToLoad - 1) * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        // Initialize base select while requesting exact count
        let query = supabase
          .from("v_live_barcodes_enriched")
          .select("*", { count: "exact" })
          .range(from, to);

        // apply filters
        query = buildQuery(query);

        // apply ordering by returned_at (nulls last): order by returned_at asc/desc
        // Supabase/Postgres: .order('returned_at', { ascending: returnedSortDir === 'asc' })
        query = query.order("returned_at", {
          ascending: returnedSortDir === "asc",
        });

        const { data, error, count } = await query;

        if (error) {
          throw error;
        }

        setRows(data || []);
        setTotalCount(typeof count === "number" ? count : (data || []).length);
        setPage(pageToLoad);
      } catch (e) {
        if (e.name === "AbortError") {
          // ignore
        } else {
          console.error(e);
          setErr(String(e));
          setRows([]);
          setTotalCount(0);
        }
      } finally {
        setLoading(false);
        abortRef.current = null;
      }
    },
    [buildQuery, page, returnedSortDir]
  );

  /** load when filters/page/sort change */
  useEffect(() => {
    loadPage(1); // reset to page 1 whenever filters change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, statusFilter, debouncedFrom, debouncedTo, returnedSortDir]);

  useEffect(() => {
    loadPage(page);
  }, [page, loadPage]);

  /** realtime subscription: refresh current page when relevant tables change */
  useEffect(() => {
    // cleanup old subs
    subsRef.current.forEach((s) => {
      try { supabase.removeChannel(s); } catch {}
    });
    subsRef.current = [];

    const subscribeAndPush = (channelName, table) => {
      const ch = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          () => {
            // refetch current page (not all rows)
            loadPage(page);
          }
        )
        .subscribe();
      subsRef.current.push(ch);
      return ch;
    };

    subscribeAndPush("rt:packets", "packets");
    subscribeAndPush("rt:ledger", "stock_ledger");

    return () => {
      subsRef.current.forEach((s) => {
        try { supabase.removeChannel(s); } catch {}
      });
      subsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedQ, statusFilter, debouncedFrom, debouncedTo, returnedSortDir]);

  /** ---------------- SELECTION ---------------- */
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
    setSelected((prev) => {
      const next = new Set(prev);
      rows.forEach((r) => {
        if (checked) next.add(r.packet_code);
        else next.delete(r.packet_code);
      });
      return next;
    });
  }

  function clearFilters() {
    setQ("");
    setFromDate("");
    setToDate("");
    setStatusFilter("all");
    setPage(1);
  }

  /** export the current server-filtered set **(streams in chunks)** */
  async function exportAllFilteredRows() {
    setLoading(true);
    try {
      const all = [];
      let offset = 0;
      while (true) {
        let qbuilder = supabase
          .from("v_live_barcodes_enriched")
          .select("*")
          .range(offset, offset + FETCH_CHUNK - 1);
        qbuilder = buildQuery(qbuilder);
        qbuilder = qbuilder.order("returned_at", {
          ascending: returnedSortDir === "asc",
        });

        const { data, error } = await qbuilder;
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < FETCH_CHUNK) break;
        offset += FETCH_CHUNK;
      }

      const csv = all.map((r) => ({
        barcode: r.packet_code,
        item: r.finished_good_name,
        bin: r.bin_code,
        status: r.status,
        returned_at: fmtDate(r.returned_at),
        produced_at: fmtDate(r.produced_at),
      }));
      downloadCSV("live_barcodes.csv", csv);
    } catch (e) {
      console.error(e);
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  function downloadSelected() {
    const chosen = Array.from(selected);
    if (!chosen.length) return alert("Select barcodes first");
    const codes = chosen;
    // we can optionally fetch names for missing ones from server
    // for simplicity, send codes only and let labels page fetch names if needed
    navigate("/labels", { state: { codes, namesByCode: {}, mode: "download" } });
  }

  function printSelected() {
    const chosen = Array.from(selected);
    if (!chosen.length) return alert("Select barcodes first");
    const codes = chosen;
    navigate("/labels", { state: { codes, namesByCode: {}, mode: "print" } });
  }

  function toggleReturnedSort() {
    setReturnedSortDir((d) => (d === "asc" ? "desc" : "asc"));
  }

  const returnedArrow = returnedSortDir === "asc" ? "↑" : "↓";

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Live Barcodes</b>

          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input
              placeholder="Search barcode / item / bin…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: 240 }}
            />

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

            <button className="btn outline" onClick={exportAllFilteredRows} disabled={loading}>
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
            Page {page} / {totalPages} ({totalCount} total matching)
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
