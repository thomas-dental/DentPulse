-- ============================================================================
-- Migration: Scope chart RPCs by provider.location_id
--
-- Context:
--   chart_get_profit_metrics and chart_get_associate_performance_metrics
--   currently filter production amounts and chair hours by p_location_id,
--   but the provider list itself is org-wide. A provider assigned to
--   location A can still appear (as a £0 row) when a user filters to
--   location B if they happen to have any mis-tagged TPI or appointment.
--
-- Fix:
--   Add AND (p_location_id IS NULL OR p.location_id = p_location_id) to the
--   base provider SELECT in both RPCs, so only providers belonging to the
--   selected location are candidates. p_location_id NULL preserves the
--   existing "All Regions" behaviour (every active provider in the org).
--
-- Behaviour note:
--   This matches the intent of the top-bar location filter: the charts
--   should show only the practitioners who work at the selected location.
--   Providers without a location_id are still excluded when a location is
--   picked — which is the safe default given our data already has 0 NULLs
--   across practitioners.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) chart_get_profit_metrics
--    Re-create with the same body as 20260324000001 but add the provider
--    location filter inside base_providers.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION chart_get_profit_metrics(
  p_start_date      DATE,
  p_end_date        DATE,
  p_organization_id UUID,
  p_provider_type   TEXT DEFAULT NULL,
  p_location_id     UUID DEFAULT NULL
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
  v_materials_percent     NUMERIC;
  v_lab_cost_percent      NUMERIC;
  v_op_costs              NUMERIC;
  v_number_of_surgeries   INTEGER;
  v_working_days_in_range INTEGER;
  v_surgery_days          NUMERIC;
  v_ocpspd                NUMERIC;
  v_connected_platform    VARCHAR;
  v_hours_per_day         NUMERIC;
  v_legal_entity_id       VARCHAR;
  v_location_has_mapping  BOOLEAN := FALSE;
BEGIN
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

  SELECT platform_name INTO v_connected_platform
  FROM platform_integrations
  WHERE organization_id = p_organization_id
    AND is_connected = true
  ORDER BY updated_at DESC
  LIMIT 1;

  IF p_location_id IS NOT NULL THEN
    SELECT pio.platform_org_id
    INTO v_legal_entity_id
    FROM platform_integration_organization_mapping piom
    JOIN platform_integration_organizations pio
      ON pio.id = piom.platform_integration_organizations_id
    WHERE piom.location_id     = p_location_id
      AND piom.organization_id = p_organization_id
      AND pio.platform_name    = 'iplicit'
    LIMIT 1;

    v_location_has_mapping := FOUND;
  END IF;

  IF p_location_id IS NOT NULL AND NOT v_location_has_mapping THEN
    v_op_costs := 0;
  ELSIF v_connected_platform = 'iplicit' THEN
    SELECT COALESCE(ABS(pl.total_amount), 0)
    INTO v_op_costs
    FROM get_iplicit_pl_amount_cost_by_date(
      p_organization_id,
      p_start_date,
      p_end_date,
      'TC',
      v_legal_entity_id
    ) pl;
  ELSE
    v_op_costs := 0;
  END IF;

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
      -- NEW: scope provider list to selected location. NULL = All Regions
      --      (keeps the historical behaviour for the unfiltered view).
      AND (p_location_id IS NULL OR p.location_id = p_location_id)
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
        u.ext_id::INTEGER,
        p_location_id
      )
    ) AS prod
    GROUP BY bps.id, bps.name, bps.assoc_split_pct, bps.lab_split_pct
  ),
  provider_hours_data AS (
    SELECT
      bps.id AS provider_id,
      COALESCE(SUM(a.apmt_duration), 0)::NUMERIC / 60.0 AS total_hours
    FROM base_providers_with_settings bps
    CROSS JOIN UNNEST(bps.external_ids) AS u(ext_id)
    LEFT JOIN appointments a
      ON a.apmt_practitioner_id = u.ext_id::BIGINT
      AND a.organization_id = p_organization_id
      AND a.apmt_state IN ('Completed', 'Pending', 'In surgery', 'Confirmed')
      AND a.apmt_start_time::DATE BETWEEN p_start_date AND p_end_date
      AND a.apmt_duration IS NOT NULL
      AND a.apmt_patient_id IS NOT NULL
      AND a.deleted_at IS NULL
      AND (p_location_id IS NULL OR a.location_id = p_location_id)
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

GRANT EXECUTE ON FUNCTION chart_get_profit_metrics(DATE, DATE, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION chart_get_profit_metrics(DATE, DATE, UUID, TEXT, UUID) TO anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) chart_get_associate_performance_metrics
--    Re-create with the same body as 20260324000004 but add the provider
--    location filter inside base_providers_with_planning.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION chart_get_associate_performance_metrics(
  p_start_date      DATE,
  p_end_date        DATE,
  p_organization_id UUID,
  p_provider_type   TEXT DEFAULT NULL,
  p_location_id     UUID DEFAULT NULL
)
RETURNS TABLE (
  provider_id                   UUID,
  provider_name                 TEXT,
  daily_production              NUMERIC,
  planning_avg_daily_production NUMERIC,
  target_gap                    NUMERIC,
  performance_percent           NUMERIC,
  rank                          INTEGER
) AS $$
DECLARE
  v_hours_per_day NUMERIC;
BEGIN
  SELECT COALESCE(NULLIF(open_hours_per_day, 0), 8)
  INTO   v_hours_per_day
  FROM   organizations
  WHERE  id = p_organization_id;

  IF v_hours_per_day IS NULL THEN v_hours_per_day := 8; END IF;

  RETURN QUERY
  WITH
  base_providers_with_planning AS (
    SELECT
      grp.id,
      grp.name,
      grp.external_ids,
      COALESCE(latest_pdp.average_daily_production, 0) AS planning_target
    FROM (
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
        p.is_active            = true
        AND p.deleted_at       IS NULL
        AND p.organization_id  = p_organization_id
        AND (p_provider_type IS NULL OR p.provider_role ILIKE '%' || p_provider_type || '%')
        -- NEW: scope provider list to selected location.
        AND (p_location_id IS NULL OR p.location_id = p_location_id)
      GROUP BY group_key
    ) grp
    LEFT JOIN LATERAL (
      SELECT average_daily_production
      FROM planned_daily_production pdp
      WHERE pdp.provider_id     = grp.id
        AND pdp.organization_id = p_organization_id
      ORDER BY pdp.created_at DESC
      LIMIT 1
    ) latest_pdp ON true
  ),
  provider_metrics_raw AS (
    SELECT
      bp.id              AS provider_id,
      bp.name            AS provider_name,
      bp.planning_target,
      COALESCE(SUM(prod.total_amount), 0) AS total_amount,
      COALESCE(SUM(hours.total_hours), 0) AS total_hours
    FROM base_providers_with_planning bp
    CROSS JOIN UNNEST(bp.external_ids) AS u(ext_id)
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(total_amount), 0) AS total_amount
      FROM get_provider_net_production_monthly(
        p_organization_id, p_start_date, p_end_date, u.ext_id::INTEGER, p_location_id
      )
    ) AS prod
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(a.apmt_duration), 0)::NUMERIC / 60.0 AS total_hours
      FROM appointments a
      WHERE a.apmt_practitioner_id = u.ext_id::BIGINT
        AND a.organization_id      = p_organization_id
        AND a.apmt_state           IN ('Completed', 'Pending', 'In surgery', 'Confirmed')
        AND a.apmt_start_time::DATE BETWEEN p_start_date AND p_end_date
        AND a.apmt_duration        IS NOT NULL
        AND a.apmt_patient_id      IS NOT NULL
        AND a.deleted_at           IS NULL
        AND (p_location_id IS NULL OR a.location_id = p_location_id)
    ) AS hours
    GROUP BY bp.id, bp.name, bp.planning_target
  ),
  provider_metrics_data AS (
    SELECT * FROM provider_metrics_raw
    WHERE total_amount > 0 OR total_hours > 0
  )
  SELECT
    pmd.provider_id,
    pmd.provider_name,
    ROUND(
      CASE WHEN pmd.total_hours > 0
        THEN pmd.total_amount / (pmd.total_hours / v_hours_per_day)
        ELSE 0
      END, 2
    ) AS daily_production,
    pmd.planning_target AS planning_avg_daily_production,
    ROUND(
      CASE WHEN pmd.total_hours > 0
        THEN pmd.total_amount / (pmd.total_hours / v_hours_per_day)
        ELSE 0
      END - pmd.planning_target, 2
    ) AS target_gap,
    CASE
      WHEN pmd.planning_target > 0 AND pmd.total_hours > 0 THEN
        ROUND((pmd.total_amount / (pmd.total_hours / v_hours_per_day) / pmd.planning_target) * 100, 0)
      ELSE NULL
    END AS performance_percent,
    ROW_NUMBER() OVER (
      ORDER BY
        CASE WHEN pmd.planning_target > 0 AND pmd.total_hours > 0 THEN
          (pmd.total_amount / (pmd.total_hours / v_hours_per_day) / pmd.planning_target) * 100
        ELSE 0 END DESC
    )::INTEGER AS rank
  FROM provider_metrics_data pmd
  ORDER BY rank;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION chart_get_associate_performance_metrics(DATE, DATE, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION chart_get_associate_performance_metrics(DATE, DATE, UUID, TEXT, UUID) TO anon;
