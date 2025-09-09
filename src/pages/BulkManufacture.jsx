import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../supabaseClient'
import { useNavigate } from 'react-router-dom'

/**
 * Excel / CSV columns (first sheet):
 * finished_good | qty
 * Ragi Atta 1kg | 10
 */
export default function BulkManufacture(){
  const [fgList,setFgList]=useState([])      // [{id,name}]
  const [rows,setRows]=useState([])          // [{name, qty}]
  const [created,setCreated]=useState([])    // [{code,name}]
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(()=>{ (async ()=>{
    const { data, error } = await supabase
      .from('finished_goods')
      .select('id,name')
      .eq('is_active', true)
      .order('name')
    if(!error) setFgList(data||[])
  })() },[])

  useEffect(()=>{
    try{
      const saved = JSON.parse(localStorage.getItem('lastBulkRun') || '[]')
      if(Array.isArray(saved)) setCreated(saved)
    }catch{}
  },[])

  function onFile(e){
    const file = e.target.files?.[0]; if(!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const wb = XLSX.read(ev.target.result, { type:'binary' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const json = XLSX.utils.sheet_to_json(ws, { defval:'' })
      const normalized = json.map(r=>({
        name: String(r.finished_good||r.FINISHED_GOOD||r['finished good']||'').trim(),
        qty : Number(r.qty||r.QTY||0)
      })).filter(r=>r.name && r.qty>0)
      setRows(normalized)
    }
    reader.readAsBinaryString(file)
  }

  async function run(){
    if(rows.length===0) return alert('No valid rows in sheet')
    setLoading(true)
    const all=[]

    try{
      // name → id index
      const idx = {}
      fgList.forEach(f => idx[f.name.trim().toLowerCase()] = f.id)

      for(const r of rows){
        const fgId = idx[r.name.trim().toLowerCase()]
        if(!fgId){ alert(`FG not found: ${r.name}`); continue }

        // 1) Create batch via v2
        const { data, error } = await supabase.rpc('create_manufacture_batch_v2', {
          p_finished_good_id: Number(fgId),
          p_qty_units: Number(r.qty)
        })
        if(error){ alert(`Error for ${r.name}: ${error.message}`); continue }

        const batchId = data?.batch_id
        const made = Number(data?.packets_created || 0)
        if(!batchId || made<=0){
          alert(`No packets created for ${r.name}`)
          continue
        }

        // 2) Fetch packets
        const { data: ps, error: e2 } = await supabase
          .from('packets')
          .select('packet_code')
          .eq('batch_id', batchId)
          .order('id')
        if(e2){ alert(`Fetch packets failed for ${r.name}: ${e2.message}`); continue }

        ps?.forEach(p=>all.push({ code:p.packet_code, name:r.name }))
      }

      setCreated(all)
      try{ localStorage.setItem('lastBulkRun', JSON.stringify(all)) }catch{}
    } finally {
      setLoading(false)
    }
  }

  function openLabels(){
    if(!created.length) return
    const codes = created.map(x=>x.code)
    const namesByCode = Object.fromEntries(created.map(x=>[x.code, x.name]))
    navigate('/labels', { state: { title: 'Bulk Labels', codes, namesByCode } })
  }

  function clearLast(){
    setCreated([])
    try{ localStorage.removeItem('lastBulkRun') }catch{}
  }

  return (
    <div className="grid">
      <div className="card">
        <div className="hd"><b>Bulk Manufacture (Excel / CSV)</b></div>
        <div className="bd">
          <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile}/>
          <button className="btn" onClick={run} style={{marginLeft:10}} disabled={loading}>
            {loading ? 'Working…' : 'Create Batches'}
          </button>
          <button className="btn outline" onClick={openLabels} disabled={!created.length} style={{marginLeft:10}}>
            Open Labels (2-up PDF)
          </button>
          <button className="btn ghost" onClick={clearLast} disabled={!created.length} style={{marginLeft:10}}>
            Clear Last
          </button>
          <div className="s" style={{color:'var(--muted)', marginTop:6}}>
            Columns required: <code>finished_good</code>, <code>qty</code>. Names must match your FG master.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="hd">
          <b>Last Upload Preview</b>
          <span className="badge">{created.length ? `${created.length} packets` : 'None'}</span>
        </div>
        <div className="bd">
          {!created.length && <div className="badge">No bulk upload yet</div>}
          {!!created.length && (
            <div className="grid" style={{gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))'}}>
              {created.map(x=>(
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
    </div>
  )
}
