// src/auth/Gate.jsx
import useSessionProfile from './useSessionProfile'
import { usePermissions } from './permissions'

export default function Gate({ mod, children }) {
  const { loading, session } = useSessionProfile()
  const { isAdmin, can } = usePermissions()

  // While auth/profile loads, render nothing (prevents flashing)
  if (loading) return null

  // Not signed in — you should never hit Gate unauthenticated because App shows <Login/>,
  // but guard anyway to avoid runtime errors.
  if (!session) return null

  // Admins bypass, others must have explicit permission
  const ok = isAdmin || can(mod)
  if (!ok) {
    return (
      <div className="card" style={{ margin: 16 }}>
        <div className="hd"><b>Access denied</b></div>
        <div className="bd">You don’t have permission to view this module: <code>{String(mod || '')}</code></div>
      </div>
    )
  }

  return children
}
