import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useNavigate } from 'react-router-dom'
import AsyncFGSelect from '../components/AsyncFGSelect.jsx' // dynamic dropdown (2k+ items friendly)

export default function Manufacture(){
  const [fgId, setFgId] = useState('')
  const [fgName, setFgName] = useState('')
  const [qty, setQty] = useState(1)
  const [making, setMaking] = useState(false)

  // preview of last run
  const [codes, setCodes] = useState([])

  const navigate = useNavigate()

  // If you want to restore last preview after refresh:
  useEffect(()=>{
    try{
      const saved = JSON.parse(localStorage.getItem('lastManufacturePreview')||'[]')
      if(Array.isArray(saved)) setCodes(saved)
    }catch{}
  },[])

  async function manufacture(){
    if(!fgId) return alert('Select a finished good')
    const n = Number(qty)
    if(!Number.isFinite(n) || n<=0) return alert('Enter valid quantity')

    setMaking(true)
    try{
      // 1) Create batch (v2 returns {batch_id, packets_created})
      const { data, error } = await supabase.rpc('create_manufacture_batch_v2', {
        p_finished_good_id: Number(fgId),
        p_qty_units: n
      })
      if(error){ alert(error.message); return }

      const batchId = data?.batch_id
      const made = Number(data?.packets_created || 0)
      if(!batchId || made<=0){
        alert('Manufacture failed: no batch id or zero packets')
        return
      }

      // 2) Fetch packets for preview
      const { data: ps, error: e2 } = await supabase
        .from('packets')
        .select('packet_code')
        .eq('batch_id', batchId)
        .order('id')
      if(e2){ alert(e2.message); return }

      const codesNow = (ps||[]).map(p=>p.packet_code)
      setCodes(codesNow)
      try{
        localStorage.setItem('lastManufacturePreview', JSON.stringify(codesNow))
      }catch{}

      // Keep fgName for labels page
    } finally {
      setMaking(false)
    }
  }

  function openLabels(){
    if(!codes.length) return
    const namesByCode = Object.fromEntries(codes.map(c=>[c, fgName || '']))
    navigate('/labels', {
      state: {
        title: fgName || 'Labels',
        codes,
        namesByCode
      }
    })
  }

  return (
    <div className="grid">
      <div className="card">
        <div className="hd"><b>Manufacturing</b></div>
        <div className="bd" style={{display:'grid', gap:10}}>
          <div className="row" style={{gap:8, alignItems:'center', flexWrap:'wrap'}}>
            <AsyncFGSelect
              value={fgId}
              onChange={(id, item)=>{ setFgId(id); setFgName(item?.name || '') }}
              placeholder="Search finished goods…"
              minChars={1}
              pageSize={25}
            />
            <input
              type="number"
              min="1"
              value={qty}
              onChange={e=>setQty(e.target.value)}
              style={{width:140}}
              placeholder="Qty (units)"
            />
            <button className="btn" onClick={manufacture} disabled={making}>
              {making ? 'Manufacturing…' : 'Create Packets'}
            </button>
            <button className="btn outline" onClick={openLabels} disabled={!codes.length}>
              Open Labels (2-up PDF)
            </button>
          </div>

          {!codes.length && <div className="s" style={{color:'var(--muted)'}}>No preview yet. Manufacture to see generated barcodes.</div>}

          {!!codes.length && (
            <>
              <div className="s" style={{color:'var(--muted)'}}>Preview — {codes.length} packets</div>
              <div className="grid" style={{gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))'}}>
                {codes.map(c=>(
                  <div key={c} className="card">
                    <div className="bd">
                      <div style={{fontWeight:600}}>{fgName || '—'}</div>
                      <code style={{fontFamily:'monospace', wordBreak:'break-all'}}>{c}</code>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
