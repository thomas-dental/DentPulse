-- Migration: plaid_accounts
-- Individual bank accounts per Plaid connection.
-- Depends on: plaid_connections

create table if not exists plaid_accounts (
  id                    uuid primary key default gen_random_uuid(),
  connection_id         uuid not null references plaid_connections(id) on delete cascade,
  organization_id       uuid not null,

  plaid_account_id      text not null,
  name                  text,
  official_name         text,
  mask                  text,
  type                  text,         -- depository | credit | loan | investment
  subtype               text,         -- checking | savings | etc.
  current_balance       numeric(15,2),
  available_balance     numeric(15,2),
  currency_code         text not null default 'GBP',
  balances_updated_at   timestamptz,

  created_at            timestamptz not null default now(),

  unique(connection_id, plaid_account_id)
);

alter table plaid_accounts enable row level security;

create policy "org members read own accounts"
  on plaid_accounts for select
  using (
    organization_id in (
      select organization_id from user_roles where user_id = auth.uid()
    )
  );

create index if not exists plaid_accounts_connection_idx
  on plaid_accounts(connection_id);

create index if not exists plaid_accounts_org_idx
  on plaid_accounts(organization_id);
