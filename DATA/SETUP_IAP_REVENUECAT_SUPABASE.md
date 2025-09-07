Onde fica: DATA/SETUP_IAP_REVENUECAT_SUPABASE.md

Objetivo: deixar pronto no código, Supabase e RevenueCat para IAP (App Store/Play Store) + vouchers.

1) Supabase (SQL)
- Abra o Supabase > SQL Editor > cole e execute o arquivo supabase/schema_iap.sql deste projeto.
- Resultado: tabelas public.entitlements, public.vouchers e view public.user_entitlements criadas com comentários em português.

2) Edge Functions (Supabase)
- No diretório supabase/functions/iap você tem:
  - revenuecat-webhook.ts: endpoint para webhooks do RevenueCat (POST).
  - redeem.ts: endpoint para resgatar códigos (POST { code, user_id }).
- Publique as funções (no seu ambiente local com supabase CLI ou no dashboard):
  - URL pública final: use em RevenueCat > Webhooks (para revenuecat-webhook)
  - URL pública final do redeem: configure no app como EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL.

3) App (Expo)
- Em app.json adicionei o plugin "@revenuecat/react-native-purchases" e chaves:
  - EXPO_PUBLIC_RC_IOS, EXPO_PUBLIC_RC_ANDROID (substitua pelas chaves do seu app no RevenueCat)
  - EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL (URL base dos seus Edge Functions)
- Instalada a dependência "react-native-purchases" no package.json.
- Arquivo utils/iapRevenueCat.js com helpers (initIAP, purchase, restore, listener).
- PaywallModal agora tem campo de resgate de código chamando a função /iap/redeem.
- Gating (core/usoLocal.js) consulta entitlements no Supabase para liberar STF quando exige compra.

4) RevenueCat
- Crie conta em revenuecat.com e um App para iOS e outro para Android.
- Crie um Entitlement (ex.: stf) e uma Offering (default) mapeando o produto das lojas.
- Copie as API Keys e coloque em app.json nas variáveis EXPO_PUBLIC_RC_*.
- Em Webhooks, configure a URL da função revenuecat-webhook (POST). Opcional: habilitar assinatura do webhook.

5) Lojas (quando for subir)
- App Store Connect: criar produto In-App (não-consumível ou assinatura) com productId (ex.: com.sigmaiq.stf).
- Play Console: criar produto equivalente com mesmo productId.
- Testar em sandbox/teste interno e validar entitlements no app.

6) Vouchers
- Gere códigos inserindo linhas em public.vouchers (no SQL Editor ou via painel Admin).
- No app, o usuário digita o código no Paywall e a função /iap/redeem concede acesso (entitlements).

Observações
- Use o entitlementsContext.js para refletir visualmente o acesso; ele lê a view user_entitlements.
- Para migrações futuras, versione o arquivo schema_iap.sql.
