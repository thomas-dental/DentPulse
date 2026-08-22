-- ============================================================================
-- Appoline This Year Production Data still empty in the browser: PostgREST
-- times out on per-row LATERAL appointment lookups. Rebuild location as a
-- distinct ta_id → appointment.location_id map (one hash join), then aggregate.
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
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SET LOCAL statement_timeout = '180s';

  RETURN QUERY
  WITH
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

  private_ids AS (
    SELECT get_setup_category_private_payment_plan_ids(p_organization_id, p_location_id) AS ids
  ),

  tpi_base AS (
    SELECT
      tpi.tpi_practitioner_id::INTEGER AS ext_id,
      tpi.tpi_completed_at,
      tpi.tpi_price,
      tpi.tpi_payment_plan_id,
      tpi.tpi_treatment_appointment_id,
      tpi.location_id
    FROM treatment_plan_items tpi
    WHERE tpi.organization_id     = p_organization_id
      AND tpi.tpi_practitioner_id IS NOT NULL
      AND tpi.tpi_completed_at    IS NOT NULL
      AND tpi.tpi_completed       = true
      AND tpi.tpi_completed_at >= (p_from_date::timestamp AT TIME ZONE 'Europe/London')
      AND tpi.tpi_completed_at <  ((p_to_date + 1)::timestamp AT TIME ZONE 'Europe/London')
      AND tpi.tpi_price           IS NOT NULL
      AND tpi.tpi_price           <> 0
      AND tpi.deleted_at          IS NULL
      AND tpi.tpi_treatment_appointment_id IS NOT NULL
  ),

  appt_loc AS (
    SELECT DISTINCT ON (ta.ta_id)
      ta.ta_id,
      ap.location_id
    FROM (SELECT DISTINCT tpi_treatment_appointment_id AS ta_id FROM tpi_base) ids
    JOIN treatment_appointments ta
      ON ta.organization_id = p_organization_id
     AND ta.ta_id = ids.ta_id
     AND ta.deleted_at IS NULL
    JOIN appointments ap
      ON ap.organization_id = p_organization_id
     AND ap.apmt_id = ta.ta_appointment_id
     AND ap.deleted_at IS NULL
    ORDER BY ta.ta_id
  ),

  tpi_rows AS (
    SELECT
      b.ext_id,
      TO_CHAR(b.tpi_completed_at AT TIME ZONE 'Europe/London', 'Mon-YY') AS mon,
      SUM(b.tpi_price) AS tot,
      SUM(CASE WHEN pri.ids IS NOT NULL AND b.tpi_payment_plan_id = ANY(pri.ids) THEN b.tpi_price ELSE 0 END) AS priv
    FROM tpi_base b
    CROSS JOIN private_ids pri
    LEFT JOIN appt_loc al ON al.ta_id = b.tpi_treatment_appointment_id
    WHERE p_location_id IS NULL
       OR COALESCE(al.location_id, b.location_id) = p_location_id
       OR (al.location_id IS NULL AND b.location_id IS NULL)
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
