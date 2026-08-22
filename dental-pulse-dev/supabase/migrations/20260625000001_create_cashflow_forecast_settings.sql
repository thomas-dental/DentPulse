-- 13-Week Cash Flow Forecast — per-location forecast generation settings.
--
-- The forecast engine builds its baseline by "repeating the trailing pattern
-- forward" with a set of assumptions that used to be hardcoded constants
-- (membership churn/pay-day, the ±2%/week trend cap, private growth, cost
-- inflation). This table lets each practice tune those ASSUMPTIONS per location
-- so they can build the forecast to their own expectations — including bundled
-- Optimistic / Expected / Pessimistic scenario presets.
--
-- One row per (organization, location). A NULL location_id row is the
-- "all locations" / org-wide default, mirroring cashflow_forecast_overrides.
-- The whole config lives in a single JSONB blob (`settings`) so new knobs can be
-- added without a migration; the app fills any missing key with its built-in
-- default (which equals the previous hardcoded constant), so existing forecasts
-- are unchanged until someone edits the settings.

CREATE TABLE IF NOT EXISTS public.cashflow_forecast_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- NULL location_id = the "all locations" forecast scope.
  location_id     UUID REFERENCES public.practice_locations(id) ON DELETE CASCADE,

  -- The forecast-generation assumptions. Shape (all optional, defaulted in app):
  --   preset                       : 'expected' | 'optimistic' | 'pessimistic' | 'custom'
  --   incomeMethod                 : 'auto' | 'average' | 'repeat' | 'manual'  (Private line)
  --   incomeManualGrowthMonthlyPct : number   (% per month, when incomeMethod = 'manual')
  --   costMethod                   : 'auto' | 'average' | 'repeat' | 'manual'  (operating costs)
  --   costManualGrowthMonthlyPct   : number   (% per month, when costMethod = 'manual')
  --   costInflationMonthlyPct      : number   (% per month uplift applied to projected costs)
  --   trendCapWeeklyPct            : number   (max ± per-week drift the 'auto' trend may apply)
  --   membershipChurnAnnualPct     : number   (Denplan annual attrition assumption)
  --   membershipPayDay             : number   (1–28, day of month Denplan cash lands)
  --
  -- Per-LINE projection-method overrides are stored separately, in
  -- cashflow_forecast_overrides with section = 'method' (JSON {method,growthPct?,fixed?}
  -- in line_label), mirroring how Auto/Repeating/Linked rules (section='rule') are kept.
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- One settings row per scope. NULLS NOT DISTINCT so the all-locations scope
  -- (location_id IS NULL) collapses to a single row too.
  CONSTRAINT cashflow_forecast_settings_unique_scope
    UNIQUE NULLS NOT DISTINCT (organization_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_cf_forecast_settings_scope
  ON public.cashflow_forecast_settings(organization_id, location_id);

ALTER TABLE public.cashflow_forecast_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cf_forecast_settings_select" ON public.cashflow_forecast_settings;
CREATE POLICY "cf_forecast_settings_select" ON public.cashflow_forecast_settings FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "cf_forecast_settings_insert" ON public.cashflow_forecast_settings;
CREATE POLICY "cf_forecast_settings_insert" ON public.cashflow_forecast_settings FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "cf_forecast_settings_update" ON public.cashflow_forecast_settings;
CREATE POLICY "cf_forecast_settings_update" ON public.cashflow_forecast_settings FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "cf_forecast_settings_delete" ON public.cashflow_forecast_settings;
CREATE POLICY "cf_forecast_settings_delete" ON public.cashflow_forecast_settings FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

COMMENT ON TABLE public.cashflow_forecast_settings IS
  '13-week cash flow forecast: per-location forecast-generation assumptions '
  '(growth, cost inflation, trend cap, membership churn/pay-day) + scenario preset. '
  'One JSONB blob per (organization, location); missing keys default to the app constants.';
