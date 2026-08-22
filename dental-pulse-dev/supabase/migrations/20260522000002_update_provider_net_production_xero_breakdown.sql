-- ============================================================================
-- Update get_provider_net_production_monthly
--
-- Private breakdown:
--   Was: practice_locations.private_income_accounts  (Revenue Income)
--   Now: practice_locations.provider_private_income_accounts  (Provider Income)
--
-- Membership / NHS breakdown:
--   Was: payment plan IDs (PMS side)
--   Now: SUM from accounting platform P&L table using the native account ID
--        stored in providers.membership_income / providers.nhs_income.
--        Set via Provider edit → Revenue Sources dropdowns, which are filtered
--        to show only accounts in practice_locations.provider_membership/nhs_income_accounts.
--
-- Native ID storage (stored directly — no UUID join needed):
--   Xero    → providers.membership_income = xero_chart_of_accounts.xero_account_id
--             → matched against xero_profit_loss.xero_account_id
--   Iplicit → providers.membership_income = iplicit_chart_of_accounts.account_id
--             → matched against iplicit_profit_loss.account_id
--   QBO     → not yet implemented (quickbooks_profit_loss Phase-3)
--
-- UNION ALL approach: only the matching platform branch returns data since
-- native IDs are platform-specific (Xero GUIDs ≠ Iplicit account IDs).
-- ============================================================================

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
  -- ── Provider's native accounting account IDs ───────────────────────────────
  provider_income_ids AS (
    SELECT
      NULLIF(p.membership_income, '') AS membership_id,
      NULLIF(p.nhs_income,        '') AS nhs_id
    FROM providers p
    WHERE p.external_id::INTEGER = p_practitioner_id
      AND p.organization_id      = p_organization_id
      AND p.deleted_at           IS NULL
      AND (p_location_id IS NULL OR p.location_id = p_location_id)
    LIMIT 1
  ),

  -- ── Monthly Membership amounts — UNION all supported platforms ─────────────
  -- Only one branch will return data since native IDs are platform-specific.
  membership_monthly_raw AS (
    -- Xero: membership_income = xero_account_id
    SELECT TO_CHAR(pl.from_date, 'Mon-YY') AS month, SUM(pl.amount) AS amount
    FROM xero_profit_loss pl
    CROSS JOIN provider_income_ids pic
    WHERE pl.organization_id = p_organization_id
      AND pl.xero_account_id = pic.membership_id
      AND pl.from_date       >= p_from_date
      AND pl.from_date       <= p_to_date
    GROUP BY TO_CHAR(pl.from_date, 'Mon-YY')

    UNION ALL

    -- Iplicit: membership_income = account_id
    SELECT TO_CHAR(pl.period_date, 'Mon-YY') AS month, SUM(pl.amount) AS amount
    FROM iplicit_profit_loss pl
    CROSS JOIN provider_income_ids pic
    WHERE pl.organization_id   = p_organization_id
      AND pl.account_id        = pic.membership_id
      AND pl.period_date::DATE >= p_from_date
      AND pl.period_date::DATE <= p_to_date
    GROUP BY TO_CHAR(pl.period_date, 'Mon-YY')
  ),
  membership_monthly AS (
    SELECT mr.month, SUM(mr.amount) AS amount FROM membership_monthly_raw mr GROUP BY 1
  ),

  -- ── Monthly NHS amounts — same pattern ────────────────────────────────────
  nhs_monthly_raw AS (
    -- Xero
    SELECT TO_CHAR(pl.from_date, 'Mon-YY') AS month, SUM(pl.amount) AS amount
    FROM xero_profit_loss pl
    CROSS JOIN provider_income_ids pic
    WHERE pl.organization_id = p_organization_id
      AND pl.xero_account_id = pic.nhs_id
      AND pl.from_date       >= p_from_date
      AND pl.from_date       <= p_to_date
    GROUP BY TO_CHAR(pl.from_date, 'Mon-YY')

    UNION ALL

    -- Iplicit
    SELECT TO_CHAR(pl.period_date, 'Mon-YY') AS month, SUM(pl.amount) AS amount
    FROM iplicit_profit_loss pl
    CROSS JOIN provider_income_ids pic
    WHERE pl.organization_id   = p_organization_id
      AND pl.account_id        = pic.nhs_id
      AND pl.period_date::DATE >= p_from_date
      AND pl.period_date::DATE <= p_to_date
    GROUP BY TO_CHAR(pl.period_date, 'Mon-YY')
  ),
  nhs_monthly AS (
    SELECT nr.month, SUM(nr.amount) AS amount FROM nhs_monthly_raw nr GROUP BY 1
  ),

  -- ── Provider Private Income — payment plans from provider_private_income_accounts ─
  configured_private AS (
    SELECT jsonb_array_elements_text(pl.provider_private_income_accounts)::bigint AS pp_id
    FROM practice_locations pl
    WHERE pl.organization_id = p_organization_id
      AND pl.deleted_at IS NULL
      AND (p_location_id IS NULL OR pl.id = p_location_id)
      AND pl.provider_private_income_accounts IS NOT NULL
      AND jsonb_array_length(pl.provider_private_income_accounts) > 0
  ),
  -- Expand to all IDs sharing the same plan name (handles Dentally global vs site-specific mismatch)
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

  -- ── TPI monthly aggregates ─────────────────────────────────────────────────
  tpi_monthly AS (
    SELECT
      TO_CHAR(tpi.tpi_completed_at, 'Mon-YY')                                                                     AS month,
      DATE_TRUNC('month', tpi.tpi_completed_at)                                                                    AS month_trunc,
      SUM(tpi.tpi_price)                                                                                           AS total_amount,
      SUM(CASE WHEN pri.ids IS NOT NULL AND tpi.tpi_payment_plan_id = ANY(pri.ids) THEN tpi.tpi_price ELSE 0 END) AS private_amount
    FROM treatment_plan_items tpi
    CROSS JOIN private_ids pri
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
  )

  -- ── Final: merge TPI months with P&L membership/NHS amounts ───────────────
  SELECT
    tm.month,
    tm.total_amount,
    tm.private_amount,
    COALESCE(mm.amount, 0) AS membership_amount,
    COALESCE(nm.amount, 0) AS nhs_amount
  FROM tpi_monthly tm
  LEFT JOIN membership_monthly mm ON mm.month = tm.month
  LEFT JOIN nhs_monthly        nm ON nm.month = tm.month
  ORDER BY tm.month_trunc;
END;
$$;

GRANT EXECUTE ON FUNCTION get_provider_net_production_monthly(UUID, DATE, DATE, INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_provider_net_production_monthly(UUID, DATE, DATE, INTEGER, UUID) TO anon;
