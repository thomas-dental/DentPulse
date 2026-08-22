-- Add UOA Income as a third revenue-settings row, alongside NHS Income and MOS
-- Income. Mirrors the MOS-adding parts of 20260727000002_create_revenue_settings.sql
-- (the revenue_settings table and apply_org_revenue_settings_to_new_location()
-- trigger already exist — this only widens/extends them).

ALTER TABLE public.revenue_settings
  ADD COLUMN IF NOT EXISTS uoa_income_from TEXT NOT NULL DEFAULT 'accounting'
    CHECK (uoa_income_from IN ('pms', 'accounting', 'dentpulse')),
  ADD COLUMN IF NOT EXISTS uoa_income_level TEXT NOT NULL DEFAULT 'practice'
    CHECK (uoa_income_level IN ('practice', 'provider'));

COMMENT ON COLUMN public.revenue_settings.uoa_income_from IS
  'Which app is authoritative for UOA Income: pms, accounting, or dentpulse.';
COMMENT ON COLUMN public.revenue_settings.uoa_income_level IS
  'practice = tracked practice-wide via account mapping; provider = tracked per-associate elsewhere.';


-- ─────────────────────────────────────────────────────────────────────────────
-- UOA Income revenue group — Setup Categories' "Revenue" account-mapping cards
-- (group_account_master, group_type 1 = Revenue) had Private/Membership/NHS/MOS;
-- id 5 is the next free id (4 = MOSIncome, 100+ = cost groups, 109 = ClinicianCost).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.group_account_master (id, range_order, name, group_code, sector_id, group_type) VALUES
(5, 5, 'UOA Income', 'UOAIncome', 10, 1)
ON CONFLICT (id) DO UPDATE SET
  range_order = EXCLUDED.range_order,
  name = EXCLUDED.name,
  group_code = EXCLUDED.group_code,
  sector_id = EXCLUDED.sector_id,
  group_type = EXCLUDED.group_type;


-- ─────────────────────────────────────────────────────────────────────────────
-- UOA columns on practice_locations, mirroring the existing MOS columns so the
-- Revenue Income panel can render a 5th UOA row.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE practice_locations
  ADD COLUMN IF NOT EXISTS uoa_income_source TEXT DEFAULT 'accounting',
  ADD COLUMN IF NOT EXISTS uoa_income_accounts JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS uoa_income_coa_accounts JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN practice_locations.uoa_income_source IS 'UOA income source type: pms, accounting, or dentpulse. Managed centrally via revenue_settings, not edited directly here.';
COMMENT ON COLUMN practice_locations.uoa_income_accounts IS 'Array of Dentally payment-plan IDs for UOA income when uoa_income_source = pms';
COMMENT ON COLUMN practice_locations.uoa_income_coa_accounts IS 'Array of Chart-of-Account UUIDs for UOA income when uoa_income_source = accounting';


-- ─────────────────────────────────────────────────────────────────────────────
-- Re-create apply_org_revenue_settings_to_new_location() to also cascade the
-- org's UOA Income default onto newly created locations.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_org_revenue_settings_to_new_location()
RETURNS TRIGGER AS $$
DECLARE
  v_defaults public.revenue_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_defaults
  FROM public.revenue_settings
  WHERE organization_id = NEW.organization_id
    AND location_id IS NULL
  LIMIT 1;

  IF FOUND THEN
    UPDATE practice_locations
    SET
      private_income_source    = v_defaults.private_income_from,
      membership_income_source = v_defaults.membership_income_from,
      nhs_income_source         = v_defaults.nhs_income_from,
      mos_income_source         = v_defaults.mos_income_from,
      uoa_income_source         = v_defaults.uoa_income_from
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
