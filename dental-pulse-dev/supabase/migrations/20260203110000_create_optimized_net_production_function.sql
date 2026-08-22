-- Create optimized function for net production reporting
-- Simplified query with only essential fields for better performance

CREATE OR REPLACE FUNCTION get_provider_net_production(
  p_organization_id UUID,
  p_from_date DATE,
  p_to_date DATE,
  p_practitioner_id INTEGER
)
RETURNS TABLE (
  completed_date DATE,
  price NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
  -- Increase statement timeout for large date ranges
  SET LOCAL statement_timeout = '60s';

  RETURN QUERY
  SELECT
    tpi.tpi_completed_at::DATE AS completed_date,
    tpi.tpi_price AS price
  FROM treatment_plan_items tpi
  WHERE tpi.organization_id = p_organization_id
    AND tpi.tpi_practitioner_id = p_practitioner_id
    AND tpi.tpi_completed_at IS NOT NULL
    AND tpi.tpi_completed = true
    AND tpi.tpi_completed_at::DATE BETWEEN p_from_date AND p_to_date
    AND tpi.tpi_price IS NOT NULL
    AND tpi.tpi_price <> 0
  ORDER BY tpi.tpi_completed_at::DATE;
END;
$$;

-- Create composite index for optimal query performance
CREATE INDEX IF NOT EXISTS idx_tpi_net_production
  ON treatment_plan_items(organization_id, tpi_practitioner_id, tpi_completed_at, tpi_completed, tpi_price)
  WHERE tpi_completed = true AND tpi_price IS NOT NULL AND tpi_price <> 0;

COMMENT ON FUNCTION get_provider_net_production IS
'Optimized function for net production reporting. Returns only essential fields (date and price) for fast aggregation.';
