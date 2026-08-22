-- Adds a per-organization toggle for the "Debt & Deals" section on the Group
-- Dashboard, replacing the hardcoded SHOW_DEBT_AND_DEALS constant in the app.
-- Defaults to true so existing organizations keep seeing the section they see today.

ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS show_debt_and_deals boolean NOT NULL DEFAULT true;
