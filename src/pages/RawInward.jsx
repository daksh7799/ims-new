import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

const today = () => new Date().toISOString().slice(0, 10);

export default function RawInward() {
  const [vendors, setVendors] = useState([]);
  const [recent, setRecent] = useState([]);

  const [header, setHeader] = useState({
    vendor_id: "",
    purchase_date: today(),
    bill_no: "",
  });

  const [lines, setLines] = useState([
    { raw_material_id: "", raw_material_name: "", qty: "", unit: "" },
  ]);
  const [loading, setLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]); // dynamic dropdown

  /** ---------------- LOAD VENDORS + RECENT ---------------- **/
  async function loadData() {
    setLoading(true);
    try {
      const [{ data: v, error: e2 }, { data: r, error: e3 }] = await Promise.all([
        supabase.from("vendors").select("id,name").order("name"),
        supabase
          .from("raw_inward")
          .select("id,bill_no,qty,purchase_date,raw_materials(name,unit),vendors(name)")
          .order("id", { ascending: false })
          .limit(50),
      ]);
      if (e2) throw e2;
      if (e3) throw e3;
      setVendors(v || []);
      setRecent(r || []);
    } catch (err) {
      alert(`Load error: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadData();
  }, []);

  /** ---------------- DYNAMIC SEARCH ---------------- **/
  async function searchRawMaterial(keyword, lineIdx) {
    const q = keyword.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    const { data, error } = await supabase
      .from("raw_materials")
      .select("id,name,unit")
      .ilike("name", `%${q}%`)
      .limit(10);
    if (error) {
      console.warn(error);
      return;
    }
    setSearchResults(data.map(r => ({ ...r, lineIdx })));
  }

  function selectMaterial(lineIdx, mat) {
    setLines(ls =>
      ls.map((ln, i) =>
        i === lineIdx
          ? {
              ...ln,
              raw_material_id: mat.id,
              raw_material_name: mat.name,
              unit: mat.unit || "",
            }
          : ln
      )
    );
    setSearchResults([]);
  }

  /** ---------------- LINES HANDLERS ---------------- **/
  function addLine() {
    setLines(ls => [...ls, { raw_material_id: "", raw_material_name: "", qty: "", unit: "" }]);
  }
  function removeLine(i) {
    setLines(ls => ls.filter((_, idx) => idx !== i));
  }
  function updateLine(i, patch) {
    setLines(ls => ls.map((ln, idx) => (idx === i ? { ...ln, ...patch } : ln)));
  }
  function clearLines() {
    setLines([{ raw_material_id: "", raw_material_name: "", qty: "", unit: "" }]);
  }

  /** ---------------- COMPUTED ---------------- **/
  const validLines = useMemo(
    () =>
      lines
        .map(l => ({
          raw_material_id: String(l.raw_material_id || "").trim(),
          qty: Number(l.qty),
        }))
        .filter(l => l.raw_material_id && Number.isFinite(l.qty) && l.qty > 0),
    [lines]
  );

  const totalRows = validLines.length;
  const totalQty = validLines.reduce((n, l) => n + Number(l.qty || 0), 0);

  /** ---------------- SAVE BILL ---------------- **/
  async function saveBill({ keepVendor = true } = {}) {
    if (!String(header.vendor_id).trim()) return alert("Select a vendor");
    if (!String(header.bill_no).trim()) return alert("Enter Bill No");
    if (!String(header.purchase_date).trim()) return alert("Choose a date");
    if (validLines.length === 0) return alert("Add at least one raw material with quantity");

    setLoading(true);
    try {
      const payload = validLines.map(l => ({
        raw_material_id: l.raw_material_id,
        vendor_id: String(header.vendor_id).trim(),
        bill_no: String(header.bill_no).trim(),
        qty: l.qty,
        purchase_date: header.purchase_date,
      }));

      const { error } = await supabase.from("raw_inward").insert(payload);
      if (error) throw error;

      await loadData();
      clearLines();
      setHeader(h => ({
        vendor_id: keepVendor ? h.vendor_id : "",
        purchase_date: today(),
        bill_no: "",
      }));
    } catch (err) {
      alert(`Save error: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  }

  /** ---------------- UI ---------------- **/
  return (
    <div className="grid">
      {/* HEADER */}
      <div className="card">
        <div className="hd">
          <b>Raw Material Inward</b>
          <div className="row" style={{ gap: 6 }}>
            <span className="badge">{loading ? "Working…" : "Ready"}</span>
            <span className="badge">Lines: {totalRows}</span>
            <span className="badge">Total Qty: {totalQty}</span>
          </div>
        </div>

        <div className="bd">
          <div className="row" style={{ marginBottom: 10, gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={header.vendor_id}
              onChange={e => setHeader(h => ({ ...h, vendor_id: e.target.value }))}
              style={{ minWidth: 260 }}
              required
              disabled={loading}
            >
              <option value="">Select Vendor</option>
              {vendors.map(v => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>

            <input
              placeholder="Bill No"
              value={header.bill_no}
              onChange={e => setHeader(h => ({ ...h, bill_no: e.target.value }))}
              style={{ minWidth: 180 }}
              disabled={loading}
            />

            <input
              type="date"
              value={header.purchase_date}
              onChange={e => setHeader(h => ({ ...h, purchase_date: e.target.value }))}
              disabled={loading}
            />
          </div>

          {/* LINES */}
          <div className="card" style={{ background: "transparent" }}>
            <div className="hd" style={{ display: "grid", gridTemplateColumns: "1fr auto" }}>
              <b>Bill Lines</b>
              <span className="badge">{totalRows} line(s)</span>
            </div>
            <div className="bd">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: "45%" }}>Raw Material</th>
                    <th style={{ width: "20%" }}>Qty</th>
                    <th>Unit</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((ln, idx) => (
                    <tr key={idx}>
                      <td style={{ position: "relative" }}>
                        <input
                          type="text"
                          placeholder="Search Raw Material"
                          value={ln.raw_material_name}
                          onChange={e => {
                            updateLine(idx, { raw_material_name: e.target.value });
                            searchRawMaterial(e.target.value, idx);
                          }}
                          disabled={loading}
                          style={{ width: "100%" }}
                        />
                        {searchResults.length > 0 &&
                          searchResults[0].lineIdx === idx && (
                            <ul
                              style={{
                                position: "absolute",
                                top: "100%",
                                left: 0,
                                right: 0,
                                zIndex: 10,
                                background: "#fff",
                                border: "1px solid #ddd",
                                borderRadius: 6,
                                listStyle: "none",
                                margin: 0,
                                padding: 0,
                                maxHeight: 150,
                                overflowY: "auto",
                              }}
                            >
                              {searchResults.map(m => (
                                <li
                                  key={m.id}
                                  onClick={() => selectMaterial(idx, m)}
                                  style={{
                                    padding: "6px 10px",
                                    cursor: "pointer",
                                    borderBottom: "1px solid #eee",
                                  }}
                                >
                                  {m.name}{" "}
                                  <span style={{ color: "#888", fontSize: 12 }}>
                                    ({m.unit})
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.0001"
                          min="0"
                          placeholder="Qty"
                          value={ln.qty}
                          onChange={e => updateLine(idx, { qty: e.target.value })}
                          style={{ width: 100 }}
                          disabled={loading}
                          onKeyDown={e => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addLine();
                            }
                          }}
                        />
                      </td>
                      <td>{ln.unit || "-"}</td>
                      <td>
                        <button className="btn ghost" onClick={() => removeLine(idx)} disabled={loading}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="row" style={{ marginTop: 10, gap: 8 }}>
                <button className="btn outline" onClick={addLine} disabled={loading}>
                  + Add Line
                </button>
                <button className="btn" onClick={() => saveBill({ keepVendor: true })} disabled={loading}>
                  Save Bill (Keep Vendor)
                </button>
                <button className="btn ghost" onClick={() => saveBill({ keepVendor: false })} disabled={loading}>
                  Save & New Vendor
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* RECENT */}
      <div className="card">
        <div className="hd"><b>Recent Inwards</b></div>
        <div className="bd" style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>ID</th><th>Bill No</th><th>Date</th><th>Vendor</th><th>Material</th><th>Qty</th><th>Unit</th></tr>
            </thead>
            <tbody>
              {recent.map(r => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.bill_no || "—"}</td>
                  <td>{r.purchase_date}</td>
                  <td>{r.vendors?.name}</td>
                  <td>{r.raw_materials?.name}</td>
                  <td>{r.qty}</td>
                  <td>{r.raw_materials?.unit || "-"}</td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr><td colSpan="7" style={{ color: "var(--muted)" }}>No inward entries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
