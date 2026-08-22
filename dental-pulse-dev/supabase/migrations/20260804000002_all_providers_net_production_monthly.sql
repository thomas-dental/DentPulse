-- ============================================================================
-- get_all_providers_net_production_monthly: ONE call for every provider.
--
-- Why: the frontend (fetchAllProvidersNetProduction) calls
-- get_provider_net_production_monthly once PER PRACTITIONER — 100+ RPC round
-- trips per page load on orgs with many providers, each one re-scanning
-- treatment_plan_items. Provider Insights / Treatment Insights render slowly
-- and, under parallel load, calls time out. This function returns the same
-- figures for ALL practitioners in a single scan, grouped by practitioner and
-- month; the frontend groups rows by provider email client-side exactly as
-- before and falls back to the per-practitioner RPC when this function is
-- not yet deployed.
--
-- The TPI rules MIRROR 20260715000003_provider_net_production_org_wide_private_plans
-- EXACTLY (charting gate via tpi_treatment_appointment_id, Europe/London
-- completed dates, price NOT NULL / <> 0, org-wide private plan vocabulary
-- expanded by plan name, TPI-level location filter with NULL fallback).
-- Membership / NHS amounts mirror its provider_income_ids CTE: accounting
-- P&L rows for the provider's mapped account ids, provider row resolved with
-- the same optional location filter. Any behavioural change here MUST be made
-- in BOTH functions.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_all_providers_net_production_monthly(
  p_organization_id  UUID,
  p_from_date        DATE,
  p_to_date          DATE,
  p_location_id      UUID DEFAULT NULL
)
RETURNS TABLE (
  practitioner_id    INTEGER,
  month              TEXT,
  total_amount       NUMERIC,
  private_amount     NUMERIC,
  membership_amount  NUMERIC,
  nhs_amount         NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
  SET LOCAL statement_timeout = '120s';

  RETURN QUERY
  WITH
  -- One row per external_id with the provider's accounting account ids.
  -- DISTINCT ON mirrors the per-practitioner function's LIMIT 1.
  providers_in_scope AS (
    SELECT DISTINCT ON (p.external_id)
      p.external_id::INTEGER          AS ext_id,
      NULLIF(p.membership_income, '') AS membership_id,
      NULLIF(p.nhs_income,        '') AS nhs_id
    FROM providers p
    WHERE p.organization_id = p_organization_id
      AND p.deleted_at      IS NULL
      AND p.external_id     IS NOT NULL
      AND (p_location_id IS NULL OR p.location_id = p_location_id)
    ORDER BY p.external_id
  ),

  -- Org-wide private plan vocabulary (deliberately NOT location-scoped) —
  -- identical to the per-practitioner function.
  configured_private AS (
    SELECT jsonb_array_elements_text(pl.provider_private_income_accounts)::bigint AS pp_id
    FROM practice_locations pl
    WHERE pl.organization_id = p_organization_id
      AND pl.deleted_at IS NULL
      AND pl.provider_private_income_accounts IS NOT NULL
      AND jsonb_array_length(pl.provider_private_income_accounts) > 0
  ),
  private_ids AS (
    SELECT array_agg(DISTINCT pp2.pp_id) AS ids
    FROM configured_private cfg
    JOIN payment_plans pp1 ON pp1.pp_id          = cfg.pp_id
      AND pp1.organization_id = p_organization_id
      AND pp1.deleted_at      IS NULL
    JOIN payment_plans pp2 ON pp2.pp_name        = pp1.pp_name
      AND pp2.organization_id = p_organization_id
      AND pp2.deleted_at      IS NULL
  ),

  -- TPI aggregates for EVERY practitioner in one scan. Not restricted to
  -- providers_in_scope: the per-practitioner path runs for every external_id
  -- the frontend passes regardless of provider location; the frontend keeps
  -- only the practitioners it knows about.
  tpi_rows AS (
    SELECT
      tpi.tpi_practitioner_id::INTEGER                                                                             AS ext_id,
      TO_CHAR(tpi.tpi_completed_at AT TIME ZONE 'Europe/London', 'Mon-YY')                                         AS mon,
      SUM(tpi.tpi_price)                                                                                           AS tot,
      SUM(CASE WHEN pri.ids IS NOT NULL AND tpi.tpi_payment_plan_id = ANY(pri.ids) THEN tpi.tpi_price ELSE 0 END)  AS priv
    FROM treatment_plan_items tpi
    CROSS JOIN private_ids pri
    WHERE tpi.organization_id       = p_organization_id
      AND tpi.tpi_practitioner_id   IS NOT NULL
      AND tpi.tpi_completed_at      IS NOT NULL
      AND tpi.tpi_completed         = true
      AND (tpi.tpi_completed_at AT TIME ZONE 'Europe/London')::DATE BETWEEN p_from_date AND p_to_date
      AND tpi.tpi_price             IS NOT NULL
      AND tpi.tpi_price             <> 0
      AND tpi.deleted_at            IS NULL
      AND tpi.tpi_treatment_appointment_id IS NOT NULL
      AND (p_location_id IS NULL OR tpi.location_id = p_location_id OR tpi.location_id IS NULL)
    GROUP BY 1, 2
  ),

  membership_rows AS (
    SELECT ps.ext_id, TO_CHAR(pl.from_date, 'Mon-YY') AS mon, SUM(pl.amount) AS amt
    FROM xero_profit_loss pl
    JOIN providers_in_scope ps ON pl.xero_account_id = ps.membership_id
    WHERE pl.organization_id = p_organization_id
      AND pl.from_date >= p_from_date
      AND pl.from_date <= p_to_date
    GROUP BY 1, 2

    UNION ALL

    SELECT ps.ext_id, TO_CHAR(pl.period_date, 'Mon-YY') AS mon, SUM(pl.amount) AS amt
    FROM iplicit_profit_loss pl
    JOIN providers_in_scope ps ON pl.account_id = ps.membership_id
    WHERE pl.organization_id   = p_organization_id
      AND pl.period_date::DATE >= p_from_date
      AND pl.period_date::DATE <= p_to_date
    GROUP BY 1, 2
  ),
  membership_agg AS (
    SELECT mr.ext_id, mr.mon, SUM(mr.amt) AS amt FROM membership_rows mr GROUP BY 1, 2
  ),

  nhs_rows AS (
    SELECT ps.ext_id, TO_CHAR(pl.from_date, 'Mon-YY') AS mon, SUM(pl.amount) AS amt
    FROM xero_profit_loss pl
    JOIN providers_in_scope ps ON pl.xero_account_id = ps.nhs_id
    WHERE pl.organization_id = p_organization_id
      AND pl.from_date >= p_from_date
      AND pl.from_date <= p_to_date
    GROUP BY 1, 2

    UNION ALL

    SELECT ps.ext_id, TO_CHAR(pl.period_date, 'Mon-YY') AS mon, SUM(pl.amount) AS amt
    FROM iplicit_profit_loss pl
    JOIN providers_in_scope ps ON pl.account_id = ps.nhs_id
    WHERE pl.organization_id   = p_organization_id
      AND pl.period_date::DATE >= p_from_date
      AND pl.period_date::DATE <= p_to_date
    GROUP BY 1, 2
  ),
  nhs_agg AS (
    SELECT nr.ext_id, nr.mon, SUM(nr.amt) AS amt FROM nhs_rows nr GROUP BY 1, 2
  ),

  all_keys AS (
    SELECT tr.ext_id, tr.mon FROM tpi_rows tr
    UNION
    SELECT ma.ext_id, ma.mon FROM membership_agg ma
    UNION
    SELECT na.ext_id, na.mon FROM nhs_agg na
  )

  SELECT
    k.ext_id,
    k.mon,
    COALESCE(t.tot,  0),
    COALESCE(t.priv, 0),
    COALESCE(m.amt,  0),
    COALESCE(n.amt,  0)
  FROM all_keys k
  LEFT JOIN tpi_rows       t ON t.ext_id = k.ext_id AND t.mon = k.mon
  LEFT JOIN membership_agg m ON m.ext_id = k.ext_id AND m.mon = k.mon
  LEFT JOIN nhs_agg        n ON n.ext_id = k.ext_id AND n.mon = k.mon;
END;
$$;

GRANT EXECUTE ON FUNCTION get_all_providers_net_production_monthly(UUID, DATE, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_providers_net_production_monthly(UUID, DATE, DATE, UUID) TO anon;
