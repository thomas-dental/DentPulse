-- Migration: plaid_connections
-- One row per linked bank (onboarding bank + any additional banks).

create table if not exists plaid_connections (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  user_id             uuid,

  item_id             text not null unique,    -- Plaid item_id
  access_token        text not null,           -- store encrypted in production
  institution_id      text,
  institution_name    text,
  institution_logo    text,                    -- base64 PNG from Plaid or null
  institution_color   text,

  status              text not null default 'active',
  -- values: active | error | disconnected
  error_code          text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table plaid_connections enable row level security;

create policy "org members read own connections"
  on plaid_connections for select
  using (
    organization_id in (
      select organization_id from user_roles where user_id = auth.uid()
    )
  );

create index if not exists plaid_connections_org_idx
  on plaid_connections(organization_id);

create index if not exists plaid_connections_item_idx
  on plaid_connections(item_id);
