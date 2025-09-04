import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

const Ctx = createContext({
  premium: false,
  stf: false,
  loading: true,
  refresh: () => {}
})

export function EntitlementsProvider({ children }) {
  const [premium, setPremium] = useState(false)
  const [stf, setStf] = useState(false)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setPremium(false); setStf(false); setLoading(false); return
    }
    const { data, error } = await supabase
      .from('user_entitlements')
      .select('product_id, kind, status, expires_at')
      .eq('user_id', user.id)
      .eq('status', 'active')

    if (error) {
      console.warn('entitlements load error', error.message)
      setLoading(false); return
    }

    const now = Date.now()
    const active = (data || []).filter(r =>
      !r.expires_at || new Date(r.expires_at).getTime() > now
    )

    const hasSub = active.some(r => r.kind === 'subscription')
    const hasSTF = hasSub || active.some(r => r.product_id === 'stf_unlock')

    setPremium(hasSub)
    setStf(hasSTF)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  return (
    <Ctx.Provider value={{ premium, stf, loading, refresh: load }}>
      {children}
    </Ctx.Provider>
  )
}

export const useEntitlements = () => useContext(Ctx)