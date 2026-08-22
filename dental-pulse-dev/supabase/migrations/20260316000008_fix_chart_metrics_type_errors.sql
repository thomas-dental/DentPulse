-- Fix two bugs from migration 000007:
-- 1. chart_get_profit_metrics: fc.lab_split_pct not in final_calcs output → use fc.assoc_lab_share directly
-- 2. chart_get_production_metrics: text = bigint type mismatch → cast u.ext_id to BIGINT for table joins

-- ============================================================
-- chart_get_production_metrics
-- ============================================================
CREATE OR REPLACE FUNCTION chart_get_production_metrics(
  p_start_date DATE,
  p_end_date DATE,
  p_organization_id UUID,
  p_provider_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  provider_id UUID,
  provider_name TEXT,
  production_amount NUMERIC,
  days_worked NUMERIC,
  avg_daily_production NUMERIC,
  rank INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH
  payment_plan_ids AS (
    SELECT DISTINCT value::TEXT AS plan_id
    FROM organizations o,
         LATERAL (
           SELECT value FROM jsonb_array_elements_text(COALESCE((o.private_income::JSONB)->'selected_account', '[]'::JSONB))
           UNION ALL
           SELECT value FROM jsonb_array_elements_text(COALESCE((o.membership_income::JSONB)->'selected_account', '[]'::JSONB))
           UNION ALL
           SELECT value FROM jsonb_array_elements_text(COALESCE((o.nhs_income::JSONB)->'selected_account', '[]'::JSONB))
         ) AS value
    WHERE o.id = p_organization_id
  ),
  base_providers AS (
    SELECT
      LOWER(COALESCE(NULLIF(TRIM(p.email), ''), p.name)) AS group_key,
      MIN(p.id::TEXT)::UUID AS provider_id,
      MIN(p.name)           AS provider_name,
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
    GROUP BY LOWER(COALESCE(NULLIF(TRIM(p.email), ''), p.name))
  ),
  provider_production AS (
    SELECT
      bp.provider_id,
      COALESCE(SUM(tpi.tpi_price), 0) AS total_production
    FROM base_providers bp
    CROSS JOIN UNNEST(bp.external_ids) AS u(ext_id)
    LEFT JOIN treatment_plan_items tpi
      -- Cast text ext_id to BIGINT to match tpi_practitioner_id column type
      ON u.ext_id::BIGINT = tpi.tpi_practitioner_id
      AND tpi.tpi_completed = true
      AND tpi.tpi_completed_at IS NOT NULL
      AND tpi.tpi_completed_at BETWEEN p_start_date AND p_end_date
      AND tpi.tpi_price IS NOT NULL
      AND tpi.tpi_price <> 0
      AND tpi.deleted_at IS NULL
      AND tpi.organization_id = p_organization_id
      AND tpi.tpi_payment_plan_id::TEXT IN (SELECT plan_id FROM payment_plan_ids)
    GROUP BY bp.provider_id
  ),
  provider_hours AS (
    SELECT
      bp.provider_id,
      COALESCE((SUM(a.apmt_duration)::NUMERIC / 60.0) / 8.0, 0) AS working_days
    FROM base_providers bp
    CROSS JOIN UNNEST(bp.external_ids) AS u(ext_id)
    LEFT JOIN appointments a
      -- Cast text ext_id to BIGINT to match apmt_practitioner_id column type
      ON u.ext_id::BIGINT = a.apmt_practitioner_id
      AND a.apmt_state = 'Completed'
      AND a.apmt_start_time IS NOT NULL
      AND a.apmt_start_time BETWEEN p_start_date AND p_end_date
      AND a.apmt_duration IS NOT NULL
      AND a.apmt_patient_name IS NOT NULL
      AND a.deleted_at IS NULL
      AND a.organization_id = p_organization_id
    GROUP BY bp.provider_id
  ),
  production_data AS (
    SELECT
      bp.provider_id,
      bp.provider_name,
      COALESCE(pp.total_production, 0) AS prod_amount,
      COALESCE(ph.working_days, 0)     AS days_count
    FROM base_providers bp
    LEFT JOIN provider_production pp ON bp.provider_id = pp.provider_id
    LEFT JOIN provider_hours      ph ON bp.provider_id = ph.provider_id
  ),
  ranked_data AS (
    SELECT
      pd.provider_id,
      pd.provider_name,
      pd.prod_amount AS production_amount,
      ROUND(pd.days_count, 2) AS days_worked,
      CASE
        WHEN pd.days_count > 0 THEN ROUND(pd.prod_amount / pd.days_count, 2)
        ELSE 0
      END AS avg_daily_production,
      ROW_NUMBER() OVER (
        ORDER BY CASE WHEN pd.days_count > 0 THEN pd.prod_amount / pd.days_count ELSE 0 END DESC
      )::INTEGER AS rank
    FROM production_data pd
  )
  SELECT rd.provider_id, rd.provider_name, rd.production_amount, rd.days_worked, rd.avg_daily_production, rd.rank
  FROM ranked_data rd
  WHERE rd.production_amount > 0 OR rd.days_worked > 0
  ORDER BY rd.rank;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION chart_get_production_metrics(DATE, DATE, UUID, TEXT) TO authenticated;


-- ============================================================
-- chart_get_profit_metrics
-- ============================================================
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
  SELECT
    COALESCE(practice_cost_materials_percent, 0),
    COALESCE(associate_cost_labs_percent, 0),
    COALESCE(number_of_surgeries, 0)
  INTO v_materials_percent, v_lab_cost_percent, v_number_of_surgeries
  FROM organizations WHERE id = p_organization_id;

  SELECT platform_name INTO v_connected_platform
  FROM platform_integrations
  WHERE organization_id = p_organization_id AND is_connected = true
  ORDER BY updated_at DESC LIMIT 1;

  IF v_connected_platform = 'iplicit' THEN
    SELECT COALESCE(ABS(pl.total_amount), 0) INTO v_op_costs
    FROM get_iplicit_pl_amount_cost_by_date(p_organization_id, p_start_date, p_end_date, 'TC') pl;
  ELSE
    v_op_costs := 0;
  END IF;

  SELECT COUNT(*) INTO v_working_days_in_range
  FROM generate_series(p_start_date, p_end_date, '1 day'::interval) AS d
  WHERE EXTRACT(DOW FROM d) NOT IN (0, 6);

  v_surgery_days := v_working_days_in_range * v_number_of_surgeries;
  v_ocpspd := CASE WHEN v_surgery_days > 0 THEN v_op_costs / v_surgery_days ELSE 0 END;

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
      FROM get_provider_net_production_monthly(p_organization_id, p_start_date, p_end_date, u.ext_id::INTEGER)
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
      FROM get_provider_working_hours_monthly(p_organization_id, p_start_date, p_end_date, u.ext_id::INTEGER)
    ) AS hours
    GROUP BY bps.id
  ),
  profit_metrics AS (
    SELECT
      ppd.provider_id,
      ppd.provider_name,
      ppd.total_amount AS total_production,
      phd.total_hours / 8.0 AS working_days,
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
      pm.assoc_gross_share,
      -- Pre-compute assoc_lab_share here so practice_pl_calcs can reference it directly
      pm.cost_of_labs * (pm.lab_split_pct / 100.0) AS assoc_lab_share,
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
      -- Practice P/L = Production - (Associate Net Pay + Cost of Labs + Materials + OCPSPA)
      fc.total_production - (
        (fc.assoc_gross_share - fc.assoc_lab_share) +
        fc.cost_of_labs +
        fc.materials_costs +
        fc.ocpspa_contribution
      ) AS practice_pl
    FROM final_calcs fc
  ),
  ranked_results AS (
    SELECT
      plc.provider_id,
      plc.provider_name,
      ROUND(plc.practice_pl, 2) AS periodic_profit,
      CASE WHEN plc.working_days > 0 THEN ROUND(plc.practice_pl / plc.working_days, 2) ELSE 0 END AS pl_per_day,
      CASE WHEN plc.total_production > 0 THEN ROUND((plc.practice_pl / plc.total_production) * 100, 2) ELSE 0 END AS profit_percent,
      ROW_NUMBER() OVER (
        ORDER BY CASE WHEN plc.working_days > 0 THEN plc.practice_pl / plc.working_days ELSE 0 END DESC
      )::INTEGER AS rank
    FROM practice_pl_calcs plc
    WHERE plc.total_production > 0 OR plc.working_days > 0
  )
  SELECT rr.provider_id, rr.provider_name, rr.periodic_profit, rr.pl_per_day, rr.profit_percent, rr.rank
  FROM ranked_results rr
  ORDER BY rr.rank;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION chart_get_profit_metrics(DATE, DATE, UUID, TEXT) TO authenticated;
