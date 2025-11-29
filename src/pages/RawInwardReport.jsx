import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { downloadCSV } from "../utils/csv";

function fmtDate(d) {
  if (!d) return "—";
  const t = typeof d === "string" ? Date.parse(d) : d;
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString();
}

export default function RawInwardReport() {
  const [rows, setRows] = useState([]);
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 🔄 Load entries from Supabase view — strict filter by purchase_date
  async function load() {
    setLoading(true);
    setError("");

    try {
      const { data, error } = await supabase
        .from("v_raw_inward_report")
        .select(
          "id, bill_no, purchase_date, vendor_name, raw_material_name, qty, created_at"
        )
        .eq("purchase_date", date) // ✅ exact date match (fixes timezone issue)
        .neq("vendor_name", "Stock Adjustment")
        .neq("vendor_name", "mismatch")
        .order("purchase_date", { ascending: true });

      if (error) throw error;
      setRows(data || []);
    } catch (err) {
      console.error("Load error:", err);
      setError(err.message || "Failed to load data");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [date]);

  // 🧾 Export CSV
  function exportCSV() {
    if (!rows.length) return alert("No data to export.");
    downloadCSV(
      `raw_inward_${date}.csv`,
      rows.map((r) => ({
        Bill_No: r.bill_no,
        Purchase_Date: r.purchase_date,
        Vendor: r.vendor_name,
        Raw_Material: r.raw_material_name,
        Qty: r.qty,
        Created_At: fmtDate(r.created_at),
      }))
    );
  }

  // 🖨️ Print PDF directly (in same tab)
  async function printPDF() {
    if (!rows.length) return alert("No data to print.");

    try {
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);

      const doc = new jsPDF();
      doc.setFontSize(14);
      doc.text(`Raw Inward Report — ${date}`, 14, 16);

      const body = rows.map((r) => [
        r.bill_no || "—",
        r.purchase_date || "—",
        r.vendor_name || "—",
        r.raw_material_name || "—",
        r.qty || "—",
      ]);

      autoTable(doc, {
        startY: 26,
        head: [["Bill No", "Purchase Date", "Vendor", "Raw Material", "Qty"]],
        body,
        styles: { fontSize: 9, cellPadding: 2 },
        columnStyles: { 4: { halign: "right", cellWidth: 25 } },
      });

      // ✅ Open print dialog in same tab
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
  }

  // ✅ Calculate total quantity
  const totalQty = rows.reduce((sum, r) => sum + Number(r.qty || 0), 0);

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Raw Inward Report</b>
        </div>

        <div className="bd">
          {/* FILTER BAR */}
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ minWidth: 180 }}
            />
            <button className="btn" onClick={load} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </button>
            <button
              className="btn outline"
              onClick={exportCSV}
              disabled={!rows.length}
            >
              Export CSV
            </button>
            <button className="btn" onClick={printPDF} disabled={!rows.length}>
              🖨️ Print
            </button>
          </div>

          {error && (
            <div className="badge err" style={{ marginTop: 10 }}>
              {error}
            </div>
          )}

          <div className="s" style={{ marginTop: 6, color: "var(--muted)" }}>
            Showing entries for <b>{date}</b> ({rows.length} records)
          </div>

          {/* DATA TABLE */}
          <div className="scroll-x" style={{ marginTop: 10 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Bill No</th>
                  <th>Purchase Date</th>
                  <th>Vendor</th>
                  <th>Raw Material</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.bill_no}</td>
                    <td>{r.purchase_date}</td>
                    <td>{r.vendor_name}</td>
                    <td>{r.raw_material_name}</td>
                    <td style={{ textAlign: "right" }}>{r.qty}</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={5} style={{ color: "var(--muted)" }}>
                      {loading ? "Loading…" : "No records found"}
                    </td>
                  </tr>
                )}
              </tbody>

              {rows.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={4} style={{ textAlign: "right", fontWeight: 600 }}>
                      Total Qty:
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>
                      {totalQty.toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
