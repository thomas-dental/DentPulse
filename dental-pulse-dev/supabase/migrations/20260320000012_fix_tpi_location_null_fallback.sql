-- Fix production showing £0 for single-location orgs where TPI records have
-- location_id = NULL (not set in Dentally sync).
--
-- Root cause: migrations 000001 and 000007 added location filters:
--   AND (p_location_id IS NULL OR tpi.location_id = p_location_id)
-- When a specific location is selected (even the only location in the org),
-- TPI records with location_id = NULL are excluded → £0 production.
--
-- Fix: treat NULL location_id TPIs as "unscoped" — include them in all location views.
--   AND (p_location_id IS NULL OR tpi.location_id = p_location_id OR tpi.location_id IS NULL)
--
-- Affects:
--   1. get_provider_net_production_monthly  (Production Data tab, Profit Goals)
--   2. chart_get_production_metrics          (Overview Ranking)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. get_provider_net_production_monthly
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_provider_net_production_monthly(
  p_organization_id  UUID,
  p_from_date        DATE,
  p_to_date          DATE,
  p_practitioner_id  INTEGER,
  p_location_id      UUID DEFAULT NULL
)
RETURNS TABLE (
  month              TEXT,
  total_amount       NUMERIC,
  private_amount     NUMERIC,
  membership_amount  NUMERIC,
  nhs_amount         NUMERIC
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_private_accounts    TEXT[];
  v_membership_accounts TEXT[];
  v_nhs_accounts        TEXT[];
  v_org_record          RECORD;
BEGIN
  SET LOCAL statement_timeout = '60s';

  SELECT private_income, membership_income, nhs_income
  INTO v_org_record
  FROM organizations
  WHERE id = p_organization_id;

  IF v_org_record.private_income IS NOT NULL AND v_org_record.private_income != '' THEN
    SELECT array_agg(value::TEXT)
    INTO v_private_accounts
    FROM jsonb_array_elements_text((v_org_record.private_income::JSONB)->'selected_account');
  END IF;

  IF v_org_record.membership_income IS NOT NULL AND v_org_record.membership_income != '' THEN
    SELECT array_agg(value::TEXT)
    INTO v_membership_accounts
    FROM jsonb_array_elements_text((v_org_record.membership_income::JSONB)->'selected_account');
  END IF;

  IF v_org_record.nhs_income IS NOT NULL AND v_org_record.nhs_income != '' THEN
    SELECT array_agg(value::TEXT)
    INTO v_nhs_accounts
    FROM jsonb_array_elements_text((v_org_record.nhs_income::JSONB)->'selected_account');
  END IF;

  RETURN QUERY
  SELECT
    TO_CHAR(tpi.tpi_completed_at, 'Mon-YY') AS month,
    SUM(tpi.tpi_price) AS total_amount,
    SUM(CASE WHEN v_private_accounts IS NOT NULL AND tpi.tpi_payment_plan_id::TEXT = ANY(v_private_accounts)    THEN tpi.tpi_price ELSE 0 END) AS private_amount,
    SUM(CASE WHEN v_membership_accounts IS NOT NULL AND tpi.tpi_payment_plan_id::TEXT = ANY(v_membership_accounts) THEN tpi.tpi_price ELSE 0 END) AS membership_amount,
    SUM(CASE WHEN v_nhs_accounts IS NOT NULL AND tpi.tpi_payment_plan_id::TEXT = ANY(v_nhs_accounts)           THEN tpi.tpi_price ELSE 0 END) AS nhs_amount
  FROM treatment_plan_items tpi
  WHERE tpi.organization_id      = p_organization_id
    AND tpi.tpi_practitioner_id  = p_practitioner_id
    AND tpi.tpi_completed_at     IS NOT NULL
    AND tpi.tpi_completed        = true
    AND tpi.tpi_completed_at::DATE BETWEEN p_from_date AND p_to_date
    AND tpi.tpi_price            IS NOT NULL
    AND tpi.tpi_price            <> 0
    AND tpi.deleted_at           IS NULL
    AND (p_location_id IS NULL OR tpi.location_id = p_location_id OR tpi.location_id IS NULL)
  GROUP BY TO_CHAR(tpi.tpi_completed_at, 'Mon-YY'), DATE_TRUNC('month', tpi.tpi_completed_at)
  ORDER BY DATE_TRUNC('month', tpi.tpi_completed_at);
END;
$$;

GRANT EXECUTE ON FUNCTION get_provider_net_production_monthly(UUID, DATE, DATE, INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_provider_net_production_monthly(UUID, DATE, DATE, INTEGER, UUID) TO anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. chart_get_production_metrics
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION chart_get_production_metrics(
  p_start_date      DATE,
  p_end_date        DATE,
  p_organization_id UUID,
  p_provider_type   TEXT DEFAULT NULL,
  p_location_id     UUID DEFAULT NULL
)
RETURNS TABLE (
  provider_id          UUID,
  provider_name        TEXT,
  production_amount    NUMERIC,
  days_worked          NUMERIC,
  avg_daily_production NUMERIC,
  rank                 INTEGER
) AS $$
DECLARE
  v_hours_per_day NUMERIC;
BEGIN
  SELECT COALESCE(NULLIF(open_hours_per_day, 0), 8)
  INTO   v_hours_per_day
  FROM   organizations
  WHERE  id = p_organization_id;

  IF v_hours_per_day IS NULL THEN
    v_hours_per_day := 8;
  END IF;

  RETURN QUERY
  WITH
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
      ON u.ext_id::BIGINT = tpi.tpi_practitioner_id
      AND tpi.tpi_completed = true
      AND tpi.tpi_completed_at IS NOT NULL
      AND tpi.tpi_completed_at::DATE BETWEEN p_start_date AND p_end_date
      AND tpi.tpi_price IS NOT NULL
      AND tpi.tpi_price <> 0
      AND tpi.deleted_at IS NULL
      AND tpi.organization_id = p_organization_id
      AND (p_location_id IS NULL OR tpi.location_id = p_location_id OR tpi.location_id IS NULL)
    GROUP BY bp.provider_id
  ),
  provider_hours AS (
    SELECT
      bp.provider_id,
      COALESCE((SUM(a.apmt_duration)::NUMERIC / 60.0) / v_hours_per_day, 0) AS working_days
    FROM base_providers bp
    CROSS JOIN UNNEST(bp.external_ids) AS u(ext_id)
    LEFT JOIN appointments a
      ON u.ext_id::BIGINT = a.apmt_practitioner_id
      AND a.apmt_state IN ('Completed', 'Pending', 'In surgery', 'Confirmed')
      AND a.apmt_start_time IS NOT NULL
      AND a.apmt_start_time::DATE BETWEEN p_start_date AND p_end_date
      AND a.apmt_duration IS NOT NULL
      AND a.deleted_at IS NULL
      AND a.organization_id = p_organization_id
      AND (p_location_id IS NULL OR a.location_id = p_location_id)
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

GRANT EXECUTE ON FUNCTION chart_get_production_metrics(DATE, DATE, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION chart_get_production_metrics(DATE, DATE, UUID, TEXT, UUID) TO anon;
