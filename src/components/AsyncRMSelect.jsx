// src/components/AsyncRMSelect.jsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'

/**
 * Async dropdown for Raw Materials (by name).
 * Props:
 *  - value: selected raw_material id (string|number)
 *  - onChange: (id, item) => void
 *  - placeholder: string
 *  - minChars: number (default 0)
 *  - pageSize: number (default 25)
 */
export default function AsyncRMSelect({
  value = '',
  onChange = ()=>{},
  placeholder = 'Search raw materials…',
  minChars = 0,
  pageSize = 25,
}) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)

  const canSearch = useMemo(()=> q.trim().length >= minChars, [q, minChars])

  useEffect(()=>{
    let cancelled = false
    ;(async ()=>{
      setLoading(true)
      try{
        let query = supabase.from('raw_materials')
          .select('id,name')
          .eq('is_active', true)
          .order('name')
          .limit(pageSize)
        if (canSearch) {
          query = query.ilike('name', `%${q.trim()}%`)
        }
        const { data, error } = await query
        if(!cancelled){
          if(error){ setItems([]) } else { setItems(data || []) }
        }
      } finally {
        if(!cancelled) setLoading(false)
      }
    })()
    return ()=>{ cancelled = true }
  }, [q, canSearch, pageSize])

  return (
    <div className="row" style={{gap:6}}>
      <input
        placeholder={placeholder}
        value={q}
        onChange={e=>setQ(e.target.value)}
        style={{minWidth:220}}
      />
      <select
        value={value}
        onChange={e=>{
          const id = e.target.value
          const item = items.find(i => String(i.id) === String(id))
          onChange(id, item)
        }}
      >
        <option value="">{loading ? 'Loading…' : 'Select'}</option>
        {items.map(i => (
          <option key={i.id} value={i.id}>{i.name}</option>
        ))}
      </select>
    </div>
  )
}
