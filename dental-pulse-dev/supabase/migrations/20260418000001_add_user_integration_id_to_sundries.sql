-- Add user_id and integration_id to sundries
-- The sundries table was created after the baseline "add user_id" and
-- "add integration_id" migrations, so it was missed by both. The Dentally
-- sync backend stamps every record with both columns, which caused inserts
-- to fail with PGRST204 ("column does not exist"). Bring sundries in line
-- with every other Dentally-synced table.

ALTER TABLE public.sundries ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.sundries ADD COLUMN IF NOT EXISTS integration_id UUID REFERENCES public.integrations(id);

CREATE INDEX IF NOT EXISTS idx_sundries_user_id        ON public.sundries(user_id);
CREATE INDEX IF NOT EXISTS idx_sundries_integration_id ON public.sundries(integration_id);
