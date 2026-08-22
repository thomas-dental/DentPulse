-- Budget category settings table
-- Stores budget amounts per category per period per organization
CREATE TABLE IF NOT EXISTS public.budget_category_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  period VARCHAR(7) NOT NULL, -- YYYY-MM format
  budget_amount DECIMAL(15, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT budget_category_settings_pkey PRIMARY KEY (id),
  CONSTRAINT budget_category_settings_unique UNIQUE (organization_id, category, period)
);

CREATE INDEX IF NOT EXISTS idx_budget_category_settings_org
  ON public.budget_category_settings(organization_id);

CREATE INDEX IF NOT EXISTS idx_budget_category_settings_period
  ON public.budget_category_settings(organization_id, period);

ALTER TABLE public.budget_category_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY budget_category_settings_org_isolation
  ON public.budget_category_settings
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION update_budget_category_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_budget_category_settings_updated_at
    BEFORE UPDATE ON public.budget_category_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_budget_category_settings_updated_at();
