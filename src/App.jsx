import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { supabase } from './supabaseClient'
import useSessionProfile from './auth/useSessionProfile'
import Login from './auth/Login.jsx'
import ThemeToggle from './ui/ThemeToggle.jsx'

// Pages
import Dashboard from './pages/Dashboard.jsx'
import RawInward from './pages/RawInward.jsx'
import BOM from './pages/BOM.jsx'
import Manufacture from './pages/Manufacture.jsx'
import LiveBarcodes from './pages/LiveBarcodes.jsx'
import Putaway from './pages/Putaway.jsx'
import BinInventory from './pages/BinInventory.jsx'
import SalesOrders from './pages/SalesOrders.jsx'
import Outward from './pages/Outward.jsx'
import Returns from './pages/Returns.jsx'
import RMInventory from './pages/RMInventory.jsx'
import FGInventory from './pages/FGInventory.jsx'
import Labels from './pages/Labels.jsx'
import BlendRecipes from './pages/BlendRecipes.jsx'
import BlendManufacture from './pages/BlendManufacture.jsx'

// Admin
import AdminUsers from './admin/AdminUsers.jsx'
import AdminMasters from './pages/AdminMasters.jsx'

// New tools
import PacketTrace from './pages/PacketTrace.jsx'
import RawAdjust from './pages/RawAdjust.jsx'
import SOAdmin from './pages/SOAdmin.jsx'
import RawProcess from './pages/RawProcess.jsx'
import FgSalesReport from './pages/FgSalesReport.jsx'  // 👈 NEW MODULE
import RawInwardReport from './pages/RawInwardReport.jsx'  // 👈 NEW MODULE

const LINKS = [
  { key: 'dashboard', path: '/', label: 'Dashboard', end: true },
  { key: 'raw', path: '/raw', label: 'Raw Inward' },
  { key: 'bom', path: '/bom', label: 'BOM' },
  { key: 'mfg', path: '/mfg', label: 'Manufacture' },
  { key: 'live', path: '/live', label: 'Live Barcodes' },
  { key: 'putaway', path: '/putaway', label: 'Bins (Putaway)' },
  { key: 'bin-inv', path: '/bin-inv', label: 'Bin Inventory' },
  { key: 'sales', path: '/sales', label: 'Sales Orders' },
  { key: 'outward', path: '/outward', label: 'Outward (SO Clearing)' },
  { key: 'returns', path: '/returns', label: 'Returns' },
  { key: 'inv-rm', path: '/inv-rm', label: 'RM Inventory' },
  { key: 'inv-fg', path: '/inv-fg', label: 'FG Inventory' },
  { key: 'blends', path: '/blends', label: 'Blend Recipes' },
  { key: 'blend-mfg', path: '/blend-manufacture', label: 'Blend Manufacture' },
  { key: 'raw-inward-report', path: '/raw-inward-report', label: 'Raw Inward Report' },


  // utilities
  { key: 'trace', path: '/trace', label: 'Packet Trace' },
  { key: 'raw-adjust', path: '/raw-adjust', label: 'Raw Adjust' },
  { key: 'so-admin', path: '/so-admin', label: 'SO Admin' },
  { key: 'raw-process', path: '/raw-process', label: 'Raw Process' },
  { key: 'fg-sales', path: '/fg-sales', label: 'FG Sales Report' }, // 👈 ADDED HERE

  // admin
  { key: 'masters', path: '/masters', label: 'Masters' },
  { key: 'admin', path: '/admin', label: 'Admin' },
]

export default function App() {
  const { session, profile, loading } = useSessionProfile()

  if (loading) return <div className="s" style={{ padding: 20 }}>Loading…</div>
  if (!session) return <Login />

  const allowed = new Set(profile?.allowed_modules || [])
  const isAdmin = (profile?.role === 'admin')
  const canSee = (key) => isAdmin || allowed.has(key)

  return (
    <BrowserRouter>
      <div className="container">
        <aside className="sidebar">
          <div className="brand"><span className="dot"></span> IMS</div>

          <nav className="nav">
            {LINKS.filter(l => canSee(l.key)).map(l => (
              <NavLink key={l.key} to={l.path} end={l.end}>
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div style={{ marginTop: 'auto', display: 'grid', gap: 8 }}>
            <div className="s">{profile?.full_name || session.user.email}</div>
            <span className="badge">{profile?.role || 'viewer'}</span>
            <button
              className="btn outline small"
              onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
            >
              Sign out
            </button>
            <ThemeToggle />
          </div>
        </aside>

        <main>
          <Routes>
            {/* Keep Labels route public (used by LiveBarcodes etc.) */}
            <Route path="/labels" element={<Labels />} />

            {/* Visible pages (only mount if link is visible) */}
            {canSee('dashboard') && <Route path="/" element={<Dashboard />} />}
            {canSee('raw') && <Route path="/raw" element={<RawInward />} />}
            {canSee('bom') && <Route path="/bom" element={<BOM />} />}
            {canSee('mfg') && <Route path="/mfg" element={<Manufacture />} />}
            {canSee('live') && <Route path="/live" element={<LiveBarcodes />} />}
            {canSee('putaway') && <Route path="/putaway" element={<Putaway />} />}
            {canSee('bin-inv') && <Route path="/bin-inv" element={<BinInventory />} />}
            {canSee('sales') && <Route path="/sales" element={<SalesOrders />} />}
            {canSee('outward') && <Route path="/outward" element={<Outward />} />}
            {canSee('returns') && <Route path="/returns" element={<Returns />} />}
            {canSee('inv-rm') && <Route path="/inv-rm" element={<RMInventory />} />}
            {canSee('inv-fg') && <Route path="/inv-fg" element={<FGInventory />} />}
            {canSee('blends') && <Route path="/blends" element={<BlendRecipes />} />}
            {canSee('blend-mfg') && <Route path="/blend-manufacture" element={<BlendManufacture />} />}

            {canSee('trace') && <Route path="/trace" element={<PacketTrace />} />}
            {canSee('raw-adjust') && <Route path="/raw-adjust" element={<RawAdjust />} />}
            {canSee('so-admin') && <Route path="/so-admin" element={<SOAdmin />} />}
            {canSee('raw-process') && <Route path="/raw-process" element={<RawProcess />} />}
            {canSee('fg-sales') && <Route path="/fg-sales" element={<FgSalesReport />} />} {/* 👈 NEW ROUTE */}

            {canSee('masters') && <Route path="/masters" element={<AdminMasters />} />}
            {canSee('admin') && <Route path="/admin" element={<AdminUsers />} />}
            {canSee('raw-inward-report') && <Route path="/raw-inward-report" element={<RawInwardReport />} />}


            {/* fallback */}
            <Route path="*" element={<div style={{ padding: 20 }}>Not found or access denied.</div>} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
