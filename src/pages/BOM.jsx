// src/pages/BOM.jsx
import {
  useEffect, useState, useCallback, useMemo, memo
} from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../supabaseClient';
import AsyncFGSelect from '../components/AsyncFGSelect.jsx';
import { downloadCSV } from '../utils/csv';
import { useToast } from '../ui/toast.jsx';

/* ---------- small pure helpers ---------- */
const normalize = (s = '') => String(s).trim().toLowerCase();

async function fetchAll(table, cols = 'id,name,is_active', onlyActive = true, page = 1000) {
  let from = 0, bucket = [];
  while (true) {
    let q = supabase.from(table).select(cols, { count: 'exact' }).order('name').range(from, from + page - 1);
    if (onlyActive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    bucket.push(...(data || []));
    if (!data || data.length < page) break;
    from += page;
  }
  return bucket;
}

/* ---------- tabs as memoised components ---------- */
const ManualTab = memo(({ fgId, setFgId }) => {
  const { push } = useToast();
  const [rms, setRms] = useState([]);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);

  /* load masters once */
  useEffect(() => {
    fetchAll('raw_materials').then(setRms).catch(e => push(e.message, 'err'));
  }, [push]);

  /* load BOM when FG changes */
  useEffect(() => {
    if (!fgId) return setLines([]);
    setLoading(true);
    supabase
      .from('v_bom_for_fg')
      .select('raw_material_id,raw_material_name,qty_per_unit')
      .eq('finished_good_id', fgId)
      .order('raw_material_name')
      .then(({ data, error }) => {
        setLoading(false);
        if (error) return push(error.message, 'err');
        setLines(data.map(r => ({ ...r, qty_per_unit: String(r.qty_per_unit) })));
        setDirty(false);
      });
  }, [fgId, push]);

  const addLine = useCallback(() => {
    setLines(l => [...l, { raw_material_id: '', raw_material_name: '', qty_per_unit: '' }]);
    setDirty(true);
  }, []);
  const removeLine = useCallback(i => {
    setLines(l => l.filter((_, idx) => idx !== i));
    setDirty(true);
  }, []);
  const updateLine = useCallback((i, patch) => {
    setLines(l => l.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
    setDirty(true);
  }, []);
  const onRmChange = useCallback((i, newId) => {
    const rm = rms.find(r => String(r.id) === String(newId));
    updateLine(i, { raw_material_id: newId, raw_material_name: rm?.name || '' });
  }, [rms, updateLine]);

  const saveAll = useCallback(async () => {
    if (!fgId) return push('Pick a finished good', 'warn');
    const seen = new Set();
    const norm = [];
    for (const l of lines) {
      const rm = String(l.raw_material_id).trim();
      const qty = Number(l.qty_per_unit);
      if (!rm || !(qty >= 0)) return push('Each line needs RM and non-negative qty', 'warn');
      if (seen.has(rm)) return push('Duplicate RM lines not allowed', 'warn');
      seen.add(rm);
      norm.push({ raw_material_id: rm, qty_per_unit: qty });
    }
    setLoading(true);
    const { error } = await supabase.rpc('set_bom_for_fg', { p_finished_good_id: fgId, p_lines: norm });
    setLoading(false);
    if (error) return push(error.message, 'err');
    push('BOM saved', 'ok');
    setDirty(false);
    /* we already have the truth – no need to reload */
    setLines(norm.map(n => ({ ...n, qty_per_unit: String(n.qty_per_unit) })));
  }, [fgId, lines, push]);

  const exportCSV = useCallback(() => {
    if (!lines.length) return push('Nothing to export', 'warn');
    downloadCSV(
      'bom.csv',
      lines.map(l => ({ raw_material_id: l.raw_material_id, raw_material: l.raw_material_name, qty_per_unit: l.qty_per_unit }))
    );
  }, [lines, push]);

  /* mount fresh table when FG changes – kills stale inputs instantly */
  return (
    <div key={fgId}>
      <div className="row" style={{ marginBottom: 10 }}>
        <AsyncFGSelect value={fgId} onChange={id => setFgId(String(id || ''))} placeholder="Type to search finished goods…" pageSize={25} minChars={0} />
        <span className="badge">Lines: {lines.length}</span>
      </div>

      <div style={{ overflow: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 420 }}>Raw Material</th>
              <th style={{ textAlign: 'right', width: 160 }}>Qty / Unit</th>
              <th style={{ width: 80 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={idx}>
                <td>
                  <select value={l.raw_material_id} onChange={e => onRmChange(idx, e.target.value)} style={{ minWidth: 360 }}>
                    <option value="">-- Select Raw Material --</option>
                    {rms.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name} {r.unit ? `(${r.unit})` : ''}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <input type="number" min="0" step="0.0001" value={l.qty_per_unit} onChange={e => updateLine(idx, { qty_per_unit: e.target.value })} style={{ width: 150, textAlign: 'right' }} />
                </td>
                <td>
                  <button className="btn ghost" onClick={() => removeLine(idx)}>✕</button>
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={3} style={{ color: 'var(--muted)' }}>{fgId ? 'No BOM lines yet — add raw materials.' : 'Pick a Finished Good.'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn outline" onClick={addLine} disabled={!fgId || !rms.length}>+ Add RM</button>
        <button className="btn outline" onClick={exportCSV} disabled={!lines.length}>Export CSV</button>
        <button className="btn" onClick={saveAll} disabled={!fgId || loading}>{loading ? 'Saving…' : dirty ? 'Save All *' : 'Save All'}</button>
      </div>
    </div>
  );
});

const BulkTab = memo(() => {
  const { push } = useToast();
  const [rows, setRows] = useState([]);
  const [errors, setErrors] = useState([]);
  const [result, setResult] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [mastersLoading, setMastersLoading] = useState(false);
  const [fgs, setFgs] = useState([]);
  const [rmsAll, setRmsAll] = useState([]);

  /* load masters once */
  useEffect(() => {
    setMastersLoading(true);
    Promise.all([fetchAll('finished_goods'), fetchAll('raw_materials')])
      .then(([f, r]) => {
        setFgs(f);
        setRmsAll(r);
      })
      .catch(e => push('Master load failed: ' + e.message, 'err'))
      .finally(() => setMastersLoading(false));
  }, [push]);

  const onFile = useCallback(e => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const out = [];
        const errs = [];
        json.forEach((r, idx) => {
          const fg = r['Finished Good'] ?? r['FG'] ?? r['finished good'] ?? '';
          const rm = r['Raw Material'] ?? r['RM'] ?? r['raw material'] ?? '';
          const q = r['Qty per Unit'] ?? r['qty'] ?? '';
          const qty = Number(String(q).replace(',', '.'));
          const ln = idx + 2;
          if (!String(fg).trim() || !String(rm).trim()) errs.push(`Row ${ln}: missing FG or RM`);
          else if (!Number.isFinite(qty) || qty <= 0) errs.push(`Row ${ln}: invalid Qty`);
          out.push({ fg: String(fg).trim(), rm: String(rm).trim(), qty });
        });
        setRows(out);
        setErrors(errs);
        setResult(null);
      } catch (err) {
        push('File read failed: ' + err.message, 'err');
        setRows([]);
        setErrors([]);
        setResult(null);
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsBinaryString(f);
  }, [push]);

  const grouped = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const key = r.fg;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(r);
    }
    return [...m.entries()];
  }, [rows]);

  const upload = useCallback(async () => {
    if (!rows.length) return push('No rows loaded', 'warn');
    if (errors.length) return push('Fix errors first:\n' + errors.slice(0, 5).join('\n'), 'warn');
    setBulkLoading(true);
    setResult(null);
    try {
      const fgByName = new Map(fgs.map(x => [normalize(x.name), x.id]));
      const rmByName = new Map(rmsAll.map(x => [normalize(x.name), x.id]));
      const missing = [];
      for (const r of rows) {
        if (!fgByName.has(normalize(r.fg))) missing.push(`FG not found: ${r.fg}`);
        if (!rmByName.has(normalize(r.rm))) missing.push(`RM not found: ${r.rm}`);
      }
      if (missing.length) {
        push('Name mismatches:\n' + [...new Set(missing)].slice(0, 30).join('\n'), 'warn');
        setBulkLoading(false);
        return;
      }
      for (const [fgName, list] of grouped) {
        const fgUUID = fgByName.get(normalize(fgName));
        const payload = list.map(r => ({
          finished_good_id: fgUUID,
          raw_material_id: rmByName.get(normalize(r.rm)),
          qty_per_unit: Number(r.qty)
        }));
        const { error: upErr } = await supabase.from('bom').upsert(payload, { onConflict: 'finished_good_id,raw_material_id' });
        if (upErr) throw upErr;
        const keepIds = payload.map(p => p.raw_material_id);
        const inList = keepIds.length ? `(${keepIds.map(id => `"${id}"`).join(',')})` : '(NULL)';
        const { error: delErr } = await supabase.from('bom').delete().eq('finished_good_id', fgUUID).not('raw_material_id', 'in', inList);
        if (delErr) throw delErr;
      }
      setResult({ ok: true, summary: grouped.map(([fg, list]) => ({ fg, components: list.length })) });
    } catch (err) {
      console.error(err);
      setResult({ ok: false, msg: err.message });
    } finally {
      setBulkLoading(false);
    }
  }, [rows, errors, fgs, rmsAll, grouped, push]);

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} />
        <button className="btn" onClick={upload} disabled={!rows.length || bulkLoading || mastersLoading}>
          {bulkLoading ? 'Uploading…' : mastersLoading ? 'Loading masters…' : 'Upload'}
        </button>
        <button className="btn outline" onClick={() => { setRows([]); setErrors([]); setResult(null); }} disabled={!rows.length || bulkLoading}>
          Clear
        </button>
      </div>

      {!!errors.length && <div className="badge err">{errors.length} issue(s). First: {errors[0]}</div>}
      {!rows.length && <div className="badge">No rows loaded</div>}

      {!!rows.length && (
        <table className="table">
          <thead>
            <tr>
              <th>Finished Good</th>
              <th>Raw Material</th>
              <th style={{ textAlign: 'right' }}>Qty/Unit</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 500).map((r, i) => (
              <tr key={i}>
                <td>{r.fg}</td>
                <td>{r.rm}</td>
                <td style={{ textAlign: 'right' }}>{r.qty}</td>
              </tr>
            ))}
            {rows.length > 500 && (
              <tr>
                <td colSpan={3}>…and {rows.length - 500} more</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {result && (
        <div style={{ marginTop: 10 }} className={`badge ${result.ok ? 'ok' : 'err'}`}>
          {result.ok ? `Done. Updated ${result.summary.length} FGs.` : `Failed: ${result.msg}`}
        </div>
      )}
    </>
  );
});

/* ---------- main page ---------- */
export default function BOM() {
  const { push } = useToast();
  const [tab, setTab] = useState('manual');
  const [fgId, setFgId] = useState('');

  return (
    <div className="grid">
      <div className="card">
        <div className="hd">
          <b>Bill of Materials</b>
          <div className="row">
            <button className={`btn ghost ${tab === 'manual' ? 'active' : ''}`} onClick={() => setTab('manual')}>
              Manual
            </button>
            <button className={`btn ghost ${tab === 'bulk' ? 'active' : ''}`} onClick={() => setTab('bulk')}>
              Bulk Upload
            </button>
          </div>
        </div>

        <div className="bd">{tab === 'manual' ? <ManualTab fgId={fgId} setFgId={setFgId} /> : <BulkTab />}</div>
      </div>
    </div>
  );
}