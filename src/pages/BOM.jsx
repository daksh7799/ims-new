// src/pages/BOM.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import AsyncFGSelect from "../components/AsyncFGSelect.jsx";
import { downloadCSV } from "../utils/csv";
import { useToast } from "../ui/toast.jsx";
import * as XLSX from "xlsx";

function normalizeName(s){ return String(s||"").trim().toLowerCase(); }

export default function BOM(){
  const { push } = useToast?.() || { push: (m)=>alert(m) }
  const [tab,setTab] = useState("manual"); // manual | bulk

  // ---------- MANUAL ----------
  const [fgId, setFgId] = useState("");            // UUID string
  const [lines, setLines] = useState([]);          // {raw_material_id, raw_material_name, qty_per_unit}
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [rms, setRms] = useState([]);

  useEffect(()=>{ (async()=>{
    const { data, error } = await supabase
      .from("raw_materials").select("id,name,unit").eq("is_active",true).order("name").range(0,9999);
    if(error) push(error.message,"err"); else setRms(data||[]);
  })() },[]);

  async function loadBOM(id){
    if(!id){ setLines([]); return }
    setLoading(true);
    const { data, error } = await supabase
      .from("v_bom_for_fg")
      .select("raw_material_id, raw_material_name, qty_per_unit")
      .eq("finished_good_id", id)
      .order("raw_material_name");
    setLoading(false);
    if(error) return push(error.message,"err");
    setLines((data||[]).map(r=>({
      raw_material_id: r.raw_material_id,
      raw_material_name: r.raw_material_name,
      qty_per_unit: String(r.qty_per_unit)
    })));
    setDirty(false);
  }
  useEffect(()=>{ loadBOM(fgId) },[fgId]);

  function addLine(){ setLines(ls=>[...ls,{raw_material_id:"",raw_material_name:"",qty_per_unit:""}]); setDirty(true); }
  function removeLine(i){ setLines(ls=>ls.filter((_,idx)=>idx!==i)); setDirty(true); }
  function updateLine(i,patch){ setLines(ls=>ls.map((l,idx)=>idx===i?{...l,...patch}:l)); setDirty(true); }
  function onRmChange(i,newId){
    const rm=rms.find(r=>String(r.id)===String(newId));
    updateLine(i,{ raw_material_id:newId, raw_material_name:rm?.name||"" });
  }

  async function saveAll(){
    if(!fgId) return push("Pick a finished good","warn");
    const norm=[]; const seen=new Set();
    for(const l of lines){
      const rm=String(l.raw_material_id).trim();
      const qty=Number(l.qty_per_unit);
      if(!rm || !(qty>=0)) return push("Each line needs RM and non-negative qty","warn");
      if(seen.has(rm)) return push("Duplicate RM lines not allowed","warn");
      seen.add(rm);
      norm.push({ raw_material_id: rm, qty_per_unit: qty });
    }
    setLoading(true);
    const { error } = await supabase.rpc("set_bom_for_fg", {
      p_finished_good_id: fgId,   // UUID string
      p_lines: norm
    });
    setLoading(false);
    if(error) return push(error.message,"err");
    push("BOM saved","ok");
    setDirty(false);
    loadBOM(fgId);
  }

  function exportCSV(){
    if(!lines.length) return push("Nothing to export","warn");
    downloadCSV("bom.csv", lines.map(l=>({
      raw_material_id:l.raw_material_id,
      raw_material:l.raw_material_name,
      qty_per_unit:l.qty_per_unit
    })));
  }

  // ---------- BULK ----------
  const [rows,setRows]=useState([]); // [{fg,rm,qty}]
  const [errors,setErrors]=useState([]);
  const [bulkLoading,setBulkLoading]=useState(false);
  const [fgs,setFgs]=useState([]); const [rmsAll,setRmsAll]=useState([]);
  const [mastersLoading,setMastersLoading]=useState(false);
  const [result,setResult]=useState(null);

  useEffect(()=>{ (async()=>{
    try{
      setMastersLoading(true);
      const [fgAll, rmAll] = await Promise.all([
        fetchAll("finished_goods","id,name,is_active",true),
        fetchAll("raw_materials","id,name,is_active",true),
      ]);
      setFgs(fgAll); setRmsAll(rmAll);
    }catch(e){ alert("Master load failed: "+e.message) }
    finally{ setMastersLoading(false); }
  })() },[]);

  async function fetchAll(table, cols="id,name,is_active", filterActive=true, pageSize=1000){
    let all=[]; let from=0;
    while(true){
      let q=supabase.from(table).select(cols,{count:"exact"}).order("name").range(from,from+pageSize-1);
      if(filterActive) q=q.eq("is_active",true);
      const {data,error}=await q; if(error) throw error;
      all=all.concat(data||[]);
      if(!data || data.length<pageSize) break;
      from+=pageSize;
    }
    return all;
  }

  function onFile(e){
    const f=e.target.files?.[0]; if(!f) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try{
        const wb=XLSX.read(ev.target.result,{type:"binary"});
        const ws=wb.Sheets[wb.SheetNames[0]];
        const json=XLSX.utils.sheet_to_json(ws,{defval:""});
        const out=[]; const errs=[];
        json.forEach((r,idx)=>{
          const fg=r["Finished Good"]??r["FG"]??r["finished good"]??"";
          const rm=r["Raw Material"]??r["RM"]??r["raw material"]??"";
          const q=r["Qty per Unit"]??r["qty"]??"";
          const qty=Number(String(q).replace(",",".")); const ln=idx+2;
          if(!String(fg).trim()||!String(rm).trim()) errs.push(`Row ${ln}: missing FG or RM`);
          else if(!Number.isFinite(qty)||qty<=0) errs.push(`Row ${ln}: invalid Qty`);
          out.push({fg:String(fg).trim(), rm:String(rm).trim(), qty});
        });
        setRows(out); setErrors(errs); setResult(null);
      }catch(err){ alert("File read failed: "+err.message); setRows([]); setErrors([]); setResult(null); }
      finally{ e.target.value=""; }
    };
    reader.readAsBinaryString(f);
  }

  const grouped = useMemo(()=>{
    const m=new Map();
    for(const r of rows){ const key=r.fg; if(!m.has(key)) m.set(key,[]); m.get(key).push(r); }
    return [...m.entries()];
  },[rows]);

  async function upload(){
    if(!rows.length) return alert("No rows loaded");
    if(errors.length) return alert("Fix errors first:\n"+errors.slice(0,5).join("\n"));
    setBulkLoading(true); setResult(null);
    try{
      const fgByName=new Map(fgs.map(x=>[normalizeName(x.name),x.id]));
      const rmByName=new Map(rmsAll.map(x=>[normalizeName(x.name),x.id]));
      const missing=[];
      for(const r of rows){
        if(!fgByName.has(normalizeName(r.fg))) missing.push(`FG not found: ${r.fg}`);
        if(!rmByName.has(normalizeName(r.rm))) missing.push(`RM not found: ${r.rm}`);
      }
      if(missing.length){ alert('Name mismatches:\n'+[...new Set(missing)].slice(0,30).join('\n')); setBulkLoading(false); return; }

      const summary=[];
      for(const [fgName,list] of grouped){
        const fgUUID=fgByName.get(normalizeName(fgName));
        const payload=list.map(r=>({
          finished_good_id: fgUUID,
          raw_material_id: rmByName.get(normalizeName(r.rm)),
          qty_per_unit: Number(r.qty)
        }));

        const { error: upErr } = await supabase
          .from('bom')
          .upsert(payload, { onConflict: 'finished_good_id,raw_material_id' });
        if(upErr) throw upErr;

        const keepIds = payload.map(p=>p.raw_material_id);
        const inList = keepIds.length ? `(${keepIds.map(id=>`"${id}"`).join(',')})` : '(NULL)';
        const { error: delErr } = await supabase
          .from('bom')
          .delete()
          .eq('finished_good_id', fgUUID)
          .not('raw_material_id','in', inList);
        if(delErr) throw delErr;

        summary.push({ fg: fgName, components: payload.length });
      }
      setResult({ ok:true, summary });
    }catch(err){
      console.error(err);
      setResult({ ok:false, msg: err.message });
    }finally{
      setBulkLoading(false);
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Bill of Materials</b>
          <div className="row">
            <button className={`btn ghost ${tab==="manual"?"active":""}`} onClick={()=>setTab("manual")}>Manual</button>
            <button className={`btn ghost ${tab==="bulk"?"active":""}`} onClick={()=>setTab("bulk")}>Bulk Upload</button>
          </div>
        </div>

        <div className="bd">
          {tab==="manual" && (
            <>
              <div className="row" style={{marginBottom:10}}>
                <AsyncFGSelect
                  value={fgId}
                  onChange={(id /*, item */)=> setFgId(String(id||""))}
                  placeholder="Type to search finished goods…"
                  pageSize={25}
                  minChars={0}         // ✅ show list immediately without typing
                />
                <span className="badge">Lines: {lines.length}</span>
              </div>

              <div style={{overflow:"auto"}}>
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{width:420}}>Raw Material</th>
                      <th style={{textAlign:"right",width:160}}>Qty / Unit</th>
                      <th style={{width:80}}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l,idx)=>(
                      <tr key={idx}>
                        <td>
                          <select value={l.raw_material_id} onChange={e=>onRmChange(idx,e.target.value)} style={{minWidth:360}}>
                            <option value="">-- Select Raw Material --</option>
                            {rms.map(r=><option key={r.id} value={r.id}>{r.name}{r.unit?` (${r.unit})`:""}</option>)}
                          </select>
                        </td>
                        <td style={{textAlign:"right"}}>
                          <input type="number" min="0" step="0.0001" value={l.qty_per_unit}
                            onChange={e=>updateLine(idx,{qty_per_unit:e.target.value})}
                            style={{width:150,textAlign:"right"}}
                          />
                        </td>
                        <td><button className="btn ghost" onClick={()=>removeLine(idx)}>✕</button></td>
                      </tr>
                    ))}
                    {lines.length===0 && (
                      <tr><td colSpan={3} style={{color:"var(--muted)"}}>
                        {fgId ? "No BOM lines yet — add raw materials." : "Pick a Finished Good."}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="row" style={{marginTop:10}}>
                <button className="btn outline" onClick={addLine} disabled={!fgId||!rms.length}>+ Add RM</button>
                <button className="btn outline" onClick={exportCSV} disabled={!lines.length}>Export CSV</button>
                <button className="btn" onClick={saveAll} disabled={!fgId||loading}>
                  {loading ? "Saving…" : (dirty ? "Save All *" : "Save All")}
                </button>
              </div>
            </>
          )}

          {tab==="bulk" && (
            <>
              <div className="row" style={{marginBottom:10}}>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile}/>
                <button className="btn" onClick={upload} disabled={!rows.length||bulkLoading||mastersLoading}>
                  {bulkLoading ? "Uploading…" : (mastersLoading ? "Loading masters…" : "Upload")}
                </button>
                <button className="btn outline" onClick={()=>{setRows([]);setErrors([]);setResult(null);}} disabled={!rows.length||bulkLoading}>Clear</button>
              </div>

              {!!errors.length && <div className="badge err">{errors.length} issue(s). First: {errors[0]}</div>}
              {!rows.length && <div className="badge">No rows loaded</div>}

              {!!rows.length && (
                <table className="table">
                  <thead><tr><th>Finished Good</th><th>Raw Material</th><th style={{textAlign:"right"}}>Qty/Unit</th></tr></thead>
                  <tbody>
                    {rows.slice(0,500).map((r,i)=>(<tr key={i}><td>{r.fg}</td><td>{r.rm}</td><td style={{textAlign:"right"}}>{r.qty}</td></tr>))}
                    {rows.length>500 && <tr><td colSpan={3}>…and {rows.length-500} more</td></tr>}
                  </tbody>
                </table>
              )}

              {result && (
                <div style={{marginTop:10}} className={`badge ${result.ok?"ok":"err"}`}>
                  {result.ok ? `Done. Updated ${result.summary.length} FGs.` : `Failed: ${result.msg}`}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
