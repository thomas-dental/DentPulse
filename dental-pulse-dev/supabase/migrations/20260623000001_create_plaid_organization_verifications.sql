-- Migration: plaid_organization_verifications
-- One row per organization — tracks 3-step Plaid onboarding state.

create table if not exists plaid_organization_verifications (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null unique,
  user_id                   uuid,

  -- Step 1: Business
  legal_name                text,
  companies_house_number    text,
  trading_name              text,
  address                   text,
  industry                  text not null default 'Dental practice',
  plaid_idv_session_id      text,
  kyb_status                text not null default 'pending',
  -- values: pending | checking | verified | review | failed
  kyb_verified_at           timestamptz,

  -- Step 3: Bank (onboarding bank used for name matching)
  bank_status               text not null default 'pending',
  -- values: pending | linking | matching | matched | mismatch
  bank_institution_name     text,
  bank_account_mask         text,
  bank_holder_name          text,
  bank_match_score          smallint,
  bank_access_token         text,    -- store encrypted in production
  bank_item_id              text,

  -- Overall
  overall_status            text not null default 'incomplete',
  -- values: incomplete | complete | manual_review
  completed_at              timestamptz,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

alter table plaid_organization_verifications enable row level security;

create policy "org members read own verification"
  on plaid_organization_verifications for select
  using (
    organization_id in (
      select organization_id from user_roles where user_id = auth.uid()
    )
  );

create index if not exists plaid_org_verif_org_idx
  on plaid_organization_verifications(organization_id);
