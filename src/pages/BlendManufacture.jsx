import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useToast } from '../ui/toast.jsx'

function num(x, d=0){ const n = Number(x); return Number.isFinite(n) ? n : d }

export default function BlendManufacture(){
  const { push } = useToast()

  // Output RM to produce (Diet Atta / Salt Mix, etc.)
  const [rms, setRms] = useState([])              // [{id,name}]
  const [outputId, setOutputId] = useState('')
  const [qtyKg, setQtyKg] = useState('1')

  // Loaded recipe + inventory
  const [recipe, setRecipe] = useState([])        // [{component_rm_id, component_name, qty_per_kg}]
  const [inv, setInv] = useState({})              // { rmId: qty_on_hand }

  // UI
  const [loading, setLoading] = useState(false)
  const [manufacturing, setManufacturing] = useState(false)
  const [strict, setStrict] = useState(true)

  // Load output RMs for dropdown
  useEffect(()=>{
    (async ()=>{
      const { data, error } = await supabase
        .from('raw_materials')
        .select('id,name')
        .eq('is_active', true)
        .order('name')
      if(error){ push(error.message,'err'); return }
      setRms(data||[])
    })()
  },[push])

  // Load recipe + inventory whenever outputId changes
  useEffect(()=>{
    if(!outputId){ setRecipe([]); setInv({}); return }
    (async ()=>{
      setLoading(true)
      try{
        // 1) fetch active blend for this output RM → components
        const { data: comps, error: e1 } = await supabase
          .from('rm_blend_components')
          .select('component_rm_id, qty_per_kg, raw_materials(name)')
          .eq('blend_id',
            (await supabase
              .from('rm_blends')
              .select('id')
              .eq('output_raw_material_id', outputId)
              .eq('is_active', true)
              .limit(1)
            ).data?.[0]?.id || -1
          )
        if(e1){ push(e1.message,'err'); setRecipe([]); setInv({}); return }
        const shaped = (comps||[]).map(c=>({
          component_rm_id: c.component_rm_id,
          component_name: c.raw_materials?.name || c.component_rm_id,
          qty_per_kg: num(c.qty_per_kg, 0)
        }))
        setRecipe(shaped)

        // 2) fetch inventory for those RM ids
        const ids = shaped.map(c=>c.component_rm_id)
        if(ids.length){
          const { data: invRows } = await supabase
            .from('v_raw_inventory')
            .select('id, qty_on_hand')
            .in('id', ids)
          const map = {}
          ;(invRows||[]).forEach(r=>{ map[r.id] = num(r.qty_on_hand, 0) })
          setInv(map)
        }else{
          setInv({})
        }
      } finally {
        setLoading(false)
      }
    })()
  },[outputId, push])

  // Derived rows with requirements
  const qty = useMemo(()=> num(qtyKg, 0), [qtyKg])
  const rows = useMemo(()=>{
    return recipe.map(r=>{
      const need = r.qty_per_kg * qty
      const have = num(inv[r.component_rm_id], 0)
      const short = need > have + 1e-9
      return { ...r, need, have, short }
    })
  }, [recipe, inv, qty])

  const insufficient = useMemo(()=> rows.some(r=>r.short), [rows])

  async function manufacture(){
    if(!outputId) return push('Pick an output raw material','warn')
    if(qty <= 0)  return push('Enter a valid quantity (kg)','warn')
    if(strict && insufficient) return push('Insufficient stock for one or more components','err')

    setManufacturing(true)
    try{
      const { error } = await supabase.rpc('manufacture_blend', {
        p_output_rm_id: Number(outputId),
        p_qty_kg: qty,
        p_strict: strict
      })
      if(error){ push(error.message,'err'); return }
      push(`Manufactured ${qty} kg`, 'ok')
      // refresh inventory snapshot
      const ids = recipe.map(c=>c.component_rm_id)
      if(ids.length){
        const { data: invRows } = await supabase
          .from('v_raw_inventory')
          .select('id, qty_on_hand')
          .in('id', ids.concat(Number(outputId)))
        const map = {}
        ;(invRows||[]).forEach(r=>{ map[r.id] = num(r.qty_on_hand, 0) })
        setInv(map)
      }
    } finally {
      setManufacturing(false)
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <div className="hd"><b>Blend Manufacture (Aata / Salt)</b></div>

        <div className="bd" style={{display:'grid', gap:10}}>
          <div className="row" style={{gap:8, flexWrap:'wrap', alignItems:'center'}}>
            <select value={outputId} onChange={e=>setOutputId(e.target.value)} style={{minWidth:260}}>
              <option value="">{loading ? 'Loading…' : '-- Select Output Raw Material --'}</option>
              {rms.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <input
              type="number" min="0.1" step="0.1"
              value={qtyKg}
              onChange={e=>setQtyKg(e.target.value)}
              style={{width:140}}
              placeholder="Qty (kg)"
            />
            <label className="row" style={{gap:6}}>
              <input type="checkbox" checked={strict} onChange={e=>setStrict(e.target.checked)} />
              Strict (block if short)
            </label>
            <button
              className="btn"
              onClick={manufacture}
              disabled={!outputId || qty<=0 || manufacturing || (strict && insufficient)}
              title={strict && insufficient ? 'Insufficient stock' : ''}
            >
              {manufacturing ? 'Manufacturing…' : 'Manufacture'}
            </button>
          </div>

          <div className="card" style={{margin:0}}>
            <div className="hd"><b>Recipe Breakdown</b></div>
            <div className="bd" style={{overflow:'auto'}}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Component RM</th>
                    <th style={{textAlign:'right'}}>Qty / kg</th>
                    <th style={{textAlign:'right'}}>Needed (for {qty || 0} kg)</th>
                    <th style={{textAlign:'right'}}>In Stock</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r=>(
                    <tr key={r.component_rm_id}>
                      <td>{r.component_name}</td>
                      <td style={{textAlign:'right'}}>{r.qty_per_kg}</td>
                      <td style={{textAlign:'right'}}>{r.need.toFixed(3)}</td>
                      <td style={{textAlign:'right'}}>{r.have.toFixed(3)}</td>
                      <td>
                        <span className="badge" style={{borderColor: r.short ? 'var(--error)' : 'var(--ok)', color: r.short ? 'var(--error)' : 'inherit'}}>
                          {r.short ? 'Short' : 'OK'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {rows.length===0 && (
                    <tr><td colSpan="5" style={{color:'var(--muted)'}}>
                      {outputId ? 'No active recipe defined for this output raw material' : 'Pick an output raw material to view recipe'}
                    </td></tr>
                  )}
                </tbody>
              </table>
              {insufficient && (
                <div className="s" style={{color:'var(--error)', marginTop:6}}>
                  One or more components are short. Uncheck <b>Strict</b> to allow negative stock, or add raw material first.
                </div>
              )}
            </div>
          </div>

          <div className="s" style={{color:'var(--muted)'}}>
            This uses your <code>rm_blends</code> + <code>rm_blend_components</code> recipe and writes to <code>stock_ledger</code> with reasons
            <code> blend_consume</code> / <code>blend_produce</code>. Raw inventory is calculated by <code>v_raw_inventory</code>.
          </div>
        </div>
      </div>
    </div>
  )
}
