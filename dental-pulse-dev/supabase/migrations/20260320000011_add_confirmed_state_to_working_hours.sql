-- Add 'Confirmed' appointment state to all working hours calculations.
-- Affects three code paths so they stay in sync:
--   1. chart_get_production_metrics          (Overview Ranking)
--   2. get_provider_working_hours_by_location (Profit Goals, specific location)
--   3. maintain_appointment_summary trigger   (Profit Goals, all locations + backfill)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. chart_get_production_metrics
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
      AND (p_location_id IS NULL OR tpi.location_id = p_location_id)
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_provider_working_hours_by_location
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_provider_working_hours_by_location(
  p_organization_id   UUID,
  p_practitioner_ids  BIGINT[],
  p_location_id       UUID,
  p_from_date         DATE,
  p_to_date           DATE
)
RETURNS TABLE (
  practitioner_id        BIGINT,
  month                  DATE,
  working_duration_hours NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    apmt_practitioner_id                          AS practitioner_id,
    DATE_TRUNC('month', apmt_start_time)::DATE    AS month,
    SUM(apmt_duration)::NUMERIC / 60.0            AS working_duration_hours
  FROM appointments
  WHERE organization_id       = p_organization_id
    AND apmt_practitioner_id  = ANY(p_practitioner_ids)
    AND location_id           = p_location_id
    AND apmt_state            IN ('Completed', 'Pending', 'In surgery', 'Confirmed')
    AND apmt_duration         IS NOT NULL
    AND apmt_start_time       IS NOT NULL
    AND deleted_at            IS NULL
    AND apmt_start_time::DATE >= p_from_date
    AND apmt_start_time::DATE <= p_to_date
  GROUP BY
    apmt_practitioner_id,
    DATE_TRUNC('month', apmt_start_time)::DATE
$$;

GRANT EXECUTE ON FUNCTION get_provider_working_hours_by_location TO authenticated;
GRANT EXECUTE ON FUNCTION get_provider_working_hours_by_location TO anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. maintain_appointment_summary trigger
-- ─────────────────────────────────────────────────────────────────────────────
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
  WHERE organization_id      = v_org_id
    AND apmt_practitioner_id = v_practitioner_id
    AND apmt_state           IN ('Completed', 'Pending', 'In surgery', 'Confirmed')
    AND apmt_duration        IS NOT NULL
    AND apmt_start_time      IS NOT NULL
    AND deleted_at           IS NULL
    AND DATE_TRUNC('month', apmt_start_time)::DATE = v_month;

  SELECT id INTO v_provider_id
  FROM providers
  WHERE organization_id    = v_org_id
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Rebuild appointment_summary with the updated 4-state criteria
-- ─────────────────────────────────────────────────────────────────────────────
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
WHERE a.apmt_state            IN ('Completed', 'Pending', 'In surgery', 'Confirmed')
  AND a.apmt_duration         IS NOT NULL
  AND a.apmt_start_time       IS NOT NULL
  AND a.apmt_practitioner_id  IS NOT NULL
  AND a.deleted_at            IS NULL
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

-- Zero out rows where all appointments are now soft-deleted or in other states
UPDATE appointment_summary AS s
SET    working_duration_hours = 0,
       appointment_count      = 0,
       updated_at             = NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM appointments a
  WHERE a.organization_id      = s.organization_id
    AND a.apmt_practitioner_id = s.practitioner_id
    AND a.apmt_state           IN ('Completed', 'Pending', 'In surgery', 'Confirmed')
    AND a.apmt_duration        IS NOT NULL
    AND a.apmt_start_time      IS NOT NULL
    AND a.deleted_at           IS NULL
    AND DATE_TRUNC('month', a.apmt_start_time)::DATE = s.month
);
