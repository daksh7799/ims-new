import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import { supabase } from '../supabaseClient'
import { useNavigate } from 'react-router-dom'
import AsyncFGSelect from '../components/AsyncFGSelect.jsx'

const LS_SINGLE = 'lastSingleRun'
const LS_BULK   = 'lastBulkRun'

export default function ManufacturePage(){
  const [tab,setTab]=useState('single')
  const navigate = useNavigate()

  // ===== Single =====
  const [fgId,setFgId]=useState('')
  const [fgName,setFgName]=useState('')
  const [qty,setQty]=useState(1)
  const [making,setMaking]=useState(false)
  const [lastBatch, setLastBatch] = useState(null)
  const [singleCreated,setSingleCreated]=useState([])

  useEffect(()=>{
    try{
      const saved = JSON.parse(localStorage.getItem(LS_SINGLE)||'[]')
      if(Array.isArray(saved)) setSingleCreated(saved)
    }catch{}
  },[])

  async function manufactureOnce(){
    if(!fgId) return alert('Select a finished good')
    const n = Math.max(1, Math.floor(Number(qty)))
    if(!Number.isFinite(n) || n<=0) return alert('Enter valid quantity (>=1)')

    setMaking(true)
    setLastBatch(null)
    try{
      const { data, error } = await supabase.rpc('create_manufacture_batch_v3', {
        p_finished_good_id: fgId,
        p_qty_units: n
      })
      if(error) throw error

      const batchId = data?.batch_id
      const made = Number(data?.packets_created || 0)
      if(!batchId || made<=0) throw new Error('Manufacture failed (no packets)')

      setLastBatch({ batch_id: batchId, packets_created: made })

      const { data: ps, error: e2 } = await supabase
        .from('packets')
        .select('packet_code')
        .eq('batch_id', batchId)
        .order('id')
      if(e2) throw e2

      const list = (ps||[]).map(p => ({ code: p.packet_code, name: fgName || '' }))
      setSingleCreated(list)
      try{ localStorage.setItem(LS_SINGLE, JSON.stringify(list)) }catch{}
    }catch(err){
      alert(err.message||String(err))
    }finally{
      setMaking(false)
    }
  }

  function openLabelsSingle(){
    if(!singleCreated.length) return
    const codes = singleCreated.map(x=>x.code)
    const namesByCode = Object.fromEntries(singleCreated.map(x=>[x.code, x.name]))
    navigate('/labels', { state: { title: fgName || 'Labels', codes, namesByCode } })
  }

  function printLabelsSingle(){
    if(!singleCreated.length) return
    const codes = singleCreated.map(x=>x.code)
    const namesByCode = Object.fromEntries(singleCreated.map(x=>[x.code, x.name]))
    navigate('/labels', { state: { title: fgName || 'Labels', codes, namesByCode, autoPrint: true } })
  }

  function clearLastSingle(){
    setSingleCreated([]); setLastBatch(null)
    try{ localStorage.removeItem(LS_SINGLE) }catch{}
  }

  // ===== Bulk =====
  const [fgList,setFgList]=useState([])
  const [rows,setRows]=useState([])
  const [bulkLoading,setBulkLoading]=useState(false)
  const [bulkCreated,setBulkCreated]=useState([])

  useEffect(()=>{ (async ()=>{
    const { data } = await supabase
      .from('finished_goods')
      .select('id,name')
      .eq('is_active', true)
      .order('name')
    setFgList(data||[])
  })() },[])

  useEffect(()=>{
    try{
      const saved = JSON.parse(localStorage.getItem(LS_BULK) || '[]')
      if(Array.isArray(saved)) setBulkCreated(saved)
    }catch{}
  },[])

  function onFile(e){
    const f = e.target.files?.[0]; if(!f) return
    const reader = new FileReader()
    reader.onload = ev => {
      const wb = XLSX.read(ev.target.result, { type:'binary' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const json = XLSX.utils.sheet_to_json(ws, { defval:'' })
      const normalized = json.map(r=>{
        const name = String(
          r.finished_good ?? r.FINISHED_GOOD ?? r['finished good'] ?? ''
        ).trim()
        const qty  = Math.max(1, Math.floor(Number(r.qty ?? r.QTY ?? 0)))
        return { name, qty }
      }).filter(r=>r.name && r.qty>0)
      setRows(normalized)
    }
    reader.readAsBinaryString(f)
  }

  async function runBulk(){
    if(rows.length===0) return alert('No valid rows in sheet')
    setBulkLoading(true)
    const all=[]

    try{
      const idx = {}
      fgList.forEach(f => { idx[f.name.trim().toLowerCase()] = f.id })

      for(const r of rows){
        const fgUUID = idx[r.name.trim().toLowerCase()]
        if(!fgUUID){ alert(`FG not found: ${r.name}`); continue }

        const { data, error } = await supabase.rpc('create_manufacture_batch_v3', {
          p_finished_good_id: fgUUID,
          p_qty_units: Math.max(1, Math.floor(Number(r.qty)))
        })
        if(error){ alert(`Error for ${r.name}: ${error.message}`); continue }

        const batchId = data?.batch_id
        const made = Number(data?.packets_created || 0)
        if(!batchId || made<=0){ alert(`No packets for ${r.name}`); continue }

        const { data: ps, error: e2 } = await supabase
          .from('packets')
          .select('packet_code')
          .eq('batch_id', batchId)
          .order('id')
        if(e2){ alert(`Fetch packets failed for ${r.name}: ${e2.message}`); continue }

        ps?.forEach(p=>all.push({ code:p.packet_code, name:r.name }))
      }

      setBulkCreated(all)
      try{ localStorage.setItem(LS_BULK, JSON.stringify(all)) }catch{}
    } finally {
      setBulkLoading(false)
    }
  }

  function openLabelsBulk(){
    if(!bulkCreated.length) return
    const codes = bulkCreated.map(x=>x.code)
    const namesByCode = Object.fromEntries(bulkCreated.map(x=>[x.code, x.name]))
    navigate('/labels', { state: { title: 'Bulk Labels', codes, namesByCode } })
  }

  function printLabelsBulk(){
    if(!bulkCreated.length) return
    const codes = bulkCreated.map(x=>x.code)
    const namesByCode = Object.fromEntries(bulkCreated.map(x=>[x.code, x.name]))
    navigate('/labels', { state: { title: 'Bulk Labels', codes, namesByCode, autoPrint: true } })
  }

  // ✅ Download blank CSV template
  function downloadTemplateCSV() {
    const headers = ['finished_good', 'qty']
    const csvContent = headers.join(',') + '\n'
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    saveAs(blob, 'bulk_template.csv')
  }

  function clearLastBulk(){
    setBulkCreated([])
    try{ localStorage.removeItem(LS_BULK) }catch{}
  }

  // ===== UI =====
  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Manufacture</b>
          <div className="row">
            <button className={`btn ghost ${tab==='single'?'active':''}`} onClick={()=>setTab('single')}>Single</button>
            <button className={`btn ghost ${tab==='bulk'?'active':''}`} onClick={()=>setTab('bulk')}>Bulk</button>
          </div>
        </div>

        <div className="bd">
          {tab==='single' && (
            <>
              <div className="row" style={{gap:8, alignItems:'center', flexWrap:'wrap'}}>
                <AsyncFGSelect
                  value={fgId}
                  onChange={(id, item)=>{ setFgId(String(id||'')); setFgName(item?.name||'') }}
                  placeholder="Search finished goods…"
                  minChars={1}
                  pageSize={25}
                />
                <input type="number" min="1" value={qty} onChange={e=>setQty(e.target.value)} style={{width:140}} placeholder="Qty (units)" />
                <button className="btn" onClick={manufactureOnce} disabled={making || !fgId || Number(qty)<=0}>
                  {making ? 'Manufacturing…' : 'Create Packets'}
                </button>
                <button className="btn outline" onClick={openLabelsSingle} disabled={!singleCreated.length}>
                  Open Labels (2-up PDF)
                </button>
                <button className="btn" onClick={printLabelsSingle} disabled={!singleCreated.length}>
                  🖨️ Print Labels (2-up)
                </button>
                <button className="btn ghost" onClick={clearLastSingle} disabled={!singleCreated.length}>
                  Clear Last
                </button>
              </div>

              {!!lastBatch && (
                <div className="row" style={{marginTop:6, gap:8}}>
                  <span className="badge">Batch: {lastBatch.batch_id}</span>
                  <span className="badge">Packets: {lastBatch.packets_created}</span>
                </div>
              )}

              <div className="card" style={{marginTop:10}}>
                <div className="hd">
                  <b>Last Run Preview (Single)</b>
                  <span className="badge">{singleCreated.length ? `${singleCreated.length} packets` : 'None'}</span>
                </div>
                <div className="bd">
                  {!singleCreated.length && <div className="badge">No single manufacture yet</div>}
                  {!!singleCreated.length && (
                    <div className="grid" style={{gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))'}}>
                      {singleCreated.map(x=>(
                        <div key={x.code} className="card">
                          <div className="bd">
                            <div style={{fontWeight:600}}>{x.name || fgName || '—'}</div>
                            <code style={{fontFamily:'monospace', wordBreak:'break-all'}}>{x.code}</code>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {tab==='bulk' && (
            <>
              <div className="row" style={{gap:8, alignItems:'center', flexWrap:'wrap'}}>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile}/>
                <button className="btn" onClick={runBulk} disabled={bulkLoading || !rows.length}>
                  {bulkLoading ? 'Working…' : 'Create Batches'}
                </button>
                <button className="btn outline" onClick={openLabelsBulk} disabled={!bulkCreated.length}>
                  Open Labels (2-up PDF)
                </button>
                <button className="btn" onClick={printLabelsBulk} disabled={!bulkCreated.length}>
                  🖨️ Print Labels (2-up)
                </button>
                <button className="btn ghost" onClick={clearLastBulk} disabled={!bulkCreated.length}>
                  Clear Last
                </button>
                <button className="btn ghost" onClick={downloadTemplateCSV}>
                  📄 Download Blank CSV Template
                </button>
              </div>

              <div className="s" style={{color:'var(--muted)', marginTop:6}}>
                Columns required: <code>finished_good</code>, <code>qty</code>.  
                Upload this same format for your grocery manufacturing batches.
              </div>

              <div className="card" style={{marginTop:10}}>
                <div className="hd">
                  <b>Last Upload Preview (Bulk)</b>
                  <span className="badge">{bulkCreated.length ? `${bulkCreated.length} packets` : 'None'}</span>
                </div>
                <div className="bd">
                  {!bulkCreated.length && <div className="badge">No bulk upload yet</div>}
                  {!!bulkCreated.length && (
                    <div className="grid" style={{gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))'}}>
                      {bulkCreated.map(x=>(
                        <div key={x.code} className="card">
                          <div className="bd">
                            <div style={{fontWeight:600}}>{x.name}</div>
                            <code style={{fontFamily:'monospace', wordBreak:'break-all'}}>{x.code}</code>
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
  )
}
