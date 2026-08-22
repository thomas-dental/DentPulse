-- ============================================================================
-- Migration: Update chart_get_profit_metrics to fetch Op Costs dynamically
--            from the connected accounting platform instead of using a
--            hardcoded value.
--
-- Platform routing (mirrors plCostService.ts):
--   iplicit    → get_iplicit_pl_amount_cost_by_date(org, start, end, 'TC')
--   xero       → TODO: implement when xero_profit_loss table is available
--   quickbooks → TODO: implement when qbo_profit_loss table is available
--   (none)     → v_op_costs = 0
-- ============================================================================

CREATE OR REPLACE FUNCTION chart_get_profit_metrics(
  p_start_date DATE,
  p_end_date DATE,
  p_organization_id UUID,
  p_provider_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  provider_id UUID,
  provider_name TEXT,
  periodic_profit NUMERIC,
  pl_per_day NUMERIC,
  profit_percent NUMERIC,
  rank INTEGER
) AS $$
DECLARE
  v_materials_percent NUMERIC;
  v_lab_cost_percent NUMERIC;
  v_op_costs NUMERIC;
  v_number_of_surgeries INTEGER;
  v_working_days_in_range INTEGER;
  v_surgery_days NUMERIC;
  v_ocpspd NUMERIC;
  v_connected_platform VARCHAR;
