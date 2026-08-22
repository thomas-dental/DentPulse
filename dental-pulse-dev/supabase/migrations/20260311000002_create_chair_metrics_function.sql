-- RPC function to calculate chair metrics per location
-- Uses completed appointments (current sync data) and paid invoices

CREATE OR REPLACE FUNCTION get_chair_metrics(
  _organization_id UUID,
  _start_date DATE,
  _end_date DATE,
  _prev_start_date DATE,
  _prev_end_date DATE
)
RETURNS TABLE (
  location_id UUID,
  location_name TEXT,
  chairs_count INTEGER,
  completed_hours NUMERIC,
  appointment_count BIGINT,
  available_hours NUMERIC,
  occupancy_pct NUMERIC,
  utilisation_pct NUMERIC,
  revenue NUMERIC,
  revenue_per_chair NUMERIC,
  prev_revenue_per_chair NUMERIC,
  trend_pct NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _working_days INTEGER;
  _prev_working_days INTEGER;
BEGIN
  -- Count weekdays (Mon-Fri) in current period
  SELECT COUNT(*)::INTEGER INTO _working_days
  FROM generate_series(_start_date, _end_date - INTERVAL '1 day', '1 day') d
  WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5;

  -- Count weekdays in previous period
  SELECT COUNT(*)::INTEGER INTO _prev_working_days
  FROM generate_series(_prev_start_date, _prev_end_date - INTERVAL '1 day', '1 day') d
  WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5;

  RETURN QUERY
  WITH loc AS (
    SELECT
      pl.id AS loc_id,
      pl.location_name AS loc_name,
      COALESCE(pl.chairs_count, 0) AS loc_chairs,
      pl.operating_hours AS loc_hours
    FROM practice_locations pl
    WHERE pl.organization_id = _organization_id
      AND pl.deleted_at IS NULL
      AND pl.is_active = true
  ),
  -- Calculate working hours per day from operating_hours JSON
  -- Default 8 hours if not set
  loc_daily_hours AS (
    SELECT
      l.loc_id,
      l.loc_name,
      l.loc_chairs,
      CASE
        WHEN l.loc_hours IS NOT NULL THEN
          COALESCE((
            SELECT AVG(
              EXTRACT(EPOCH FROM (
                (entry.value->>'close')::TIME - (entry.value->>'open')::TIME
              )) / 3600.0
            )
            FROM jsonb_each(l.loc_hours::jsonb) AS entry
            WHERE entry.value->>'open' IS NOT NULL
              AND entry.value->>'close' IS NOT NULL
          ), 8)
        ELSE 8
      END AS daily_hours
    FROM loc l
  ),
  -- Current period: completed appointment hours per location
  apmt_current AS (
    SELECT
      a.location_id AS loc_id,
      SUM(a.apmt_duration) / 60.0 AS total_hours,
      COUNT(*) AS total_count
    FROM appointments a
    WHERE a.organization_id = _organization_id
      AND a.apmt_state = 'Completed'
      AND a.apmt_start_time >= _start_date::TIMESTAMPTZ
      AND a.apmt_start_time <= (_end_date)::TIMESTAMPTZ
      AND a.apmt_duration IS NOT NULL
      AND a.deleted_at IS NULL
    GROUP BY a.location_id
  ),
  -- Current period: paid invoice revenue per location
  -- paid_date is DATE column, params are DATE — compare directly
  rev_current AS (
    SELECT
      i.location_id AS loc_id,
      SUM(COALESCE(i.total_amount, 0)) AS total_revenue
    FROM platform_integration_invoices i
    WHERE i.organization_id = _organization_id
      AND i.is_paid = true
      AND i.paid_date >= _start_date
      AND i.paid_date <= _end_date
      AND i.deleted_at IS NULL
    GROUP BY i.location_id
  ),
  -- Previous period: paid invoice revenue per location (for trend)
  rev_prev AS (
    SELECT
      i.location_id AS loc_id,
      SUM(COALESCE(i.total_amount, 0)) AS total_revenue
    FROM platform_integration_invoices i
    WHERE i.organization_id = _organization_id
      AND i.is_paid = true
      AND i.paid_date >= _prev_start_date
      AND i.paid_date < _prev_end_date
      AND i.deleted_at IS NULL
    GROUP BY i.location_id
  )
  SELECT
    ldh.loc_id AS location_id,
    ldh.loc_name::TEXT AS location_name,
    ldh.loc_chairs::INTEGER AS chairs_count,
    COALESCE(ac.total_hours, 0) AS completed_hours,
    COALESCE(ac.total_count, 0) AS appointment_count,
    -- Available hours = chairs × daily_hours × working_days
    (ldh.loc_chairs * ldh.daily_hours * _working_days) AS available_hours,
    -- Occupancy % = completed hours / available hours
    CASE
      WHEN ldh.loc_chairs > 0 AND (ldh.loc_chairs * ldh.daily_hours * _working_days) > 0
      THEN ROUND(COALESCE(ac.total_hours, 0) / (ldh.loc_chairs * ldh.daily_hours * _working_days) * 100, 1)
      ELSE 0
    END AS occupancy_pct,
    -- Utilisation % = same as occupancy with completed-only data
    -- Once all states are synced, this will differ (completed / booked)
    CASE
      WHEN ldh.loc_chairs > 0 AND (ldh.loc_chairs * ldh.daily_hours * _working_days) > 0
      THEN ROUND(COALESCE(ac.total_hours, 0) / (ldh.loc_chairs * ldh.daily_hours * _working_days) * 100, 1)
      ELSE 0
    END AS utilisation_pct,
    COALESCE(rc.total_revenue, 0) AS revenue,
    -- Revenue per chair
    CASE
      WHEN ldh.loc_chairs > 0
      THEN ROUND(COALESCE(rc.total_revenue, 0) / ldh.loc_chairs, 0)
      ELSE 0
    END AS revenue_per_chair,
    -- Previous period revenue per chair
    CASE
      WHEN ldh.loc_chairs > 0
      THEN ROUND(COALESCE(rp.total_revenue, 0) / ldh.loc_chairs, 0)
      ELSE 0
    END AS prev_revenue_per_chair,
    -- Trend % = ((current - previous) / previous) × 100
    CASE
      WHEN ldh.loc_chairs > 0 AND COALESCE(rp.total_revenue, 0) > 0
      THEN ROUND(
        (COALESCE(rc.total_revenue, 0) - COALESCE(rp.total_revenue, 0))
        / COALESCE(rp.total_revenue, 0) * 100, 1
      )
      ELSE 0
    END AS trend_pct
  FROM loc_daily_hours ldh
  LEFT JOIN apmt_current ac ON ac.loc_id = ldh.loc_id
  LEFT JOIN rev_current rc ON rc.loc_id = ldh.loc_id
  LEFT JOIN rev_prev rp ON rp.loc_id = ldh.loc_id
  ORDER BY ldh.loc_name;
END;
$$;
