import { useState } from 'react'
import { supabase } from '../supabaseClient'

export default function Login(){
  const [mode,setMode] = useState('signin') // 'signin' | 'signup'
  const [email,setEmail] = useState('')
  const [password,setPassword] = useState('')
  const [fullName,setFullName] = useState('')
  const [loading,setLoading] = useState(false)

  async function onSubmit(e){
    e.preventDefault()
    setLoading(true)
    try{
      if(mode==='signin'){
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if(error) throw error
        // App will detect session change automatically
      }else{
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName || null } }
        })
        if(error) throw error
        alert('Account created. Check your inbox (if email confirmation is enabled), then sign in.')
        setMode('signin')
      }
    }catch(err){
      alert(err.message || 'Auth error')
    }finally{
      setLoading(false)
    }
  }

  return (
    <div style={{maxWidth:380, margin:'10vh auto'}} className="card">
      <div className="hd" style={{gap:8}}>
        <b>{mode==='signin' ? 'Sign in' : 'Create account'}</b>
        <div className="row">
          <button className={`btn small ${mode==='signin'?'':'outline'}`} onClick={()=>setMode('signin')}>Sign in</button>
          <button className={`btn small ${mode==='signup'?'':'outline'}`} onClick={()=>setMode('signup')}>Sign up</button>
        </div>
      </div>
      <div className="bd">
        <form onSubmit={onSubmit} className="grid" style={{gap:10}}>
          {mode==='signup' && (
            <input placeholder="Full name (optional)" value={fullName} onChange={e=>setFullName(e.target.value)} />
          )}
          <input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required/>
          <input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required/>
          <button className="btn" disabled={loading}>{mode==='signin'?'Sign in':'Create account'}</button>
        </form>
      </div>
    </div>
  )
}
