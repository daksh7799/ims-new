// src/pages/BlendManufacture.jsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useToast } from '../ui/toast.jsx'

function num(x, d = 0) {
  const n = Number(x)
  return Number.isFinite(n) ? n : d
}

export default function BlendManufacture() {
  const { push } = useToast?.() || { push: (m) => alert(m) }

  const [rms, setRms] = useState([])
  const [outputId, setOutputId] = useState('')
  const [qtyKg, setQtyKg] = useState('1')
  const [note, setNote] = useState('')

  const [recipe, setRecipe] = useState([])
  const [inv, setInv] = useState({})
  const [loading, setLoading] = useState(false)
  const [manufacturing, setManufacturing] = useState(false)

  /** Load only outputs that have an ACTIVE blend recipe */
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('v_blends_list')
        .select('output_raw_material_id, output_name, is_active')
        .eq('is_active', true)
        .order('output_name', { ascending: true })
      if (error) return push(error.message, 'err')
      const options = (data || []).map((r) => ({
        id: r.output_raw_material_id,
        name: r.output_name
      }))
      setRms(options)
      if (options.length && outputId && !options.some((o) => String(o.id) === String(outputId))) {
        setOutputId('')
      }
    })()
  }, [push]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Load recipe + inventory when outputId changes */
  useEffect(() => {
    if (!outputId) {
      setRecipe([])
      setInv({})
      return
    }
    ;(async () => {
      setLoading(true)
      try {
        const { data: comps, error: e1 } = await supabase
          .from('v_blend_recipe_for_output')
          .select('component_rm_id, component_name, qty_per_kg')
          .eq('output_rm_id', outputId)
          .order('component_name')

        if (e1) {
          push(e1.message, 'err')
          setRecipe([])
          setInv({})
          return
        }

        const shaped = (comps || []).map((c) => ({
          component_rm_id: c.component_rm_id,
          component_name: c.component_name,
          qty_per_kg: num(c.qty_per_kg, 0)
        }))
        setRecipe(shaped)

        await loadInventoryFor(shaped.map((r) => r.component_rm_id))
      } finally {
        setLoading(false)
      }
    })()
  }, [outputId]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Smart inventory loader that auto-detects column name */
  async function loadInventoryFor(ids) {
    if (!ids.length) return
    const possibleCols = ['raw_material_id', 'rm_id', 'material_id', 'id']
    let foundCol = null
    let data = null
    for (const col of possibleCols) {
      const { data: d, error } = await supabase
        .from('v_raw_inventory')
        .select(`${col}, qty_on_hand`)
        .limit(1)
      if (!error && d && d.length && col in d[0]) {
        foundCol = col
        break
      }
    }
    if (!foundCol) {
      push('Cannot detect column in v_raw_inventory', 'err')
      return
    }

    const { data: invRows, error } = await supabase
      .from('v_raw_inventory')
      .select(`${foundCol}, qty_on_hand`)
      .in(foundCol, ids)
    if (error) {
      push(error.message, 'err')
      return
    }

    const map = {}
    ;(invRows || []).forEach((r) => {
      map[r[foundCol]] = num(r.qty_on_hand, 0)
    })
    setInv(map)
  }

  async function refreshInv() {
    await loadInventoryFor(recipe.map((r) => r.component_rm_id))
  }

  const qty = useMemo(() => num(qtyKg, 0), [qtyKg])
  const rows = useMemo(() => {
    return recipe.map((r) => {
      const need = r.qty_per_kg * qty
      const have = num(inv[r.component_rm_id], 0)
      const short = need > have + 1e-9
      return { ...r, need, have, short }
    })
  }, [recipe, inv, qty])

  const insufficient = useMemo(() => rows.some((r) => r.short), [rows])

  async function manufacture() {
    if (!outputId) return push('Pick an output raw material', 'warn')
    if (qty <= 0) return push('Enter valid quantity (kg)', 'warn')
    if (insufficient) return push('Insufficient stock for one or more components', 'err')

    setManufacturing(true)
    try {
      const { error } = await supabase.rpc('manufacture_blend', {
        p_output_rm_id: String(outputId),
        p_qty_kg: qty,
        p_note: note || null
      })
      if (error) return push(error.message, 'err')
      push(`Manufactured ${qty} kg`, 'ok')
      await refreshInv()
    } finally {
      setManufacturing(false)
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Blend Manufacture (Multiple RMs → One RM)</b>
        </div>

        <div className="bd" style={{ display: 'grid', gap: 10 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={outputId}
              onChange={(e) => setOutputId(e.target.value)}
              style={{ minWidth: 260 }}
            >
              <option value="">{loading ? 'Loading…' : '-- Select Output Raw Material --'}</option>
              {rms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>

            <input
              type="number"
              min="0.1"
              step="0.1"
              value={qtyKg}
              onChange={(e) => setQtyKg(e.target.value)}
              style={{ width: 140 }}
              placeholder="Qty (kg)"
            />
            <input
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ minWidth: 220 }}
            />

            <button
              className="btn"
              onClick={manufacture}
              disabled={!outputId || qty <= 0 || manufacturing || insufficient}
              title={insufficient ? 'Insufficient stock' : ''}
            >
              {manufacturing ? 'Manufacturing…' : 'Manufacture'}
            </button>

            <button className="btn ghost" onClick={refreshInv} disabled={!recipe.length}>
              🔄 Refresh Inventory
            </button>
          </div>

          <div className="card" style={{ margin: 0 }}>
            <div className="hd">
              <b>Recipe Breakdown</b>
            </div>
            <div className="bd" style={{ overflow: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Component RM</th>
                    <th style={{ textAlign: 'right' }}>Qty / kg</th>
                    <th style={{ textAlign: 'right' }}>Needed (for {qty || 0} kg)</th>
                    <th style={{ textAlign: 'right' }}>In Stock</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.component_rm_id}>
                      <td>{r.component_name}</td>
                      <td style={{ textAlign: 'right' }}>{r.qty_per_kg}</td>
                      <td style={{ textAlign: 'right' }}>{r.need.toFixed(3)}</td>
                      <td style={{ textAlign: 'right' }}>{r.have.toFixed(3)}</td>
                      <td>
                        <span
                          className="badge"
                          style={{
                            borderColor: r.short ? 'var(--error)' : 'var(--ok)',
                            color: r.short ? 'var(--error)' : 'inherit'
                          }}
                        >
                          {r.short ? 'Short' : 'OK'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ color: 'var(--muted)' }}>
                        {outputId
                          ? 'No active recipe defined for this output raw material'
                          : 'Pick an output raw material to view recipe'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {insufficient && (
                <div className="s" style={{ color: 'var(--error)', marginTop: 6 }}>
                  One or more components are short. Add RM inward or reduce quantity.
                </div>
              )}
            </div>
          </div>

          <div className="s" style={{ color: 'var(--muted)' }}>
            Uses <code>blends</code>, <code>blend_components</code>, <code>v_blend_recipe_for_output</code>, and{' '}
            <code>v_raw_inventory</code>.<br />
            Writes to <code>stock_ledger</code> with reasons <code>blend_consume</code> /{' '}
            <code>blend_produce</code>. Manufacturing is strictly blocked if any component would go negative.
          </div>
        </div>
      </div>
    </div>
  )
}
