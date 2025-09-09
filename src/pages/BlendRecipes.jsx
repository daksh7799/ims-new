// src/pages/BlendRecipes.jsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import AsyncRMSelect from '../components/AsyncRMSelect.jsx'

function numberOr(x, d=0){ const n=Number(x); return Number.isFinite(n) ? n : d }

export default function BlendRecipes(){
  const [blends, setBlends] = useState([]) // [{id, name, is_active, output_raw_material_id, output_name}]
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  // create form
  const [newOutputId, setNewOutputId] = useState('')
  const [newOutputName, setNewOutputName] = useState('')
  const [newBlendName, setNewBlendName] = useState('')

  // expanded row id to edit components
  const [openId, setOpenId] = useState(null)
  const [comps, setComps] = useState([]) // current blend components when open

  async function load(){
    setLoading(true)
    // fetch blends with output RM name
    const { data: b0, error } = await supabase
      .from('rm_blends')
      .select('id, name, is_active, output_raw_material_id, raw_materials!rm_blends_output_raw_material_id_fkey(name)')
      .order('id', { ascending: false })
    if(error){ alert(error.message); setBlends([]); setLoading(false); return }
    const shaped = (b0||[]).map(b => ({
      id: b.id,
      name: b.name,
      is_active: b.is_active,
      output_raw_material_id: b.output_raw_material_id,
      output_name: b.raw_materials?.name || b.output_raw_material_id
    }))
    setBlends(shaped)
    setLoading(false)
  }

  useEffect(()=>{ load() },[])

  const filtered = useMemo(()=>{
    const qq = q.trim().toLowerCase()
    return (blends||[]).filter(b =>
      !qq ||
      String(b.name||'').toLowerCase().includes(qq) ||
      String(b.output_name||'').toLowerCase().includes(qq)
    )
  }, [blends, q])

  async function createBlend(){
    const outId = Number(newOutputId)
    const name = (newBlendName || '').trim()
    if(!outId) return alert('Pick the Output Raw Material (the blended product)')
    if(!name)  return alert('Enter a Blend Name')
    const { error } = await supabase.from('rm_blends').insert({
      output_raw_material_id: outId,
      name,
      is_active: true
    })
    if(error){ alert(error.message); return }
    setNewBlendName(''); setNewOutputId(''); setNewOutputName('')
    await load()
  }

  async function toggleActive(blendId, curr){
    const { error } = await supabase.from('rm_blends').update({ is_active: !curr }).eq('id', blendId)
    if(error){ alert(error.message); return }
    setBlends(bs => bs.map(b => b.id===blendId ? {...b, is_active: !curr} : b))
  }

  async function openBlend(id){
    setOpenId(id===openId ? null : id)
    if(id===openId) { setComps([]); return }
    const { data, error } = await supabase
      .from('rm_blend_components')
      .select('id, component_rm_id, qty_per_kg, raw_materials(name)')
      .eq('blend_id', id)
      .order('id')
    if(error){ alert(error.message); setComps([]); return }
    setComps((data||[]).map(c => ({
      id: c.id,
      component_rm_id: c.component_rm_id,
      component_name: c.raw_materials?.name || c.component_rm_id,
      qty_per_kg: c.qty_per_kg
    })))
  }

  async function addComponent(){
    if(!openId) return
    // simple prompt-based add
    const rmName = prompt('Enter Raw Material name EXACT (or cancel to use selector). Leave blank to use selector.')
    let rmId = null, qty = null
    if(rmName && rmName.trim()){
      // find RM by exact name
      const { data } = await supabase.from('raw_materials').select('id,name').ilike('name', rmName.trim()).limit(1)
      if(!data?.length){ alert('Raw material not found'); return }
      rmId = data[0].id
    } else {
      const input = prompt('Enter component RM id')
      rmId = Number(input)
      if(!rmId) return
    }
    qty = numberOr(prompt('Qty per 1kg output (e.g. 0.25)'), 0)
    if(qty<=0){ alert('Invalid qty'); return }

    const { error } = await supabase.from('rm_blend_components').insert({
      blend_id: openId,
      component_rm_id: rmId,
      qty_per_kg: qty
    })
    if(error){ alert(error.message); return }
    await openBlend(openId) // reload
  }

  async function addComponentUI(rmId, rmName, qty){
    if(!openId || !rmId || qty<=0) return
    const { error } = await supabase.from('rm_blend_components').insert({
      blend_id: openId,
      component_rm_id: Number(rmId),
      qty_per_kg: Number(qty)
    })
    if(error){ alert(error.message); return }
    await openBlend(openId)
  }

  async function updateQty(compId, qty){
    const n = numberOr(qty, -1)
    if(n<=0) return alert('Invalid qty')
    const { error } = await supabase.from('rm_blend_components').update({ qty_per_kg: n }).eq('id', compId)
    if(error){ alert(error.message); return }
    setComps(cs => cs.map(c => c.id===compId ? {...c, qty_per_kg: n} : c))
  }

  async function removeComp(compId){
    if(!confirm('Remove this component from the recipe?')) return
    const { error } = await supabase.from('rm_blend_components').delete().eq('id', compId)
    if(error){ alert(error.message); return }
    setComps(cs => cs.filter(c => c.id!==compId))
  }

  // lightweight inline add row state
  const [newCmpId, setNewCmpId] = useState('')
  const [newCmpName, setNewCmpName] = useState('')
  const [newCmpQty, setNewCmpQty] = useState('')

  return (
    <div className="grid">

      {/* Create Blend */}
      <div className="card">
        <div className="hd"><b>Create Blend Recipe</b></div>
        <div className="bd" style={{display:'grid', gap:8}}>
          <div className="row" style={{gap:8, alignItems:'center', flexWrap:'wrap'}}>
            <AsyncRMSelect
              value={newOutputId}
              onChange={(id,item)=>{ setNewOutputId(id); setNewOutputName(item?.name || '') }}
              placeholder="Search Output Raw Material…"
              minChars={0}
              pageSize={25}
            />
            <input
              placeholder="Blend Name (e.g., Diet Atta Blend)"
              value={newBlendName}
              onChange={e=>setNewBlendName(e.target.value)}
              style={{minWidth:240}}
            />
            <button className="btn" onClick={createBlend}>Create</button>
          </div>
          <div className="s" style={{color:'var(--muted)'}}>
            Output Raw Material is what increases (e.g., “Diet Atta”). Components will be deducted per kg based on the recipe.
          </div>
        </div>
      </div>

      {/* List blends */}
      <div className="card">
        <div className="hd">
          <b>Blend Recipes</b>
          <div className="row">
            <input placeholder="Search blends / output RM…" value={q} onChange={e=>setQ(e.target.value)} />
            <button className="btn ghost" onClick={load} disabled={loading}>{loading?'Refreshing…':'Refresh'}</button>
          </div>
        </div>
        <div className="bd" style={{overflow:'auto'}}>
          <table className="table">
            <thead>
              <tr>
                <th>Blend</th>
                <th>Output RM</th>
                <th>Status</th>
                <th style={{width:120}}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(b=>(
                <FragmentRow
                  key={b.id}
                  b={b}
                  isOpen={openId===b.id}
                  onToggle={()=>openBlend(b.id)}
                  onToggleActive={()=>toggleActive(b.id, b.is_active)}
                  comps={openId===b.id ? comps : null}
                  addComponentUI={addComponentUI}
                  updateQty={updateQty}
                  removeComp={removeComp}
                  newCmpId={newCmpId} setNewCmpId={setNewCmpId}
                  newCmpName={newCmpName} setNewCmpName={setNewCmpName}
                  newCmpQty={newCmpQty} setNewCmpQty={setNewCmpQty}
                />
              ))}
              {filtered.length===0 && (
                <tr><td colSpan={4} style={{color:'var(--muted)'}}>No blends</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ---------- row with expandable components editor ---------- */
function FragmentRow({
  b, isOpen, onToggle, onToggleActive, comps,
  addComponentUI, updateQty, removeComp,
  newCmpId, setNewCmpId, newCmpName, setNewCmpName, newCmpQty, setNewCmpQty
}){
  return (
    <>
      <tr>
        <td>
          <button className="btn ghost" onClick={onToggle} title={isOpen?'Hide components':'Show components'}>
            {isOpen ? '▾' : '▸'}
          </button>{' '}
          <b>{b.name}</b>
        </td>
        <td>{b.output_name}</td>
        <td><span className="badge" style={{borderColor: b.is_active ? 'var(--ok)' : 'var(--border)'}}>{b.is_active ? 'Active' : 'Inactive'}</span></td>
        <td className="row" style={{justifyContent:'flex-end', gap:6}}>
          <button className="btn outline" onClick={onToggleActive}>{b.is_active ? 'Disable' : 'Enable'}</button>
          <button className="btn ghost" onClick={onToggle}>{isOpen ? 'Close' : 'Edit'}</button>
        </td>
      </tr>

      {isOpen && (
        <tr>
          <td colSpan={4} style={{background:'#fafafa'}}>
            <div style={{padding:'8px 4px', display:'grid', gap:8}}>
              <div className="s" style={{fontWeight:600}}>Components per 1 kg of <i>{b.output_name}</i></div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Component RM</th>
                    <th style={{textAlign:'right'}}>Qty / kg</th>
                    <th style={{width:100}}></th>
                  </tr>
                </thead>
                <tbody>
                  {(comps||[]).map(c=>(
                    <tr key={c.id}>
                      <td>{c.component_name}</td>
                      <td style={{textAlign:'right'}}>
                        <input
                          type="number" min="0.001" step="0.001"
                          value={c.qty_per_kg}
                          onChange={e=>updateQty(c.id, e.target.value)}
                          style={{width:120, textAlign:'right'}}
                        />
                      </td>
                      <td>
                        <button className="btn ghost" onClick={()=>removeComp(c.id)}>Remove</button>
                      </td>
                    </tr>
                  ))}
                  {(!comps || comps.length===0) && (
                    <tr><td colSpan={3} style={{color:'var(--muted)'}}>No components yet</td></tr>
                  )}
                </tbody>
              </table>

              <div className="row" style={{gap:8, alignItems:'center', flexWrap:'wrap'}}>
                {/* Quick add via AsyncRMSelect */}
                <AddComponentInline
                  value={newCmpId}
                  onChange={(id, item)=>{ setNewCmpId(id); setNewCmpName(item?.name || '') }}
                />
                <input
                  type="number" min="0.001" step="0.001"
                  value={newCmpQty}
                  onChange={e=>setNewCmpQty(e.target.value)}
                  placeholder="Qty per kg"
                  style={{width:140}}
                />
                <button
                  className="btn"
                  onClick={()=>addComponentUI(Number(newCmpId), newCmpName, Number(newCmpQty))}
                  disabled={!newCmpId || !newCmpQty}
                >
                  + Add Component
                </button>
              </div>

              <div className="s" style={{color:'var(--muted)'}}>
                Tip: Total of all components per kg usually equals 1.000, but you can set any proportions you need.
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function AddComponentInline({ value, onChange }){
  return (
    <div className="row" style={{gap:6}}>
      <AsyncRMSelect
        value={value}
        onChange={onChange}
        placeholder="Add component RM…"
        minChars={1}
        pageSize={25}
      />
    </div>
  )
}
