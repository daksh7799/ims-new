import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import AsyncFGSelect from "../components/AsyncFGSelect.jsx";

function fmt(d) {
  if (!d) return "—";
  const t = typeof d === "string" ? Date.parse(d) : d;
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString();
}

export default function Returns() {
  const [tab, setTab] = useState("scan"); // scan | nobarcode | scrap

  // === Return by Scan
  const [scanCode, setScanCode] = useState("");
  const [scanNote, setScanNote] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [autoScan, setAutoScan] = useState(true);
  const scanTimer = useRef(null);
  const scanRef = useRef(null);

  // === No-barcode
  const [nbFgId, setNbFgId] = useState("");
  const [nbQty, setNbQty] = useState(1);
  const [nbNote, setNbNote] = useState("");
  const [nbBusy, setNbBusy] = useState(false);

  // === Scrap
  const [scrapCode, setScrapCode] = useState("");
  const [scrapNote, setScrapNote] = useState("");
  const [scrapBusy, setScrapBusy] = useState(false);
  const [autoScrap, setAutoScrap] = useState(true);
  const scrapTimer = useRef(null);
  const scrapRef = useRef(null);

  // === Recent
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [loadingRows, setLoadingRows] = useState(false);

  // === Load recent returns
  async function loadRows() {
    setLoadingRows(true);
    const { data, error } = await supabase
      .from("v_packet_returned_at")
      .select("*")
      .order("returned_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error(error);
      setRows([]);
    } else setRows(data || []);
    setLoadingRows(false);
  }

  useEffect(() => {
    loadRows();
    // realtime refresh
    const ch = supabase
      .channel("realtime:packet_returns")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "packet_returns" },
        () => loadRows()
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows || []).filter(
      (r) =>
        !s ||
        String(r.packet_code || "").toLowerCase().includes(s) ||
        String(r.finished_good_name || "").toLowerCase().includes(s) ||
        String(r.note || "").toLowerCase().includes(s)
    );
  }, [rows, q]);

  // === Return by Scan
  async function doReturnByScan(code) {
    const barcode = (code || "").trim();
    if (!barcode || scanBusy) return;
    setScanBusy(true);
    try {
      const { data, error } = await supabase.rpc("return_packet_scan", {
        p_packet_code: barcode,
        p_note: scanNote || null,
      });
      if (error) throw error;
      const msg =
        data?.message || `✅ Packet ${barcode} successfully returned`;
      alert(msg);
      setScanCode("");
      setScanNote("");
      await loadRows();
    } catch (err) {
      alert(`⚠️ ${err.message}`);
    } finally {
      setScanBusy(false);
      setTimeout(() => scanRef.current?.focus(), 0);
    }
  }

  function onScanKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      doReturnByScan(scanCode);
    }
  }

  useEffect(() => {
    if (tab !== "scan" || !autoScan) return;
    const v = scanCode.trim();
    if (!v) return;
    clearTimeout(scanTimer.current);
    scanTimer.current = setTimeout(() => doReturnByScan(v), 120);
    return () => clearTimeout(scanTimer.current);
  }, [scanCode, autoScan, tab]);

  // === No Barcode Return
  async function doNoBarcode() {
    if (!nbFgId) return alert("Select a Finished Good");
    const qty = Number(nbQty);
    if (!Number.isFinite(qty) || qty <= 0)
      return alert("Qty must be positive");

    setNbBusy(true);
    try {
      const { data, error } = await supabase.rpc("return_no_barcode", {
        p_finished_good_id: String(nbFgId),
        p_qty_units: qty,
        p_note: nbNote || null,
      });
      if (error) throw error;

      if (data?.ok) {
        const codes =
          Array.isArray(data.barcodes) && data.barcodes.length
            ? data.barcodes.join(", ")
            : "(barcode generated)";
        alert(
          `✅ ${data.fg_name || "Finished Good"} — ${qty} packet(s) created.\nBarcodes: ${codes}`
        );
      } else {
        alert("✅ No-barcode return created successfully.");
      }

      setNbFgId("");
      setNbQty(1);
      setNbNote("");
      await loadRows();
    } catch (err) {
      alert(`⚠️ ${err.message}`);
    } finally {
      setNbBusy(false);
    }
  }

  // === Scrap by Scan
  async function doScrapByScan(code) {
    const barcode = (code || "").trim();
    if (!barcode || scrapBusy) return;
    setScrapBusy(true);
    try {
      const { data, error } = await supabase.rpc("scrap_packet_by_barcode", {
        p_packet_code: barcode,
        p_note: scrapNote || null,
      });
      if (error) throw error;

      const msg =
        data?.message ||
        `♻️ Packet ${barcode} marked scrapped. RM recovery recorded.`;
      alert(msg);

      setScrapCode("");
      setScrapNote("");
      await loadRows();
    } catch (err) {
      alert(`⚠️ ${err.message}`);
    } finally {
      setScrapBusy(false);
      setTimeout(() => scrapRef.current?.focus(), 0);
    }
  }

  function onScrapKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      doScrapByScan(scrapCode);
    }
  }

  useEffect(() => {
    if (tab !== "scrap" || !autoScrap) return;
    const v = scrapCode.trim();
    if (!v) return;
    clearTimeout(scrapTimer.current);
    scrapTimer.current = setTimeout(() => doScrapByScan(v), 120);
    return () => clearTimeout(scrapTimer.current);
  }, [scrapCode, autoScrap, tab]);

  // === UI ===
  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Returns</b>
          <div className="row">
            <button
              className={`btn ${tab === "scan" ? "" : "outline"}`}
              onClick={() => setTab("scan")}
            >
              Return by Scan
            </button>
            <button
              className={`btn ${tab === "nobarcode" ? "" : "outline"}`}
              onClick={() => setTab("nobarcode")}
            >
              Return (No Barcode)
            </button>
            <button
              className={`btn ${tab === "scrap" ? "" : "outline"}`}
              onClick={() => setTab("scrap")}
            >
              Scrap by Scan
            </button>
          </div>
        </div>

        {/* === Return by Scan === */}
        {tab === "scan" && (
          <div className="bd grid gap-2">
            <div className="row flex-wrap gap-2">
              <input
                ref={scanRef}
                placeholder="Scan / Enter packet barcode (must be outwarded)"
                value={scanCode}
                onChange={(e) => setScanCode(e.target.value)}
                onKeyDown={onScanKey}
                style={{ minWidth: 360 }}
                autoFocus
                disabled={scanBusy}
              />
              <input
                placeholder="Note (optional)"
                value={scanNote}
                onChange={(e) => setScanNote(e.target.value)}
                style={{ minWidth: 260 }}
              />
              <button
                className="btn"
                onClick={() => doReturnByScan(scanCode)}
                disabled={scanBusy}
              >
                {scanBusy ? "Working…" : "Accept Return"}
              </button>
              <label className="row gap-1">
                <input
                  type="checkbox"
                  checked={autoScan}
                  onChange={(e) => setAutoScan(e.target.checked)}
                />
                Auto-scan
              </label>
            </div>
            <div className="s" style={{ color: "var(--muted)" }}>
              Only previously outwarded packets can be returned.
            </div>
          </div>
        )}

        {/* === No Barcode Return === */}
        {tab === "nobarcode" && (
          <div className="bd grid gap-2">
            <div className="row flex-wrap gap-2">
              <AsyncFGSelect
                value={nbFgId}
                onChange={(id) => setNbFgId(id)}
                placeholder="Select finished good…"
                minChars={1}
                pageSize={25}
              />
              <input
                type="number"
                min="1"
                value={nbQty}
                onChange={(e) => setNbQty(e.target.value)}
                style={{ width: 120 }}
              />
              <input
                placeholder="Note (optional)"
                value={nbNote}
                onChange={(e) => setNbNote(e.target.value)}
                style={{ minWidth: 260 }}
              />
              <button className="btn" onClick={doNoBarcode} disabled={nbBusy}>
                {nbBusy ? "Working…" : "Create Returns"}
              </button>
            </div>
            <div className="s" style={{ color: "var(--muted)" }}>
              Creates new packets (FG IN, reason{" "}
              <code>return_no_barcode</code>). They appear in live barcodes as
              “No-Barcode Return”.
            </div>
          </div>
        )}

        {/* === Scrap by Scan === */}
        {tab === "scrap" && (
          <div className="bd grid gap-2">
            <div className="row flex-wrap gap-2">
              <input
                ref={scrapRef}
                placeholder="Scan / Enter packet barcode"
                value={scrapCode}
                onChange={(e) => setScrapCode(e.target.value)}
                onKeyDown={onScrapKey}
                style={{ minWidth: 360 }}
                disabled={scrapBusy}
              />
              <input
                placeholder="Note (optional)"
                value={scrapNote}
                onChange={(e) => setScrapNote(e.target.value)}
                style={{ minWidth: 260 }}
              />
              <button
                className="btn"
                onClick={() => doScrapByScan(scrapCode)}
                disabled={scrapBusy}
              >
                {scrapBusy ? "Working…" : "Scrap"}
              </button>
              <label className="row gap-1">
                <input
                  type="checkbox"
                  checked={autoScrap}
                  onChange={(e) => setAutoScrap(e.target.checked)}
                />
                Auto-scan
              </label>
            </div>
            <div className="s" style={{ color: "var(--muted)" }}>
              When scrapped, FG OUT + RM IN (recovery) is logged automatically.
            </div>
          </div>
        )}
      </div>

      {/* === Recent Returns === */}
      <div className="card">
        <div className="hd">
          <b>Recent Returns</b>
          <div className="row">
            <input
              placeholder="Search packet / item / note…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: 280 }}
            />
            <button
              className="btn outline"
              onClick={loadRows}
              disabled={loadingRows}
            >
              {loadingRows ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        <div className="bd" style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>When</th>
                <th>Packet</th>
                <th>Item</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{fmt(r.returned_at)}</td>
                  <td style={{ fontFamily: "monospace" }}>
                    {r.packet_code || "—"}
                  </td>
                  <td>{r.finished_good_name || "—"}</td>
                  <td>{r.note || "—"}</td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan="5" style={{ color: "var(--muted)" }}>
                    No returns
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
