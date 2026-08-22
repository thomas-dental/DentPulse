-- ============================================================================
-- Fix get_provider_net_production_monthly: exclude charting rows and resolve
-- the completed date in Europe/London.
--
-- Problem 1 — charting rows inflate production:
--   Charting / tooth-status records (Missing, Caries, Unerupted, ...) are not
--   clinical procedures, and Dentally's Practitioner Activity report excludes
--   them. They carry spurious prices, so they inflate production. They are
--   identified by having no treatment_appointment_id.
--
--   Verified against Dentally (Casey David, Woodbridge, June 2026):
--     RPC before  £12,492.50
--     7 charting rows (250, 250, 795, 250, 250, 250, 250)  -£2,295.00
--     RPC after   £10,197.50  = Dentally "Private" exactly
--
--   Gate is IS NOT NULL rather than > 0: the column is nullable and holds no
--   zero values.
--
-- Problem 2 — the month/date filter was evaluated in UTC:
--   tpi_completed_at is timestamptz, and Dentally date-only completions are
--   stored as London midnight (e.g. 2026-05-31T23:00:00Z = 1 Jun 00:00 BST).
--   Casting ::DATE in UTC filed those under the previous month, so BST-dated
--   treatments silently fell out of the range. For June 2026 (org fe601988)
--   24 rows worth £3,400.25 were dropped this way.
--
--   Mirrors the Europe/London handling already used by Treatment Insights.
--
-- Everything else is carried over unchanged from
-- 20260527000001_fix_provider_net_production_month_scaffold.sql.
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

  -- ── Month scaffold: one row per calendar month in the requested range ──────
  month_series AS (
    SELECT
      TO_CHAR(d, 'Mon-YY')         AS month,
      DATE_TRUNC('month', d)::DATE AS month_trunc
    FROM generate_series(
      DATE_TRUNC('month', p_from_date)::DATE,
      DATE_TRUNC('month', p_to_date)::DATE,
      '1 month'::INTERVAL
    ) AS d
  ),

  -- ── Monthly Membership amounts — UNION all supported platforms ─────────────
  membership_monthly_raw AS (
    SELECT TO_CHAR(pl.from_date, 'Mon-YY') AS month, SUM(pl.amount) AS amount
    FROM xero_profit_loss pl
    CROSS JOIN provider_income_ids pic
    WHERE pl.organization_id = p_organization_id
      AND pl.xero_account_id = pic.membership_id
      AND pl.from_date       >= p_from_date
      AND pl.from_date       <= p_to_date
    GROUP BY TO_CHAR(pl.from_date, 'Mon-YY')

    UNION ALL

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
    SELECT TO_CHAR(pl.from_date, 'Mon-YY') AS month, SUM(pl.amount) AS amount
    FROM xero_profit_loss pl
    CROSS JOIN provider_income_ids pic
    WHERE pl.organization_id = p_organization_id
      AND pl.xero_account_id = pic.nhs_id
      AND pl.from_date       >= p_from_date
      AND pl.from_date       <= p_to_date
    GROUP BY TO_CHAR(pl.from_date, 'Mon-YY')

    UNION ALL

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
      TO_CHAR(tpi.tpi_completed_at AT TIME ZONE 'Europe/London', 'Mon-YY')                                        AS month,
      SUM(tpi.tpi_price)                                                                                           AS total_amount,
      SUM(CASE WHEN pri.ids IS NOT NULL AND tpi.tpi_payment_plan_id = ANY(pri.ids) THEN tpi.tpi_price ELSE 0 END) AS private_amount
    FROM treatment_plan_items tpi
    CROSS JOIN private_ids pri
    WHERE tpi.organization_id     = p_organization_id
      AND tpi.tpi_practitioner_id = p_practitioner_id
      AND tpi.tpi_completed_at    IS NOT NULL
      AND tpi.tpi_completed       = true
      -- Resolve the completed date in Europe/London, not UTC.
      AND (tpi.tpi_completed_at AT TIME ZONE 'Europe/London')::DATE BETWEEN p_from_date AND p_to_date
      AND tpi.tpi_price           IS NOT NULL
      AND tpi.tpi_price           <> 0
      AND tpi.deleted_at          IS NULL
      -- Charting / tooth-status rows are not clinical procedures.
      AND tpi.tpi_treatment_appointment_id IS NOT NULL
      AND (p_location_id IS NULL OR tpi.location_id = p_location_id OR tpi.location_id IS NULL)
    GROUP BY TO_CHAR(tpi.tpi_completed_at AT TIME ZONE 'Europe/London', 'Mon-YY')
  )

  -- ── Final: month scaffold drives output; LEFT JOIN TPI + P&L ──────────────
  SELECT
    ms.month,
    COALESCE(tm.total_amount,   0) AS total_amount,
    COALESCE(tm.private_amount, 0) AS private_amount,
    COALESCE(mm.amount,         0) AS membership_amount,
    COALESCE(nm.amount,         0) AS nhs_amount
  FROM month_series ms
  LEFT JOIN tpi_monthly        tm ON tm.month = ms.month
  LEFT JOIN membership_monthly mm ON mm.month = ms.month
  LEFT JOIN nhs_monthly        nm ON nm.month = ms.month
  WHERE COALESCE(tm.total_amount, 0) <> 0
     OR COALESCE(mm.amount,       0) <> 0
     OR COALESCE(nm.amount,       0) <> 0
  ORDER BY ms.month_trunc;
END;
$$;

GRANT EXECUTE ON FUNCTION get_provider_net_production_monthly(UUID, DATE, DATE, INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_provider_net_production_monthly(UUID, DATE, DATE, INTEGER, UUID) TO anon;
