// src/pages/Putaway.jsx
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'

function normBin(s){ return (s || '').trim().toUpperCase() }

export default function Putaway(){
  const [bins, setBins] = useState([])
  const [bin, setBin] = useState('')
  const [binNorm, setBinNorm] = useState('')
  const [scan, setScan] = useState('')
  const [assigning, setAssigning] = useState(false)

  const [contents, setContents] = useState([])
  const [unbinned, setUnbinned] = useState([])
  const [loadingC, setLoadingC] = useState(false)
  const [loadingU, setLoadingU] = useState(false)

  // NEW: Auto-Assign toggle
  const [autoMode, setAutoMode] = useState(true) // default ON
  const debounceRef = useRef(null)
  const scanRef = useRef(null)

  // ---- Load bins
  useEffect(()=>{
    (async ()=>{
      const { data } = await supabase.from('bins').select('code').order('code')
      setBins((data || []).map(b => b.code))
    })()
  },[])

  // keep normalized bin
  useEffect(()=>{ setBinNorm(normBin(bin)) }, [bin])

  async function loadContents(){
    if(!binNorm){ setContents([]); return }
    setLoadingC(true)
    const { data, error } = await supabase
      .from('v_bin_contents')
      .select('packet_code, finished_good_name, status, produced_at, added_at, bin_code')
      .eq('bin_code', binNorm)
      .order('produced_at', { ascending:false })
    if(error){ console.error(error); setContents([]) } else { setContents(data || []) }
    setLoadingC(false)
  }

  async function loadUnbinned(){
    setLoadingU(true)
    const { data, error } = await supabase
      .from('v_unbinned_live_packets')
      .select('packet_code, finished_good_name, status, produced_at')
      .order('produced_at', { ascending:false })
    if(error){ console.error(error); setUnbinned([]) } else { setUnbinned(data || []) }
    setLoadingU(false)
  }

  // initial + realtime refresh
  useEffect(()=>{
    loadUnbinned()
    const ch = supabase
      .channel('realtime:putaway')
      .on('postgres_changes', { event:'*', schema:'public', table:'packets' }, () => {
        loadUnbinned()
        loadContents()
      })
      .subscribe()
    return ()=>supabase.removeChannel(ch)
  },[])

  useEffect(()=>{ loadContents() }, [binNorm])

  async function tryAssign(code){
    const barcode = (code || '').trim()
    if(!barcode || !binNorm) return
    if(assigning) return

    setAssigning(true)
    try{
      const { error } = await supabase.rpc('assign_packet_to_bin', {
        p_packet_code: barcode,
        p_bin_code: binNorm
      })
      if(error){
        alert(error.message)
      }else{
        setScan('')
        await Promise.all([ loadUnbinned(), loadContents() ])
      }
    } finally {
      setAssigning(false)
      setTimeout(()=>scanRef.current?.focus(), 0)
    }
  }

  // Manual Enter submit
  function onScanKey(e){
    if(e.key === 'Enter'){
      e.preventDefault()
      if (scan) tryAssign(scan)
    }
  }

  // NEW: Auto-assign on change (debounced)
  function onScanChange(e){
    const val = e.target.value
    setScan(val)

    if(!autoMode) return
    if(!binNorm) return
    // many scanners paste full code in one go; debounce lightly to let value settle
    if(debounceRef.current) clearTimeout(debounceRef.current)

    // trigger when looks like a full code (>= 10 chars) — tweak if needed
    if(val && val.length >= 10){
      debounceRef.current = setTimeout(()=>{
        tryAssign(val)
      }, 120)
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <div className="hd"><b>Bin Putaway</b></div>
        <div className="bd">
          <div className="row" style={{ gap:8, marginBottom:8, alignItems:'center' }}>
            <select value={bin} onChange={e=>setBin(e.target.value)} style={{ minWidth:160 }}>
              <option value="">Select Bin</option>
              {bins.map(code => <option key={code} value={code}>{code}</option>)}
            </select>

            <input
              ref={scanRef}
              placeholder={binNorm ? `Scan barcode → assign to ${binNorm}` : 'Select a bin first'}
              value={scan}
              onChange={onScanChange}
              onKeyDown={onScanKey}
              disabled={!binNorm || assigning}
              style={{ minWidth:320 }}
            />

            {/* Manual fallback button */}
            <button className="btn" onClick={()=>tryAssign(scan)} disabled={!scan || !binNorm || assigning}>
              {assigning ? 'Assigning…' : `Assign to ${binNorm || '—'}`}
            </button>

            {/* NEW: Auto-Assign toggle button */}
            <button
              className={`btn ${autoMode ? '' : 'outline'}`}
              onClick={()=>setAutoMode(v=>!v)}
              title="Automatically assign after scan"
            >
              Auto-Assign: {autoMode ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="s" style={{ color:'var(--muted)' }}>
            Scanner that sends “Enter” will always work. With Auto-Assign ON, scans are assigned instantly without pressing Enter.
          </div>
        </div>
      </div>

      {/* Contents of selected bin */}
      <div className="card">
        <div className="hd">
          <b>Contents of Bin {binNorm || '—'}</b>
          <span className="badge">{contents.length} items</span>
        </div>
        <div className="bd" style={{ overflow:'auto' }}>
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
              {contents.map((r,i)=>(
                <tr key={`${r.packet_code}-${i}`}>
                  <td style={{ fontFamily:'monospace' }}>{r.packet_code}</td>
                  <td>{r.finished_good_name}</td>
                  <td><span className="badge">{r.status}</span></td>
                  <td>{new Date(r.produced_at).toLocaleString()}</td>
                  <td>{new Date(r.added_at).toLocaleString()}</td>
                </tr>
              ))}
              {(!contents.length) && (
                <tr><td colSpan="5" style={{ color:'var(--muted)' }}>{loadingC ? 'Loading…' : 'No packets in this bin'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Unbinned live packets */}
      <div className="card">
        <div className="hd">
          <b>Unbinned Live Packets</b>
          <span className="badge">{unbinned.length} items</span>
        </div>
        <div className="bd" style={{ overflow:'auto' }}>
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
              {unbinned.map((r,i)=>(
                <tr key={`${r.packet_code}-${i}`}>
                  <td style={{ fontFamily:'monospace' }}>{r.packet_code}</td>
                  <td>{r.finished_good_name}</td>
                  <td><span className="badge">{r.status}</span></td>
                  <td>{new Date(r.produced_at).toLocaleString()}</td>
                </tr>
              ))}
              {(!unbinned.length) && (
                <tr><td colSpan="4" style={{ color:'var(--muted)' }}>{loadingU ? 'Loading…' : 'No unbinned packets'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
