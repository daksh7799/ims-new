import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import * as XLSX from 'xlsx'

function Section({ title, children, right }){
  return (
    <div className="card">
      <div className="hd"><b>{title}</b>{right}</div>
      <div className="bd">{children}</div>
    </div>
  )
}

/* ---------------- RAW MATERIALS ---------------- */
function RawMaterialsAdmin(){
  const [rows,setRows] = useState([])
  const [q,setQ] = useState('')
  const [form,setForm] = useState({ name:'', unit:'kg', low_threshold:'', is_active:true })
  const [saving,setSaving] = useState(false)

  async function load(){
    const { data, error } = await supabase
      .from('raw_materials')
      .select('id,name,unit,low_threshold,is_active')
      .order('name')
    if(!error) setRows(data||[])
  }
  useEffect(()=>{ load() },[])

  function reset(){ setForm({ name:'', unit:'kg', low_threshold:'', is_active:true }) }

  async function save(){
    if(!form.name.trim()) { alert('Name required'); return }
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      unit: form.unit || 'kg',
      low_threshold: form.low_threshold === '' ? null : Number(form.low_threshold),
      is_active: !!form.is_active
    }
    const { error } = await supabase.from('raw_materials').insert(payload)
    setSaving(false)
    if(error){ alert(error.message); return }
    reset(); load()
  }

  async function toggleActive(id, is_active){
    const { error } = await supabase.from('raw_materials').update({ is_active: !is_active }).eq('id', id)
    if(!error) load()
  }

  const filtered = rows.filter(r =>
    !q || r.name.toLowerCase().includes(q.trim().toLowerCase())
  )

  return (
    <div className="card">
      <div className="hd">
        <b>Raw Materials</b>
        <input placeholder="Search…" value={q} onChange={e=>setQ(e.target.value)} />
      </div>
      <div className="bd">
        <div className="row" style={{marginBottom:12}}>
          <input placeholder="Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/>
          <select value={form.unit} onChange={e=>setForm(f=>({...f,unit:e.target.value}))}>
            <option value="kg">kg</option>
            <option value="g">g</option>
            <option value="pkt">pkt</option>
            <option value="ltr">ltr</option>
          </select>
          <input type="number" step="any" placeholder="Low threshold (optional)"
                 value={form.low_threshold}
                 onChange={e=>setForm(f=>({...f,low_threshold:e.target.value}))}/>
          <label style={{display:'inline-flex',alignItems:'center',gap:6}}>
            <input type="checkbox" checked={form.is_active} onChange={e=>setForm(f=>({...f,is_active:e.target.checked}))}/>
            Active
          </label>
          <button className="btn" onClick={save} disabled={saving}>Add</button>
        </div>

        <table className="table">
          <thead><tr>
            <th>Name</th><th>Unit</th>
            <th style={{textAlign:'right'}}>Low thresh</th>
            <th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {filtered.map(r=>(
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.unit}</td>
                <td style={{textAlign:'right'}}>{r.low_threshold ?? '—'}</td>
                <td><span className="badge">{r.is_active?'Active':'Inactive'}</span></td>
                <td>
                  <button className="btn small outline" onClick={()=>toggleActive(r.id, r.is_active)}>
                    {r.is_active?'Disable':'Enable'}
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length===0 && (
              <tr><td colSpan="5" style={{color:'var(--muted)'}}>No items</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ---------------- FINISHED GOODS ---------------- */
function FinishedGoodsAdmin(){
  const [rows,setRows]=useState([])
  const [q,setQ]=useState('')
  const [form,setForm]=useState({ name:'', unit:'pkt', low_threshold:null, barcode_prefix:'' })

  async function load(){
    const { data } = await supabase
      .from('finished_goods')
      .select('id,name,unit,low_threshold,barcode_prefix,is_active')
      .order('name')
    setRows(data||[])
  }
  useEffect(()=>{ load() },[])

  const filtered = useMemo(()=>{
    const qq=q.trim().toLowerCase()
    return (rows||[]).filter(r => !qq || r.name.toLowerCase().includes(qq))
  },[rows,q])

  async function add(){
    const payload={
      name: form.name.trim(),
      unit: form.unit || 'pkt',
      low_threshold: form.low_threshold ? Number(form.low_threshold) : null,
      barcode_prefix: form.barcode_prefix?.trim() || null,
      is_active:true
    }
    if(!payload.name) return alert('Name required')
    const { error } = await supabase.from('finished_goods').insert(payload)
    if(error) return alert(error.message)
    setForm({ name:'', unit:'pkt', low_threshold:null, barcode_prefix:'' })
    await load()
  }
  async function toggle(id,active){
    const { error } = await supabase.from('finished_goods').update({ is_active: !active }).eq('id', id)
    if(error) return alert(error.message)
    await load()
  }

  return (
    <Section title="Finished Goods"
      right={<input placeholder="Search…" value={q} onChange={e=>setQ(e.target.value)} />}>
      <div className="row" style={{marginBottom:10}}>
        <input placeholder="Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/>
        <select value={form.unit} onChange={e=>setForm(f=>({...f,unit:e.target.value}))}>
          <option value="pkt">pkt</option>
          <option value="kg">kg</option>
        </select>
        <input type="number" step="any" placeholder="Low threshold (optional)" value={form.low_threshold||''}
               onChange={e=>setForm(f=>({...f,low_threshold:e.target.value}))}/>
        <input placeholder="Barcode Prefix (optional)" value={form.barcode_prefix||''}
               onChange={e=>setForm(f=>({...f,barcode_prefix:e.target.value}))}/>
        <button className="btn" onClick={add}>Add</button>
      </div>

      <table className="table">
        <thead><tr>
          <th>Name</th><th>Unit</th><th style={{textAlign:'right'}}>Low</th><th>Prefix</th><th>Status</th><th></th>
        </tr></thead>
        <tbody>
          {filtered.map(r=>(
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.unit}</td>
              <td style={{textAlign:'right'}}>{r.low_threshold ?? '-'}</td>
              <td>{r.barcode_prefix ?? '—'}</td>
              <td><span className="badge">{r.is_active?'active':'inactive'}</span></td>
              <td><button className="btn ghost" onClick={()=>toggle(r.id,r.is_active)}>{r.is_active?'Disable':'Enable'}</button></td>
            </tr>
          ))}
          {!filtered.length && <tr><td colSpan="6" style={{color:'var(--muted)'}}>No items</td></tr>}
        </tbody>
      </table>
    </Section>
  )
}

/* ---------------- CUSTOMERS ---------------- */
function CustomersAdmin(){
  const [rows,setRows]=useState([])
  const [name,setName]=useState('')
  async function load(){
    const { data } = await supabase.from('customers').select('id,name,is_active').order('name')
    setRows(data||[])
  }
  useEffect(()=>{ load() },[])
  async function add(){
    if(!name.trim()) return
    const { error } = await supabase.from('customers').insert({ name:name.trim(), is_active:true })
    if(error) return alert(error.message)
    setName(''); load()
  }
  async function toggle(id,active){
    const { error } = await supabase.from('customers').update({ is_active: !active }).eq('id', id)
    if(error) return alert(error.message)
    load()
  }
  return (
    <Section title="Customers">
      <div className="row" style={{marginBottom:10}}>
        <input placeholder="Customer name" value={name} onChange={e=>setName(e.target.value)}/>
        <button className="btn" onClick={add}>Add</button>
      </div>
      <table className="table">
        <thead><tr><th>Name</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {rows.map(r=>(
            <tr key={r.id}>
              <td>{r.name}</td>
              <td><span className="badge">{r.is_active?'active':'inactive'}</span></td>
              <td><button className="btn ghost" onClick={()=>toggle(r.id,r.is_active)}>{r.is_active?'Disable':'Enable'}</button></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan="3" style={{color:'var(--muted)'}}>No customers</td></tr>}
        </tbody>
      </table>
    </Section>
  )
}

/* ---------------- VENDORS ---------------- */
function VendorsAdmin(){
  const [rows,setRows]=useState([])
  const [name,setName]=useState('')
  async function load(){
    const { data } = await supabase.from('vendors').select('id,name,is_active').order('name')
    setRows(data||[])
  }
  useEffect(()=>{ load() },[])
  async function add(){
    if(!name.trim()) return
    const { error } = await supabase.from('vendors').insert({ name:name.trim(), is_active:true })
    if(error) return alert(error.message)
    setName(''); load()
  }
  async function toggle(id,active){
    const { error } = await supabase.from('vendors').update({ is_active: !active }).eq('id', id)
    if(error) return alert(error.message)
    load()
  }
  return (
    <Section title="Vendors">
      <div className="row" style={{marginBottom:10}}>
        <input placeholder="Vendor name" value={name} onChange={e=>setName(e.target.value)}/>
        <button className="btn" onClick={add}>Add</button>
      </div>
      <table className="table">
        <thead><tr><th>Name</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {rows.map(r=>(
            <tr key={r.id}>
              <td>{r.name}</td>
              <td><span className="badge">{r.is_active?'active':'inactive'}</span></td>
              <td><button className="btn ghost" onClick={()=>toggle(r.id,r.is_active)}>{r.is_active?'Disable':'Enable'}</button></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan="3" style={{color:'var(--muted)'}}>No vendors</td></tr>}
        </tbody>
      </table>
    </Section>
  )
}

/* ---------------- BOM BULK UPLOAD (Excel) ---------------- */
function BOMBulkUpload(){
  const [log,setLog]=useState([])
  function append(msg){ setLog(l=>[...l, msg]) }

  async function onFile(e){
    const file = e.target.files?.[0]; if(!file) return
    setLog([])
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type:'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { defval:'' })

    // Expect columns: Finished Good, Raw Material, Qty
    // We will resolve names to IDs, then upsert into bom(finished_good_id, raw_material_id, qty_per_unit)
    const { data: fgs } = await supabase.from('finished_goods').select('id,name').eq('is_active',true)
    const { data: rms } = await supabase.from('raw_materials').select('id,name').eq('is_active',true)
    const fgByName = Object.fromEntries((fgs||[]).map(f=>[f.name.trim().toLowerCase(), f.id]))
    const rmByName = Object.fromEntries((rms||[]).map(r=>[r.name.trim().toLowerCase(), r.id]))

    for(const r of rows){
      const fgName = String(r['Finished Good']||r['finished good']||r['FG']||'').trim().toLowerCase()
      const rmName = String(r['Raw Material']||r['raw material']||r['RM']||'').trim().toLowerCase()
      const qty     = Number(r['Qty']||r['qty']||0)
      if(!fgName || !rmName || qty<=0){
        append(`❌ Skipped row: ${JSON.stringify(r)}`); continue
      }
      const fgId = fgByName[fgName], rmId = rmByName[rmName]
      if(!fgId){ append(`❌ FG not found: ${r['Finished Good']}`); continue }
      if(!rmId){ append(`❌ RM not found: ${r['Raw Material']}`); continue }
      const { error } = await supabase
        .from('bom')
        .upsert({ finished_good_id: fgId, raw_material_id: rmId, qty_per_unit: qty }, { onConflict: 'finished_good_id,raw_material_id' })
      if(error){ append(`❌ ${r['Finished Good']} + ${r['Raw Material']}: ${error.message}`) }
      else { append(`✅ ${r['Finished Good']} needs ${qty} × ${r['Raw Material']}`) }
    }
  }

  return (
    <Section title="BOM Bulk Upload (Excel)">
      <div className="row" style={{marginBottom:10}}>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile}/>
      </div>
      <div className="s" style={{marginBottom:8}}>Columns required: <code>Finished Good</code>, <code>Raw Material</code>, <code>Qty</code></div>
      <div style={{whiteSpace:'pre-wrap', fontFamily:'ui-monospace', fontSize:12, background:'var(--surface-2)', padding:10, borderRadius:8, border:'1px dashed var(--border)'}}>
        {log.join('\n') || 'No file processed yet.'}
      </div>
    </Section>
  )
}

/* ---------------- USERS & MODULE ACCESS ---------------- */
function UsersAdmin(){
  const [users,setUsers]=useState([])
  const [name,setName]=useState('')
  const [sel,setSel]=useState(null)
  const [mods,setMods]=useState([])
  const ALL = [
    'dashboard','raw','bom','mfg','mfg-bulk','live','putaway','bin-inv',
    'sales','outward','returns','inv-rm','inv-fg','blends','blend-mfg','admin'
  ]

  async function load(){
    const [{ data: u }, { data: m }] = await Promise.all([
      supabase.from('users').select('id,name,is_active').order('name'),
      supabase.from('user_modules').select('id,user_id,module_key,can_view')
    ])
    setUsers(u||[])
    setMods(m||[])
  }
  useEffect(()=>{ load() },[])

  async function addUser(){
    if(!name.trim()) return
    const { data, error } = await supabase.from('users').insert({ name:name.trim(), is_active:true }).select().single()
    if(error) return alert(error.message)
    setName(''); setSel(data.id); load()
  }
  async function toggleUser(id,active){
    const { error } = await supabase.from('users').update({ is_active: !active }).eq('id', id)
    if(error) return alert(error.message)
    load()
  }
  async function toggleModule(userId, key, value){
    // upsert
    const { error } = await supabase.from('user_modules').upsert({
      user_id: userId, module_key: key, can_view: value
    }, { onConflict: 'user_id,module_key' })
    if(error) return alert(error.message)
    load()
  }

  const perUser = useMemo(()=>{
    const map = {}; (users||[]).forEach(u=>map[u.id]=new Set())
    ;(mods||[]).forEach(m => { if(m.can_view) (map[m.user_id]||=new Set()).add(m.module_key) })
    return map
  },[users,mods])

  const chosen = users.find(u=>u.id===sel) || null
  const chosenSet = perUser[sel] || new Set()

  return (
    <Section title="Users & Module Access">
      <div className="grid" style={{gridTemplateColumns:'320px 1fr', gap:16}}>
        <div className="card">
          <div className="hd"><b>Users</b></div>
          <div className="bd">
            <div className="row" style={{marginBottom:10}}>
              <input placeholder="User name" value={name} onChange={e=>setName(e.target.value)}/>
              <button className="btn" onClick={addUser}>Add</button>
            </div>
            <table className="table">
              <thead><tr><th>Name</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {(users||[]).map(u=>(
                  <tr key={u.id} style={{cursor:'pointer', outline: sel===u.id?'1px solid var(--brand)':'none'}} onClick={()=>setSel(u.id)}>
                    <td>{u.name}</td>
                    <td><span className="badge">{u.is_active?'active':'inactive'}</span></td>
                    <td><button className="btn ghost" onClick={(e)=>{e.stopPropagation(); toggleUser(u.id,u.is_active)}}>{u.is_active?'Disable':'Enable'}</button></td>
                  </tr>
                ))}
                {!users.length && <tr><td colSpan="3" style={{color:'var(--muted)'}}>No users</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="hd"><b>Access</b><span className="badge">{chosen?.name || 'Select a user'}</span></div>
          <div className="bd">
            {!chosen && <div className="badge">Pick a user to edit access</div>}
            {!!chosen && (
              <div className="grid" style={{gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))'}}>
                {ALL.map(k=>(
                  <label key={k} className="row" style={{justifyContent:'space-between', border:'1px solid var(--border)', borderRadius:10, padding:'8px 10px', background:'var(--surface-2)'}}>
                    <span>{k}</span>
                    <input type="checkbox"
                      checked={chosenSet.has(k)}
                      onChange={e=>toggleModule(chosen.id, k, e.target.checked)}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Section>
  )
}

/* ---------------- MAIN ADMIN PAGE ---------------- */
export default function Admin(){
  return (
    <div className="grid">
      <RawMaterialsAdmin/>
      <FinishedGoodsAdmin/>
      <BOMBulkUpload/>
      <CustomersAdmin/>
      <VendorsAdmin/>
      <UsersAdmin/>
    </div>
  )
}
