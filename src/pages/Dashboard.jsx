import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts'

/** ✅ Updated customer list (from your DB actual names) */
const CUSTOMER_LIST = [
  'Flipkart Goshudh Cons Hyderabad',
  'Flipkart Goshudh Cons Bhiwandi',
  'Flipkart Goshudh Cons Jaipur',
  'Jiomart Cons Mumbai',
  'Amazon Cons Banglore',
  'Amazon Cons DED3',
  'Flipkart Reblast Cons Haringhata',
  'Flipkart Reblast Cons Hyderabad',
  'Flipkart Goshudh Cons Malur',
  'Amazon Cons Hyderabad',
  'Flipkart Reblast Cons Malur',
  'Flipkart Reblast Cons Sankpa',
  'Amazon Cons Maharashtra',
  'Flipkart Goshudh Cons Guwahati',
  'Flipkart Reblast Cons Bhiwandi',
  'Jiomart Cons Hyderabad',
  'Flipkart Reblast Cons Guwahati',
  'Flipkart Reblast Cons Kolkatta',
  'Flipkart Goshudh Cons Kolkatta',
  'Jiomart Cons Kolkatta',
  'Flipkart Goshudh Cons Sankpa',
  'Meesho Cons',
  'Amazon Cons Haryana',
  'Flipkart Reblast Cons Jaipur',
  'Jiomart Cons Haryana',
  'Amazon Cons Kolkatta',
  'Flipkart Goshudh Cons Haringhata'
]

const PERIODS = [3, 7, 15, 30]
const CUSTOMER_PERIOD = 30
const REFRESH_MS = 60_000

