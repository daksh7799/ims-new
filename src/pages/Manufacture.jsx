import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { supabase } from "../supabaseClient";
import { useNavigate } from "react-router-dom";
import AsyncFGSelect from "../components/AsyncFGSelect.jsx";

const LS_SINGLE = "lastSingleRun";
const LS_BULK = "lastBulkRun";

export default function ManufacturePage() {
  const [tab, setTab] = useState("single");
  const navigate = useNavigate();

  /* =========================================================
   * SINGLE MANUFACTURE
   * ======================================================= */
  const [fgId, setFgId] = useState("");
  const [fgName, setFgName] = useState("");
  const [qty, setQty] = useState(1);
  const [making, setMaking] = useState(false);
  const [lastBatch, setLastBatch] = useState(null);
  const [singleCreated, setSingleCreated] = useState([]);

  // load last single run from localStorage
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_SINGLE) || "[]");
      if (Array.isArray(saved)) setSingleCreated(saved);
    } catch {
      /* ignore */
    }
  }, []);

  async function manufactureOnce() {
    if (!fgId) return alert("Select a finished good");
    const n = Math.max(1, Math.floor(Number(qty)));
    if (!Number.isFinite(n) || n <= 0) return alert("Enter valid quantity (>=1)");

    setMaking(true);
    setLastBatch(null);
    try {
      const { data, error } = await supabase.rpc("create_manufacture_batch_v3", {
        p_finished_good_id: fgId,
        p_qty_units: n,
      });
      if (error) throw error;

      const batchId = data?.batch_id;
      const made = Number(data?.packets_created || 0);
      if (!batchId || made <= 0) {
        throw new Error("Manufacture failed (no packets)");
      }

      setLastBatch({ batch_id: batchId, packets_created: made });

      // fetch packets for preview
      const { data: ps, error: e2 } = await supabase
        .from("packets")
        .select("packet_code")
        .eq("batch_id", batchId)
        .order("id");
      if (e2) throw e2;

      const list =
        (ps || []).map((p) => ({
          code: p.packet_code,
          name: fgName || "",
        })) || [];
      setSingleCreated(list);
      try {
        localStorage.setItem(LS_SINGLE, JSON.stringify(list));
      } catch {
        /* ignore */
      }
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      setMaking(false);
    }
  }

  function openLabelsSingle() {
    if (!singleCreated.length) return;
    const codes = singleCreated.map((x) => x.code);
    const namesByCode = Object.fromEntries(singleCreated.map((x) => [x.code, x.name]));
    navigate("/labels", {
      state: { title: fgName || "Labels", codes, namesByCode },
    });
  }

  function printLabelsSingle() {
    if (!singleCreated.length) return;
    const codes = singleCreated.map((x) => x.code);
    const namesByCode = Object.fromEntries(singleCreated.map((x) => [x.code, x.name]));
    navigate("/labels", {
      state: { title: fgName || "Labels", codes, namesByCode, autoPrint: true },
    });
  }

  function clearLastSingle() {
    setSingleCreated([]);
    setLastBatch(null);
    try {
      localStorage.removeItem(LS_SINGLE);
    } catch {
      /* ignore */
    }
  }

  /* =========================================================
   * BULK MANUFACTURE
   * ======================================================= */
  // master list from DB (all active FGs)
  const [fgList, setFgList] = useState([]);
  // rows user uploaded (only qty > 0)
  const [rows, setRows] = useState([]);
  // loading flags
  const [bulkLoading, setBulkLoading] = useState(false);
  // created barcodes from bulk run
  const [bulkCreated, setBulkCreated] = useState([]);

  // fetch ALL finished goods, paginated
  useEffect(() => {
    (async () => {
      let all = [];
      let from = 0;
      const pageSize = 1000;
      // paginate until no more rows
      // this way we support 2k+ FGs
      while (true) {
        const { data, error } = await supabase
          .from("finished_goods")
          .select("id,name")
          .eq("is_active", true)
          .order("name", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data?.length) break;
        all = all.concat(data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      setFgList(all);
    })().catch((err) => {
      console.error("Failed to load finished_goods:", err);
      alert(`Failed to load finished_goods: ${err.message || err}`);
    });
  }, []);

  // load last bulk run preview
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_BULK) || "[]");
      if (Array.isArray(saved)) setBulkCreated(saved);
    } catch {
      /* ignore */
    }
  }, []);

  // helper: normalize FG names for matching
  function normalizeName(s) {
    return (
      s
        ?.toString()
        .normalize("NFKC")
        .replace(/\s+/g, " ")
        .replace(/\u00A0/g, " ")
        .replace(/[“”‘’]/g, '"')
        .replace(/’/g, "'")
        .replace(/[‐-‒–—―]/g, "-")
        .replace(/\( *([^)]+) *\)/g, (_, x) => `(${x.trim()})`)
        .trim()
        .toLowerCase() || ""
    );
  }

  // user uploads CSV/XLSX
  function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      // support xlsx and csv both
      const wb = XLSX.read(ev.target.result, { type: "binary" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: "" });

      // We accept header "finished_good" (this is what you asked)
      // and we keep only rows with qty > 0
      const parsed = json
        .map((r) => {
          const name = String(
            r.finished_good ??
              r.FINISHED_GOOD ??
              r["finished good"] ??
              r["Finished Good"] ??
              ""
          ).trim();
          const qty = Number(r.qty ?? r.QTY ?? 0);
          return { name, qty };
        })
        .filter((r) => r.name && Number.isFinite(r.qty) && r.qty > 0);

      setRows(parsed);
      e.target.value = ""; // reset input
    };
    reader.readAsBinaryString(f);
  }

  // download a CSV of ALL finished goods, qty blank
  async function downloadTemplateCSV() {
    try {
      const pageSize = 1000;
      let from = 0;
      let all = [];

      while (true) {
        const { data, error } = await supabase
          .from("finished_goods")
          .select("name")
          .eq("is_active", true)
          .order("name", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data?.length) break;
        all = all.concat(data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      // header EXACTLY as you wanted
      const header = "finished_good,qty\n";
      const body = all.map((fg) => `${fg.name},`).join("\n");
      const blob = new Blob([header + body], {
        type: "text/csv;charset=utf-8;",
      });
      saveAs(blob, "bulk_manufacture_template.csv");
    } catch (err) {
      alert("Failed to download template: " + (err?.message || String(err)));
    }
  }

  // run bulk manufacture for rows (only those with qty>0, already filtered)
  async function runBulk() {
    if (!rows.length) return alert("No valid rows in sheet");

    setBulkLoading(true);
    const allCreated = [];

    try {
      // Build a lookup: normalized name -> id
      const idx = {};
      fgList.forEach((f) => {
        idx[normalizeName(f.name)] = f.id;
      });

      // group by normalized name (so if sheet has same FG in 2 lines, we add qty)
      const grouped = {};
      for (const r of rows) {
        const key = normalizeName(r.name);
        const displayName = r.name.trim();
        const qty = Math.floor(Number(r.qty));
        if (!key || !qty || qty <= 0) continue;
        if (!grouped[key]) grouped[key] = { name: displayName, qty: 0 };
        grouped[key].qty += qty;
      }

      const entries = Object.entries(grouped);

      for (const [normKey, val] of entries) {
        const fgUUID = idx[normKey];
        if (!fgUUID) {
          // FG name from sheet not found in DB
          alert(`FG not found: ${val.name}`);
          continue;
        }

        // call your RPC
        const { data, error } = await supabase.rpc(
          "create_manufacture_batch_v3",
          {
            p_finished_good_id: fgUUID,
            p_qty_units: val.qty,
          }
        );
        if (error) {
          console.error("RPC failed for", val.name, error);
          alert(`Failed for ${val.name}: ${error.message}`);
          continue;
        }

        const batchId = data?.batch_id;
        const made = Number(data?.packets_created || 0);
        if (!batchId || made <= 0) {
          console.warn("No packets created for", val.name);
          continue;
        }

        // fetch created packets for this batch
        const { data: ps, error: e2 } = await supabase
          .from("packets")
          .select("packet_code")
          .eq("batch_id", batchId)
          .order("id");

        if (e2) {
          console.error("Fetch packets failed for", val.name, e2);
          continue;
        }

        (ps || []).forEach((p) => {
          allCreated.push({
            code: p.packet_code,
            name: val.name, // keep sheet's capitalization
          });
        });
      }

      setBulkCreated(allCreated);
      try {
        localStorage.setItem(LS_BULK, JSON.stringify(allCreated));
      } catch {
        /* ignore */
      }

      alert(`✅ Bulk manufacturing complete — ${allCreated.length} packets created.`);
    } catch (err) {
      console.error("Bulk run failed:", err);
      alert(`Bulk manufacturing failed: ${err.message || err}`);
    } finally {
      setBulkLoading(false);
    }
  }

  function openLabelsBulk() {
    if (!bulkCreated.length) return;
    const codes = bulkCreated.map((x) => x.code);
    const namesByCode = Object.fromEntries(bulkCreated.map((x) => [x.code, x.name]));
    navigate("/labels", {
      state: { title: "Bulk Labels", codes, namesByCode },
    });
  }

  function printLabelsBulk() {
    if (!bulkCreated.length) return;
    const codes = bulkCreated.map((x) => x.code);
    const namesByCode = Object.fromEntries(bulkCreated.map((x) => [x.code, x.name]));
    navigate("/labels", {
      state: { title: "Bulk Labels", codes, namesByCode, autoPrint: true },
    });
  }

  function clearLastBulk() {
    setBulkCreated([]);
    try {
      localStorage.removeItem(LS_BULK);
    } catch {
      /* ignore */
    }
  }

  /* =========================================================
   * RENDER
   * ======================================================= */
  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Manufacture</b>
          <div className="row">
            <button
              className={`btn ghost ${tab === "single" ? "active" : ""}`}
              onClick={() => setTab("single")}
            >
              Single
            </button>
            <button
              className={`btn ghost ${tab === "bulk" ? "active" : ""}`}
              onClick={() => setTab("bulk")}
            >
              Bulk
            </button>
          </div>
        </div>

        <div className="bd">
          {/* ================= SINGLE TAB ================= */}
          {tab === "single" && (
            <>
              <div
                className="row"
                style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}
              >
                <AsyncFGSelect
                  value={fgId}
                  onChange={(id, item) => {
                    setFgId(String(id || ""));
                    setFgName(item?.name || "");
                  }}
                  placeholder="Search finished goods…"
                  minChars={1}
                  pageSize={25}
                />
                <input
                  type="number"
                  min="1"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  style={{ width: 140 }}
                  placeholder="Qty (units)"
                />
                <button
                  className="btn"
                  onClick={manufactureOnce}
                  disabled={making || !fgId || Number(qty) <= 0}
                >
                  {making ? "Manufacturing…" : "Create Packets"}
                </button>
                <button
                  className="btn outline"
                  onClick={openLabelsSingle}
                  disabled={!singleCreated.length}
                >
                  Open Labels (2-up PDF)
                </button>
                <button
                  className="btn"
                  onClick={printLabelsSingle}
                  disabled={!singleCreated.length}
                >
                  🖨️ Print Labels (2-up)
                </button>
                <button
                  className="btn ghost"
                  onClick={clearLastSingle}
                  disabled={!singleCreated.length}
                >
                  Clear Last
                </button>
              </div>

              {!!lastBatch && (
                <div className="row" style={{ marginTop: 6, gap: 8 }}>
                  <span className="badge">Batch: {lastBatch.batch_id}</span>
                  <span className="badge">Packets: {lastBatch.packets_created}</span>
                </div>
              )}

              <div className="card" style={{ marginTop: 10 }}>
                <div className="hd">
                  <b>Last Run Preview (Single)</b>
                  <span className="badge">
                    {singleCreated.length
                      ? `${singleCreated.length} packets`
                      : "None"}
                  </span>
                </div>
                <div className="bd">
                  {!singleCreated.length && (
                    <div className="badge">No single manufacture yet</div>
                  )}
                  {!!singleCreated.length && (
                    <div
                      className="grid"
                      style={{
                        gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))",
                      }}
                    >
                      {singleCreated.map((x) => (
                        <div key={x.code} className="card">
                          <div className="bd">
                            <div style={{ fontWeight: 600 }}>
                              {x.name || fgName || "—"}
                            </div>
                            <code
                              style={{
                                fontFamily: "monospace",
                                wordBreak: "break-all",
                              }}
                            >
                              {x.code}
                            </code>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ================= BULK TAB ================= */}
          {tab === "bulk" && (
            <>
              <div
                className="row"
                style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}
              >
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={onFile}
                />
                <button
                  className="btn"
                  onClick={runBulk}
                  disabled={bulkLoading || !rows.length}
                >
                  {bulkLoading ? "Working…" : "Create Batches"}
                </button>
                <button
                  className="btn outline"
                  onClick={openLabelsBulk}
                  disabled={!bulkCreated.length}
                >
                  Open Labels (2-up PDF)
                </button>
                <button
                  className="btn"
                  onClick={printLabelsBulk}
                  disabled={!bulkCreated.length}
                >
                  🖨️ Print Labels (2-up)
                </button>
                <button
                  className="btn ghost"
                  onClick={clearLastBulk}
                  disabled={!bulkCreated.length}
                >
                  Clear Last
                </button>
                <button className="btn ghost" onClick={downloadTemplateCSV}>
                  📄 Download Sample CSV
                </button>
              </div>

              <div
                className="s"
                style={{ color: "var(--muted)", marginTop: 6 }}
              >
                Upload CSV with columns: <code>finished_good</code>,{" "}
                <code>qty</code>. Only rows with qty &gt; 0 will be processed.
              </div>

              {/* Preview of uploaded rows (to be created) */}
              {!!rows.length && (
                <div className="card" style={{ marginTop: 10 }}>
                  <div className="hd">
                    <b>Upload Preview</b>
                    <span className="badge">{rows.length} item(s)</span>
                  </div>
                  <div className="bd" style={{ overflow: "auto" }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Finished Good (from CSV)</th>
                          <th style={{ textAlign: "right" }}>Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i}>
                            <td>{r.name}</td>
                            <td style={{ textAlign: "right" }}>{r.qty}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Last created barcodes preview */}
              <div className="card" style={{ marginTop: 10 }}>
                <div className="hd">
                  <b>Last Upload Preview (Bulk)</b>
                  <span className="badge">
                    {bulkCreated.length ? `${bulkCreated.length} packets` : "None"}
                  </span>
                </div>
                <div className="bd">
                  {!bulkCreated.length && (
                    <div className="badge">No bulk upload yet</div>
                  )}
                  {!!bulkCreated.length && (
                    <div
                      className="grid"
                      style={{
                        gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))",
                      }}
                    >
                      {bulkCreated.map((x) => (
                        <div key={x.code} className="card">
                          <div className="bd">
                            <div style={{ fontWeight: 600 }}>{x.name}</div>
                            <code
                              style={{
                                fontFamily: "monospace",
                                wordBreak: "break-all",
                              }}
                            >
                              {x.code}
                            </code>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
