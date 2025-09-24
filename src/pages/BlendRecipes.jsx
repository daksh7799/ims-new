// src/pages/BlendRecipes.jsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import AsyncRMSelect from '../components/AsyncRMSelect.jsx'

function numberOr(x, d=0){ const n=Number(x); return Number.isFinite(n) ? n : d }

export default function BlendRecipes(){
  // Left pane: existing blends
  const [list, setList] = useState([])  // [{id,name,is_active,output_raw_material_id,output_name}]
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  // Right pane: editor (BOM-style)
  const [outputName, setOutputName] = useState('')  // text name of output RM
  const [blendName, setBlendName]   = useState('')  // optional blend label
  // rows: use id+name so selector shows the chosen item nicely; we send name to RPC
  const [rows, setRows] = useState([{ raw_material_id:'', raw_material_name:'', qty_per_kg:'' }])
  const [saving, setSaving] = useState(false)

  useEffect(()=>{ loadList() },[])
  async function loadList(){
    setLoading(true)
    const { data, error } = await supabase
      .from('v_blends_list')
      .select('*')
      .order('is_active', { ascending:false })
      .order('output_name', { ascending:true })
    if(error){ alert(error.message); setList([]) } else { setList(data||[]) }
    setLoading(false)
  }

  const filtered = useMemo(()=>{
    const s = q.trim().toLowerCase()
    return (list||[]).filter(b =>
      !s ||
      String(b.name||'').toLowerCase().includes(s) ||
      String(b.output_name||'').toLowerCase().includes(s)
    )
  },[list,q])

  // editor helpers
  function addRow(){ setRows(rs => [...rs, { raw_material_id:'', raw_material_name:'', qty_per_kg:'' }]) }
  function removeRow(i){ setRows(rs => rs.filter((_,idx)=>idx!==i)) }
  function updateRow(i, patch){ setRows(rs => rs.map((r,idx)=>idx===i ? {...r, ...patch} : r)) }

  async function saveRecipe(){
    const on = outputName.trim()
    if(!on) return alert('Enter Output Product name (the blended RM you’ll produce)')

    // normalize rows → use name (from selector), fallback to typed text if any (kept for safety)
    const comps = []
    const errs = []
    const seen = new Set()
    rows.forEach((r, idx) => {
      const nm = (r.raw_material_name||'').trim()
      const q  = numberOr(r.qty_per_kg, -1)
      if(!nm) errs.push(`Row ${idx+1}: pick a Raw Material`)
      else if(q <= 0) errs.push(`Row ${idx+1}: invalid Qty per kg`)
      else {
        const key = nm.toLowerCase()
        if(seen.has(key)) errs.push(`Duplicate component: ${nm}`)
        seen.add(key)
        comps.push({ raw_material_name: nm, qty_per_kg: q })
      }
    })
    if(errs.length){ alert(errs.join('\n')); return }
    if(comps.length===0){ alert('Add at least one component'); return }

    setSaving(true)
    try{
      const { error } = await supabase.rpc('blend_set_for_output', {
        p_output_name: on,
        p_components: comps,
        p_blend_name: blendName.trim() || null
      })
      if(error){ alert(error.message); return }
      alert('Recipe saved')
      await loadList()
    } finally {
      setSaving(false)
    }
  }

  async function loadIntoEditor(b){
    setOutputName(b.output_name || '')
    setBlendName(b.name || '')
    const { data, error } = await supabase
      .from('v_blend_recipe_for_output')
      .select('component_rm_id, component_name, qty_per_kg')
      .eq('output_rm_id', b.output_raw_material_id)
      .order('component_name')
    if(error){ alert(error.message); setRows([{raw_material_id:'', raw_material_name:'', qty_per_kg:''}]); return }
    const rs = (data||[]).map(r => ({
      raw_material_id: r.component_rm_id,     // uuid (for selector default)
      raw_material_name: r.component_name,    // name (for saving)
      qty_per_kg: String(r.qty_per_kg)
    }))
    setRows(rs.length ? rs : [{ raw_material_id:'', raw_material_name:'', qty_per_kg:'' }])
  }

  function clearEditor(){
    setOutputName(''); setBlendName('')
    setRows([{ raw_material_id:'', raw_material_name:'', qty_per_kg:'' }])
  }

  return (
    <div className="grid" style={{gridTemplateColumns:'minmax(260px, 1fr) 2fr', gap:16}}>
      {/* LEFT: existing blends */}
      <div className="card">
        <div className="hd">
          <b>Blend Recipes</b>
          <div className="row">
            <input placeholder="Search output/product…" value={q} onChange={e=>setQ(e.target.value)} />
            <button className="btn ghost" onClick={loadList} disabled={loading}>{loading?'Refreshing…':'Refresh'}</button>
          </div>
        </div>
        <div className="bd" style={{overflow:'auto'}}>
          <table className="table">
            <thead>
              <tr><th>Output Product</th><th>Blend Name</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map(b=>(
                <tr key={b.id}>
                  <td>{b.output_name}</td>
                  <td>{b.name}</td>
                  <td><span className="badge" style={{borderColor: b.is_active ? 'var(--ok)':'var(--border)'}}>{b.is_active?'Active':'Inactive'}</span></td>
                  <td style={{textAlign:'right'}}>
                    <button className="btn outline" onClick={()=>loadIntoEditor(b)}>Edit</button>
                  </td>
                </tr>
              ))}
              {filtered.length===0 && (
                <tr><td colSpan={4} style={{color:'var(--muted)'}}>{loading ? 'Loading…' : 'No blends'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* RIGHT: editor */}
      <div className="card">
        <div className="hd">
          <b>Edit / Create Recipe (Per 1 kg Output)</b>
          <div className="row">
            <button className="btn outline" onClick={clearEditor}>New</button>
            <button className="btn" onClick={saveRecipe} disabled={saving}>{saving?'Saving…':'Save Recipe (replace)'}</button>
          </div>
        </div>
        <div className="bd" style={{display:'grid', gap:10}}>
          <div className="row" style={{gap:8, alignItems:'center', flexWrap:'wrap'}}>
            <input
              placeholder="Output Product Name (e.g., Diet Atta)"
              value={outputName}
              onChange={e=>setOutputName(e.target.value)}
              style={{minWidth:320}}
            />
            <input
              placeholder="Blend Name (optional)"
              value={blendName}
              onChange={e=>setBlendName(e.target.value)}
              style={{minWidth:220}}
            />
          </div>

          <div className="card" style={{margin:0}}>
            <div className="hd"><b>Components per 1 kg</b></div>
            <div className="bd" style={{overflow:'auto'}}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Raw Material</th>
                    <th style={{textAlign:'right', width:160}}>Qty / kg</th>
                    <th style={{width:80}}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r,idx)=>(
                    <tr key={idx}>
                      <td>
                        <AsyncRMSelect
                          value={r.raw_material_id}
                          onChange={(id,item)=>{
                            updateRow(idx, {
                              raw_material_id: id || '',
                              raw_material_name: item?.name || ''  // we’ll save by name
                            })
                          }}
                          placeholder="Search raw materials…"
                          minChars={0}
                          pageSize={25}
                        />
                      </td>
                      <td style={{textAlign:'right'}}>
                        <input
                          type="number" min="0.0001" step="0.0001"
                          value={r.qty_per_kg}
                          onChange={e=>updateRow(idx,{ qty_per_kg: e.target.value })}
                          style={{width:140, textAlign:'right'}}
                        />
                      </td>
                      <td>
                        <button className="btn ghost" onClick={()=>removeRow(idx)}>✕</button>
                      </td>
                    </tr>
                  ))}
                  {rows.length===0 && (
                    <tr><td colSpan={3} style={{color:'var(--muted)'}}>No components — add at least one.</td></tr>
                  )}
                </tbody>
              </table>
              <div className="row" style={{marginTop:8}}>
                <button className="btn outline" onClick={addRow}>+ Add Component</button>
              </div>
            </div>
          </div>

          <div className="s" style={{color:'var(--muted)'}}>
            Saving will <b>replace</b> the recipe for this output product. Missing raw materials are auto-created.  
            Blend manufacture uses this as a strict BOM (blocks if any component is short).
          </div>
        </div>
      </div>
    </div>
  )
}
