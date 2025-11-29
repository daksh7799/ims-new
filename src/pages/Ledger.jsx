import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { downloadCSV } from "../utils/csv";
import { useNavigate } from "react-router-dom";
import AsyncFGSelect from "../components/AsyncFGSelect"; // keep your FG typeahead

/** debounce hook */
function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

const DEFAULT_PAGE_SIZE = 100;
const CHUNK = 1000;

function fmtDate(d) {
  if (!d) return "—";
  const t = typeof d === "string" ? Date.parse(d) : d;
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString();
}

/**
 * LedgerModule — searches ONLY on `note` now (no packet_id).
 * Keeps: FG typeahead, inline RM search, pagination + jump, export, offset clamping.
 */
export default function LedgerModule() {
  const [rows, setRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [selectedFgId, setSelectedFgId] = useState("");
  const [selectedRmId, setSelectedRmId] = useState("");
  const [selectedRmName, setSelectedRmName] = useState("");
  const [movement, setMovement] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [q, setQ] = useState("");
  const debouncedQ = useDebounced(q, 350);
  const debouncedFrom = useDebounced(fromDate, 300);
  const debouncedTo = useDebounced(toDate, 300);

  // raw material inline search state
  const [rmInput, setRmInput] = useState("");
  const rmQ = useDebounced(rmInput, 300);
  const [searchResults, setSearchResults] = useState([]);
  const [rmDropdownOpen, setRmDropdownOpen] = useState(false);

  const [selectedSet, setSelectedSet] = useState(() => new Set());
  const [selectAllFiltered, setSelectAllFiltered] = useState(false);

  const [orderDesc, setOrderDesc] = useState(true);
  const [jumpInput, setJumpInput] = useState("");

  const navigate = useNavigate();
  const abortRef = useRef(null);
  const rmRef = useRef(null);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  /* ---------- INLINE RAW MATERIAL SEARCH (your snippet adapted) ---------- */
  async function searchRawMaterial(keyword) {
    const q = (keyword || "").trim();
    if (!q) {
      setSearchResults([]);
      setRmDropdownOpen(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("raw_materials")
        .select("id,name,unit")
        .ilike("name", `%${q}%`)
        .limit(10);
      if (error) {
        console.warn(error);
        setSearchResults([]);
        setRmDropdownOpen(false);
        return;
      }
      setSearchResults(data || []);
      setRmDropdownOpen(true);
    } catch (e) {
      console.error(e);
      setSearchResults([]);
      setRmDropdownOpen(false);
    }
  }
  useEffect(() => {
    if (!rmQ || rmQ.length === 0) {
      setSearchResults([]);
      setRmDropdownOpen(false);
      return;
    }
    searchRawMaterial(rmQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rmQ]);

  function selectMaterial(mat) {
    if (!mat) return;
    setSelectedRmId(mat.id);
    setSelectedRmName(mat.name);
    setSearchResults([]);
    setRmInput("");
    setRmDropdownOpen(false);
  }
  function clearSelectedRM() {
    setSelectedRmId("");
    setSelectedRmName("");
    setSearchResults([]);
    setRmInput("");
    setRmDropdownOpen(false);
  }
  useEffect(() => {
    function onDoc(e) {
      if (rmRef.current && !rmRef.current.contains(e.target)) setRmDropdownOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  /* ---------- BUILD QUERY: SEARCH ONLY NOTE (no packet_id) ---------- */
  const buildQuery = useCallback(
    (builder) => {
      if (selectedFgId) builder.eq("fg_id", selectedFgId);
      if (selectedRmId) builder.eq("rm_id", selectedRmId);
      if (movement !== "all") builder.eq("movement", movement);
      if (debouncedFrom) builder.gte("created_at", new Date(debouncedFrom).toISOString());
      if (debouncedTo) builder.lte("created_at", new Date(debouncedTo).toISOString());
      if (debouncedQ && debouncedQ.trim()) {
        const QQ = debouncedQ.trim();
        builder.ilike("note", `%${QQ}%`);
      }
      return builder;
    },
    [selectedFgId, selectedRmId, movement, debouncedFrom, debouncedTo, debouncedQ]
  );

  /* ---------- LOAD PAGE with offset clamping ---------- */
  const loadPage = useCallback(
    async (pageToLoad = page, size = pageSize) => {
      setLoading(true);
      setErr("");
      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch {}
      }
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const from = (pageToLoad - 1) * size;
        const to = from + size - 1;

        let query = supabase
          .from("stock_ledger")
          .select("id, movement, reason, qty, packet_id, fg_id, rm_id, note, created_at", { count: "exact" })
          .range(from, to)
          .order("created_at", { ascending: !orderDesc });

        query = buildQuery(query);

        const { data: pageData, error, count } = await query;
        if (error) throw error;

        // clamp if offset beyond count
        if (typeof count === "number" && from >= count && count > 0) {
          const lastPage = Math.max(1, Math.ceil(count / size));
          if (lastPage !== pageToLoad) {
            setPage(lastPage);
            return; // effect will reload
          }
        }

        const rowsPage = pageData || [];
        const fgIds = Array.from(new Set(rowsPage.map((r) => r.fg_id).filter(Boolean)));
        const rmIds = Array.from(new Set(rowsPage.map((r) => r.rm_id).filter(Boolean)));

        const [fgResp, rmResp] = await Promise.all([
          fgIds.length ? supabase.from("finished_goods").select("id, name").in("id", fgIds) : Promise.resolve({ data: [], error: null }),
          rmIds.length ? supabase.from("raw_materials").select("id, name").in("id", rmIds) : Promise.resolve({ data: [], error: null }),
        ]);

        if (fgResp && fgResp.error) throw fgResp.error;
        if (rmResp && rmResp.error) throw rmResp.error;

        const fgById = new Map((fgResp.data || []).map((f) => [String(f.id), f.name]));
        const rmById = new Map((rmResp.data || []).map((r) => [String(r.id), r.name]));

        const augmented = rowsPage.map((r) => ({
          id: r.id,
          movement: r.movement,
          reason: r.reason,
          qty: r.qty,
          packet_id: r.packet_id,
          fg_name: r.fg_id ? fgById.get(String(r.fg_id)) || null : null,
          rm_name: r.rm_id ? rmById.get(String(r.rm_id)) || null : null,
          note: r.note,
          created_at: r.created_at,
        }));

        setRows(augmented);
        setTotalCount(typeof count === "number" ? count : augmented.length);
        setPage(pageToLoad);
        setJumpInput(String(pageToLoad));
      } catch (e) {
        if (e.name !== "AbortError") {
          console.error("loadPage error:", e);
          setErr(String(e));
          setRows([]);
          setTotalCount(0);
        }
      } finally {
        setLoading(false);
        abortRef.current = null;
      }
    },
    [buildQuery, orderDesc, pageSize, page]
  );

  // initial + filters change
  useEffect(() => {
    loadPage(1, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFgId, selectedRmId, movement, debouncedFrom, debouncedTo, debouncedQ, orderDesc, pageSize]);

  // when page changes
  useEffect(() => {
    loadPage(page, pageSize);
  }, [page, pageSize, loadPage]);

  // selection helpers
  const allVisibleSelected = rows.length > 0 && rows.every((r) => selectedSet.has(r.id));
  const someVisibleSelected = rows.some((r) => selectedSet.has(r.id)) && !allVisibleSelected;

  function toggleRow(id, checked) {
    setSelectAllFiltered(false);
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleVisible(checked) {
    setSelectAllFiltered(false);
    setSelectedSet((prev) => {
      const next = new Set(prev);
      rows.forEach((r) => {
        if (checked) next.add(r.id);
        else next.delete(r.id);
      });
      return next;
    });
  }

  function clearFilters() {
    setSelectedFgId("");
    clearSelectedRM();
    setMovement("all");
    setFromDate("");
    setToDate("");
    setQ("");
    setPage(1);
    setSelectAllFiltered(false);
    setSelectedSet(new Set());
  }

  /* ---------- Export and selectAllFiltered (same as before) ---------- */
  async function exportFilteredCSV() {
    setLoading(true);
    try {
      let offset = 0;
      const allRows = [];
      while (true) {
        let qb = supabase
          .from("stock_ledger")
          .select("id, movement, reason, qty, packet_id, fg_id, rm_id, note, created_at")
          .range(offset, offset + CHUNK - 1)
          .order("created_at", { ascending: !orderDesc });
        qb = buildQuery(qb);
        const { data, error } = await qb;
        if (error) throw error;
        if (!data || data.length === 0) break;
        allRows.push(...data);
        if (data.length < CHUNK) break;
        offset += CHUNK;
      }
      const fgIds = Array.from(new Set(allRows.map((r) => r.fg_id).filter(Boolean)));
      const rmIds = Array.from(new Set(allRows.map((r) => r.rm_id).filter(Boolean)));
      const [fgResp, rmResp] = await Promise.all([
        fgIds.length ? supabase.from("finished_goods").select("id, name").in("id", fgIds) : Promise.resolve({ data: [], error: null }),
        rmIds.length ? supabase.from("raw_materials").select("id, name").in("id", rmIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (fgResp && fgResp.error) throw fgResp.error;
      if (rmResp && rmResp.error) throw rmResp.error;
      const fgById = new Map((fgResp.data || []).map((f) => [String(f.id), f.name]));
      const rmById = new Map((rmResp.data || []).map((r) => [String(r.id), r.name]));
      const csv = allRows.map((r) => ({
        movement: r.movement,
        reason: r.reason,
        qty: r.qty,
        packet_id: r.packet_id,
        fg_name: r.fg_id ? fgById.get(String(r.fg_id)) || "" : "",
        rm_name: r.rm_id ? rmById.get(String(r.rm_id)) || "" : "",
        note: r.note,
        created_at: fmtDate(r.created_at),
      }));
      downloadCSV("ledger_export.csv", csv);
    } catch (e) {
      console.error(e);
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function selectAllFilteredRows() {
    setLoading(true);
    try {
      let offset = 0;
      const ids = [];
      while (true) {
        let qb = supabase.from("stock_ledger").select("id").range(offset, offset + CHUNK - 1).order("created_at", { ascending: !orderDesc });
        qb = buildQuery(qb);
        const { data, error } = await qb;
        if (error) throw error;
        if (!data || data.length === 0) break;
        ids.push(...data.map((d) => d.id));
        if (data.length < CHUNK) break;
        offset += CHUNK;
      }
      setSelectedSet(new Set(ids));
      setSelectAllFiltered(true);
    } catch (e) {
      console.error(e);
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  function downloadSelected() {
    const chosen = Array.from(selectedSet);
    if (!chosen.length) return alert("Select rows first");
    navigate("/labels", { state: { ids: chosen, mode: "download" } });
  }

  // pagination helpers & jump
  function goFirst() { setPage(1); }
  function goLast() { setPage(totalPages); }
  function goPrev() { setPage((p) => Math.max(1, p - 1)); }
  function goNext() { setPage((p) => Math.min(totalPages, p + 1)); }
  function doJump() {
    const n = Number(jumpInput);
    if (!Number.isFinite(n) || n < 1) return alert("Enter a valid page number");
    setPage(Math.min(totalPages, Math.max(1, Math.floor(n))));
  }

  // inline styles kept for quick drop-in
  const colStyleCompact = { display: "flex", flexDirection: "column", gap: 4, lineHeight: 1.1 };
  const smallMuted = { fontSize: 12, color: "var(--muted)" };
  const boldMain = { fontWeight: 600 };

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Ledger</b>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <AsyncFGSelect value={selectedFgId} onChange={(id) => setSelectedFgId(id)} placeholder="Type to search finished goods…" />

            {/* inline raw material typeahead */}
            <div ref={rmRef} style={{ position: "relative", minWidth: 320 }}>
              {selectedRmId ? (
                <div className="row" style={{ marginBottom: 6, gap: 6, flexWrap: "wrap" }}>
                  <span className="badge">{selectedRmName}</span>
                  <button className="btn ghost small" onClick={clearSelectedRM}>Clear</button>
                </div>
              ) : null}
              <input
                placeholder="Type to search raw materials…"
                value={rmInput}
                onChange={(e) => setRmInput(e.target.value)}
                onFocus={() => rmQ.length >= 1 && setRmDropdownOpen(true)}
              />
              {rmDropdownOpen && searchResults.length > 0 && (
                <div style={{ position: "absolute", zIndex: 50, left: 0, right: 0, top: "calc(100% + 6px)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, maxHeight: 260, overflow: "auto", boxShadow: "var(--shadow-1)" }}>
                  <ul style={{ listStyle: "none", margin: 0, padding: 6 }}>
                    {searchResults.map((it) => (
                      <li key={it.id} onMouseDown={() => selectMaterial(it)} style={{ padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}>
                        <div style={{ fontWeight: 600 }}>{it.name}</div>
                        <div className="s" style={{ fontSize: 12, color: "var(--muted)" }}>{it.unit || ""}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <select value={movement} onChange={(e) => setMovement(e.target.value)}>
              <option value="all">All movements</option>
              <option value="in">In</option>
              <option value="out">Out</option>
              <option value="adjustment">Adjustment</option>
            </select>

            <input type="datetime-local" step="1" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            <input type="datetime-local" step="1" value={toDate} onChange={(e) => setToDate(e.target.value)} />

            <input placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />

            <button className="btn ghost" onClick={clearFilters}>Clear Filters</button>
            <button className="btn outline" onClick={exportFilteredCSV} disabled={loading}>Export CSV</button>
            <button className="btn" onClick={selectAllFilteredRows} disabled={loading}>Select all filtered</button>
            <button className="btn" onClick={downloadSelected} disabled={!selectedSet.size}>Download Selected</button>
          </div>
        </div>

        <div className="bd" style={{ overflow: "auto" }}>
          {!!err && <div className="badge err">{err}</div>}

          {/* IMPORTANT: self-closing <col /> only — no whitespace between them */}
          <table className="table" style={{ width: "100%", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 36 }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "6%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "24%" }} />
              <col style={{ width: "6%" }} />
            </colgroup>

            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={allVisibleSelected} ref={(el) => el && (el.indeterminate = someVisibleSelected)} onChange={(e) => toggleVisible(e.target.checked)} />
                </th>
                <th>Movement</th>
                <th>Reason</th>
                <th>Qty</th>
                <th>Finished Good</th>
                <th>Raw Material</th>
                <th>Note</th>
                <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => setOrderDesc((d) => !d)}>Created {orderDesc ? "↓" : "↑"}</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--muted-2)", verticalAlign: "top" }}>
                  <td style={{ padding: "12px 8px" }}>
                    <input type="checkbox" checked={selectedSet.has(r.id)} onChange={(e) => toggleRow(r.id, e.target.checked)} />
                  </td>

                  <td style={{ padding: "12px 8px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, lineHeight: 1.1 }}>
                      <div style={{ fontWeight: 600 }}>{r.movement || "—"}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>{r.packet_id ? `pkt: ${r.packet_id}` : ""}</div>
                    </div>
                  </td>

                  <td style={{ padding: "12px 8px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ fontWeight: 500 }}>{r.reason || "—"}</div>
                    </div>
                  </td>

                  <td style={{ padding: "12px 8px", textAlign: "left" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ fontWeight: 600 }}>{r.qty ?? "—"}</div>
                    </div>
                  </td>

                  <td style={{ padding: "12px 8px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontWeight: 600 }}>{r.fg_name || "—"}</div>
                    </div>
                  </td>

                  <td style={{ padding: "12px 8px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontWeight: 600 }}>{r.rm_name || "—"}</div>
                    </div>
                  </td>

                  <td style={{ padding: "12px 8px", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.3 }}>{r.note || "—"}</td>

                  <td style={{ padding: "12px 8px", whiteSpace: "nowrap" }}>{fmtDate(r.created_at)}</td>
                </tr>
              ))}

              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ color: "var(--muted)", padding: 20 }}>{loading ? "Loading…" : "No rows found"}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="row" style={{ justifyContent: "center", marginTop: 12, gap: 8, alignItems: "center" }}>
          <button className="btn ghost" onClick={() => setPage(1)} disabled={page === 1 || loading}>⏮ First</button>
          <button className="btn ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1 || loading}>← Prev</button>

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span>Page</span>
            <input value={jumpInput} onChange={(e) => setJumpInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doJump(); }} style={{ width: 80, textAlign: "center" }} />
            <button className="btn" onClick={doJump} disabled={loading}>Go</button>
            <span>of {totalPages}</span>
          </div>

          <button className="btn ghost" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading}>Next →</button>
          <button className="btn ghost" onClick={() => setPage(totalPages)} disabled={page >= totalPages || loading}>Last ⏭</button>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span className="s">Per page</span>
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {[25, 50, 100, 250, 500].map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}
