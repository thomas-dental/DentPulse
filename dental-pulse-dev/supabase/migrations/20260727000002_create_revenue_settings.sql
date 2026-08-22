-- Revenue Settings: centralizes "which app is the source of truth for each
-- income type, and is it tracked practice-wide or per-provider" — previously
-- duplicated (and drifting) across LocationDetailContent, OrganizationDetailContent,
-- and Organization.tsx's own settings tab. One row per organization is the
-- org-wide default (location_id IS NULL); a non-null location_id is that one
-- location's override. Mirrors the uda_settings -> uda_settings_per_location
-- evolution (see 20260310000001 / 20260609000003) from day one so multi-location
-- orgs with different PMS/accounting setups per site don't force a second
-- migration later.

CREATE TABLE IF NOT EXISTS public.revenue_settings (
  id                       UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  location_id              UUID NULL REFERENCES practice_locations(id) ON DELETE CASCADE,

  -- Defaults match practice_locations' existing column defaults (private_income_source
  -- DEFAULT 'pms', membership/nhs DEFAULT 'accounting') so a first-time save of this
  -- modal doesn't silently flip an org's actual current setup.
  private_income_from      TEXT NOT NULL DEFAULT 'pms'
                              CHECK (private_income_from IN ('pms', 'accounting')),
  membership_income_from   TEXT NOT NULL DEFAULT 'accounting'
                              CHECK (membership_income_from IN ('pms', 'accounting', 'dentpulse')),
  nhs_income_from          TEXT NOT NULL DEFAULT 'accounting'
                              CHECK (nhs_income_from IN ('pms', 'accounting', 'dentpulse')),
  mos_income_from          TEXT NOT NULL DEFAULT 'accounting'
                              CHECK (mos_income_from IN ('pms', 'accounting', 'dentpulse')),

  private_income_level     TEXT NOT NULL DEFAULT 'practice'
                              CHECK (private_income_level IN ('practice', 'provider')),
  membership_income_level  TEXT NOT NULL DEFAULT 'practice'
                              CHECK (membership_income_level IN ('practice', 'provider')),
  nhs_income_level         TEXT NOT NULL DEFAULT 'practice'
                              CHECK (nhs_income_level IN ('practice', 'provider')),
  mos_income_level         TEXT NOT NULL DEFAULT 'practice'
                              CHECK (mos_income_level IN ('practice', 'provider')),

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT revenue_settings_unique UNIQUE NULLS NOT DISTINCT (organization_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_revenue_settings_org_loc
  ON public.revenue_settings (organization_id, location_id);

CREATE TRIGGER revenue_settings_updated_at
  BEFORE UPDATE ON public.revenue_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.revenue_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their org revenue_settings"
  ON public.revenue_settings FOR ALL
  USING (
    organization_id IN (
      SELECT current_organization_id FROM profiles WHERE id = auth.uid()
      UNION
      SELECT organization_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.revenue_settings IS
  'Per-org (location_id NULL) or per-location Revenue Source + Income Level policy for Private/Membership/NHS/MOS income.';
COMMENT ON COLUMN public.revenue_settings.location_id IS
  'NULL = organization-wide default. Non-null = override for that one location.';
COMMENT ON COLUMN public.revenue_settings.private_income_from IS
  'Which app is authoritative for Private Income: pms or accounting. (No dentpulse option for Private.)';
COMMENT ON COLUMN public.revenue_settings.mos_income_from IS
  'Which app is authoritative for MOS Income: pms, accounting, or dentpulse.';
COMMENT ON COLUMN public.revenue_settings.private_income_level IS
  'practice = tracked practice-wide via account mapping; provider = tracked per-associate elsewhere (forced + locked when *_income_from is pms or dentpulse).';


-- ─────────────────────────────────────────────────────────────────────────────
-- MOS Income revenue group — Setup Categories' "Revenue" account-mapping cards
-- (group_account_master, group_type 1 = Revenue) only had Private/Membership/NHS.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.group_account_master (id, range_order, name, group_code, sector_id, group_type) VALUES
(4, 4, 'MOS Income', 'MOSIncome', 10, 1)
ON CONFLICT (id) DO UPDATE SET
  range_order = EXCLUDED.range_order,
  name = EXCLUDED.name,
  group_code = EXCLUDED.group_code,
  sector_id = EXCLUDED.sector_id,
  group_type = EXCLUDED.group_type;


-- ─────────────────────────────────────────────────────────────────────────────
-- MOS columns on practice_locations, mirroring the existing NHS columns so
-- LocationDetailContent's Revenue Income panel can render a 4th MOS row.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE practice_locations
  ADD COLUMN IF NOT EXISTS mos_income_source TEXT DEFAULT 'accounting',
  ADD COLUMN IF NOT EXISTS mos_income_accounts JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS mos_income_coa_accounts JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN practice_locations.mos_income_source IS 'MOS income source type: pms, accounting, or dentpulse. Managed centrally via revenue_settings, not edited directly here.';
COMMENT ON COLUMN practice_locations.mos_income_accounts IS 'Array of Dentally payment-plan IDs for MOS income when mos_income_source = pms';
COMMENT ON COLUMN practice_locations.mos_income_coa_accounts IS 'Array of Chart-of-Account UUIDs for MOS income when mos_income_source = accounting';


-- ─────────────────────────────────────────────────────────────────────────────
-- New practice_locations rows (manual creation, or the dentally-sync edge
-- function) previously got raw column defaults instead of the org's actual
-- Revenue Settings policy. Apply the org default (location_id IS NULL row) on
-- insert, if one has been configured.
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
      mos_income_source         = v_defaults.mos_income_from
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS apply_org_revenue_settings_on_location_insert ON practice_locations;
CREATE TRIGGER apply_org_revenue_settings_on_location_insert
  AFTER INSERT ON practice_locations
  FOR EACH ROW EXECUTE FUNCTION public.apply_org_revenue_settings_to_new_location();
