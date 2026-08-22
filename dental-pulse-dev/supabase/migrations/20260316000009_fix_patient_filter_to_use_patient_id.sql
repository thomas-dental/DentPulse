-- Fix appointment filtering: use apmt_patient_id IS NOT NULL instead of apmt_patient_name IS NOT NULL
-- Reason: apmt_patient_id is the reliable identifier; apmt_patient_name can be populated on
-- ghost/stale records that should be excluded, causing over-counting of working hours.
-- This aligns our counts with Dentally's "Appointments Booked" report.
--
-- Affected:
--   1. maintain_appointment_summary()  -- trigger that keeps appointment_summary up to date
--   2. get_provider_working_hours_monthly() -- function used by profit metrics chart
--   3. chart_get_production_metrics()  -- uses apmt_patient_name directly in provider_hours CTE


-- ============================================================
-- 1. maintain_appointment_summary trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION maintain_appointment_summary()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id          UUID;
  v_practitioner_id BIGINT;
  v_month           DATE;
  v_provider_id     UUID;
  v_total_hours     NUMERIC;
  v_count           INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_org_id          := OLD.organization_id;
    v_practitioner_id := OLD.apmt_practitioner_id;
    v_month           := DATE_TRUNC('month', OLD.apmt_start_time)::DATE;
  ELSE
    v_org_id          := NEW.organization_id;
    v_practitioner_id := NEW.apmt_practitioner_id;
    v_month           := DATE_TRUNC('month', NEW.apmt_start_time)::DATE;
  END IF;

  IF v_practitioner_id IS NULL OR v_month IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    COALESCE(ROUND(SUM(apmt_duration) / 60.0, 2), 0),
    COUNT(*)
  INTO v_total_hours, v_count
  FROM appointments
  WHERE organization_id    = v_org_id
    AND apmt_practitioner_id = v_practitioner_id
    AND apmt_state           = 'Completed'
    AND apmt_duration        IS NOT NULL
    AND apmt_patient_id      IS NOT NULL
    AND apmt_start_time      IS NOT NULL
    AND deleted_at           IS NULL
    AND DATE_TRUNC('month', apmt_start_time) = v_month;

  SELECT id INTO v_provider_id
  FROM providers
  WHERE organization_id  = v_org_id
    AND external_id::BIGINT = v_practitioner_id
  LIMIT 1;

  INSERT INTO appointment_summary (
    organization_id, practitioner_id, provider_id, month,
    working_duration_hours, appointment_count
  ) VALUES (
    v_org_id, v_practitioner_id, v_provider_id, v_month,
    v_total_hours, v_count
  )
  ON CONFLICT (organization_id, practitioner_id, month) DO UPDATE SET
    working_duration_hours = EXCLUDED.working_duration_hours,
    appointment_count      = EXCLUDED.appointment_count,
    provider_id            = COALESCE(EXCLUDED.provider_id, appointment_summary.provider_id),
    updated_at             = NOW();

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 2. get_provider_working_hours_monthly
-- ============================================================
CREATE OR REPLACE FUNCTION get_provider_working_hours_monthly(
  p_organization_id UUID,
  p_from_date DATE,
  p_to_date DATE,
  p_practitioner_id INTEGER
)
RETURNS TABLE (
  month TEXT,
  appointment_count BIGINT,
  total_hours NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
  SET LOCAL statement_timeout = '60s';

  RETURN QUERY
  SELECT
    TO_CHAR(DATE_TRUNC('month', apmt_start_time), 'Mon-YY') AS month,
    COUNT(*) AS appointment_count,
    ROUND(SUM(apmt_duration) / 60.0, 1) AS total_hours
  FROM appointments
  WHERE organization_id    = p_organization_id
    AND apmt_practitioner_id = p_practitioner_id
    AND apmt_state           = 'Completed'
    AND apmt_start_time::DATE BETWEEN p_from_date AND p_to_date
    AND apmt_duration        IS NOT NULL
    AND apmt_patient_id      IS NOT NULL
    AND deleted_at           IS NULL
  GROUP BY TO_CHAR(DATE_TRUNC('month', apmt_start_time), 'Mon-YY'), DATE_TRUNC('month', apmt_start_time)
  ORDER BY DATE_TRUNC('month', apmt_start_time);
END;
$$;


-- ============================================================
-- 3. chart_get_production_metrics — fix provider_hours CTE
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
      ON u.ext_id::BIGINT = a.apmt_practitioner_id
      AND a.apmt_state = 'Completed'
      AND a.apmt_start_time IS NOT NULL
      AND a.apmt_start_time BETWEEN p_start_date AND p_end_date
      AND a.apmt_duration IS NOT NULL
      AND a.apmt_patient_id IS NOT NULL
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
-- 4. Backfill appointment_summary with corrected filter
-- ============================================================
INSERT INTO appointment_summary (
  organization_id, practitioner_id, provider_id, month,
  working_duration_hours, appointment_count
)
SELECT
  a.organization_id,
  a.apmt_practitioner_id,
  p.id                                                          AS provider_id,
  DATE_TRUNC('month', a.apmt_start_time)::DATE                 AS month,
  ROUND(SUM(a.apmt_duration) / 60.0, 2)                        AS working_duration_hours,
  COUNT(*)                                                      AS appointment_count
FROM appointments a
LEFT JOIN providers p
  ON  p.organization_id    = a.organization_id
  AND p.external_id::BIGINT = a.apmt_practitioner_id
WHERE a.apmt_state           = 'Completed'
  AND a.apmt_duration        IS NOT NULL
  AND a.apmt_patient_id      IS NOT NULL
  AND a.apmt_start_time      IS NOT NULL
  AND a.apmt_practitioner_id IS NOT NULL
  AND a.deleted_at           IS NULL
GROUP BY
  a.organization_id,
  a.apmt_practitioner_id,
  DATE_TRUNC('month', a.apmt_start_time)::DATE,
  p.id
ON CONFLICT (organization_id, practitioner_id, month) DO UPDATE SET
  working_duration_hours = EXCLUDED.working_duration_hours,
  appointment_count      = EXCLUDED.appointment_count,
  provider_id            = COALESCE(EXCLUDED.provider_id, appointment_summary.provider_id),
  updated_at             = NOW();
