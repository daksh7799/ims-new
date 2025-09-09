// src/pages/LiveBarcodes.jsx
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
  const [rows, setRows] = useState([]);        // data from view
  const [q, setQ] = useState("");              // search
  const [onlyNoBarcode, setOnlyNoBarcode] = useState(false);
  const [loading, setLoading] = useState(true);

  // selection set of packet_codes (only acts on filtered/visible rows when using header checkbox)
  const [selected, setSelected] = useState(() => new Set());
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("v_live_barcodes_enriched")
      .select(
        "id, packet_code, finished_good_name, bin_code, status, is_no_barcode_return, returned_at, created_at, produced_at"
      )
      .order("id", { ascending: false });

    if (error) {
      alert(error.message);
      setRows([]);
    } else {
      // normalize created display (createdAt) with produced_at fallback (Option B)
      const norm = (data || []).map((r) => ({
        ...r,
        createdAt: r.created_at || r.produced_at || null,
      }));
      setRows(norm);
    }
    setLoading(false);
    setSelected(new Set()); // clear selection on refresh
  }

  useEffect(() => {
    load();
    // realtime refresh when packets mutate
    const ch = supabase
      .channel("realtime:pkts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "packets" },
        () => load()
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  // filtering
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let arr = rows || [];
    if (qq) {
      arr = arr.filter(
        (r) =>
          r.packet_code.toLowerCase().includes(qq) ||
          (r.finished_good_name || "").toLowerCase().includes(qq) ||
          (r.bin_code || "").toLowerCase().includes(qq)
      );
    }
    if (onlyNoBarcode) arr = arr.filter((r) => !!r.is_no_barcode_return);
    return arr;
  }, [rows, q, onlyNoBarcode]);

  // header checkbox state (acts only on currently filtered rows)
  const allVisibleSelected =
    filtered.length > 0 &&
    filtered.every((r) => selected.has(r.packet_code));
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
      if (checked) {
        filtered.forEach((r) => next.add(r.packet_code));
      } else {
        filtered.forEach((r) => next.delete(r.packet_code));
      }
      return next;
    });
  }

  function exportRows() {
    const data = filtered.map((r) => ({
      barcode: r.packet_code,
      item: r.finished_good_name,
      bin: r.bin_code || "-",
      status: r.status,
      source: r.is_no_barcode_return ? "No-Barcode Return" : "",
      returned_at: r.returned_at ? new Date(r.returned_at).toISOString() : "",
      created_at: r.createdAt ? new Date(r.createdAt).toISOString() : "",
    }));
    downloadCSV("live_barcodes.csv", data);
  }

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
      },
    });
  }

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
          </div>
        </div>

        <div className="bd" style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  {/* header checkbox toggles ONLY visible rows */}
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
                <th>Source</th>
                <th>Returned At</th>
                <th>Created</th>
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
                  <td>
                    {r.is_no_barcode_return ? (
                      <span className="badge" title="Created from Good Packet but Barcode Missing">
                        No-Barcode Return
                      </span>
                    ) : (
                      <span className="s" style={{ color: "var(--muted)" }}>—</span>
                    )}
                  </td>
                  <td>{fmtDate(r.returned_at)}</td>
                  <td>{fmtDate(r.createdAt)}</td>
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
