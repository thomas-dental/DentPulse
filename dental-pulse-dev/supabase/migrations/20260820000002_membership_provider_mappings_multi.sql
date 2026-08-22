-- ============================================
-- Membership Provider Mappings — multi-select
-- One statement provider name can correspond to SEVERAL enterprise
-- providers (e.g. a "Hygiene Only" statement bucket covering every
-- hygienist) and SEVERAL locations, so provider_id / location_id become
-- UUID[] — same shape as membership_plan_mappings.payment_plan_ids
-- (Postgres can't FK array elements, so ids are validated client-side).
-- Existing single mappings are carried over.
-- ============================================

ALTER TABLE public.membership_provider_mappings
    ADD COLUMN IF NOT EXISTS provider_ids UUID[] NOT NULL DEFAULT '{}'::UUID[],
    ADD COLUMN IF NOT EXISTS location_ids UUID[] NOT NULL DEFAULT '{}'::UUID[];

UPDATE public.membership_provider_mappings
    SET provider_ids = ARRAY[provider_id]
    WHERE provider_id IS NOT NULL AND provider_ids = '{}'::UUID[];

UPDATE public.membership_provider_mappings
    SET location_ids = ARRAY[location_id]
    WHERE location_id IS NOT NULL AND location_ids = '{}'::UUID[];

ALTER TABLE public.membership_provider_mappings
    DROP COLUMN IF EXISTS provider_id,
    DROP COLUMN IF EXISTS location_id;

COMMENT ON TABLE public.membership_provider_mappings IS
    'Maps statement provider names (membership_upload_members.treating_dentist) to one or more enterprise providers (provider_ids) and/or practice locations (location_ids). Overrides fuzzy name matching where present; a multi-provider mapping splits that name''s statement revenue equally.';
