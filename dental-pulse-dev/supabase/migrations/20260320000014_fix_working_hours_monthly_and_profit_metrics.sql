-- Fix two issues in the Profit chart (chart_get_profit_metrics):
--
-- 1. get_provider_working_hours_monthly was never updated to use the standard
--    4-state criteria. Still used: apmt_state = 'Completed' AND patient_name IS NOT NULL.
--    Fix: align with all other working hours functions:
--      states: Completed, Pending, In surgery, Confirmed
--      no patient_name filter
--      deleted_at IS NULL
--
-- 2. chart_get_profit_metrics hardcodes working_days = total_hours / 8.0
--    Fix: use open_hours_per_day from organizations (same as chart_get_production_metrics).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Fix get_provider_working_hours_monthly
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_provider_working_hours_monthly(
  p_organization_id UUID,
  p_from_date       DATE,
  p_to_date         DATE,
  p_practitioner_id INTEGER
)
RETURNS TABLE (
  month             TEXT,
  appointment_count BIGINT,
  total_hours       NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
  SET LOCAL statement_timeout = '60s';

  RETURN QUERY
  SELECT
    TO_CHAR(DATE_TRUNC('month', apmt_start_time), 'Mon-YY') AS month,
    COUNT(*)                                                  AS appointment_count,
    SUM(apmt_duration)::NUMERIC / 60.0                        AS total_hours
  FROM appointments
  WHERE organization_id      = p_organization_id
    AND apmt_practitioner_id = p_practitioner_id
    AND apmt_state           IN ('Completed', 'Pending', 'In surgery', 'Confirmed')
    AND apmt_start_time::DATE BETWEEN p_from_date AND p_to_date
    AND apmt_duration        IS NOT NULL
    AND apmt_start_time      IS NOT NULL
    AND deleted_at           IS NULL
  GROUP BY TO_CHAR(DATE_TRUNC('month', apmt_start_time), 'Mon-YY'),
           DATE_TRUNC('month', apmt_start_time)
  ORDER BY DATE_TRUNC('month', apmt_start_time);
END;
$$;

GRANT EXECUTE ON FUNCTION get_provider_working_hours_monthly(UUID, DATE, DATE, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_provider_working_hours_monthly(UUID, DATE, DATE, INTEGER) TO anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Fix chart_get_profit_metrics — use open_hours_per_day instead of 8.0
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION chart_get_profit_metrics(
  p_start_date      DATE,
  p_end_date        DATE,
  p_organization_id UUID,
  p_provider_type   TEXT DEFAULT NULL
)
RETURNS TABLE (
  provider_id     UUID,
  provider_name   TEXT,
  periodic_profit NUMERIC,
  pl_per_day      NUMERIC,
  profit_percent  NUMERIC,
  rank            INTEGER
) AS $$
DECLARE
  v_materials_percent    NUMERIC;
  v_lab_cost_percent     NUMERIC;
  v_op_costs             NUMERIC;
  v_number_of_surgeries  INTEGER;
  v_working_days_in_range INTEGER;
  v_surgery_days         NUMERIC;
  v_ocpspd               NUMERIC;
  v_connected_platform   VARCHAR;
  v_hours_per_day        NUMERIC;
BEGIN
  -- Get organization cost settings and hours per day
  SELECT
    COALESCE(practice_cost_materials_percent, 0),
    COALESCE(associate_cost_labs_percent, 0),
    COALESCE(number_of_surgeries, 0),
    COALESCE(NULLIF(open_hours_per_day, 0), 8)
  INTO
    v_materials_percent,
    v_lab_cost_percent,
    v_number_of_surgeries,
    v_hours_per_day
  FROM organizations
  WHERE id = p_organization_id;

  IF v_hours_per_day IS NULL THEN v_hours_per_day := 8; END IF;

  -- Determine connected accounting platform
  SELECT platform_name INTO v_connected_platform
  FROM platform_integrations
  WHERE organization_id = p_organization_id
    AND is_connected = true
  ORDER BY updated_at DESC
  LIMIT 1;

  -- Fetch Op Costs dynamically from connected platform
  IF v_connected_platform = 'iplicit' THEN
    SELECT COALESCE(ABS(pl.total_amount), 0)
    INTO v_op_costs
    FROM get_iplicit_pl_amount_cost_by_date(
      p_organization_id,
      p_start_date,
      p_end_date,
      'TC'
    ) pl;
  ELSE
    v_op_costs := 0;
  END IF;

  -- Calculate working days in the date range
  SELECT COUNT(*)
  INTO v_working_days_in_range
  FROM generate_series(p_start_date, p_end_date, '1 day'::interval) AS d
  WHERE EXTRACT(DOW FROM d) NOT IN (0, 6);

  v_surgery_days := v_working_days_in_range * v_number_of_surgeries;

  v_ocpspd := CASE
    WHEN v_surgery_days > 0 THEN v_op_costs / v_surgery_days
    ELSE 0
  END;

  RETURN QUERY
  WITH
  base_providers AS (
    SELECT
      LOWER(COALESCE(NULLIF(TRIM(p.email), ''), p.name)) AS group_key,
      MIN(p.id::TEXT)::UUID AS id,
      MIN(p.name)           AS name,
      COALESCE(
        ARRAY_AGG(DISTINCT p.external_id::TEXT) FILTER (WHERE p.external_id IS NOT NULL),
        ARRAY[]::TEXT[]
      ) AS external_ids
    FROM providers p
    WHERE
      p.is_active = true
      AND p.deleted_at IS NULL
      AND p.organization_id = p_organization_id
      AND (p_provider_type IS NULL OR p.provider_role ILIKE '%' || p_provider_type || '%')
    GROUP BY group_key
  ),
  base_providers_with_settings AS (
    SELECT
      bp.id,
      bp.name,
      bp.external_ids,
      COALESCE(p.associate_split_percentage, 30) AS assoc_split_pct,
      COALESCE(
        CASE
          WHEN p.split_source_method = 'sliding-scale' THEN p.lab_split_percentage_sliding
          ELSE p.lab_split_percentage
        END,
        50
      ) AS lab_split_pct
    FROM base_providers bp
    JOIN providers p ON p.id = bp.id
  ),
  provider_production_data AS (
    SELECT
      bps.id AS provider_id,
      bps.name AS provider_name,
      bps.assoc_split_pct,
      bps.lab_split_pct,
      COALESCE(SUM(prod.total_amount), 0) AS total_amount
    FROM base_providers_with_settings bps
    CROSS JOIN UNNEST(bps.external_ids) AS u(ext_id)
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(total_amount), 0) AS total_amount
      FROM get_provider_net_production_monthly(
        p_organization_id,
        p_start_date,
        p_end_date,
        u.ext_id::INTEGER
      )
    ) AS prod
    GROUP BY bps.id, bps.name, bps.assoc_split_pct, bps.lab_split_pct
  ),
  provider_hours_data AS (
    SELECT
      bps.id AS provider_id,
      COALESCE(SUM(hours.total_hours), 0) AS total_hours
    FROM base_providers_with_settings bps
    CROSS JOIN UNNEST(bps.external_ids) AS u(ext_id)
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(total_hours), 0) AS total_hours
      FROM get_provider_working_hours_monthly(
        p_organization_id,
        p_start_date,
        p_end_date,
        u.ext_id::INTEGER
      )
    ) AS hours
    GROUP BY bps.id
  ),
  profit_metrics AS (
    SELECT
      ppd.provider_id,
      ppd.provider_name,
      ppd.total_amount AS total_production,
      phd.total_hours / v_hours_per_day AS working_days,
      ppd.assoc_split_pct,
      ppd.lab_split_pct,
      ppd.total_amount * (ppd.assoc_split_pct / 100.0) AS assoc_gross_share,
      ppd.total_amount * (v_lab_cost_percent / 100.0)  AS cost_of_labs,
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
      pm.cost_of_labs * (pm.lab_split_pct / 100.0) AS assoc_lab_share,
      pm.assoc_gross_share,
      pm.cost_of_labs,
      pm.materials_costs,
      v_ocpspd * pm.working_days AS ocpspa_contribution
    FROM profit_metrics pm
  ),
  practice_pl_calcs AS (
    SELECT
      fc.provider_id,
      fc.provider_name,
      fc.total_production,
      fc.working_days,
      fc.assoc_gross_share - fc.assoc_lab_share AS associate_net_pay,
      fc.cost_of_labs,
      fc.materials_costs,
      fc.ocpspa_contribution,
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
      CASE
        WHEN plc.working_days > 0 THEN ROUND(plc.practice_pl / plc.working_days, 2)
        ELSE 0
      END AS pl_per_day,
      CASE
        WHEN plc.total_production > 0 THEN ROUND((plc.practice_pl / plc.total_production) * 100, 2)
        ELSE 0
      END AS profit_percent,
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

GRANT EXECUTE ON FUNCTION chart_get_profit_metrics(DATE, DATE, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION chart_get_profit_metrics(DATE, DATE, UUID, TEXT) TO anon;
