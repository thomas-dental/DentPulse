-- Tag each DenPlan membership upload with the location it was uploaded for.
--
-- Previously each row's location was derived from the matched patient's home
-- location (`location_id`), so a single DenPlan file scattered its members
-- across locations by patient. `upload_location_id` records the location the
-- file belongs to (chosen at import), so reads (13-week cash flow forecast,
-- Membership page) can isolate a DenPlan upload to a single location.

ALTER TABLE public.membership_upload_members
  ADD COLUMN IF NOT EXISTS upload_location_id UUID REFERENCES public.practice_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_membership_upload_members_upload_location
  ON public.membership_upload_members(organization_id, upload_location_id);

COMMENT ON COLUMN public.membership_upload_members.upload_location_id IS
  'The location this DenPlan file was uploaded for (whole-file scope). Reads prefer '
  'this over the per-patient location_id so an upload isolates to one location.';
