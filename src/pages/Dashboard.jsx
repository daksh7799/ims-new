import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

/** ✅ Updated customer list (from your database actual names) **/
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

export default function Dashboard() {
  const [loading, setLoading] = useState(true)

  // time series
  const [sales7, setSales7] = useState([])
  const [returns7, setReturns7] = useState([])

  // top sellers
  const [period, setPeriod] = useState(7)
  const [top, setTop] = useState([])

  // customers (fixed 30d)
  const [cust, setCust] = useState([])

  /** -------------------- INITIAL LOAD -------------------- **/
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

      await Promise.all([loadTop(period), loadCustomersFixed()])
    } catch (err) {
      alert(err.message)
    } finally {
      setLoading(false)
    }
  }

  /** -------------------- LOAD TOP SELLERS -------------------- **/
  async function loadTop(p) {
    const { data, error } = await supabase.rpc('dash_top_products', {
      p_days: p,
      p_limit: 20
    })
    if (error) {
      console.warn('Top products error:', error.message)
      setTop([])
      return
    }
    setTop(data || [])
  }

  /** -------------------- LOAD CUSTOMER TOTALS -------------------- **/
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

    const found = new Map(
      (data || []).map((r) => [r.customer_name, Number(r.units || 0)])
    )

    setCust(
      CUSTOMER_LIST.map((name) => ({
        customer_name: name,
        units: found.get(name) || 0
      }))
    )
  }

  useEffect(() => {
    loadInitial()
  }, [])

  useEffect(() => {
    loadTop(period)
  }, [period])

  /** -------------------- UI -------------------- **/
  return (
    <div className="grid">
      {/* Two charts: Sales & Returns (7d) */}
      <div className="grid cols-2">
        <ChartCard title="Sales (Units) — Last 7 Days" data={sales7} />
        <ChartCard title="Returns (Units) — Last 7 Days" data={returns7} />
      </div>

      <div className="grid cols-2">
        {/* Top sellers */}
        <div className="card">
          <div className="hd">
            <b>Top 20 Products</b>
            <div className="row">
              <select
                value={period}
                onChange={(e) => setPeriod(Number(e.target.value))}
              >
                {PERIODS.map((p) => (
                  <option key={p} value={p}>
                    Last {p} days
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="bd" style={{ overflow: 'auto', maxHeight: 360 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Finished Good</th>
                  <th style={{ textAlign: 'right' }}>Units</th>
                </tr>
              </thead>
              <tbody>
                {(top || []).map((r, idx) => (
                  <tr key={r.finished_good_id || idx}>
                    <td>{idx + 1}</td>
                    <td>{r.finished_good_name}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>
                      {r.units}
                    </td>
                  </tr>
                ))}
                {(!top || top.length === 0) && (
                  <tr>
                    <td colSpan={3} style={{ color: 'var(--muted)' }}>
                      No sales
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Customer totals (fixed 30d) */}
        <div className="card">
          <div className="hd">
            <b>Customer Totals</b>
            <span className="badge">Last {CUSTOMER_PERIOD} days</span>
          </div>
          <div className="bd" style={{ overflow: 'auto', maxHeight: 360 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th style={{ textAlign: 'right' }}>Units</th>
                </tr>
              </thead>
              <tbody>
                {(cust || []).map((c) => (
                  <tr key={c.customer_name}>
                    <td>{c.customer_name}</td>
                    <td
                      style={{ textAlign: 'right', fontWeight: 700 }}
                    >{c.units}</td>
                  </tr>
                ))}
                {(!cust || cust.length === 0) && (
                  <tr>
                    <td colSpan={2} style={{ color: 'var(--muted)' }}>
                      No data
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {loading && <div className="s" style={{ marginTop: 6 }}>Loading…</div>}
    </div>
  )
}

/* ---------- chart card ---------- */
function ChartCard({ title, data }) {
  return (
    <div className="card">
      <div className="hd"><b>{title}</b></div>
      <div className="bd">
        <Bar7 data={data} height={200} />
        <div className="s" style={{ marginTop: 8 }}>Hover any bar for exact units.</div>
      </div>
    </div>
  )
}

/* Robust 7-day bar chart with custom tooltip */
function Bar7({ data, height = 180 }) {
  const max = Math.max(1, ...data.map((d) => Number(d.units || 0)))
  const [hover, setHover] = useState(null) // {x,y,label}

  return (
    <div style={{ position: 'relative' }}>
      {hover && (
        <div
          style={{
            position: 'absolute',
            left: hover.x,
            top: hover.y - 34,
            transform: 'translate(-50%, -100%)',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            padding: '6px 8px',
            borderRadius: 8,
            fontSize: 12,
            whiteSpace: 'nowrap',
            boxShadow: 'var(--shadow-1)',
            pointerEvents: 'none',
            zIndex: 5
          }}
        >
          <b>{hover.label}</b>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 12,
          alignItems: 'end',
          height
        }}
        onMouseLeave={() => setHover(null)}
      >
        {data.map((d, idx) => {
          const units = Number(d.units || 0)
          const h = (units / max) * (height - 36)
          return (
            <div key={idx} style={{ display: 'grid', alignItems: 'end' }}>
              <div
                role="button"
                onMouseMove={(e) => placeTip(e, setHover, d, units)}
                onMouseEnter={(e) => placeTip(e, setHover, d, units)}
                onMouseLeave={() => setHover(null)}
                style={{
                  height: Math.max(6, h),
                  background:
                    'linear-gradient(180deg, rgba(106,167,255,.85), rgba(139,92,246,.85))',
                  border: '1px solid #2a3150',
                  borderRadius: 10,
                  boxShadow: 'var(--shadow-1)',
                  transition: 'height .15s ease'
                }}
              />
              <div className="s" style={{ textAlign: 'center', marginTop: 6 }}>
                {formatDayShort(d.sale_date)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function placeTip(e, setHover, d, units) {
  const grid = e.currentTarget.parentElement.parentElement.getBoundingClientRect()
  const rect = e.currentTarget.getBoundingClientRect()
  setHover({
    x: rect.left + rect.width / 2 - grid.left,
    y: rect.top - grid.top,
    label: `${formatDayLabel(d.sale_date)} — ${units} units`
  })
}

/* ---------- helpers ---------- */
function fillLastNDays(rows, n) {
  const today = new Date()
  const map = new Map()
  ;(rows || []).forEach((r) => {
    const key = (r.sale_date || '').slice(0, 10)
    map.set(key, Number(r.units || 0))
  })
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    out.push({ sale_date: key, units: map.get(key) || 0 })
  }
  return out
}

function formatDayShort(iso) {
  try {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString(undefined, { weekday: 'short' })
  } catch {
    return iso
  }
}

function formatDayLabel(iso) {
  try {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}
