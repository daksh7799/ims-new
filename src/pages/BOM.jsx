import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import AsyncFGSelect from "../components/AsyncFGSelect.jsx";
import { downloadCSV } from "../utils/csv";
import { useToast } from "../ui/toast.jsx";

export default function BOM(){
  const { push } = useToast?.() || { push: (m)=>alert(m) }

  const [fgId, setFgId] = useState("");
  const [lines, setLines] = useState([]); // {raw_material_id, raw_material_name, qty_per_unit}
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Static raw materials list (simple dropdown)
  const [rms, setRms] = useState([]);     // [{id,name,unit}]
  const rmById = useMemo(() => {
    const m = new Map(); (rms||[]).forEach(r=>m.set(Number(r.id), r)); return m;
  }, [rms]);

  // Load all RMs once
  async function loadRMs(){
    const { data, error } = await supabase
      .from("raw_materials")
      .select("id,name,unit")
      .eq("is_active", true)
      .order("name")
      .range(0, 9999);  // fetch up to 10k
    if(error){ push(error.message, "err"); return }
    setRms(data || []);
  }

  // Load BOM for selected FG
  async function loadBOM(id){
    if(!id){ setLines([]); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("v_bom_for_fg")
      .select("raw_material_id, raw_material_name, qty_per_unit")
      .eq("finished_good_id", id)
      .order("raw_material_name");
    setLoading(false);
    if(error){ push(error.message, "err"); return; }
    setLines((data||[]).map(r=>({
      raw_material_id: r.raw_material_id,
      raw_material_name: r.raw_material_name,
      qty_per_unit: String(r.qty_per_unit)
    })));
    setDirty(false);
  }

  useEffect(()=>{ loadRMs() },[]);
  useEffect(()=>{ loadBOM(fgId) }, [fgId]);

  function addLine(){
    setLines(ls => [...ls, { raw_material_id: "", raw_material_name: "", qty_per_unit: "" }]);
    setDirty(true);
  }
  function removeLine(i){
    setLines(ls => ls.filter((_,idx)=>idx!==i));
    setDirty(true);
  }
  function updateLine(i, patch){
    setLines(ls => ls.map((l,idx)=> idx===i ? { ...l, ...patch } : l));
    setDirty(true);
  }

  function onRmChange(i, newId){
    const idNum = newId ? Number(newId) : "";
    const rm = idNum ? rmById.get(idNum) : null;
    updateLine(i, {
      raw_material_id: idNum,
      raw_material_name: rm?.name || ""
    });
  }

  function exportCSV(){
    if(!lines.length){ push("Nothing to export","warn"); return; }
    downloadCSV("bom.csv", lines.map(l=>({
      raw_material_id: l.raw_material_id,
      raw_material: l.raw_material_name,
      qty_per_unit: l.qty_per_unit
    })));
  }

  async function saveAll(){
    if(!fgId) return push("Pick a finished good","warn");
    // validate
    const norm = [];
    const seen = new Set();
    for(const l of lines){
      const rm = Number(l.raw_material_id);
      const qty = Number(l.qty_per_unit);
      if(!rm || !(qty >= 0)) return push("Each line needs raw material and non-negative qty", "warn");
      const key = String(rm);
      if(seen.has(key)) return push("Duplicate raw material lines are not allowed", "warn");
      seen.add(key);
      norm.push({ raw_material_id: rm, qty_per_unit: qty });
    }

    setLoading(true);
    const { error } = await supabase.rpc("set_bom_for_fg", {
      p_finished_good_id: Number(fgId),
      p_lines: norm
    });
    setLoading(false);
    if(error){ push(error.message, "err"); return; }
    push("BOM saved", "ok");
    setDirty(false);
    loadBOM(fgId);
  }

  const totalRMs = useMemo(()=> lines.length, [lines]);

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Bill of Materials (per Finished Good)</b>
          <div className="row">
            <button className="btn outline" onClick={exportCSV} disabled={!lines.length}>Export CSV</button>
            <button className="btn" onClick={saveAll} disabled={!fgId || loading}>
              {loading ? "Saving…" : (dirty ? "Save All *" : "Save All")}
            </button>
          </div>
        </div>

        <div className="bd">
          {/* FG picker (dynamic) */}
          <div className="row" style={{ marginBottom: 10 }}>
            <AsyncFGSelect
              value={fgId}
              onChange={(id)=>setFgId(id)}
              placeholder="Search finished goods…"
              minChars={1}
              pageSize={25}
            />
            <span className="badge">Lines: {totalRMs}</span>
          </div>

          {/* BOM table */}
          <div style={{ overflow: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 420 }}>Raw Material</th>
                  <th style={{ textAlign: "right", width: 160 }}>Qty / Unit</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx)=>(
                  <tr key={idx}>
                    <td>
                      <select
                        value={l.raw_material_id}
                        onChange={e=>onRmChange(idx, e.target.value)}
                        style={{ minWidth: 360 }}
                      >
                        <option value="">-- Select Raw Material --</option>
                        {rms.map(r=>(
                          <option key={r.id} value={r.id}>
                            {r.name}{r.unit ? ` (${r.unit})` : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={l.qty_per_unit}
                        onChange={e=>updateLine(idx, { qty_per_unit: e.target.value })}
                        style={{ width: 150, textAlign: "right" }}
                      />
                    </td>
                    <td><button className="btn ghost" onClick={()=>removeLine(idx)}>✕</button></td>
                  </tr>
                ))}
                {lines.length===0 && (
                  <tr><td colSpan={3} style={{ color: "var(--muted)" }}>
                    {fgId ? "No BOM lines yet — add raw materials below." : "Pick a Finished Good to load BOM."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn outline" onClick={addLine} disabled={!fgId || rms.length===0}>+ Add Raw Material</button>
            {dirty && <span className="s" style={{ marginLeft: 8, color: "var(--muted)" }}>You have unsaved changes</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