export default function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [sales7, setSales7] = useState([])
  const [returns7, setReturns7] = useState([])

  const totalSales7 = useMemo(() => sumUnits(sales7), [sales7])
  const totalReturns7 = useMemo(() => sumUnits(returns7), [returns7])
  const returnRate = useMemo(
    () => (totalSales7 ? ((totalReturns7 / totalSales7) * 100).toFixed(1) : '0.0'),
    [totalReturns7, totalSales7]
  )
  const [salesGrowthPct, setSalesGrowthPct] = useState('0.0')

  const [period, setPeriod] = useState(7)
  const [top, setTop] = useState([])
  const [cust, setCust] = useState([])
  const activeCustomers = useMemo(() => (cust || []).filter(c => c.units > 0).length, [cust])

  const [autoRefresh, setAutoRefresh] = useState(true)

  async function loadInitial() {
    setLoading(true)
    try {
      const [{ data: s, error: e1 }, { data: r, error: e2 }] = await Promise.all([
        supabase.rpc('dash_sales_last_days', { p_days: 7 }),
        supabase.rpc('dash_returns_last_days', { p_days: 7 })
      ])
      if (e1) throw e1
      if (e2) throw e2
      setSales7(fillLastNDays(s || [], 7))
      setReturns7(fillLastNDays(r || [], 7))
      await Promise.all([loadTop(period), loadCustomersFixed(), computeSalesGrowth()])
    } catch (err) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function computeSalesGrowth() {
    const { data, error } = await supabase.rpc('dash_sales_last_days', { p_days: 14 })
    if (error) {
      console.warn('Sales growth error:', error.message)
      setSalesGrowthPct('0.0')
      return
    }
    const series = fillLastNDays(data || [], 14)
    const last7 = series.slice(-7)
    const prev7 = series.slice(0, 7)
    const lastSum = sumUnits(last7)
    const prevSum = sumUnits(prev7)
    const pct = ((lastSum - prevSum) / (prevSum || 1)) * 100
    setSalesGrowthPct(pct.toFixed(1))
  }

  async function loadTop(p) {
    const { data, error } = await supabase.rpc('dash_top_products', { p_days: p, p_limit: 100 })
    if (error) {
      console.warn('Top products error:', error.message)
      setTop([])
      return
    }
    setTop(data || [])
  }

  async function loadCustomersFixed() {
    const { data, error } = await supabase.rpc('dash_customer_totals', {
      p_days: CUSTOMER_PERIOD,
      p_names: CUSTOMER_LIST
    })
    if (error) {
      console.warn('Customer totals error:', error.message)
      setCust([])
      return
    }

    const found = new Map((data || []).map((r) => [r.customer_name, Number(r.units || 0)]))
    const normalized = CUSTOMER_LIST.map((name) => ({
      customer_name: name,
      units: found.get(name) || 0
    }))
    setCust(normalized)
  }

  useEffect(() => { loadInitial() }, [])
  useEffect(() => { loadTop(period) }, [period])
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(loadInitial, REFRESH_MS)
    return () => clearInterval(id)
  }, [autoRefresh, period])

  const combined = mergeSalesReturns(sales7, returns7)
  const topMax = Math.max(1, ...((top || []).map(t => Number(t.units || 0))))
  const custMax = Math.max(1, ...((cust || []).map(c => Number(c.units || 0))))

  return (
    <div className="grid" style={{ gap: 14 }}>
      {/* === HERO KPIs === */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12 }}>
        <KPI title="Total Sales (7d)" value={totalSales7} color="var(--ok)" />
        <KPI title="Total Returns (7d)" value={totalReturns7} color="var(--warn)" />
        <KPI title="Active Customers (30d)" value={activeCustomers} color="var(--accent)" />
        <KPI
          title={`Sales Growth vs prev 7d`}
          value={`${Number.isFinite(Number(salesGrowthPct)) ? salesGrowthPct : '0.0'}%`}
          color={Number(salesGrowthPct) >= 0 ? 'var(--ok)' : 'var(--err)'}
        />
      </div>

      {/* === CONTROLS === */}
      <div className="card">
        <div className="hd">
          <b>Dashboard Controls</b>
          <div className="row" style={{ gap: 10 }}>
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto refresh every 60s
            </label>
            <span className="badge">Return Rate: {returnRate}%</span>
          </div>
        </div>
        <div className="bd" style={{ color: 'var(--muted)' }}>
          Live overview of your operations — charts & tables refresh automatically when enabled.
        </div>
      </div>

      {/* === COMBINED SALES/RETURNS CHART === */}
      <div className="card">
        <div className="hd">
          <b>Sales vs Returns — Last 7 Days</b>
          <span className="badge">Hover bars for instant info</span>
        </div>
        <div className="bd">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={combined} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="sale_date"
                tickFormatter={formatDayShort}
                axisLine={false}
                tickLine={false}
              />
              <YAxis axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(0, 0, 0, 0.9)',
                  border: 'none',
                  borderRadius: '6px',
                  color: 'white'
                }}
                labelFormatter={(label) => formatDayLabel(label)}
              />
              <Legend />
              <Bar dataKey="sales" name="Sales" fill="#22c55e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="returns" name="Returns" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* === TWO PANES === */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
        {/* Top sellers */}
        <div className="card">
          <div className="hd">
            <b>📦 Top 100 Products</b>
            <div className="row" style={{ gap: 8 }}>
              <select value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
                {PERIODS.map((p) => (
                  <option key={p} value={p}>Last {p} days</option>
                ))}
              </select>
            </div>
          </div>
          <div className="bd" style={{ overflow: 'auto', maxHeight: 360 }}>
            <table className="table">
              <thead>
                <tr><th>#</th><th>Finished Good</th><th style={{ textAlign: 'right' }}>Units</th></tr>
              </thead>
              <tbody>
                {(top || []).map((r, idx) => (
                  <tr key={r.finished_good_id || idx}
                    style={{
                      background: `linear-gradient(90deg, rgba(34,197,94,.15) ${(Number(r.units || 0) / topMax) * 85}%, transparent 0)`
                    }}>
                    <td>{idx + 1}</td>
                    <td>{r.finished_good_name}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{r.units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Customers */}
        <div className="card">
          <div className="hd"><b>👥 Customer Totals</b><span className="badge">Last 30 days</span></div>
          <div className="bd" style={{ overflow: 'auto', maxHeight: 360 }}>
            <table className="table">
              <thead>
                <tr><th>Customer</th><th style={{ textAlign: 'right' }}>Units</th></tr>
              </thead>
              <tbody>
                {(cust || []).map((c) => (
                  <tr key={c.customer_name}
                    style={{
                      background: `linear-gradient(90deg, rgba(59,130,246,.15) ${(Number(c.units || 0) / custMax) * 85}%, transparent 0)`
                    }}>
                    <td>{c.customer_name}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{c.units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {loading && <div className="s" style={{ marginTop: 6 }}>Loading…</div>}
    </div>
  )
}

/* ---------- KPI Card ---------- */
function KPI({ title, value, color }) {
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="s" style={{ color: 'var(--muted)' }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1.1 }}>{fmtNum(value)}</div>
    </div>
  )
}


/* ---------- Helpers ---------- */
function sumUnits(rows) {
  return (rows || []).reduce((n, r) => n + Number(r.units || 0), 0)
}
function mergeSalesReturns(sales, returns) {
  const map = new Map()
    ; (sales || []).forEach(s => map.set(s.sale_date, { sale_date: s.sale_date, sales: Number(s.units || 0), returns: 0 }))
    ; (returns || []).forEach(r => {
      const row = map.get(r.sale_date) || { sale_date: r.sale_date, sales: 0, returns: 0 }
      row.returns = Number(r.units || 0)
      map.set(r.sale_date, row)
    })
  return Array.from(map.values()).sort((a, b) => a.sale_date.localeCompare(b.sale_date))
}
function fillLastNDays(rows, n) {
  const today = new Date()
  const map = new Map()
    ; (rows || []).forEach(r => {
      const key = (r.sale_date || '').slice(0, 10)
      map.set(key, Number(r.units || 0))
    })
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    out.push({ sale_date: key, units: map.get(key) || 0 })
  }
  return out
}
function fmtNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v ?? '0')
  return n.toLocaleString()
}
function formatDayShort(iso) {
  try { return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' }) }
  catch { return iso }
}
function formatDayLabel(iso) {
  try { return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) }
  catch { return iso }
}
