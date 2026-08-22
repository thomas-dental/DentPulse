-- ============================================================================
-- Appoline This Year still empty in the browser: PostgREST ~8s timeout.
-- EXPLAIN ANALYZE of get_all_providers_net_production_monthly was ~11s with
-- 8.8M buffer hits. Two causes:
--   1. LANGUAGE sql STABLE helper get_setup_category_private_payment_plan_ids
--      is inlined into the TPI aggregate, so payment_plans is re-joined per
--      treatment row.
--   2. Appointment-location map hash-joins the whole org year of TPI onto
--      treatment_appointments / appointments.
-- Fix: compute private plan ids once in plpgsql; for a selected location,
--      scan that site's TPI plus appointment-site mismatches only.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_ta_org_ta_id_active
  ON public.treatment_appointments (organization_id, ta_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tpi_org_loc_completed_active
  ON public.treatment_plan_items (organization_id, location_id, tpi_completed_at)
  WHERE deleted_at IS NULL
    AND tpi_completed = true;

CREATE INDEX IF NOT EXISTS idx_appointments_org_location_start_active
  ON public.appointments (organization_id, location_id, apmt_start_time)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION get_setup_category_private_payment_plan_ids(
  p_organization_id UUID,
  p_location_id     UUID DEFAULT NULL
)
RETURNS BIGINT[]
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  ids BIGINT[];
BEGIN
  SELECT NULLIF(ARRAY(
    SELECT DISTINCT pp2.pp_id
    FROM practice_locations pl
    CROSS JOIN LATERAL jsonb_array_elements_text(
      COALESCE(
        CASE WHEN jsonb_typeof(pl.provider_private_income_accounts) = 'array'
             THEN pl.provider_private_income_accounts ELSE '[]'::jsonb END,
        '[]'::jsonb
      ) || COALESCE(
        CASE WHEN jsonb_typeof(pl.private_income_accounts) = 'array'
             THEN pl.private_income_accounts ELSE '[]'::jsonb END,
        '[]'::jsonb
      )
    ) AS e(txt)
    JOIN payment_plans pp1
      ON e.txt ~ '^[0-9]+$'
     AND pp1.pp_id = e.txt::bigint
     AND pp1.organization_id = p_organization_id
     AND pp1.deleted_at IS NULL
    JOIN payment_plans pp2
      ON pp2.pp_name = pp1.pp_name
     AND pp2.organization_id = p_organization_id
     AND pp2.deleted_at IS NULL
    WHERE pl.organization_id = p_organization_id
      AND pl.deleted_at IS NULL
      AND (p_location_id IS NULL OR pl.id = p_location_id)
      AND e.txt ~ '^[0-9]+$'
  ), ARRAY[]::bigint[]) INTO ids;

  RETURN ids;
END;
$$;

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
DECLARE
  v_private_ids BIGINT[];
  v_from_ts    TIMESTAMPTZ;
  v_to_ts      TIMESTAMPTZ;
BEGIN
  SET LOCAL statement_timeout = '180s';

  v_private_ids := get_setup_category_private_payment_plan_ids(p_organization_id, p_location_id);
  v_from_ts := p_from_date::timestamp AT TIME ZONE 'Europe/London';
  v_to_ts   := (p_to_date + 1)::timestamp AT TIME ZONE 'Europe/London';

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

  -- Site-stamped TPI. When a location is selected, drop rows whose appointment
  -- was actually at another site (reverse of the Dimitra mis-stamp).
  tpi_home AS (
    SELECT
      tpi.tpi_practitioner_id::INTEGER AS ext_id,
      tpi.tpi_completed_at,
      tpi.tpi_price,
      tpi.tpi_payment_plan_id
    FROM treatment_plan_items tpi
    LEFT JOIN LATERAL (
      SELECT ap.location_id
      FROM treatment_appointments ta
      JOIN appointments ap
        ON ap.organization_id = tpi.organization_id
       AND ap.apmt_id = ta.ta_appointment_id
       AND ap.deleted_at IS NULL
      WHERE p_location_id IS NOT NULL
        AND ta.organization_id = tpi.organization_id
        AND ta.ta_id = tpi.tpi_treatment_appointment_id
        AND ta.deleted_at IS NULL
      LIMIT 1
    ) ap ON p_location_id IS NOT NULL
    WHERE tpi.organization_id     = p_organization_id
      AND tpi.tpi_practitioner_id IS NOT NULL
      AND tpi.tpi_completed_at    IS NOT NULL
      AND tpi.tpi_completed       = true
      AND tpi.tpi_completed_at    >= v_from_ts
      AND tpi.tpi_completed_at    <  v_to_ts
      AND tpi.tpi_price           IS NOT NULL
      AND tpi.tpi_price           <> 0
      AND tpi.deleted_at          IS NULL
      AND (p_location_id IS NULL OR tpi.location_id = p_location_id)
      AND (p_location_id IS NULL OR ap.location_id IS NULL OR ap.location_id = p_location_id)
  ),

  -- Dimitra path: start from THIS site's appointments so we do not LATERAL
  -- every other location's TPI. Look back a year on start_time so a
  -- completed-in-range item booked earlier still matches.
  tpi_appt AS (
    SELECT
      tpi.tpi_practitioner_id::INTEGER AS ext_id,
      tpi.tpi_completed_at,
      tpi.tpi_price,
      tpi.tpi_payment_plan_id
    FROM appointments ap
    JOIN treatment_appointments ta
      ON ta.organization_id   = ap.organization_id
     AND ta.ta_appointment_id = ap.apmt_id
     AND ta.deleted_at IS NULL
    JOIN treatment_plan_items tpi
      ON tpi.organization_id = ap.organization_id
     AND tpi.tpi_treatment_appointment_id = ta.ta_id
     AND tpi.deleted_at IS NULL
     AND tpi.tpi_completed = true
     AND tpi.tpi_practitioner_id IS NOT NULL
     AND tpi.tpi_completed_at IS NOT NULL
     AND tpi.tpi_completed_at >= v_from_ts
     AND tpi.tpi_completed_at <  v_to_ts
     AND tpi.tpi_price IS NOT NULL
     AND tpi.tpi_price <> 0
     AND tpi.location_id IS DISTINCT FROM p_location_id
    WHERE p_location_id IS NOT NULL
      AND ap.organization_id = p_organization_id
      AND ap.location_id     = p_location_id
      AND ap.deleted_at IS NULL
      AND ap.apmt_start_time >= (v_from_ts - INTERVAL '1 year')
      AND ap.apmt_start_time <  (v_to_ts   + INTERVAL '30 days')
  ),

  tpi_located AS (
    SELECT * FROM tpi_home
    UNION ALL
    SELECT * FROM tpi_appt
  ),

  tpi_rows AS (
    SELECT
      l.ext_id,
      TO_CHAR(l.tpi_completed_at AT TIME ZONE 'Europe/London', 'Mon-YY') AS mon,
      SUM(l.tpi_price) AS tot,
      SUM(CASE WHEN v_private_ids IS NOT NULL AND l.tpi_payment_plan_id = ANY(v_private_ids) THEN l.tpi_price ELSE 0 END) AS priv
    FROM tpi_located l
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
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_private_ids BIGINT[];
  v_from_ts    TIMESTAMPTZ;
  v_to_ts      TIMESTAMPTZ;
BEGIN
  SET LOCAL statement_timeout = '120s';

  v_private_ids := get_setup_category_private_payment_plan_ids(p_organization_id, p_location_id);
  v_from_ts := p_from_date::timestamp AT TIME ZONE 'Europe/London';
  v_to_ts   := (p_to_date + 1)::timestamp AT TIME ZONE 'Europe/London';

  RETURN QUERY
  WITH
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

  tpi_home AS (
    SELECT
      tpi.tpi_completed_at,
      tpi.tpi_price,
      tpi.tpi_payment_plan_id
    FROM treatment_plan_items tpi
    LEFT JOIN LATERAL (
      SELECT ap.location_id
      FROM treatment_appointments ta
      JOIN appointments ap
        ON ap.organization_id = tpi.organization_id
       AND ap.apmt_id = ta.ta_appointment_id
       AND ap.deleted_at IS NULL
      WHERE p_location_id IS NOT NULL
        AND ta.organization_id = tpi.organization_id
        AND ta.ta_id = tpi.tpi_treatment_appointment_id
        AND ta.deleted_at IS NULL
      LIMIT 1
    ) ap ON p_location_id IS NOT NULL
    WHERE tpi.organization_id     = p_organization_id
      AND tpi.tpi_practitioner_id = p_practitioner_id
      AND tpi.tpi_completed_at    IS NOT NULL
      AND tpi.tpi_completed       = true
      AND tpi.tpi_completed_at    >= v_from_ts
      AND tpi.tpi_completed_at    <  v_to_ts
      AND tpi.tpi_price           IS NOT NULL
      AND tpi.tpi_price           <> 0
      AND tpi.deleted_at          IS NULL
      AND (p_location_id IS NULL OR tpi.location_id = p_location_id)
      AND (p_location_id IS NULL OR ap.location_id IS NULL OR ap.location_id = p_location_id)
  ),

  tpi_appt AS (
    SELECT
      tpi.tpi_completed_at,
      tpi.tpi_price,
      tpi.tpi_payment_plan_id
    FROM appointments ap
    JOIN treatment_appointments ta
      ON ta.organization_id   = ap.organization_id
     AND ta.ta_appointment_id = ap.apmt_id
     AND ta.deleted_at IS NULL
    JOIN treatment_plan_items tpi
      ON tpi.organization_id = ap.organization_id
     AND tpi.tpi_treatment_appointment_id = ta.ta_id
     AND tpi.deleted_at IS NULL
     AND tpi.tpi_completed = true
     AND tpi.tpi_practitioner_id = p_practitioner_id
     AND tpi.tpi_completed_at IS NOT NULL
     AND tpi.tpi_completed_at >= v_from_ts
     AND tpi.tpi_completed_at <  v_to_ts
     AND tpi.tpi_price IS NOT NULL
     AND tpi.tpi_price <> 0
     AND tpi.location_id IS DISTINCT FROM p_location_id
    WHERE p_location_id IS NOT NULL
      AND ap.organization_id = p_organization_id
      AND ap.location_id     = p_location_id
      AND ap.deleted_at IS NULL
      AND ap.apmt_start_time >= (v_from_ts - INTERVAL '1 year')
      AND ap.apmt_start_time <  (v_to_ts   + INTERVAL '30 days')
  ),

  tpi_monthly AS (
    SELECT
      TO_CHAR(l.tpi_completed_at AT TIME ZONE 'Europe/London', 'Mon-YY') AS month,
      SUM(l.tpi_price) AS total_amount,
      SUM(CASE WHEN v_private_ids IS NOT NULL AND l.tpi_payment_plan_id = ANY(v_private_ids) THEN l.tpi_price ELSE 0 END) AS private_amount
    FROM (
      SELECT * FROM tpi_home
      UNION ALL
      SELECT * FROM tpi_appt
    ) l
    GROUP BY 1
  )

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
