// src/components/AsyncRMSelect.jsx
import { useEffect, useState, useRef } from 'react'
import { supabase } from '../supabaseClient'
import useDebouncedValue from '../hooks/useDebouncedValue'

/**
 * Async Combobox for Raw Materials.
 * Props:
 *  - value: selected raw_material id (string|number)
 *  - onChange: (id, item) => void
 *  - placeholder: string
 *  - minChars: number (default 0)
 *  - pageSize: number (default 25)
 *  - preselectedName: string (optional, to show initial name if value is set but item not loaded)
 */
export default function AsyncRMSelect({
  value = '',
  onChange = () => { },
  placeholder = 'Search raw materials…',
  minChars = 0,
  pageSize = 25,
  preselectedName = ''
}) {
  const [display, setDisplay] = useState(preselectedName)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  // Search query
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 300)

  const wrapperRef = useRef(null)

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // Fetch items when debounced query changes
  useEffect(() => {
    // Only search if we have enough chars or if it's an initial load (minChars=0)
    if (debouncedQuery.trim().length < minChars) {
      setItems([])
      return
    }

    let cancelled = false

    async function fetchItems() {
      setLoading(true)
      try {
        let q = supabase
          .from('raw_materials')
          .select('id,name,unit')
          .eq('is_active', true)
          .order('name')
          .limit(pageSize)

        if (debouncedQuery.trim()) {
          q = q.ilike('name', `%${debouncedQuery.trim()}%`)
        }

        const { data, error } = await q
        if (!cancelled) {
          if (error) {
            console.error(error)
            setItems([])
          } else {
            setItems(data || [])
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    if (open) {
      fetchItems()
    }
  }, [debouncedQuery, minChars, pageSize, open])

  // Sync display if external value changes (and we don't have the item name yet)
  useEffect(() => {
    if (!value) {
      setDisplay('')
    } else if (preselectedName && display !== preselectedName && !open) {
      // Only reset display if we are not searching
      setDisplay(preselectedName)
    }
  }, [value, preselectedName])


  function handleSelect(item) {
    setDisplay(item.name)
    onChange(item.id, item)
    setOpen(false)
    setQuery('') // Reset search query but keep display
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <input
        type="text"
        placeholder={placeholder}
        value={open ? query : display} // Show query when searching, display name otherwise
        onChange={(e) => {
          setQuery(e.target.value)
          if (!open) {
            setOpen(true)
          }
        }}
        onFocus={() => {
          // Only clear query, don't open yet. Opens on click or typing.
          setQuery('')
        }}
        onClick={() => {
          setOpen(true)
          setQuery('')
        }}
        style={{ width: '100%' }}
      />

      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          zIndex: 100,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          boxShadow: 'var(--shadow-2)',
          maxHeight: 200,
          overflowY: 'auto',
          marginTop: 4
        }}>
          {loading && <div style={{ padding: 8, color: 'var(--muted)' }}>Loading...</div>}

          {!loading && items.length === 0 && (
            <div style={{ padding: 8, color: 'var(--muted)' }}>No results found</div>
          )}

          {!loading && items.map(item => (
            <div
              key={item.id}
              onMouseDown={(e) => {
                e.preventDefault()
                handleSelect(item)
              }}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--border-light)',
                display: 'flex',
                justifyContent: 'space-between'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <span>{item.name}</span>
              <span style={{ color: 'var(--muted)', fontSize: '0.85em' }}>{item.unit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
