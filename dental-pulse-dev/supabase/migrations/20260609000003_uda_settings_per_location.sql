-- Make UDA settings storable per location.
--
-- uda_settings was org-level per financial year (NHS contract value + total UDA
-- obligation). Practices with multiple NHS contracts need these per location, so
-- the 13-week cash flow forecast can show each location's own NHS = contract ÷ 12.
--
-- location_id IS NULL keeps the previous org-level/default behaviour (back-compat
-- for existing rows); a non-null location_id is that location's own settings.

ALTER TABLE public.uda_settings
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.practice_locations(id) ON DELETE CASCADE;

-- Replace the (org, FY) uniqueness with (org, location, FY) so each location can
-- hold its own row. NULLS NOT DISTINCT so the org-level (null location) row also
-- stays unique per FY.
ALTER TABLE public.uda_settings DROP CONSTRAINT IF EXISTS uda_settings_unique;
ALTER TABLE public.uda_settings
  ADD CONSTRAINT uda_settings_unique_loc
  UNIQUE NULLS NOT DISTINCT (organization_id, location_id, financial_year);

CREATE INDEX IF NOT EXISTS idx_uda_settings_org_loc_fy
  ON public.uda_settings (organization_id, location_id, financial_year);

COMMENT ON COLUMN public.uda_settings.location_id IS
  'Location these UDA settings apply to. NULL = org-level/default (legacy). '
  'A non-null value scopes the NHS contract value & UDA obligation to one location.';
