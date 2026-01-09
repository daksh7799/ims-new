// src/components/AsyncFGSelect.jsx
import { useEffect, useState, useRef } from "react";
import { supabase } from "../supabaseClient";
import useDebouncedValue from "../hooks/useDebouncedValue";

/**
 * Async Combobox for Finished Goods.
 * Props:
 *  - value: selected finished_good id (string|number)
 *  - onChange: (id, item) => void
 *  - placeholder: string
 *  - minChars: number (default 0)
 *  - pageSize: number (default 25)
 *  - preselectedName: string (optional)
 *  - disabled: boolean
 */
export default function AsyncFGSelect({
  value = "",
  onChange = () => { },
  placeholder = "Type to search finished goods…",
  minChars = 0,
  pageSize = 25,
  preselectedName = "",
  disabled = false,
}) {
  const [display, setDisplay] = useState(preselectedName);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  // Search query
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300);

  const wrapperRef = useRef(null);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch items when debounced query changes
  useEffect(() => {
    if (debouncedQuery.trim().length < minChars) {
      setItems([]);
      return;
    }

    let cancelled = false;

    async function fetchItems() {
      setLoading(true);
      try {
        let q = supabase
          .from("finished_goods")
          .select("id,name,code_prefix")
          .eq("is_active", true)
          .order("name")
          .limit(pageSize);

        if (debouncedQuery.trim()) {
          q = q.ilike("name", `%${debouncedQuery.trim()}%`);
        }

        const { data, error } = await q;
        if (!cancelled) {
          if (error) {
            console.error(error);
            setItems([]);
          } else {
            setItems(data || []);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (open) {
      fetchItems();
    }
  }, [debouncedQuery, minChars, pageSize, open]);

  // Sync display if external value changes
  useEffect(() => {
    if (!value) {
      setDisplay("");
    } else if (preselectedName && display !== preselectedName && !open) {
      setDisplay(preselectedName);
    } else if (value && !display && !open) {
      // If we have a value but no display name, we might want to fetch it
      // This is a fallback if preselectedName isn't provided
      (async () => {
        const { data } = await supabase.from('finished_goods').select('name').eq('id', value).single();
        if (data) setDisplay(data.name);
      })();
    }
  }, [value, preselectedName]);

  function handleSelect(item) {
    setDisplay(item.name);
    onChange(item.id, item);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={wrapperRef} style={{ position: "relative", width: "100%", minWidth: 220, zIndex: open ? 9999 : undefined }}>
      <input
        type="text"
        placeholder={placeholder}
        value={open ? query : display}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) {
            setOpen(true);
          }
        }}
        onFocus={() => {
          if (!disabled) {
            // Only clear query, don't open yet. Opens on click or typing.
            setQuery("");
          }
        }}
        onClick={() => {
          if (!disabled) {
            setOpen(true);
            setQuery("");
          }
        }}
        disabled={disabled}
        style={{ width: "100%" }}
      />

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 9999,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            boxShadow: "var(--shadow-2)",
            maxHeight: 200,
            overflowY: "auto",
            marginTop: 4,
          }}
        >
          {loading && <div style={{ padding: 8, color: "var(--muted)" }}>Loading...</div>}

          {!loading && items.length === 0 && (
            <div style={{ padding: 8, color: "var(--muted)" }}>No results found</div>
          )}

          {!loading &&
            items.map((item) => (
              <div
                key={item.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(item);
                }}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  borderBottom: "1px solid var(--border-light)",
                  display: "flex",
                  justifyContent: "space-between",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span>{item.name}</span>
                {item.code_prefix && (
                  <span style={{ color: "var(--muted)", fontSize: "0.85em" }}>
                    {item.code_prefix}
                  </span>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
