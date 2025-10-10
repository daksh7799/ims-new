import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { downloadCSV } from "../utils/csv";
import { useNavigate } from "react-router-dom";

function fmtDate(d) {
  if (!d) return "—";
  const t = typeof d === "string" ? Date.parse(d) : d;
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString();
}

export default function LiveBarcodes() {
  const [rows, setRows] = useState([]); // data from view
  const [q, setQ] = useState("");
  const [onlyNoBarcode, setOnlyNoBarcode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const navigate = useNavigate();

  /** -------------------- LOAD BAR CODES -------------------- **/
  async function load() {
    setLoading(true);
    setErr("");
    const { data, error } = await supabase
      .from("v_live_barcodes_enriched")
      .select(
        "id, packet_code, finished_good_name, bin_code, status, returned_at, produced_at, is_no_barcode_return"
      )
      .eq("status", "live") // ✅ fetch only live barcodes
      .order("id", { ascending: false });
    if (error) {
      console.error(error);
      setErr(error.message || String(error));
      setRows([]);
    } else {
      setRows(data || []);
    }
    setLoading(false);
    setSelected(new Set());
  }

  /** -------------------- AUTO + REALTIME REFRESH -------------------- **/
  useEffect(() => {
    load();

    // refresh every 30 s (lightweight, won't lag)
    const timer = setInterval(load, 30_000);

    // realtime triggers on DB changes
    const ch1 = supabase
      .channel("rt:packets")
      .on("postgres_changes", { event: "*", schema: "public", table: "packets" }, load);
    const ch2 = supabase
      .channel("rt:putaway")
      .on("postgres_changes", { event: "*", schema: "public", table: "packet_putaway" }, load);
    const ch3 = supabase
      .channel("rt:ledger")
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_ledger" }, load);

    ch1.subscribe();
    ch2.subscribe();
    ch3.subscribe();

    return () => {
      clearInterval(timer);
      try { supabase.removeChannel(ch1); } catch {}
      try { supabase.removeChannel(ch2); } catch {}
      try { supabase.removeChannel(ch3); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** -------------------- FILTER -------------------- **/
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (onlyNoBarcode && !r.is_no_barcode_return) return false;
      return (
        !qq ||
        r.packet_code?.toLowerCase().includes(qq) ||
        (r.finished_good_name || "").toLowerCase().includes(qq) ||
        (r.bin_code || "").toLowerCase().includes(qq)
      );
    });
  }, [rows, q, onlyNoBarcode]);

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
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) filtered.forEach((r) => next.add(r.packet_code));
      else filtered.forEach((r) => next.delete(r.packet_code));
      return next;
    });
  }

  /** -------------------- EXPORTS -------------------- **/
  function exportRows() {
    const data = filtered.map((r) => ({
      barcode: r.packet_code,
      item: r.finished_good_name,
      bin: r.bin_code || "-",
      status: r.status,
      no_barcode_return: r.is_no_barcode_return ? "Yes" : "No",
      returned_at: r.returned_at || "",
      produced_at: r.produced_at || "",
    }));
    downloadCSV("live_barcodes.csv", data);
  }

  /** -------------------- LABEL DOWNLOAD -------------------- **/
  function downloadSelected() {
    const chosen = filtered.filter((r) => selected.has(r.packet_code));
    if (!chosen.length) {
      alert("Select at least one barcode.");
      return;
    }
    const codes = chosen.map((r) => r.packet_code);
    const namesByCode = Object.fromEntries(
      chosen.map((r) => [r.packet_code, r.finished_good_name || ""])
    );
    navigate("/labels", {
      state: {
        title:
          chosen.length === 1 ? chosen[0].finished_good_name : "Selected Labels",
        codes,
        namesByCode,
        mode: "download"
      },
    });
  }

  /** -------------------- DIRECT PRINT -------------------- **/
  function printSelected() {
    const chosen = filtered.filter((r) => selected.has(r.packet_code));
    if (!chosen.length) {
      alert("Select at least one barcode.");
      return;
    }
    const codes = chosen.map((r) => r.packet_code);
    const namesByCode = Object.fromEntries(
      chosen.map((r) => [r.packet_code, r.finished_good_name || ""])
    );
    navigate("/labels", {
      state: {
        title:
          chosen.length === 1 ? chosen[0].finished_good_name : "Selected Labels",
        codes,
        namesByCode,
        mode: "print"
      },
    });
  }

  /** -------------------- UI -------------------- **/
  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Live Barcodes</b>
          <div className="row" style={{ gap: 8 }}>
            <input
              placeholder="Search barcode / item / bin…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: 280 }}
            />
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={onlyNoBarcode}
                onChange={(e) => setOnlyNoBarcode(e.target.checked)}
              />
              Show only “No-Barcode Returns”
            </label>
            <button className="btn outline" onClick={exportRows} disabled={loading}>
              Export CSV
            </button>
            <button
              className="btn"
              onClick={downloadSelected}
              disabled={[...selected].length === 0}
            >
              Download Selected Labels
            </button>
            <button
              className="btn ok"
              onClick={printSelected}
              disabled={[...selected].length === 0}
            >
              🖨️ Print
            </button>
          </div>
        </div>

        <div className="bd" style={{ overflow: "auto" }}>
          {!!err && (
            <div className="badge err" style={{ marginBottom: 8 }}>
              {err}
            </div>
          )}
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someVisibleSelected;
                    }}
                    onChange={(e) => toggleVisible(e.target.checked)}
                  />
                </th>
                <th>Barcode</th>
                <th>Item</th>
                <th>Bin</th>
                <th>Status</th>
                <th>No-Barcode Return</th>
                <th>Returned At</th>
                <th>Produced At</th>
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
                    {loading ? "Loading…" : "No barcodes"}
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
