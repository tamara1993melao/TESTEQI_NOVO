import { supabase } from './supabaseClient'

async function currentUserId() {
  const { data:{ user } } = await supabase.auth.getUser()
  return user?.id
}

export async function fakeBuyPremium(days = 7) {
  const uid = await currentUserId()
  if (!uid) return false
  const expires_at = new Date(Date.now()+days*864e5).toISOString()
  await supabase.from('user_entitlements').upsert({
    user_id: uid,
    product_id: 'premium_monthly',
    kind: 'subscription',
    status: 'active',
    expires_at
  })
  return true
}

export async function fakeBuySTF() {
  const uid = await currentUserId()
  if (!uid) return false
  await supabase.from('user_entitlements').upsert({
    user_id: uid,
    product_id: 'stf_unlock',
    kind: 'lifetime',
    status: 'active',
    expires_at: null
  })
  return true
}