import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { ALL_MODULES } from './permissions'

/**
 * Loads the Supabase session + the user's profile row.
 * If a profile row does not exist, it creates one.
 * First-ever user becomes admin with full module access.
 *
 * DB expected table: public.profiles
 * columns: id uuid PK, email text, full_name text, role text, allowed_modules text[]
 * role defaults to 'viewer', allowed_modules defaults to '{}' (empty array)
 */
export default function useSessionProfile(){
  const [session,setSession]=useState(null)
  const [profile,setProfile]=useState(null)
  const [loading,setLoading]=useState(true)

  useEffect(()=>{
    // get initial session
    supabase.auth.getSession().then(({ data })=>{
      setSession(data.session||null)
    })
    // subscribe to session changes
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s)=>setSession(s))
    return ()=>sub.subscription.unsubscribe()
  },[])

  useEffect(()=>{
    (async ()=>{
      if(!session){ setProfile(null); setLoading(false); return }

      setLoading(true)
      const user = session.user
      const email = user.email || ''
      const fullName = (user.user_metadata && user.user_metadata.full_name) || null

      // 1) Try to fetch existing profile
      let { data: prof, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, allowed_modules')
        .eq('id', user.id)
        .maybeSingle()

      // 2) If missing, create it.
      if(!prof){
        // Determine if this is the first-ever user → make admin with full access.
        let firstUser = false
        try{
          const { count } = await supabase
            .from('profiles')
            .select('*', { count:'exact', head:true })
          if ((count||0) === 0) firstUser = true
        }catch{}

        const payload = {
          id: user.id,
          email,
          full_name: fullName,
          role: firstUser ? 'admin' : 'viewer',
          allowed_modules: firstUser ? ALL_MODULES : []
        }

        const { error: insErr } = await supabase.from('profiles').insert(payload)
        if(insErr){
          console.warn('profiles insert failed (RLS?)', insErr)
        }

        // Re-fetch
        const { data: prof2 } = await supabase
          .from('profiles')
          .select('id, email, full_name, role, allowed_modules')
          .eq('id', user.id)
          .maybeSingle()
        prof = prof2 || null
      }else{
        // 3) If exists, keep email/full_name fresh
        if(email && prof.email !== email || (fullName || null) !== (prof.full_name || null)){
          await supabase.from('profiles').update({ email, full_name: fullName }).eq('id', user.id)
          const { data: prof3 } = await supabase
            .from('profiles')
            .select('id, email, full_name, role, allowed_modules')
            .eq('id', user.id)
            .maybeSingle()
          prof = prof3 || prof
        }
      }

      setProfile(prof || { role:'viewer', allowed_modules:[] })
      setLoading(false)
    })()
  },[session])

  return { session, profile, loading }
}
