-- ============================================================
-- Table: ai_pricing_settings
--
-- Per-organization configuration for the AI Suggested Pricing
-- panel. Lets admins edit the system prompt, choose the model,
-- tune max_tokens, and set how long a generated suggestion
-- stays valid before the next click re-runs the AI call.
--
-- One row per organization (enforced by UNIQUE on organization_id).
-- Frontend reads this row before each Generate; if no row exists,
-- it falls back to compiled-in defaults.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_pricing_settings (
  id                          uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id             uuid          NOT NULL,

  -- Editable AI configuration
  system_prompt               text          NOT NULL,
  model_name                  varchar(64)   NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  max_tokens                  integer       NOT NULL DEFAULT 4000,

  -- Cache TTL: skip the AI call if the most recent suggestion for
  -- this treatment is younger than this many seconds. 0 disables
  -- caching (every Generate hits the API).
  regenerate_after_seconds    integer       NOT NULL DEFAULT 86400,  -- 24h

  -- Web-search tool toggle + version
  web_search_enabled          boolean       NOT NULL DEFAULT true,
  web_search_tool_version     varchar(64)   NOT NULL DEFAULT 'web_search_20250305',

  -- Audit
  created_at                  timestamptz   NOT NULL DEFAULT now(),
  updated_at                  timestamptz   NOT NULL DEFAULT now(),
  created_by                  uuid,
  updated_by                  uuid,

  CONSTRAINT ai_pricing_settings_pkey PRIMARY KEY (id),
  CONSTRAINT ai_pricing_settings_organization_id_unique UNIQUE (organization_id),
  CONSTRAINT ai_pricing_settings_max_tokens_positive    CHECK (max_tokens BETWEEN 256 AND 64000),
  CONSTRAINT ai_pricing_settings_regen_seconds_positive CHECK (regenerate_after_seconds >= 0)
);

-- Foreign keys
ALTER TABLE public.ai_pricing_settings
  ADD CONSTRAINT ai_pricing_settings_org_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.ai_pricing_settings
  ADD CONSTRAINT ai_pricing_settings_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.ai_pricing_settings
  ADD CONSTRAINT ai_pricing_settings_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- updated_at auto-touch trigger
CREATE OR REPLACE FUNCTION public.touch_ai_pricing_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_pricing_settings_touch_updated_at ON public.ai_pricing_settings;
CREATE TRIGGER trg_ai_pricing_settings_touch_updated_at
  BEFORE UPDATE ON public.ai_pricing_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_ai_pricing_settings_updated_at();

-- RLS
ALTER TABLE public.ai_pricing_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view AI pricing settings in their org"
ON public.ai_pricing_settings FOR SELECT
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  public.user_in_org(auth.uid(), organization_id)
);

CREATE POLICY "Owners and admins can insert AI pricing settings"
ON public.ai_pricing_settings FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

CREATE POLICY "Owners and admins can update AI pricing settings"
ON public.ai_pricing_settings FOR UPDATE
USING (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL AND
  organization_id IS NOT NULL AND
  (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR
    public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  )
);

COMMENT ON TABLE  public.ai_pricing_settings IS
'Per-organization configuration for the AI Suggested Pricing feature. One row per org. Frontend falls back to compiled-in defaults when no row exists.';
COMMENT ON COLUMN public.ai_pricing_settings.system_prompt            IS 'Editable system prompt sent to the AI. Replaces the hardcoded default when present.';
COMMENT ON COLUMN public.ai_pricing_settings.regenerate_after_seconds IS 'Cache TTL for AI suggestions. Generate reuses any treatment_ai_suggested_pricing row newer than this. 0 = always regenerate.';
COMMENT ON COLUMN public.ai_pricing_settings.web_search_enabled       IS 'Whether to attach the web_search tool to the AI call.';
