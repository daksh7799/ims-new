import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { downloadCSV } from "../utils/csv";
import { useNavigate } from "react-router-dom";
import { useToast } from "../ui/toast.jsx";

function fmtDate(d) {
  if (!d) return "—";
  const t = typeof d === "string" ? Date.parse(d) : d;
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString();
}

const PAGE_SIZE = 50;

export default function LiveBarcodes() {
  const { push } = useToast();
  const navigate = useNavigate();

  const [rows, setRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");

  const [statusFilter, setStatusFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [selected, setSelected] = useState(() => new Set());

  const [returnedSortDir, setReturnedSortDir] = useState("desc");
  const [producedSortDir, setProducedSortDir] = useState("desc");
  const [activeSort, setActiveSort] = useState("produced");

  // ---------------- SEARCH DEBOUNCE ----------------
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(searchInput);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ---------------- LOAD ----------------
  async function load(includeCount = true) {
    setLoading(true);

    try {
      let baseQuery = supabase
        .from("v_live_barcodes_enriched")
        .select(
          "packet_code, finished_good_name, bin_code, status, returned_at, produced_at, is_no_barcode_return"
        );

      // STATUS
      if (statusFilter === "available") {
        baseQuery = baseQuery.eq("status", "available");
      } else if (statusFilter === "returned") {
        baseQuery = baseQuery.eq("status", "returned").not("is_no_barcode_return", "eq", true);
      } else if (statusFilter === "returned_no_barcode") {
        baseQuery = baseQuery.eq("status", "returned").eq("is_no_barcode_return", true);
      } else {
        baseQuery = baseQuery.in("status", ["available", "returned"]);
      }

      // DATE
      if (fromDate) baseQuery = baseQuery.gte("produced_at", fromDate);
      if (toDate) baseQuery = baseQuery.lte("produced_at", toDate);

      // SEARCH
      if (q.trim()) {
        const term = `%${q.trim()}%`;
        baseQuery = baseQuery.or(
          `packet_code.ilike.${term},finished_good_name.ilike.${term},bin_code.ilike.${term}`
        );
      }

      // SORT
      if (activeSort === "returned") {
        baseQuery = baseQuery.order("returned_at", {
          ascending: returnedSortDir === "asc",
          nullsFirst: false,
        });
      } else {
        baseQuery = baseQuery.order("produced_at", {
          ascending: producedSortDir === "asc",
          nullsFirst: false,
        });
      }

      // PAGINATION
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error } = await baseQuery.range(from, to);

      if (error) throw error;

      setRows(data || []);

      // ---------------- COUNT WITH SAME FILTERS ----------------
      if (includeCount) {
        let countQuery = supabase
          .from("v_live_barcodes_enriched")
          .select("*", { count: "exact", head: true });

        if (statusFilter === "available") {
          countQuery = countQuery.eq("status", "available");
        } else if (statusFilter === "returned") {
          countQuery = countQuery.eq("status", "returned").not("is_no_barcode_return", "eq", true);
        } else if (statusFilter === "returned_no_barcode") {
          countQuery = countQuery.eq("status", "returned").eq("is_no_barcode_return", true);
        } else {
          countQuery = countQuery.in("status", ["available", "returned"]);
        }

        if (fromDate) countQuery = countQuery.gte("produced_at", fromDate);
        if (toDate) countQuery = countQuery.lte("produced_at", toDate);

        if (q.trim()) {
          const term = `%${q.trim()}%`;
          countQuery = countQuery.or(
            `packet_code.ilike.${term},finished_good_name.ilike.${term},bin_code.ilike.${term}`
          );
        }

        const { count } = await countQuery;
        setTotalCount(count || 0);
      }

    } catch (e) {
      console.error(e);
      push(e.message || "Error loading", "err");
      setRows([]);
      if (includeCount) setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }

  // ---------------- FILTER CHANGE ----------------
  useEffect(() => {
    setPage(1);
    load(true);
  }, [q, statusFilter, fromDate, toDate, returnedSortDir, producedSortDir, activeSort]);

  // ---------------- PAGE CHANGE ----------------
  useEffect(() => {
    load(false);
  }, [page]);

  // ---------------- REALTIME ----------------
  useEffect(() => {
    let timeout;

    const trigger = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => load(false), 800);
    };

    const c1 = supabase
      .channel("rt:packets_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "packets" }, trigger)
      .subscribe();

    const c2 = supabase
      .channel("rt:ledger_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_ledger" }, trigger)
      .subscribe();

    return () => {
      supabase.removeChannel(c1);
      supabase.removeChannel(c2);
    };
  }, []);

  // ---------------- SELECTION ----------------
  const allVisibleSelected =
    rows.length > 0 && rows.every((r) => selected.has(r.packet_code));

  const someVisibleSelected =
    rows.some((r) => selected.has(r.packet_code)) && !allVisibleSelected;

  function toggleRow(code, checked) {
    setSelected((prev) => {
      const next = new Set(prev);
      checked ? next.add(code) : next.delete(code);
      return next;
    });
  }

  function toggleVisible(checked) {
    const next = new Set(selected);
    if (checked) rows.forEach((r) => next.add(r.packet_code));
    else rows.forEach((r) => next.delete(r.packet_code));
    setSelected(next);
  }

  function clearFilters() {
    setSearchInput("");
    setQ("");
    setFromDate("");
    setToDate("");
    setStatusFilter("all");
    setPage(1);
    setActiveSort("produced");
    setProducedSortDir("desc");
  }

  // ---------------- EXPORT ----------------
  async function exportRows() {
    push("Fetching all rows...", "ok");

    try {
      let all = [];
      let from = 0;

      while (true) {
        const { data } = await supabase
          .from("v_live_barcodes_enriched")
          .select("*")
          .range(from, from + 999);

        if (!data?.length) break;

        all = [...all, ...data];
        from += 1000;
      }

      downloadCSV("live_barcodes.csv", all);
      push("Export complete", "ok");

    } catch (e) {
      push("Export failed: " + e.message, "err");
    }
  }

  // ---------------- DOWNLOAD (FIXED) ----------------
  function downloadSelected() {
    if (!selected.size) return push("Select barcodes first", "warn");

    (async () => {
      const codes = Array.from(selected);

      const { data, error } = await supabase
        .from("v_live_barcodes_enriched")
        .select("packet_code, finished_good_name")
        .in("packet_code", codes);

      if (error) {
        push("Failed: " + error.message, "err");
        return;
      }

      const namesByCode = Object.fromEntries(
        (data || []).map(r => [r.packet_code, r.finished_good_name || ""])
      );

      navigate("/labels", {
        state: { codes, namesByCode, mode: "download" }
      });
    })();
  }

  // ---------------- PRINT (FIXED) ----------------
  function printSelected() {
    if (!selected.size) return push("Select barcodes first", "warn");

    (async () => {
      const codes = Array.from(selected);

      const { data, error } = await supabase
        .from("v_live_barcodes_enriched")
        .select("packet_code, finished_good_name")
        .in("packet_code", codes);

      if (error) {
        push("Failed: " + error.message, "err");
        return;
      }

      const namesByCode = Object.fromEntries(
        (data || []).map(r => [r.packet_code, r.finished_good_name || ""])
      );

      navigate("/labels", {
        state: { codes, namesByCode, mode: "print" }
      });
    })();
  }

  function toggleReturnedSort() {
    if (activeSort !== "returned") setActiveSort("returned");
    setReturnedSortDir((d) => (d === "asc" ? "desc" : "asc"));
  }

  function toggleProducedSort() {
    if (activeSort !== "produced") setActiveSort("produced");
    setProducedSortDir((d) => (d === "asc" ? "desc" : "asc"));
  }

  const returnedArrow =
    activeSort === "returned"
      ? returnedSortDir === "asc"
        ? "↑"
        : "↓"
      : "↕";

  const producedArrow =
    activeSort === "produced"
      ? producedSortDir === "asc"
        ? "↑"
        : "↓"
      : "↕";

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Live Barcodes</b>

          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input
              placeholder="Search barcode / item / bin…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{ minWidth: 240 }}
            />

            <input type="datetime-local" step="1" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            <input type="datetime-local" step="1" value={toDate} onChange={(e) => setToDate(e.target.value)} />

            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              <option value="available">Available</option>
              <option value="returned">Returned</option>
              <option value="returned_no_barcode">Returned (No-Barcode)</option>
            </select>

            <button className="btn ghost" onClick={clearFilters}>Clear Filters</button>
            <button className="btn outline" onClick={exportRows} disabled={loading}>Export CSV</button>
            <button className="btn" onClick={downloadSelected} disabled={!selected.size}>
              Download Selected ({selected.size})
            </button>
            <button className="btn ok" onClick={printSelected} disabled={!selected.size}>
              🖨️ Print ({selected.size})
            </button>
          </div>
        </div>

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
                <th onClick={toggleReturnedSort} style={{ cursor: "pointer" }}>
                  Returned {returnedArrow}
                </th>
                <th onClick={toggleProducedSort} style={{ cursor: "pointer" }}>
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
                  <td>{r.packet_code}</td>
                  <td>{r.finished_good_name}</td>
                  <td>{r.bin_code || "—"}</td>
                  <td><span className="badge">{r.status}</span></td>
                  <td>{r.is_no_barcode_return ? "Yes" : "—"}</td>
                  <td>{fmtDate(r.returned_at)}</td>
                  <td>{fmtDate(r.produced_at)}</td>
                </tr>
              ))}

              {rows.length === 0 && (
                <tr>
                  <td colSpan={8}>{loading ? "Loading…" : "No barcodes found"}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="row" style={{ justifyContent: "center", marginTop: 12, gap: 10 }}>
          <button className="btn ghost" onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ← Prev
          </button>
          <span>Page {page} / {totalPages} ({totalCount} total)</span>
          <button className="btn ghost" onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
