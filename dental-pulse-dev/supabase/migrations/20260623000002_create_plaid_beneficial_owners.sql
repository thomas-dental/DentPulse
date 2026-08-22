-- Migration: plaid_beneficial_owners
-- Stores control persons and beneficial owners for KYC/IDV.
-- Depends on: plaid_organization_verifications

create table if not exists plaid_beneficial_owners (
  id                              uuid primary key default gen_random_uuid(),
  organization_verification_id    uuid not null
    references plaid_organization_verifications(id) on delete cascade,
  organization_id                 uuid not null,

  first_name                      text not null,
  last_name                       text not null,
  role                            text not null default 'control_person',
  -- values: control_person | beneficial_owner
  ownership_percent               numeric(5,2),

  plaid_idv_id                    text,
  status                          text not null default 'pending',
  -- values: pending | in_progress | verified | failed | manual_review
  idv_completed_at                timestamptz,

  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

alter table plaid_beneficial_owners enable row level security;

create policy "org members read own owners"
  on plaid_beneficial_owners for select
  using (
    organization_id in (
      select organization_id from user_roles where user_id = auth.uid()
    )
  );

create index if not exists plaid_owners_verification_idx
  on plaid_beneficial_owners(organization_verification_id);

create index if not exists plaid_owners_org_idx
  on plaid_beneficial_owners(organization_id);
