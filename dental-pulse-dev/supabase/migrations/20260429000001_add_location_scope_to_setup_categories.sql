-- Add optional practice-location scope to setup category mappings.
-- Existing location_id/account_id columns continue to store chart-of-account ids.
-- mapping_location_id NULL = all-location default.
-- mapping_location_id NOT NULL = override for that practice location.

ALTER TABLE public.category_range_map
  ADD COLUMN IF NOT EXISTS mapping_location_id UUID REFERENCES public.practice_locations(id) ON DELETE CASCADE;

ALTER TABLE public.category_wish_list
  ADD COLUMN IF NOT EXISTS mapping_location_id UUID REFERENCES public.practice_locations(id) ON DELETE CASCADE;

ALTER TABLE public.group_account
  ADD COLUMN IF NOT EXISTS mapping_location_id UUID REFERENCES public.practice_locations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_category_range_map_mapping_location
  ON public.category_range_map(organization_id, platform_integration_id, mapping_location_id);

CREATE INDEX IF NOT EXISTS idx_category_wish_list_mapping_location
  ON public.category_wish_list(organization_id, platform_integration_id, mapping_location_id);

CREATE INDEX IF NOT EXISTS idx_group_account_mapping_location
  ON public.group_account(organization_id, platform_integration_id, mapping_location_id);

COMMENT ON COLUMN public.category_range_map.mapping_location_id IS
  'Optional practice location scope for this account category mapping. NULL means all-location default.';

COMMENT ON COLUMN public.category_wish_list.mapping_location_id IS
  'Optional practice location scope for this wishlist account mapping. NULL means all-location default.';

COMMENT ON COLUMN public.group_account.mapping_location_id IS
  'Optional practice location scope for this profit/expense account mapping. NULL means all-location default.';
