-- ============================================================================
-- Migration: Add username column to platform_integrations and migrate
--            existing iplicit credentials from combined "username|apiKey"
--            in client_secret to separate username + client_secret fields.
-- ============================================================================

-- 1. Add username column
ALTER TABLE public.platform_integrations
  ADD COLUMN IF NOT EXISTS username VARCHAR(500);

-- 2. Migrate existing iplicit rows: split "username|apiKey" → username + client_secret
UPDATE public.platform_integrations
SET
  username      = SPLIT_PART(client_secret, '|', 1),
  client_secret = SPLIT_PART(client_secret, '|', 2)
WHERE
  platform_name = 'iplicit'
  AND client_secret IS NOT NULL
  AND client_secret LIKE '%|%';

COMMENT ON COLUMN public.platform_integrations.username IS
  'Username / login for the connected platform (iplicit). Previously embedded in client_secret as "username|apiKey".';
