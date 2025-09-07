import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const { code, user_id } = await req.json();
    if (!code || !user_id) return new Response("Parâmetros inválidos", { status: 400 });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: voucher, error: errCode } = await supabase
      .from("codigos")
      .select("*")
      .eq("code", code)
      .maybeSingle();

    if (errCode) return new Response(errCode.message, { status: 500 });
    if (!voucher) return new Response("Código inválido", { status: 404 });
    if (voucher.expira_em && new Date(voucher.expira_em) < new Date()) return new Response("Código expirado", { status: 410 });
    if (voucher.usos_count >= voucher.usos_max) return new Response("Código já utilizado", { status: 409 });

    const { error: errInc } = await supabase.rpc("incrementa_uso_codigo", { codigo_id: voucher.id });
    if (errInc) return new Response(errInc.message, { status: 500 });

    const payload = {
      user_id,
      product_id: voucher.product_id,
      plataforma: "voucher",
      ativo: true,
      status: "granted_by_code",
      origem: "codigo",
    };

    const { error: errUpsert } = await supabase
      .from("compras")
      .upsert(payload, { onConflict: "user_id,product_id" });

    if (errUpsert) return new Response(errUpsert.message, { status: 500 });
    return new Response("ok");
  } catch (e) {
    return new Response(`error: ${e}`, { status: 500 });
  }
});
