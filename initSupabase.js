import { createClient } from '@supabase/supabase-js'
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '<URL>'
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '<ANON_KEY>'
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)