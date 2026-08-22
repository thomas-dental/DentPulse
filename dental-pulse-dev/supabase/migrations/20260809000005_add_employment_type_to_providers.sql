-- Self Employed / Employee toggle for the Associate Split Configuration,
-- shown on the Edit Associate screen when Split Source Method = 'per-hour'.

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS employment_type varchar(20) DEFAULT 'self-employed'
  CHECK (employment_type IN ('self-employed', 'employee'));

COMMENT ON COLUMN public.providers.employment_type IS 'Self Employed vs Employee, surfaced on the Edit Associate screen alongside the per-hour Split Source Method.';
