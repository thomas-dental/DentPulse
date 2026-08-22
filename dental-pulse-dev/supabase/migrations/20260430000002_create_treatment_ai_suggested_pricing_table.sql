-- ============================================================
-- Table: treatment_ai_suggested_pricing
--
-- Logs every AI suggestion response that ended up applied to a
-- treatment. Each row captures the full AI output AND the subset
-- of fields the user actually accepted, so the team can audit
-- what was suggested vs. what was kept and build a "Suggestion
-- History" view per treatment.
--
-- Triggered by: form Save on TreatmentEdit, only when the user
-- applied at least one AI suggestion during that edit session.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.treatment_ai_suggested_pricing (
  id              uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid          NOT NULL,
  treatment_id    uuid          NOT NULL,
  location_id     uuid,

  -- Audit
  applied_at      timestamptz   NOT NULL DEFAULT now(),
  applied_by      uuid,
  apply_action    varchar(16)   NOT NULL,  -- 'single' | 'all'

  -- AI response context
  summary         text,
  currency        varchar(8),
  scope_label     text,
  peer_count      integer,

  -- Area benchmark snapshot (nullable — present only when AREA source contributed)
  area_match_level   varchar(16),
  area_geo_level     varchar(16),
  area_geo_label     text,
  area_clinic_count  integer,
  area_sample_count  integer,

  -- Full AI suggestions object: { "<field>": { "value": <num>, "reason": "<text>", "sources": ["peer"|"area"|"market"] } }
  ai_suggestions  jsonb         NOT NULL,

  -- Subset that was applied this time: { "<field>": <number> }
  applied_fields  jsonb         NOT NULL,

  CONSTRAINT treatment_ai_suggested_pricing_pkey       PRIMARY KEY (id),
  CONSTRAINT treatment_ai_suggested_pricing_action_chk CHECK (apply_action IN ('single', 'all'))
);

-- Foreign keys
ALTER TABLE public.treatment_ai_suggested_pricing
  ADD CONSTRAINT treatment_ai_suggested_pricing_org_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.treatment_ai_suggested_pricing
  ADD CONSTRAINT treatment_ai_suggested_pricing_treatment_fkey
  FOREIGN KEY (treatment_id) REFERENCES public.treatments(id) ON DELETE CASCADE;

ALTER TABLE public.treatment_ai_suggested_pricing
  ADD CONSTRAINT treatment_ai_suggested_pricing_location_fkey
  FOREIGN KEY (location_id) REFERENCES public.practice_locations(id) ON DELETE SET NULL;

ALTER TABLE public.treatment_ai_suggested_pricing
  ADD CONSTRAINT treatment_ai_suggested_pricing_applied_by_fkey
  FOREIGN KEY (applied_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Indexes for the common access pattern: history per treatment, ordered by time
CREATE INDEX IF NOT EXISTS idx_treatment_ai_suggested_pricing_treatment_id_applied_at
  ON public.treatment_ai_suggested_pricing (treatment_id, applied_at DESC);

CREATE INDEX IF NOT EXISTS idx_treatment_ai_suggested_pricing_organization_id
  ON public.treatment_ai_suggested_pricing (organization_id);

-- RLS — mirror the treatments table policies
ALTER TABLE public.treatment_ai_suggested_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view AI suggestion history in their org"
ON public.treatment_ai_suggested_pricing FOR SELECT
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  public.user_in_org(auth.uid(), organization_id)
);

CREATE POLICY "Owners and admins can insert AI suggestion history"
ON public.treatment_ai_suggested_pricing FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

COMMENT ON TABLE  public.treatment_ai_suggested_pricing IS
'History of AI pricing suggestions that were applied to treatments. One row per Save where the user accepted at least one AI value.';
COMMENT ON COLUMN public.treatment_ai_suggested_pricing.ai_suggestions IS
'Full suggestions object returned by the AI for the run that produced the applied values.';
COMMENT ON COLUMN public.treatment_ai_suggested_pricing.applied_fields  IS
'Subset of suggestions that the user accepted during this edit session: { field_name: applied_value }.';
COMMENT ON COLUMN public.treatment_ai_suggested_pricing.apply_action    IS
'How the apply happened: "single" (one field via tick) or "all" (Apply all suggestions button).';
