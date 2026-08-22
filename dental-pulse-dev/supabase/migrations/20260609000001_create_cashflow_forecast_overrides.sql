-- 13-Week Cash Flow Forecast — manual overrides + custom rows.
--
-- The forecast auto-computes a baseline (repeat the trailing period's pattern
-- forward), but true cash-receipt timing is human knowledge the data can't infer
-- (e.g. a one-off £375k client payment landing in a specific week). This table
-- stores per-cell overrides AND ad-hoc custom rows the user adds.
--
-- A cell is identified by (week_start [the Monday], section, line_key):
--   line_key = 'nhs' | 'private' | 'membership:<provider_id>' | 'custom:<uuid>'
-- For standard rows the override REPLACES the computed value for that week.
-- For custom rows (line_key starts 'custom:') line_label holds the row title and
-- the row exists only via its override cells.
--
-- Overrides are keyed by the actual week_start DATE (not a 1..13 index) so they
-- stay attached to the right week as the rolling forecast window advances.

CREATE TABLE IF NOT EXISTS public.cashflow_forecast_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- NULL location_id = the "all locations" forecast scope.
  location_id     UUID REFERENCES public.practice_locations(id) ON DELETE CASCADE,

  week_start DATE        NOT NULL,                 -- Monday of the forecast week
  section    VARCHAR(20)  NOT NULL DEFAULT 'inflow', -- 'inflow' | 'outflow' (outflow = future phase)
  line_key   VARCHAR(120) NOT NULL,                -- see header
  line_label VARCHAR(255),                         -- title for custom rows

  amount NUMERIC(15, 2) NOT NULL DEFAULT 0,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- One override per cell. NULLS NOT DISTINCT so the all-locations scope
  -- (location_id IS NULL) still collapses duplicates.
  CONSTRAINT cashflow_forecast_overrides_unique_cell
    UNIQUE NULLS NOT DISTINCT (organization_id, location_id, week_start, section, line_key)
);

CREATE INDEX IF NOT EXISTS idx_cf_forecast_ovr_org
  ON public.cashflow_forecast_overrides(organization_id);
CREATE INDEX IF NOT EXISTS idx_cf_forecast_ovr_scope
  ON public.cashflow_forecast_overrides(organization_id, location_id, section, week_start);

ALTER TABLE public.cashflow_forecast_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cf_forecast_ovr_select" ON public.cashflow_forecast_overrides;
CREATE POLICY "cf_forecast_ovr_select" ON public.cashflow_forecast_overrides FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "cf_forecast_ovr_insert" ON public.cashflow_forecast_overrides;
CREATE POLICY "cf_forecast_ovr_insert" ON public.cashflow_forecast_overrides FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "cf_forecast_ovr_update" ON public.cashflow_forecast_overrides;
CREATE POLICY "cf_forecast_ovr_update" ON public.cashflow_forecast_overrides FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS "cf_forecast_ovr_delete" ON public.cashflow_forecast_overrides;
CREATE POLICY "cf_forecast_ovr_delete" ON public.cashflow_forecast_overrides FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

COMMENT ON TABLE public.cashflow_forecast_overrides IS
  '13-week cash flow forecast: manual per-cell overrides and ad-hoc custom rows. '
  'Keyed by week_start (Monday) + line_key; overrides replace computed baseline cells.';
