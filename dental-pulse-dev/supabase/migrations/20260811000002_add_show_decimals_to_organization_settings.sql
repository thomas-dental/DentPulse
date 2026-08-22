-- Adds a per-organization toggle for whether currency values show decimal
-- places (pence) across tables and detail views, controlled from
-- Settings -> General -> Display Preferences -> "Show Decimals".
-- Defaults to false: most existing currency displays in the app already round
-- to whole pounds, so this keeps today's look until an org opts in.

ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS show_decimals boolean NOT NULL DEFAULT false;
