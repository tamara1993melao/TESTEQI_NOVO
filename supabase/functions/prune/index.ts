// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

console.log("Hello from Functions!")

serve(async () => {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) {
    console.error('ENV_MISSING', { urlOk: !!url, keyOk: !!serviceKey })
    return new Response(JSON.stringify({ ok:false, error:'ENV_MISSING' }), { status:500 })
  }
  const client = createClient(url, serviceKey)
  try {
    const { error } = await client.rpc('prune_leaderboards', { p_limit: 100, p_archive: true })
    if (error) {
      console.error('RPC_ERROR', error)
      return new Response(JSON.stringify({ ok:false, error: error.message }), { status:500 })
    }
    return new Response(JSON.stringify({ ok:true }), { status:200 })
  } catch (e) {
    console.error('UNHANDLED', e)
    return new Response(JSON.stringify({ ok:false, error:String(e) }), { status:500 })
  }
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/prune' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
