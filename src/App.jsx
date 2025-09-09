import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import ThemeToggle from './ui/ThemeToggle.jsx'

// Pages
import Dashboard from './pages/Dashboard.jsx'
import RawInward from './pages/RawInward.jsx'
import BOM from './pages/BOM.jsx'
import Manufacture from './pages/Manufacture.jsx'
import BulkManufacture from './pages/BulkManufacture.jsx'
import LiveBarcodes from './pages/LiveBarcodes.jsx'
import Putaway from './pages/Putaway.jsx'
import BinInventory from './pages/BinInventory.jsx'
import SalesOrders from './pages/SalesOrders.jsx'
import Outward from './pages/Outward.jsx'
import Returns from './pages/Returns.jsx'
import RMInventory from './pages/RMInventory.jsx'
import FGInventory from './pages/FGInventory.jsx'
import Labels from './pages/Labels.jsx'

// Blends
import BlendRecipes from './pages/BlendRecipes.jsx'
import BlendManufacture from './pages/BlendManufacture.jsx'

// (Optional) If your project still imports App.css somewhere, it will simply import styles.css
import './App.css'

export default function App(){
  return (
    <BrowserRouter>
      <div className="container">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="brand">
            <span className="dot"></span> IMS
          </div>

          <nav className="nav">
            <NavLink to="/" end>Dashboard</NavLink>
            <NavLink to="/raw">Raw Inward</NavLink>
            <NavLink to="/bom">BOM</NavLink>
            <NavLink to="/mfg">Manufacture</NavLink>
            <NavLink to="/mfg-bulk">Bulk Manufacture</NavLink>
            <NavLink to="/live">Live Barcodes</NavLink>
            <NavLink to="/putaway">Bins (Putaway)</NavLink>
            <NavLink to="/bin-inv">Bin Inventory</NavLink>
            <NavLink to="/sales">Sales Orders</NavLink>
            <NavLink to="/outward">Outward (SO Clearing)</NavLink>
            <NavLink to="/returns">Returns</NavLink>
            <NavLink to="/inv-rm">RM Inventory</NavLink>
            <NavLink to="/inv-fg">FG Inventory</NavLink>

            <div className="s" style={{margin:'10px 12px 4px', opacity:.8}}>Blends</div>
            <NavLink to="/blends">Blend Recipes</NavLink>
            <NavLink to="/blend-manufacture">Blend Manufacture</NavLink>
          </nav>

          <div style={{ marginTop: 'auto' }}>
            <ThemeToggle />
          </div>
        </aside>

        {/* Main content */}
        <main>
          <Routes>
            <Route path="/" element={<Dashboard/>} />
            <Route path="/raw" element={<RawInward/>} />
            <Route path="/bom" element={<BOM/>} />
            <Route path="/mfg" element={<Manufacture/>} />
            <Route path="/mfg-bulk" element={<BulkManufacture/>} />
            <Route path="/live" element={<LiveBarcodes/>} />
            <Route path="/putaway" element={<Putaway/>} />
            <Route path="/bin-inv" element={<BinInventory/>} />
            <Route path="/sales" element={<SalesOrders/>} />
            <Route path="/outward" element={<Outward/>} />
            <Route path="/returns" element={<Returns/>} />
            <Route path="/inv-rm" element={<RMInventory/>} />
            <Route path="/inv-fg" element={<FGInventory/>} />
            <Route path="/labels" element={<Labels/>} />

            {/* Blends */}
            <Route path="/blends" element={<BlendRecipes/>} />
            <Route path="/blend-manufacture" element={<BlendManufacture/>} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
