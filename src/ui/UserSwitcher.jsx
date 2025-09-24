import { useCurrentUser } from '../auth/useModules'

export default function UserSwitcher(){
  const { users, userId, changeUser } = useCurrentUser()
  return (
    <select
      value={userId}
      onChange={e=>changeUser(e.target.value)}
      title="Current User"
      style={{ minWidth: 160 }}
    >
      {users.map(u=>(
        <option key={u.id} value={u.id}>{u.name}</option>
      ))}
      {!users.length && <option>(no users)</option>}
    </select>
  )
}
