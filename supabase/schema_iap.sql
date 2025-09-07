-- Onde criar: supabase/schema_iap.sql
-- Execute no Supabase (SQL Editor) para criar tabelas de compras e códigos em português

-- Tabela: compras (direitos de acesso do usuário)
-- Armazena quais produtos o usuário possui e se estão ativos
create table if not exists public.compras (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,                              -- Ex.: com.sigmaiq.stf
  platform text check (platform in ('ios','android','rc','manual','voucher')) default 'rc',
  is_active boolean not null default false,             -- Se o acesso está ativo
  status text,                                          -- purchased, expired, refunded, granted_by_voucher, etc.
  purchased_at timestamptz default now(),               -- Quando foi concedido
  expires_at timestamptz,                               -- Nulo se compra vitalícia
  original_tx_id text,                                  -- ID original da transação (Apple)
  order_id text,                                        -- ID do pedido (Google)
  source text,                                          -- Origem do evento: revenuecat, apple_asn, google_rtdn, voucher, manual
  last_event jsonb,
  unique (user_id, product_id)
);

comment on table public.compras is 'Compras/direitos de acesso por usuário e produto';
comment on column public.compras.product_id is 'Identificador do produto (ex.: com.sigmaiq.stf)';
comment on column public.compras.is_active is 'Indica se o direito está ativo';

-- Políticas de segurança (RLS)
alter table public.compras enable row level security;
do $$ begin
  create policy "usuario pode ver suas próprias compras"
    on public.compras for select
    using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Tabela: codigos (códigos promocionais)
-- Lista de códigos que podem liberar acesso a um produto
create table if not exists public.codigos (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,              -- Código legível (ex.: 8-12 caracteres)
  product_id text not null,               -- Produto a liberar (ex.: com.sigmaiq.stf)
  expires_at timestamptz,                 -- (Opcional) Data de expiração do código
  max_uses int not null default 1,        -- Número máximo de usos
  used_count int not null default 0,      -- Usos atuais
  metadata jsonb,                         -- Informações adicionais
  created_at timestamptz default now()
);

comment on table public.codigos is 'Códigos promocionais para liberar produtos';
comment on column public.codigos.code is 'Código a ser digitado pelo usuário no app';

-- RLS: por padrão, não expor códigos a usuários finais
alter table public.codigos enable row level security;
-- Não criar política de SELECT pública; manipule via Service Role em Edge Functions

-- View: v_compras_usuario (compatibilidade com o app)
create or replace view public.v_compras_usuario as
select
  e.user_id,
  e.product_id,
  case when e.expires_at is null then 'non_consumable' else 'subscription' end as kind,
  case when e.is_active then 'active' else 'inactive' end as status,
  e.expires_at
from public.compras e;

comment on view public.v_compras_usuario is 'Visão simplificada de compras por usuário';
