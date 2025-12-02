import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import Papa from "papaparse";
import { saveAs } from "file-saver";
import { useToast } from "../ui/toast.jsx";

function normBin(s) {
  return (s || "").trim().toUpperCase();
}

export default function Putaway() {
  const { push } = useToast();
  const [bins, setBins] = useState([]);
  const [bin, setBin] = useState("");
  const [binNorm, setBinNorm] = useState("");
  const [scan, setScan] = useState("");
  const [assigning, setAssigning] = useState(false);

  const [contents, setContents] = useState([]);
  const [unbinned, setUnbinned] = useState([]);
  const [loadingC, setLoadingC] = useState(false);
  const [loadingU, setLoadingU] = useState(false);
  const [message, setMessage] = useState("");

  // Pagination for unbinned
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const [autoMode, setAutoMode] = useState(true);
  const debounceRef = useRef(null);
  const scanRef = useRef(null);

  // BULK STATES
  const [bulkRows, setBulkRows] = useState([]);
  const [bulkResults, setBulkResults] = useState([]);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkColor, setBulkColor] = useState("var(--accent)"); // blue by default

  // Load bins
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("bins")
          .select("code")
          .eq("is_active", true)
          .order("code");
        if (error) throw error;
        setBins((data || []).map((b) => b.code));
      } catch (e) {
        console.error(e);
        push(e.message || String(e), "err");
      }
    })();
  }, []);

  useEffect(() => {
    setBinNorm(normBin(bin));
  }, [bin]);

  async function loadContents() {
    if (!binNorm) {
      setContents([]);
      return;
    }
    setLoadingC(true);
    try {
      const { data, error } = await supabase
        .from("v_bin_contents")
        .select(
          "packet_code, finished_good_name, status, produced_at, added_at, bin_code"
        )
        .eq("bin_code", binNorm)
        .order("added_at", { ascending: false });
      if (error) throw error;
      setContents(data || []);
    } catch (e) {
      push(e.message || String(e), "err");
      setContents([]);
    } finally {
      setLoadingC(false);
    }
  }

  async function loadUnbinned() {
    setLoadingU(true);
    try {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data, error } = await supabase
        .from("v_unbinned_live_packets")
        .select("packet_code, finished_good_name, status, produced_at")
        .order("produced_at", { ascending: false })
        .range(from, to);

      if (error) throw error;
      setUnbinned(data || []);
    } catch (e) {
      push(e.message || String(e), "err");
      setUnbinned([]);
    } finally {
      setLoadingU(false);
    }
  }

  // realtime updates
  useEffect(() => {
    loadUnbinned();
    const ch1 = supabase
      .channel("rt:putaway_hist")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "packet_putaway" },
        () => {
          loadUnbinned();
          loadContents();
        }
      );
    const ch2 = supabase
      .channel("rt:packets")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "packets" },
        () => {
          loadUnbinned();
          loadContents();
        }
      );
    ch1.subscribe();
    ch2.subscribe();
    return () => {
      try {
        supabase.removeChannel(ch1);
        supabase.removeChannel(ch2);
      } catch { }
    };
  }, [binNorm, page]); // Reload when page changes too

  useEffect(() => {
    loadContents();
  }, [binNorm]);

  // === Single assign ===
  async function tryAssign(code) {
    const barcode = (code || "").trim();
    if (!barcode || !binNorm) return;
    if (assigning) return;
    setAssigning(true);
    try {
      const { error } = await supabase.rpc("assign_packet_to_bin", {
        p_packet_code: barcode,
        p_bin_code: binNorm,
      });
      if (error) throw error;
      setScan("");
      push(`Assigned ${barcode} to ${binNorm}`, "ok");
      await Promise.all([loadUnbinned(), loadContents()]);
    } catch (e) {
      push(e.message || String(e), "err");
    } finally {
      setAssigning(false);
      setTimeout(() => scanRef.current?.focus(), 0);
    }
  }

  function onScanKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (scan) tryAssign(scan);
    }
  }

  function onScanChange(e) {
    const val = e.target.value;
    setScan(val);
    if (!autoMode || !binNorm) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val && val.length >= 10) {
      debounceRef.current = setTimeout(() => {
        tryAssign(val);
      }, 120);
    }
  }

  // === BULK UPLOAD ===
  function handleCSVUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const rows = res.data.map((r) => ({
          packet_code: (r["Packet Code"] || r["packet_code"] || "").trim(),
          bin_code: (r["Bin Code"] || r["bin_code"] || "").trim(),
        }));
        setBulkRows(rows);
        setBulkResults([]);
        setBulkProgress(0);
        setBulkColor("var(--accent)");
      },
    });
  }

  async function startBulkAssign() {
    if (!bulkRows.length) return;
    setBulkRunning(true);
    setBulkProgress(0);
    setBulkColor("var(--accent)");

    try {
      // Call the bulk RPC function with all rows at once
      const { data: results, error } = await supabase.rpc("assign_packets_bulk_fast", {
        p_records: bulkRows
      });

      if (error) throw error;

      // Process results
      const formattedResults = (results || []).map(r => ({
        packet_code: r.packet_code,
        bin_code: r.bin_code,
        success: r.success,
        message: r.error_message || ""
      }));

      setBulkResults(formattedResults);
      setBulkProgress(100);
      setBulkRunning(false);
      await Promise.all([loadUnbinned(), loadContents()]);

      const allSuccess = formattedResults.every((r) => r.success);
      const anyFailed = formattedResults.some((r) => !r.success);

      if (allSuccess) {
        setBulkColor("var(--ok)");
        push("✅ All packets successfully assigned!", "ok");
        setTimeout(() => {
          setBulkRows([]);
          setBulkResults([]);
          setBulkProgress(0);
        }, 1200);
      } else if (anyFailed) {
        setBulkColor("var(--err)");
        const failedCount = formattedResults.filter(r => !r.success).length;
        push(`⚠️ ${failedCount} packet(s) failed. Download error report for details.`, "warn");
      }
    } catch (e) {
      setBulkRunning(false);
      setBulkColor("var(--err)");
      push(e.message || String(e), "err");
    }
  }

  function downloadErrorReport() {
    const failed = bulkResults.filter((r) => !r.success);
    if (!failed.length) return;
    const csv = Papa.unparse(
      failed.map((f) => ({
        "Packet Code": f.packet_code,
        "Bin Code": f.bin_code,
        Status: "❌ Failed",
        "Error Message": f.message,
      }))
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    saveAs(blob, "Putaway_Error_Report.csv");
  }

  function downloadSampleCSV() {
    const sample = Papa.unparse([
      { "Packet Code": "ABC123456", "Bin Code": "A100" },
      { "Packet Code": "XYZ789012", "Bin Code": "A200" },
    ]);
    const blob = new Blob([sample], { type: "text/csv;charset=utf-8" });
    saveAs(blob, "Sample_Putaway.csv");
  }

  return (
    <div className="grid">
      {/* === NORMAL PUTAWAY === */}
      <div className="card">
        <div className="hd">
          <b>Bin Putaway</b>
        </div>
        <div className="bd">
          <div
            className="row"
            style={{ gap: 8, marginBottom: 8, alignItems: "center" }}
          >
            <select
              value={bin}
              onChange={(e) => setBin(e.target.value)}
              style={{ minWidth: 160 }}
            >
              <option value="">Select Bin</option>
              {bins.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>

            <input
              ref={scanRef}
              placeholder={
                binNorm
                  ? `Scan barcode → assign to ${binNorm}`
                  : "Select a bin first"
              }
              value={scan}
              onChange={onScanChange}
              onKeyDown={onScanKey}
              disabled={!binNorm || assigning}
              style={{ minWidth: 320 }}
            />

            <button
              className="btn"
              onClick={() => tryAssign(scan)}
              disabled={!scan || !binNorm || assigning}
            >
              {assigning ? "Assigning…" : `Assign to ${binNorm || "—"}`}
            </button>

            <button
              className={`btn ${autoMode ? "" : "outline"}`}
              onClick={() => setAutoMode((v) => !v)}
            >
              Auto-Assign: {autoMode ? "ON" : "OFF"}
            </button>
          </div>
        </div>
      </div>

      {/* === BULK PUTAWAY === */}
      <div className="card">
        <div className="hd">
          <b>📦 Bulk Putaway Upload</b>
          <button className="btn small" onClick={downloadSampleCSV}>
            Download Sample CSV
          </button>
        </div>
        <div className="bd">
          <input
            type="file"
            accept=".csv"
            onChange={handleCSVUpload}
            style={{ marginBottom: 10 }}
          />

          {bulkRows.length > 0 && (
            <>
              <div style={{ marginBottom: 8 }}>
                <b>{bulkRows.length}</b> rows loaded.
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Packet Code</th>
                    <th>Bin Code</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkRows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.packet_code}</td>
                      <td>{r.bin_code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {!bulkRunning && (
                <button className="btn" onClick={startBulkAssign}>
                  Start Assign
                </button>
              )}

              {bulkRunning && (
                <div style={{ marginTop: 10 }}>
                  <div
                    style={{
                      width: "100%",
                      height: 10,
                      background: "#222",
                      borderRadius: 6,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${bulkProgress}%`,
                        height: "100%",
                        background: bulkColor,
                        transition: "width 0.2s ease, background 0.3s ease",
                      }}
                    />
                  </div>
                  <div className="s">
                    {Math.round(bulkProgress)}% completed
                  </div>
                </div>
              )}
            </>
          )}

          {bulkResults.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <b>Results:</b>
              <div>
                ✅ Success: {bulkResults.filter((r) => r.success).length} | ❌
                Failed: {bulkResults.filter((r) => !r.success).length}
              </div>
              {bulkResults.some((r) => !r.success) && (
                <button
                  className="btn small"
                  style={{ marginTop: 8 }}
                  onClick={downloadErrorReport}
                >
                  Download Error Report (CSV)
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* === Bin Contents === */}
      <div className="card">
        <div className="hd">
          <b>Contents of Bin {binNorm || "—"}</b>
          <span className="badge">{contents.length} items</span>
        </div>
        <div className="bd" style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Barcode</th>
                <th>Item</th>
                <th>Status</th>
                <th>Produced</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {contents.map((r, i) => (
                <tr key={`${r.packet_code}-${i}`}>
                  <td style={{ fontFamily: "monospace" }}>{r.packet_code}</td>
                  <td>{r.finished_good_name}</td>
                  <td>
                    <span className="badge">{r.status}</span>
                  </td>
                  <td>
                    {r?.produced_at
                      ? new Date(r.produced_at).toLocaleString()
                      : "—"}
                  </td>
                  <td>
                    {r?.added_at
                      ? new Date(r.added_at).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))}
              {!contents.length && (
                <tr>
                  <td colSpan="5" style={{ color: "var(--muted)" }}>
                    No packets in this bin
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* === Unbinned === */}
      <div className="card">
        <div className="hd">
          <b>Unbinned Live Packets</b>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn small outline"
              disabled={page === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
            >
              Previous
            </button>
            <span className="badge">Page {page + 1}</span>
            <button
              className="btn small outline"
              disabled={unbinned.length < pageSize}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
        <div className="bd" style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Barcode</th>
                <th>Item</th>
                <th>Status</th>
                <th>Produced</th>
              </tr>
            </thead>
            <tbody>
              {unbinned.map((r, i) => (
                <tr key={`${r.packet_code}-${i}`}>
                  <td style={{ fontFamily: "monospace" }}>{r.packet_code}</td>
                  <td>{r.finished_good_name}</td>
                  <td>
                    <span className="badge">{r.status}</span>
                  </td>
                  <td>
                    {r?.produced_at
                      ? new Date(r.produced_at).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))}
              {!unbinned.length && (
                <tr>
                  <td colSpan="4" style={{ color: "var(--muted)" }}>
                    {loadingU ? "Loading..." : "No unbinned packets"}
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
