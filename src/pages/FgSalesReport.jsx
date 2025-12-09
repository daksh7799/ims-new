import { useState, useEffect, useMemo, useCallback } from "react";
import { format, subDays, eachDayOfInterval } from "date-fns";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { supabase } from "../supabaseClient";
import { saveAs } from "file-saver";

const PAGE_SIZE = 500;
const SERVER_PAGE_SIZE = 1000; // must be <= Supabase max_rows

const QUICK_FILTERS = [
  { label: "Today", days: 0 },
  { label: "3 Days", days: 3 },
  { label: "7 Days", days: 7 },
  { label: "15 Days", days: 15 },
  { label: "30 Days", days: 30 },
];

export default function FgSalesReport() {
  const [range, setRange] = useState({ from: new Date(), to: new Date() });
  const [selectedDays, setSelectedDays] = useState([new Date()]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [qtySortDirection, setQtySortDirection] = useState("none"); // 'none' | 'asc' | 'desc'

  /** ─── Helpers ─── */

  const setQuickFilter = (days) => {
    const end = new Date();
    const start = days > 0 ? subDays(end, days - 1) : end;
    const rangeDays = eachDayOfInterval({ start, end });
    setRange({ from: start, to: end });
    setSelectedDays(rangeDays);
  };

  const toggleQtySort = () => {
    setPage(1);
    setQtySortDirection((prev) =>
      prev === "none" ? "asc" : prev === "asc" ? "desc" : "none"
    );
  };

  const qtySortIcon = qtySortDirection === "asc" ? "▲" : qtySortDirection === "desc" ? "▼" : "↕";

  /** ─── Load Data (fetch ALL chunks from Supabase) ─── */
  const load = useCallback(async (selectedDates) => {
    try {
      setLoading(true);
      setError("");

      if (!selectedDates?.length) {
        setRows([]);
        return;
      }

      const dates = selectedDates.map((d) => format(d, "yyyy-MM-dd"));

      let allData = [];
      let from = 0;

      // fetch in chunks until we get less than SERVER_PAGE_SIZE
      while (true) {
        const to = from + SERVER_PAGE_SIZE - 1;

        const { data, error } = await supabase
          .rpc("get_fg_sales_by_dates", { p_dates: dates })
          .range(from, to);

        if (error) throw error;

        const chunk = data || [];
        if (!chunk.length) break;

        allData = allData.concat(chunk);
        if (chunk.length < SERVER_PAGE_SIZE) break;

        from += SERVER_PAGE_SIZE;
      }

      const mapped = allData.map((r) => ({
        finished_good_name: r.finished_good_name,
        qty_shipped: Number(r.total_qty || 0),
      }));

      setRows(mapped);
      setPage(1);
      setQtySortDirection("none"); // reset sort when date range changes
    } catch (err) {
      console.error("load", err);
      setError(err.message || "Error loading data");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  /** ─── Auto load on date change ─── */
  useEffect(() => {
    if (selectedDays.length > 0) {
      load(selectedDays);
    }
  }, [selectedDays, load]);

  /** ─── Sorted rows (global) ─── */
  const sortedRows = useMemo(() => {
    if (!rows.length) return [];

    const arr = [...rows];

    if (qtySortDirection === "asc") {
      arr.sort((a, b) => a.qty_shipped - b.qty_shipped);
    } else if (qtySortDirection === "desc") {
      arr.sort((a, b) => b.qty_shipped - a.qty_shipped);
    } else {
      arr.sort((a, b) =>
        (a.finished_good_name || "").localeCompare(b.finished_good_name || "")
      );
    }

    return arr;
  }, [rows, qtySortDirection]);

  /** ─── Totals & Pagination ─── */
  const totalQtyAll = useMemo(
    () => sortedRows.reduce((sum, r) => sum + (r.qty_shipped || 0), 0),
    [sortedRows]
  );

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const pagedRows = sortedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  /** ─── Export CSV (all sorted rows) ─── */
  const exportCSV = () => {
    if (!sortedRows.length) return;
    const header = "Finished Good,Qty Shipped\n";
    const body = sortedRows
      .map((r) => `${r.finished_good_name},${r.qty_shipped}`)
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv;charset=utf-8" });
    saveAs(blob, "fg_sales_report.csv");
  };

  /** ─── Print PDF (all sorted rows) ─── */
  const printPDF = async () => {
    if (!sortedRows.length) return alert("No data to print.");

    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);

      const doc = new jsPDF();
      doc.setFontSize(14);

      const startDate = selectedDays[0]
        ? format(selectedDays[0], "dd-MMM-yyyy")
        : "—";
      const endDate = selectedDays[selectedDays.length - 1]
        ? format(selectedDays[selectedDays.length - 1], "dd-MMM-yyyy")
        : startDate;

      doc.text(
        `Finished Goods Sales Report — ${startDate} to ${endDate}`,
        14,
        16
      );
      doc.setFontSize(11);
      doc.text(
        `Total Qty: ${totalQtyAll} | Records: ${sortedRows.length}`,
        14,
        22
      );

      const body = sortedRows.map((r) => [
        r.finished_good_name || "—",
        r.qty_shipped?.toLocaleString() || "0",
      ]);

      autoTable(doc, {
        startY: 30,
        head: [["Finished Good", "Qty Shipped"]],
        body,
        styles: { fontSize: 9, cellPadding: 2 },
        columnStyles: { 1: { halign: "right", cellWidth: 30 } },
      });

      const blob = doc.output("blob");
      const blobURL = URL.createObjectURL(blob);
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "none";
      iframe.src = blobURL;
      document.body.appendChild(iframe);
      iframe.onload = function () {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      };
    } catch (err) {
      alert("Failed to print: " + (err?.message || String(err)));
    }
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div className="hd row space-between">
          <b>Finished Goods Sales Report</b>
          <span style={{ fontSize: 13, color: "gray" }}>
            {sortedRows.length
              ? `Total Qty: ${totalQtyAll} | Records: ${sortedRows.length}`
              : "Select dates to view report"}
          </span>
        </div>

        {/* FILTER BAR */}
        <div
          className="row flex-wrap"
          style={{
            gap: 8,
            marginBottom: 12,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {QUICK_FILTERS.map((f) => (
              <button
                key={f.days}
                className="btn small outline"
                onClick={() => setQuickFilter(f.days)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn outline"
              onClick={exportCSV}
              disabled={!sortedRows.length}
            >
              ⬇️ Export CSV
            </button>
            <button
              className="btn"
              onClick={printPDF}
              disabled={!sortedRows.length}
            >
              🖨️ Print
            </button>
          </div>
        </div>

        {/* Calendar */}
        <div
          className="row"
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            gap: 20,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "12px 24px",
              background: "#fafafa",
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
              flex: "1 1 600px",
              maxWidth: 740,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <DayPicker
              mode="range"
              selected={range}
              onSelect={(r) => {
                if (r?.from && r?.to) {
                  const daysInRange = eachDayOfInterval({
                    start: r.from,
                    end: r.to,
                  });
                  setRange(r);
                  setSelectedDays(daysInRange);
                } else {
                  setRange(r || {});
                  setSelectedDays(r?.from ? [r.from] : []);
                }
              }}
              showOutsideDays
              fixedWeeks
              numberOfMonths={2}
              captionLayout="dropdown-buttons"
              style={{ width: "100%", justifyContent: "center" }}
            />
          </div>
        </div>
      </div>

      {/* TABLE */}
      <div className="card" id="printable-area">
        <div className="bd" style={{ overflow: "auto" }}>
          {error && (
            <div style={{ color: "var(--err)", marginBottom: 8 }}>{error}</div>
          )}
          <table className="table" style={{ minWidth: 400 }}>
            <thead>
              <tr>
                <th>Finished Good</th>
                <th
                  style={{
                    textAlign: "right",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                  onClick={toggleQtySort}
                  title="Sort by Qty Shipped"
                >
                  Qty Shipped {qtySortIcon}
                </th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.length === 0 && !loading && (
                <tr>
                  <td colSpan="2" style={{ color: "gray" }}>
                    No data found
                  </td>
                </tr>
              )}
              {pagedRows.map((r) => (
                <tr key={r.finished_good_name}>
                  <td>{r.finished_good_name}</td>
                  <td style={{ textAlign: "right" }}>{r.qty_shipped}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* PAGINATION */}
        {sortedRows.length > PAGE_SIZE && (
          <div className="ft row center" style={{ gap: 10, marginTop: 10 }}>
            <button
              className="btn outline small"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              ← Prev
            </button>
            <span>
              Page {page} / {totalPages}
            </span>
            <button
              className="btn outline small"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
