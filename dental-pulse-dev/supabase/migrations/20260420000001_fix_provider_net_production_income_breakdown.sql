-- Fix PRIVATE/MEMBERSHIP/NHS breakdown showing wrong amounts in provider net production tooltip.
--
-- Root cause: get_provider_net_production_monthly reads payment plan IDs from
-- organizations.private_income (empty). Switched to practice_locations.private_income_accounts,
-- but a secondary mismatch remained: Dentally has both a global plan (pp_id=2, name="Private")
-- and a site-specific plan (pp_id=2698, name="Private"). The user configured pp_id=2 but TPIs
-- use pp_id=2698.
--
-- Fix: Resolve configured pp_ids → their pp_names → ALL pp_ids sharing that name.
-- This expands "Private" (pp_id=2) to also include "Private" (pp_id=2698), making the
-- breakdown robust against global-vs-site-specific Dentally plan ID mismatches.
--
-- Performance: payment_plans is a small table; the self-join is cheap. TPI scan uses
-- = ANY(bigint[]) which is O(n) on the small array, and CROSS JOIN on 1-row CTEs never
-- multiplies TPI rows.

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
BEGIN
  SET LOCAL statement_timeout = '60s';

  RETURN QUERY
  WITH
  -- Step 1: Read configured pp_ids from practice_locations.
  configured_private AS (
    SELECT jsonb_array_elements_text(pl.private_income_accounts)::bigint AS pp_id
    FROM practice_locations pl
    WHERE pl.organization_id = p_organization_id
      AND pl.deleted_at IS NULL
      AND (p_location_id IS NULL OR pl.id = p_location_id)
      AND pl.private_income_accounts IS NOT NULL
      AND jsonb_array_length(pl.private_income_accounts) > 0
  ),
  configured_membership AS (
    SELECT jsonb_array_elements_text(pl.membership_income_accounts)::bigint AS pp_id
    FROM practice_locations pl
    WHERE pl.organization_id = p_organization_id
      AND pl.deleted_at IS NULL
      AND (p_location_id IS NULL OR pl.id = p_location_id)
      AND pl.membership_income_accounts IS NOT NULL
      AND jsonb_array_length(pl.membership_income_accounts) > 0
  ),
  configured_nhs AS (
    SELECT jsonb_array_elements_text(pl.nhs_income_accounts)::bigint AS pp_id
    FROM practice_locations pl
    WHERE pl.organization_id = p_organization_id
      AND pl.deleted_at IS NULL
      AND (p_location_id IS NULL OR pl.id = p_location_id)
      AND pl.nhs_income_accounts IS NOT NULL
      AND jsonb_array_length(pl.nhs_income_accounts) > 0
  ),
  -- Step 2: Expand each configured ID to all IDs sharing the same plan name.
  -- Handles Dentally global-vs-site plan ID mismatches (e.g., "Private" pp_id=2
  -- configured, but "Private" pp_id=2698 is the one actually used in TPIs).
  private_ids AS (
    SELECT array_agg(DISTINCT pp2.pp_id) AS ids
    FROM configured_private cfg
    JOIN payment_plans pp1 ON pp1.pp_id = cfg.pp_id
      AND pp1.organization_id = p_organization_id
      AND pp1.deleted_at IS NULL
    JOIN payment_plans pp2 ON pp2.pp_name = pp1.pp_name
      AND pp2.organization_id = p_organization_id
      AND pp2.deleted_at IS NULL
  ),
  membership_ids AS (
    SELECT array_agg(DISTINCT pp2.pp_id) AS ids
    FROM configured_membership cfg
    JOIN payment_plans pp1 ON pp1.pp_id = cfg.pp_id
      AND pp1.organization_id = p_organization_id
      AND pp1.deleted_at IS NULL
    JOIN payment_plans pp2 ON pp2.pp_name = pp1.pp_name
      AND pp2.organization_id = p_organization_id
      AND pp2.deleted_at IS NULL
  ),
  nhs_ids AS (
    SELECT array_agg(DISTINCT pp2.pp_id) AS ids
    FROM configured_nhs cfg
    JOIN payment_plans pp1 ON pp1.pp_id = cfg.pp_id
      AND pp1.organization_id = p_organization_id
      AND pp1.deleted_at IS NULL
    JOIN payment_plans pp2 ON pp2.pp_name = pp1.pp_name
      AND pp2.organization_id = p_organization_id
      AND pp2.deleted_at IS NULL
  )
  SELECT
    TO_CHAR(tpi.tpi_completed_at, 'Mon-YY')                                                                     AS month,
    SUM(tpi.tpi_price)                                                                                           AS total_amount,
    SUM(CASE WHEN pri.ids IS NOT NULL AND tpi.tpi_payment_plan_id = ANY(pri.ids) THEN tpi.tpi_price ELSE 0 END) AS private_amount,
    SUM(CASE WHEN mem.ids IS NOT NULL AND tpi.tpi_payment_plan_id = ANY(mem.ids) THEN tpi.tpi_price ELSE 0 END) AS membership_amount,
    SUM(CASE WHEN nhs.ids IS NOT NULL AND tpi.tpi_payment_plan_id = ANY(nhs.ids) THEN tpi.tpi_price ELSE 0 END) AS nhs_amount
  FROM treatment_plan_items tpi
  CROSS JOIN private_ids    pri
  CROSS JOIN membership_ids mem
  CROSS JOIN nhs_ids        nhs
  WHERE tpi.organization_id     = p_organization_id
    AND tpi.tpi_practitioner_id = p_practitioner_id
    AND tpi.tpi_completed_at    IS NOT NULL
    AND tpi.tpi_completed       = true
    AND tpi.tpi_completed_at::DATE BETWEEN p_from_date AND p_to_date
    AND tpi.tpi_price           IS NOT NULL
    AND tpi.tpi_price           <> 0
    AND tpi.deleted_at          IS NULL
    AND (p_location_id IS NULL OR tpi.location_id = p_location_id OR tpi.location_id IS NULL)
  GROUP BY TO_CHAR(tpi.tpi_completed_at, 'Mon-YY'), DATE_TRUNC('month', tpi.tpi_completed_at)
  ORDER BY DATE_TRUNC('month', tpi.tpi_completed_at);
END;
$$;

GRANT EXECUTE ON FUNCTION get_provider_net_production_monthly(UUID, DATE, DATE, INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_provider_net_production_monthly(UUID, DATE, DATE, INTEGER, UUID) TO anon;
