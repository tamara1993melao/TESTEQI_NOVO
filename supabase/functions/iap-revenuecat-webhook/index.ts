import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function ok(txt = "ok") { return new Response(txt, { status: 200 }); }
function bad(txt = "bad request", code = 400) { return new Response(txt, { status: code }); }

serve(async (req) => {
  if (req.method !== "POST") return bad("method not allowed", 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();

    // Opcional: validar assinatura do webhook (X-RevenueCat-Signature)
    const userId = body?.app_user_id;
    const productId = body?.product_id || body?.event?.product_id || "com.sigmaiq.stf";
    if (!userId || !productId) return bad("payload incompleto");

    const eventType: string | undefined = body?.event?.type;
    const explicitActive = body?.entitlement?.active ?? body?.event?.entitlement?.active;
    const isActive = typeof explicitActive === "boolean"
      ? explicitActive
      : (eventType ? !/expire|cancel|refund/i.test(eventType) : true);

    const payload: any = {
      user_id: userId,
      product_id: productId,
      plataforma: "rc",
      ativo: isActive,
      status: isActive ? "purchased" : "expired",
      origem: "revenuecat",
      ultimo_evento: body,
    };

    const { error } = await supabase
      .from("compras")
      .upsert(payload, { onConflict: "user_id,product_id" });

    if (error) return bad("db error: " + error.message, 500);
    return ok();
  } catch (e: any) {
    return bad("error: " + (e?.message || e), 500);
  }
});
