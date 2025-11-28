// src/pages/AdminMasters.jsx
import { useEffect, useState, useMemo, useCallback, memo } from 'react';
import { supabase } from '../supabaseClient';
import { useToast } from '../ui/toast';

/* ---------- small helpers ---------- */
const norm = (s = '') => String(s).trim().toLowerCase();

/* ---------- generic server-side paginated CRUD hook ---------- */
function usePagedList({
  table,
  orderBy = 'name',
  searchCols = ['name'],
  size = 100,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(size);
  const [total, setTotal] = useState(0);
  const { push } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      let query = supabase
        .from(table)
        .select('*', { count: 'exact' })
        .order(orderBy, { ascending: true })
        .range(from, to);

      const s = q.trim();
      if (s) {
        const like = `%${s}%`;
        const or = searchCols.map((c) => `${c}.ilike.${like}`).join(',');
        query = query.or(or);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      setRows(data || []);
      setTotal(count ?? 0);
    } catch (e) {
      push(e.message, 'err');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [table, orderBy, page, pageSize, q, searchCols, push]);

  useEffect(() => {
    load();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil((total || 0) / Math.max(1, pageSize)));
  const canPrev = page > 0;
  const canNext = page + 1 < pageCount;

  const next = () => canNext && setPage((p) => p + 1);
  const prev = () => canPrev && setPage((p) => p - 1);
  const reset = (n) => {
    setPageSize(n);
    setPage(0);
  };
  const search = (v) => {
    setQ(v);
    setPage(0);
  };

  return {
    rows,
    setRows,
    loading,
    reload: load,
    q,
    setQ: search,
    page,
    pageSize,
    setPageSize: reset,
    total,
    pageCount,
    canPrev,
    canNext,
    next,
    prev,
  };
}

/* ---------- generic inline-edit CRUD section ---------- */
const CrudSection = memo(({ table, title, searchCols, extraCols = null }) => {
  const { rows, setRows, loading, reload, q, setQ, page, pageSize, setPageSize, total, pageCount, canPrev, canNext, next, prev } =
    usePagedList({ table, searchCols });

  const [form, setForm] = useState(() => ({ name: '', is_active: true, ...extraCols?.default }));
  const { push } = useToast();

  const saveRow = useCallback(
    async (row) => {
      const { error } = await supabase.from(table).update(row).eq('id', row.id);
      if (error) return push(error.message, 'err');
      push('Data saved', 'ok');
    },
    [table, push]
  );

  const addRow = useCallback(async () => {
    if (!form.name.trim()) return push('Name required', 'warn');
    const { error } = await supabase.from(table).insert({ ...form, name: form.name.trim() });
    if (error) return push(error.message, 'err');
    setForm({ name: '', is_active: true, ...extraCols?.default });
    reload();
  }, [form, table, reload, push, extraCols]);

  const toggleActive = useCallback(
    async (id, active) => {
      const { error } = await supabase.from(table).update({ is_active: !active }).eq('id', id);
      if (!error) {
        reload();
        push('Data saved', 'ok');
      } else push(error.message, 'err');
    },
    [table, reload, push]
  );

  const columns = useMemo(
    () => [
      { key: 'name', label: 'Name', width: 240 },
      ...(extraCols?.columns || []),
      { key: 'is_active', label: 'Active', type: 'check' },
    ],
    [extraCols]
  );

  return (
    <>
      {/* toolbar */}
      <div className="row" style={{ marginBottom: 10, gap: 8, alignItems: 'center' }}>
        <input placeholder={`Search ${title.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="badge">Page {page + 1} / {pageCount}</span>
        <span className="badge">Loaded {rows.length} • Total {total}</span>
        <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
          <option value={200}>200 / page</option>
        </select>
        <button className="btn small" onClick={prev} disabled={!canPrev}>Prev</button>
        <button className="btn small" onClick={next} disabled={!canNext}>Next</button>
        <button className="btn ghost" onClick={reload} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* add row */}
      <div className="row" style={{ marginBottom: 10, gap: 8 }}>
        <input placeholder="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={{ minWidth: 240 }} />
        {extraCols?.render?.(form, setForm)}
        <button className="btn" onClick={addRow}>
          Add {title.slice(0, -1)}
        </button>
      </div>

      {/* table */}
      <div style={{ overflow: 'auto', maxHeight: 520 }}>
        <table className="table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={{ width: c.width }}>
                  {c.label}
                </th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {columns.map((c) =>
                  c.type === 'check' ? (
                    <td key={c.key}>
                      <input
                        type="checkbox"
                        checked={!!r[c.key]}
                        onChange={(e) => setRows((list) => list.map((x) => (x.id === r.id ? { ...x, [c.key]: e.target.checked } : x)))}
                      />
                    </td>
                  ) : (
                    <td key={c.key}>
                      <input
                        value={r[c.key] || ''}
                        onChange={(e) => setRows((list) => list.map((x) => (x.id === r.id ? { ...x, [c.key]: e.target.value } : x)))}
                        style={{ width: c.width }}
                      />
                    </td>
                  )
                )}
                <td className="row">
                  <button className="btn small" onClick={() => saveRow(r)}>Save</button>
                  <button className="btn small outline" onClick={() => toggleActive(r.id, r.is_active)}>
                    {r.is_active ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={columns.length + 1} style={{ color: 'var(--muted)' }}>
                  {loading ? 'Loading…' : `No ${title.toLowerCase()}`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
});

/* ---------- Processing Pairs (special case) ---------- */
const PairsSection = memo(() => {
  const [pairs, setPairs] = useState([]);
  const [raws, setRaws] = useState([]);
  const [source, setSource] = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(true);
  const { push } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: p }, { data: r }] = await Promise.all([
      supabase.from('v_processing_pairs_expanded').select('*'),
      supabase.from('raw_materials').select('id,name').eq('is_active', true).order('name'),
    ]);
    setPairs(p || []);
    setRaws(r || []);
    setLoading(false);
  }, [push]);

  useEffect(() => {
    load();
  }, [load]);

  const add = useCallback(async () => {
    if (!source || !output) return push('Pick both source and output', 'warn');
    const { error } = await supabase.from('processing_pairs').insert({ source_rm_id: source, output_rm_id: output, is_active: true });
    if (error) return push(error.message, 'err');
    setSource('');
    setOutput('');
    push('Data saved', 'ok');
    load();
  }, [source, output, load, push]);

  const toggle = useCallback(
    async (p) => {
      const { error } = await supabase.from('processing_pairs').update({ is_active: !p.is_active }).eq('id', p.id);
      if (error) return push(error.message, 'err');
      push('Data saved', 'ok');
      load();
    },
    [load, push]
  );

  return (
    <>
      <div className="row" style={{ marginBottom: 10, gap: 8, alignItems: 'center' }}>
        <span className="badge">Loaded {pairs.length} pairs</span>
        <button className="btn ghost" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="row" style={{ marginBottom: 10, gap: 8 }}>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">-- Source RM --</option>
          {raws.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select value={output} onChange={(e) => setOutput(e.target.value)}>
          <option value="">-- Output RM --</option>
          {raws.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <button className="btn" onClick={add}>
          Add Pair
        </button>
      </div>

      <div style={{ overflow: 'auto', maxHeight: 520 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Source RM</th>
              <th>Output RM</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p) => (
              <tr key={p.id}>
                <td>{p.source_rm_name}</td>
                <td>{p.output_rm_name}</td>
                <td>{p.is_active ? 'Yes' : 'No'}</td>
                <td>
                  <button className="btn small" onClick={() => toggle(p)}>
                    {p.is_active ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
            {!pairs.length && (
              <tr>
                <td colSpan="4" style={{ color: 'var(--muted)' }}>No pairs defined</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
});

/* ---------- main page ---------- */
export default function AdminMasters() {
  const [tab, setTab] = useState('rm');

  const buttons = [
    { key: 'rm', label: 'Raw Materials' },
    { key: 'fg', label: 'Finished Goods' },
    { key: 'ven', label: 'Vendors' },
    { key: 'cust', label: 'Customers' },
    { key: 'pairs', label: 'Processing Pairs' },
  ];

  const extra = {
    rm: {
      default: { unit: 'kg', low_threshold: null },
      columns: [
        { key: 'unit', label: 'Unit', width: 120 },
        { key: 'low_threshold', label: 'Low Threshold', width: 140 },
      ],
      render: (form, setForm) => (
        <>
          <input
            placeholder="Unit"
            value={form.unit || ''}
            onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
            style={{ width: 120 }}
          />
          <input
            placeholder="Low threshold"
            type="number"
            value={form.low_threshold || ''}
            onChange={(e) => setForm((f) => ({ ...f, low_threshold: e.target.value }))}
            style={{ width: 140 }}
          />
        </>
      ),
    },
    fg: {
      default: { unit: 'pkt', low_threshold: null, barcode_prefix: '' },
      columns: [
        { key: 'barcode_prefix', label: 'Barcode Prefix', width: 220 },
        { key: 'low_threshold', label: 'Low Threshold', width: 140 },
      ],
      render: (form, setForm) => (
        <>
          <select
            value={form.unit}
            onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
            style={{ width: 100 }}
          >
            <option value="pkt">pkt</option>
            <option value="kg">kg</option>
          </select>
          <input
            placeholder="Barcode prefix"
            value={form.barcode_prefix || ''}
            onChange={(e) => setForm((f) => ({ ...f, barcode_prefix: e.target.value }))}
            style={{ width: 220 }}
          />
          <input
            placeholder="Low threshold"
            type="number"
            value={form.low_threshold || ''}
            onChange={(e) => setForm((f) => ({ ...f, low_threshold: e.target.value }))}
            style={{ width: 140 }}
          />
        </>
      ),
    },
  };

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Master Data</b>
          <div className="row" style={{ gap: 8 }}>
            {buttons.map((b) => (
              <button
                key={b.key}
                className={`btn small ${tab === b.key ? '' : 'outline'}`}
                onClick={() => setTab(b.key)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <div className="bd">
          {tab === 'rm' && <CrudSection table="raw_materials" title="Raw Materials" searchCols={['name']} extraCols={extra.rm} />}
          {tab === 'fg' && <CrudSection table="finished_goods" title="Finished Goods" searchCols={['name', 'barcode_prefix']} extraCols={extra.fg} />}
          {tab === 'ven' && <CrudSection table="vendors" title="Vendors" searchCols={['name']} />}
          {tab === 'cust' && <CrudSection table="customers" title="Customers" searchCols={['name']} />}
          {tab === 'pairs' && <PairsSection />}
        </div>
      </div>
    </div>
  );
}