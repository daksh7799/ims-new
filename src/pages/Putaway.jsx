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
  const [errorMsg, setErrorMsg] = useState('')

  const [autoMode, setAutoMode] = useState(true)
  const debounceRef = useRef(null)
  const scanRef = useRef(null)

  // Load bins list
  useEffect(()=>{
    (async ()=>{
      try{
        const { data, error } = await supabase
          .from('bins')
          .select('code')
          .eq('is_active', true)
          .order('code')
        if(error) throw error
        setBins((data || []).map(b => b.code))
      }catch(e){
        console.error(e)
        setErrorMsg(e.message || String(e))
      }
    })()
  },[])

  // keep normalized code
  useEffect(()=>{ setBinNorm(normBin(bin)) }, [bin])

  async function loadContents(){
    if(!binNorm){ setContents([]); return }
    setLoadingC(true)
    try{
      const { data, error } = await supabase
        .from('v_bin_contents')
        .select('packet_code, finished_good_name, status, produced_at, added_at, bin_code')
        .eq('bin_code', binNorm)
        .order('added_at', { ascending:false })
      if(error) throw error
      setContents(data || [])
    }catch(e){
      console.error(e)
      setErrorMsg(e.message || String(e))
      setContents([])
    }finally{
      setLoadingC(false)
    }
  }

  async function loadUnbinned(){
    setLoadingU(true)
    try{
      const { data, error } = await supabase
        .from('v_unbinned_live_packets')
        .select('packet_code, finished_good_name, status, produced_at')
        .order('produced_at', { ascending:false })
      if(error) throw error
      setUnbinned(data || [])
    }catch(e){
      console.error(e)
      setErrorMsg(e.message || String(e))
      setUnbinned([])
    }finally{
      setLoadingU(false)
    }
  }

  // initial + realtime (v2: subscribe returns channel; no .catch)
  useEffect(()=>{
    loadUnbinned()
    const ch1 = supabase
      .channel('rt:putaway_hist')
      .on('postgres_changes', { event:'*', schema:'public', table:'packet_putaway' }, () => { loadUnbinned(); loadContents(); })
    const ch2 = supabase
      .channel('rt:packets')
      .on('postgres_changes', { event:'*', schema:'public', table:'packets' }, () => { loadUnbinned(); loadContents(); })
    ch1.subscribe()
    ch2.subscribe()
    return () => { try{ supabase.removeChannel(ch1) }catch{}; try{ supabase.removeChannel(ch2) }catch{} }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binNorm])

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
      if(error) throw error
      setScan('')
      await Promise.all([ loadUnbinned(), loadContents() ])
    }catch(e){
      alert(e.message || String(e))
    }finally{
      setAssigning(false)
      setTimeout(()=>scanRef.current?.focus(), 0)
    }
  }

  function onScanKey(e){
    if(e.key === 'Enter'){
      e.preventDefault()
      if (scan) tryAssign(scan)
    }
  }

  function onScanChange(e){
    const val = e.target.value
    setScan(val)
    if(!autoMode || !binNorm) return
    if(debounceRef.current) clearTimeout(debounceRef.current)
    if(val && val.length >= 10){
      debounceRef.current = setTimeout(()=>{ tryAssign(val) }, 120)
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <div className="hd"><b>Bin Putaway</b></div>
        <div className="bd">
          {!!errorMsg && <div className="badge err" style={{marginBottom:8}}>{errorMsg}</div>}
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

            <button className="btn" onClick={()=>tryAssign(scan)} disabled={!scan || !binNorm || assigning}>
              {assigning ? 'Assigning…' : `Assign to ${binNorm || '—'}`}
            </button>

            <button
              className={`btn ${autoMode ? '' : 'outline'}`}
              onClick={()=>setAutoMode(v=>!v)}
              title="Automatically assign after scan"
            >
              Auto-Assign: {autoMode ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="s" style={{ color:'var(--muted)' }}>
            Scanners that press Enter will work. With Auto-Assign ON, scans assign instantly without Enter.
          </div>
        </div>
      </div>

      {/* Bin contents */}
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
                  <td>{r?.produced_at ? new Date(r.produced_at).toLocaleString() : '—'}</td>
                  <td>{r?.added_at ? new Date(r.added_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
              {(!contents.length) && (
                <tr><td colSpan="5" style={{ color:'var(--muted)' }}>No packets in this bin</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Unbinned list */}
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
                  <td>{r?.produced_at ? new Date(r.produced_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
              {(!unbinned.length) && (
                <tr><td colSpan="4" style={{ color:'var(--muted)' }}>No unbinned packets</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