BEGIN
  -- Get organization cost settings (matches UI profitGoalsMetrics)
  SELECT
    COALESCE(practice_cost_materials_percent, 0),
    COALESCE(associate_cost_labs_percent, 0),
    COALESCE(number_of_surgeries, 0)
  INTO
    v_materials_percent,
    v_lab_cost_percent,
    v_number_of_surgeries
  FROM organizations
  WHERE id = p_organization_id;

  -- Determine connected accounting platform for this organization
  SELECT platform_name INTO v_connected_platform
  FROM platform_integrations
  WHERE organization_id = p_organization_id
    AND is_connected = true
  ORDER BY updated_at DESC
  LIMIT 1;

  -- Fetch Op Costs dynamically from the connected platform
  IF v_connected_platform = 'iplicit' THEN
    SELECT COALESCE(ABS(pl.total_amount), 0)
    INTO v_op_costs
    FROM get_iplicit_pl_amount_cost_by_date(
      p_organization_id,
      p_start_date,
      p_end_date,
      'TC'
    ) pl;
  -- ELSIF v_connected_platform = 'xero' THEN
  --   TODO: implement when xero_profit_loss table and function are available
  --   v_op_costs := 0;
  -- ELSIF v_connected_platform = 'quickbooks' THEN
  --   TODO: implement when qbo_profit_loss table and function are available
  --   v_op_costs := 0;
  ELSE
    v_op_costs := 0;
  END IF;

  -- Calculate working days in the date range (matches calculateWorkingDays function)
  SELECT COUNT(*)
  INTO v_working_days_in_range
  FROM generate_series(p_start_date, p_end_date, '1 day'::interval) AS d
  WHERE EXTRACT(DOW FROM d) NOT IN (0, 6);

  -- Calculate surgery days for the period (matches UI line 404)
  v_surgery_days := v_working_days_in_range * v_number_of_surgeries;

  -- Calculate OCPSPD (matches UI line 410)
  v_ocpspd := CASE
    WHEN v_surgery_days > 0 THEN v_op_costs / v_surgery_days
    ELSE 0
  END;

  RETURN QUERY
  WITH
  -- Get base provider list
  base_providers AS (
    SELECT
      p.id,
      p.name,
      p.external_id,
      -- Get split percentages (matches UI lines 753-756)
      COALESCE(p.associate_split_percentage, 30) AS assoc_split_pct,
      COALESCE(
        CASE
          WHEN p.split_source_method = 'sliding-scale' THEN p.lab_split_percentage_sliding
          ELSE p.lab_split_percentage
        END,
        50
      ) AS lab_split_pct
    FROM providers p
    WHERE
      p.is_active = true
      AND p.deleted_at IS NULL
      AND p.organization_id = p_organization_id
      AND (p_provider_type IS NULL OR p.provider_role ILIKE '%' || p_provider_type || '%')
  ),
  -- Get production data using the same procedure as UI (get_provider_net_production_monthly)
  provider_production_data AS (
    SELECT
      bp.id AS provider_id,
      bp.name AS provider_name,
      bp.assoc_split_pct,
      bp.lab_split_pct,
      prod.total_amount
    FROM base_providers bp
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(total_amount), 0) AS total_amount
      FROM get_provider_net_production_monthly(
        p_organization_id,
        p_start_date,
        p_end_date,
        bp.external_id::INTEGER
      )
    ) AS prod
  ),
  -- Get working hours data using the same procedure as UI (get_provider_working_hours_monthly)
  provider_hours_data AS (
    SELECT
      bp.id AS provider_id,
      hours.total_hours
    FROM base_providers bp
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(total_hours), 0) AS total_hours
      FROM get_provider_working_hours_monthly(
        p_organization_id,
        p_start_date,
        p_end_date,
        bp.external_id::INTEGER
      )
    ) AS hours
  ),
  -- Calculate metrics (matches UI lines 759-844)
  profit_metrics AS (
    SELECT
      ppd.provider_id,
      ppd.provider_name,
      ppd.total_amount AS total_production,
      -- Working Days = Total Hours / 8 (matches UI line 775)
      phd.total_hours / 8.0 AS working_days,
      ppd.assoc_split_pct,
      ppd.lab_split_pct,
      -- Associate Gross Share = Production × Associate Split % (matches UI line 789)
      ppd.total_amount * (ppd.assoc_split_pct / 100.0) AS assoc_gross_share,
      -- Cost of Labs = Production × Lab Cost % (matches UI line 792)
      ppd.total_amount * (v_lab_cost_percent / 100.0) AS cost_of_labs,
      -- Materials Costs = Production × Materials % (matches UI line 814)
      ppd.total_amount * (v_materials_percent / 100.0) AS materials_costs
    FROM provider_production_data ppd
    JOIN provider_hours_data phd ON ppd.provider_id = phd.provider_id
  ),
  final_calcs AS (
    SELECT
      pm.provider_id,
      pm.provider_name,
      pm.total_production,
      pm.working_days,
      -- Associate Lab Share = Cost of Labs × Lab Split % (matches UI line 795)
      pm.cost_of_labs * (pm.lab_split_pct / 100.0) AS assoc_lab_share,
      pm.assoc_gross_share,
      pm.cost_of_labs,
      pm.materials_costs,
      -- OCPSPA Contribution = OCPSPD × Working Days (matches UI line 818)
      v_ocpspd * (pm.working_days) AS ocpspa_contribution
    FROM profit_metrics pm
  ),
  practice_pl_calcs AS (
    SELECT
      fc.provider_id,
      fc.provider_name,
      fc.total_production,
      fc.working_days,
      -- Associate Net Pay = Gross Share - Lab Share (matches UI line 798)
      fc.assoc_gross_share - fc.assoc_lab_share AS associate_net_pay,
      fc.cost_of_labs,
      fc.materials_costs,
      fc.ocpspa_contribution,
      -- Practice P/L = Production - (Net Pay + Labs + Materials + OCPSPA) (matches UI line 821)
      fc.total_production - (
        (fc.assoc_gross_share - fc.assoc_lab_share) +
        fc.cost_of_labs +
        fc.materials_costs +
        (v_ocpspd * fc.working_days)
      ) AS practice_pl
    FROM final_calcs fc
  ),
  ranked_results AS (
    SELECT
      plc.provider_id,
      plc.provider_name,
      ROUND(plc.practice_pl, 2) AS periodic_profit,
      -- P/L Per Day = Practice P/L / Working Days (matches UI line 827)
      CASE
        WHEN plc.working_days > 0 THEN ROUND(plc.practice_pl / plc.working_days, 2)
        ELSE 0
      END AS pl_per_day,
      -- Profit % = (Practice P/L / Total Production) × 100 (custom for chart)
      CASE
        WHEN plc.total_production > 0 THEN ROUND((plc.practice_pl / plc.total_production) * 100, 2)
        ELSE 0
      END AS profit_percent,
      -- Rank by P/L Per Day (highest to lowest)
      ROW_NUMBER() OVER (
        ORDER BY
          CASE
            WHEN plc.working_days > 0 THEN plc.practice_pl / plc.working_days
            ELSE 0
          END DESC
      )::INTEGER AS rank
    FROM practice_pl_calcs plc
    WHERE plc.total_production > 0 OR plc.working_days > 0
  )
  SELECT
    rr.provider_id,
    rr.provider_name,
    rr.periodic_profit,
    rr.pl_per_day,
    rr.profit_percent,
    rr.rank
  FROM ranked_results rr
  ORDER BY rr.rank;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION chart_get_profit_metrics(DATE, DATE, UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION chart_get_profit_metrics(DATE, DATE, UUID, TEXT) IS
'Calculates profit metrics for providers using the same logic as Profit Goals Settings page.
Op Costs are fetched dynamically from the connected accounting platform
(iplicit → get_iplicit_pl_amount_cost_by_date; xero/quickbooks → TODO).
Periodic Profit = Practice P/L = Production - (Associate Net Pay + Cost of Labs + Materials + OCPSPD Contribution)
P/L Per Day = Practice P/L / Working Days
Profit % = (Practice P/L / Total Production) × 100
Ranking: Providers are ranked by P/L Per Day (highest to lowest)';
