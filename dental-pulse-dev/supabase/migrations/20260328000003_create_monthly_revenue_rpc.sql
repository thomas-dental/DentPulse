-- RPC to aggregate monthly TPI revenue server-side instead of paginating all rows to the client.
-- Used by useEbitdaValuation for the quality score's revenue predictability calculation.

CREATE OR REPLACE FUNCTION get_monthly_revenue(
  _organization_id UUID,
  _start_date DATE,
  _end_date DATE,
  _location_id UUID DEFAULT NULL
)
RETURNS TABLE (
  month TEXT,
  revenue NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '15s'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    TO_CHAR(tpi.tpi_completed_at, 'YYYY-MM') AS month,
    SUM(COALESCE(tpi.tpi_price, 0)) AS revenue
  FROM treatment_plan_items tpi
  WHERE tpi.organization_id = _organization_id
    AND tpi.tpi_completed = true
    AND tpi.deleted_at IS NULL
    AND tpi.tpi_completed_at IS NOT NULL
    AND tpi.tpi_completed_at >= _start_date::TIMESTAMPTZ
    AND tpi.tpi_completed_at < (_end_date::TIMESTAMPTZ + INTERVAL '1 day')
    AND tpi.tpi_price > 0
    AND (_location_id IS NULL OR tpi.location_id = _location_id)
  GROUP BY TO_CHAR(tpi.tpi_completed_at, 'YYYY-MM')
  ORDER BY month;
END;
$$;
