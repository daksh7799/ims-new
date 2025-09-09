import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import useDebouncedValue from "../hooks/useDebouncedValue";

/**
 * Props:
 *  value: string | number (finished_goods.id)
 *  onChange: (id, item) => void
 *  placeholder?: string
 *  minChars?: number (default 1)
 *  pageSize?: number (default 25)
 *  disabled?: boolean
 */
export default function AsyncFGSelect({
  value,
  onChange,
  placeholder = "Type to search finished goods…",
  minChars = 1,
  pageSize = 25,
  disabled = false,
}) {
  const [input, setInput] = useState("");
  const q = useDebouncedValue(input, 250);
  const [items, setItems] = useState([]);  // {id,name,unit,barcode_prefix}
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const listRef = useRef(null);
  const [selected, setSelected] = useState(null); // cache selected {id,name,...}

  useEffect(() => {
    // When value is externally set (e.g., after submit), fetch its name once
    async function fetchSelectedOnce() {
      if (!value) { setSelected(null); return; }
      const { data, error } = await supabase
        .from("finished_goods")
        .select("id,name,unit,barcode_prefix")
        .eq("id", value)
        .limit(1);
      if (!error && data && data[0]) setSelected(data[0]);
    }
    fetchSelectedOnce();
  }, [value]);

  async function search(pageArg = 1, append = false) {
    if (q.length < minChars) {
      setItems([]);
      setPage(1);
      return;
    }
    setLoading(true);
    const from = (pageArg - 1) * pageSize;
    const to = from + pageSize - 1;

    let qry = supabase
      .from("finished_goods")
      .select("id,name,unit,barcode_prefix")
      .order("name", { ascending: true })
      .ilike("name", `%${q}%`)
      .range(from, to);

    const { data, error } = await qry;
    setLoading(false);
    if (error) { console.error(error); return; }

    setItems((prev) => (append ? [...prev, ...(data || [])] : (data || [])));
    setPage(pageArg);
    setOpen(true);
  }

  useEffect(() => {
    // new query string -> reset to page 1
    if (q.length >= minChars) search(1, false);
    else { setItems([]); setOpen(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function pick(it) {
    setSelected(it);
    setOpen(false);
    setInput(""); // clear search box after selection
    onChange?.(it.id, it);
  }

  function onKey(e) {
    if (!open || !items.length) return;
    const el = listRef.current;
    if (!el) return;
    const current = el.querySelector(".active");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = current ? current.nextElementSibling : el.firstChild;
      next?.scrollIntoView({ block: "nearest" });
      el.querySelectorAll("li").forEach(li => li.classList.remove("active"));
      next?.classList.add("active");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = current ? current.previousElementSibling : el.lastChild;
      prev?.scrollIntoView({ block: "nearest" });
      el.querySelectorAll("li").forEach(li => li.classList.remove("active"));
      prev?.classList.add("active");
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = current || el.firstChild;
      if (target?.dataset?.id) {
        const it = items.find(x => String(x.id) === target.dataset.id);
        if (it) pick(it);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  async function loadMore() {
    await search(page + 1, true);
  }

  return (
    <div style={{ position: "relative", minWidth: 320 }}>
      {/* Selected pill */}
      {selected ? (
        <div className="row" style={{ marginBottom: 6, gap: 6, flexWrap: "wrap" }}>
          <span className="badge">
            {selected.name} {selected.unit ? `(${selected.unit})` : ""}
          </span>
          <button className="btn ghost small" onClick={() => { setSelected(null); onChange?.("", null); }}>
            Clear
          </button>
        </div>
      ) : null}

      {/* Search input */}
      <input
        placeholder={placeholder}
        value={input}
        onChange={e => setInput(e.target.value)}
        onFocus={() => q.length >= minChars && setOpen(true)}
        onKeyDown={onKey}
        disabled={disabled}
      />

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: "absolute",
            zIndex: 50,
            left: 0,
            right: 0,
            top: "calc(100% + 6px)",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            maxHeight: 260,
            overflow: "auto",
            boxShadow: "var(--shadow-1)",
          }}
        >
          <ul ref={listRef} style={{ listStyle: "none", margin: 0, padding: 6 }}>
            {loading && items.length === 0 && (
              <li className="s" style={{ padding: "8px 10px" }}>Searching…</li>
            )}
            {!loading && items.length === 0 && (
              <li className="s" style={{ padding: "8px 10px" }}>
                {q.length < minChars ? `Type at least ${minChars} character` : "No results"}
              </li>
            )}
            {items.map(it => (
              <li
                key={it.id}
                data-id={String(it.id)}
                onMouseDown={() => pick(it)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  // hover highlight
                  listRef.current?.querySelectorAll("li").forEach(li => li.classList.remove("active"));
                  e.currentTarget.classList.add("active");
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{it.name}</div>
                    <div className="s">
                      {it.unit ? `Unit: ${it.unit}` : ""}{it.unit && it.barcode_prefix ? " • " : ""}
                      {it.barcode_prefix ? `Prefix: ${it.barcode_prefix}` : ""}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* Load more */}
          {items.length > 0 && (
            <div style={{ display: "flex", justifyContent: "center", borderTop: "1px dashed var(--border)" }}>
              <button className="btn ghost small" onMouseDown={(e)=>e.preventDefault()} onClick={loadMore} disabled={loading}>
                {loading ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
