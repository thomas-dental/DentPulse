-- Store a per-row mapping from the CSV `fee_category` to an actual DB
-- payment_plans record, chosen by the user during the import preview step.
-- The mapping can differ per import, so it is stored on each row rather
-- than in a separate lookup table.

ALTER TABLE public.membership_upload_members
  ADD COLUMN IF NOT EXISTS mapped_plan_id   UUID,
  ADD COLUMN IF NOT EXISTS mapped_plan_name TEXT;

CREATE INDEX IF NOT EXISTS idx_membership_upload_members_mapped_plan_id
  ON public.membership_upload_members (organization_id, mapped_plan_id)
  WHERE mapped_plan_id IS NOT NULL;
