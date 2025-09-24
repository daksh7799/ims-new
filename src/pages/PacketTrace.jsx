// src/pages/PacketTrace.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

function fmt(ts){
  if(!ts) return "—";
  const t = typeof ts === "string" ? Date.parse(ts) : ts;
  if(Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString();
}

export default function PacketTrace(){
  const [code, setCode] = useState("");         // packet barcode text
  const [loading, setLoading] = useState(false);
  const [header, setHeader] = useState(null);   // { packet_code, finished_good_name, mfg_date, status, bin_code }
  const [events, setEvents] = useState([]);     // [{event_time, event_kind, movement, reason, so_number, note}]
  const [err, setErr] = useState("");

  const typing = useRef(null);
  const [auto, setAuto] = useState(true);

  async function loadAll(barcode){
    const pkt = (barcode || "").trim();
    if(!pkt) return;
    setLoading(true); setErr("");

    try{
      const [{ data: hdr, error: e1 }, { data: evs, error: e2 }] = await Promise.all([
        supabase.rpc("get_packet_header", { p_packet_code: pkt }),
        supabase.rpc("packet_trace",     { p_packet_code: pkt }),
      ]);
      if(e1) throw e1;
      if(e2) throw e2;

      setHeader(hdr?.[0] || null);
      setEvents(evs || []);
    }catch(e){
      console.error(e);
      setErr(e.message || String(e));
      setHeader(null);
      setEvents([]);
    }finally{
      setLoading(false);
    }
  }

  // auto-trace when typing a long barcode
  useEffect(()=>{
    if(!auto) return;
    const v = code.trim();
    if(!v) return;
    clearTimeout(typing.current);
    // trigger once user pauses typing (works with USB scanners too)
    typing.current = setTimeout(()=>loadAll(v), 200);
    return ()=>clearTimeout(typing.current);
  }, [code, auto]);

  const hasData = useMemo(()=>!!(header || events.length), [header, events]);

  return (
    <div className="grid">
      {/* Search */}
      <div className="card">
        <div className="hd">
          <b>Packet Trace</b>
          <div className="row" style={{gap:8}}>
            <input
              placeholder="Scan / type packet barcode…"
              value={code}
              onChange={(e)=>setCode(e.target.value)}
              style={{minWidth:360}}
            />
            <button className="btn" onClick={()=>loadAll(code)} disabled={loading}>
              {loading ? "Tracing…" : "Trace"}
            </button>
            <label className="row" style={{gap:6}}>
              <input type="checkbox" checked={auto} onChange={(e)=>setAuto(e.target.checked)} />
              Auto-trace
            </label>
          </div>
        </div>
        {!!err && <div className="bd"><div className="badge err">{err}</div></div>}
      </div>

      {/* Header */}
      <div className="card">
        <div className="hd"><b>Packet</b></div>
        <div className="bd">
          {!header && !loading && <div className="s" style={{color:'var(--muted)'}}>Enter a barcode to view details.</div>}
          {header && (
            <div className="row" style={{gap:8, flexWrap:'wrap'}}>
              <span className="badge">Code: {header.packet_code || "—"}</span>
              <span className="badge">Item: {header.finished_good_name || "—"}</span>
              <span className="badge">Mfg: {header.mfg_date || "—"}</span>
              <span className="badge">Status: {header.status || "—"}</span>
              <span className="badge">Bin: {header.bin_code || "—"}</span>
            </div>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="card">
        <div className="hd"><b>Timeline</b></div>
        <div className="bd" style={{overflow:'auto'}}>
          {!hasData && !loading && (
            <div className="s" style={{color:'var(--muted)'}}>No events.</div>
          )}
          {!!events.length && (
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Kind</th>
                  <th>Movement</th>
                  <th>Reason</th>
                  <th>SO</th>
                  <th>Note / Details</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i)=>(
                  <tr key={`${e.event_time}-${i}`}>
                    <td>{fmt(e.event_time)}</td>
                    <td><span className="badge">{e.event_kind || "—"}</span></td>
                    <td>{e.movement || "—"}</td>
                    <td><span className="badge">{e.reason || "—"}</span></td>
                    <td>{e.so_number || "—"}</td>
                    <td>{e.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
