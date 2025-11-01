import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'

// Must match the keys used in App.jsx
const ALL_MODULES = [
  'dashboard','raw','bom','mfg','live','putaway','bin-inv',
  'sales','outward','returns','inv-rm','inv-fg',
  'blends','blend-mfg',
  // utilities
  'trace','raw-adjust','so-admin','raw-process','fg-sales', // ✅ Added fg-sales here
  // admin areas
  'masters','admin'
]

// Optional quick presets for convenience
const PRESETS = {
  admin: ALL_MODULES,
  ops: [
    'dashboard','raw','live','putaway','bin-inv','sales','outward','returns',
    'inv-rm','inv-fg','trace','raw-adjust','so-admin','raw-process','fg-sales' // ✅ Added fg-sales in ops preset
  ],
  picker: ['dashboard','outward','live','putaway','bin-inv','trace'],
  viewer: ['dashboard','inv-rm','inv-fg','fg-sales'] // ✅ Viewers can also see FG Sales Report
}

export default function AdminUsers(){
  const [rows,setRows] = useState([])
  const [q,setQ] = useState('')
  const [savingId,setSavingId] = useState(null)

  async function load(){
    const { data, error } = await supabase
      .from('profiles')
      .select('id,email,full_name,role,allowed_modules,created_at')
      .order('created_at', { ascending:false })
    if(error){ alert(error.message); return }
    setRows(data || [])
  }
  useEffect(()=>{ load() },[])

  const filtered = useMemo(()=>{
    const s = q.trim().toLowerCase()
    return (rows||[]).filter(r =>
      !s || (r.email||'').toLowerCase().includes(s) || (r.full_name||'').toLowerCase().includes(s)
    )
  },[rows,q])

  function toggleModule(userId, mod){
    setRows(list => list.map(r=>{
      if(r.id !== userId) return r
      const set = new Set(r.allowed_modules || [])
      set.has(mod) ? set.delete(mod) : set.add(mod)
      return { ...r, allowed_modules: Array.from(set) }
    }))
  }

  function setPreset(userId, presetKey){
    const mods = PRESETS[presetKey] || []
    setRows(list => list.map(r => r.id===userId ? { ...r, allowed_modules:[...mods] } : r))
  }

  async function saveRow(r){
    setSavingId(r.id)
    try{
      // If you give someone role=admin, they see everything anyway.
      const payload = { role: r.role, allowed_modules: r.allowed_modules || [] }
      const { error } = await supabase.from('profiles').update(payload).eq('id', r.id)
      if(error) throw error
    }catch(err){ alert(err.message || String(err)) }
    finally{ setSavingId(null) }
  }

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Users & Access</b>
          <input
            placeholder="Search email / name…"
            value={q}
            onChange={e=>setQ(e.target.value)}
          />
        </div>
        <div className="bd" style={{ overflow:'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{minWidth:260}}>Email / Name</th>
                <th style={{width:140}}>Role</th>
                <th>Allowed Modules</th>
                <th style={{width:210}}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r=>{
                const allowed = new Set(r.allowed_modules || [])
                return (
                  <tr key={r.id}>
                    <td>
                      <div style={{fontWeight:600}}>{r.email || '—'}</div>
                      <div className="s" title="Full name">{r.full_name || '—'}</div>
                    </td>
                    <td>
                      <select
                        value={r.role || 'viewer'}
                        onChange={e=>{
                          const role = e.target.value
                          setRows(list => list.map(x => x.id===r.id ? { ...x, role } : x))
                        }}
                      >
                        <option value="admin">admin</option>
                        <option value="ops">ops</option>
                        <option value="picker">picker</option>
                        <option value="viewer">viewer</option>
                      </select>
                    </td>
                    <td>
                      {r.role === 'admin' ? (
                        <div className="s" style={{color:'var(--muted)'}}>Admin sees all modules.</div>
                      ) : (
                        <div className="row" style={{gap:6, flexWrap:'wrap'}}>
                          {ALL_MODULES.map(mod => {
                            const on = allowed.has(mod)
                            return (
                              <button
                                key={mod}
                                className={`btn small ${on ? '' : 'outline'}`}
                                onClick={()=>toggleModule(r.id, mod)}
                                title={mod}
                              >
                                {mod}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </td>
                    <td className="row" style={{gap:6, justifyContent:'flex-end'}}>
                      {r.role !== 'admin' && (
                        <>
                          <button className="btn small outline" onClick={()=>setPreset(r.id, 'viewer')}>Viewer</button>
                          <button className="btn small outline" onClick={()=>setPreset(r.id, 'picker')}>Picker</button>
                          <button className="btn small outline" onClick={()=>setPreset(r.id, 'ops')}>Ops</button>
                        </>
                      )}
                      <button
                        className="btn small"
                        onClick={()=>saveRow(r)}
                        disabled={savingId === r.id}
                      >
                        {savingId === r.id ? 'Saving…' : 'Save'}
                      </button>
                    </td>
                  </tr>
                )
              })}
              {filtered.length===0 && (
                <tr><td colSpan={4} style={{color:'var(--muted)'}}>No users</td></tr>
              )}
            </tbody>
          </table>

          <div className="s" style={{marginTop:8}}>
            Tip: New signups create a row in <code>profiles</code> via your trigger.
            Set <b>role</b> and <b>allowed_modules</b> here. Admin role automatically gets all access.
          </div>
        </div>
      </div>
    </div>
  )
}

