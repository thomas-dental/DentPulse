-- ============================================================================
-- Zahid Hussain Therapist Jul-26 Appoline: £2,053 vs Dentally / Private
-- Income plans £1,902.50.
--
-- Extra £150 is TPI practitioner St Catherine's Zahid (290685) completed on
-- an Appoline appointment whose practitioner is someone else (57217).
-- Email-grouping then added 290685 onto Appoline Zahid (305674).
--
-- Dimitra's Appoline £185 items must still count: TPI practitioner is
-- St Catherine's Dimitra, appointment practitioner is Appoline Dimitra
-- (same person, different Dentally IDs).
--
-- Rule: location = appointment site; practitioner = TPI practitioner;
-- drop the row when the appointment practitioner is a different person.
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

  same_person AS (
    SELECT DISTINCT
      p1.external_id::INTEGER AS id_a,
      p2.external_id::INTEGER AS id_b
    FROM providers p1
    JOIN providers p2
      ON p2.organization_id = p1.organization_id
     AND p2.deleted_at IS NULL
     AND p2.external_id IS NOT NULL
     AND LOWER(COALESCE(NULLIF(TRIM(p1.email), ''), p1.name))
       = LOWER(COALESCE(NULLIF(TRIM(p2.email), ''), p2.name))
    WHERE p1.organization_id = p_organization_id
      AND p1.deleted_at IS NULL
      AND p1.external_id IS NOT NULL
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
      SELECT ap.location_id, ap.apmt_practitioner_id
      FROM treatment_appointments ta
      JOIN appointments ap
        ON ap.organization_id = tpi.organization_id
       AND ap.apmt_id = ta.ta_appointment_id
       AND ap.deleted_at IS NULL
      WHERE ta.organization_id = tpi.organization_id
        AND ta.ta_id = tpi.tpi_treatment_appointment_id
        AND ta.deleted_at IS NULL
      LIMIT 1
    ) ap ON TRUE
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
      AND (
        ap.apmt_practitioner_id IS NULL
        OR ap.apmt_practitioner_id = tpi.tpi_practitioner_id
        OR EXISTS (
          SELECT 1 FROM same_person sp
          WHERE sp.id_a = tpi.tpi_practitioner_id::INTEGER
            AND sp.id_b = ap.apmt_practitioner_id::INTEGER
        )
      )
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
      AND (
        ap.apmt_practitioner_id IS NULL
        OR ap.apmt_practitioner_id = tpi.tpi_practitioner_id
        OR EXISTS (
          SELECT 1 FROM same_person sp
          WHERE sp.id_a = tpi.tpi_practitioner_id::INTEGER
            AND sp.id_b = ap.apmt_practitioner_id::INTEGER
        )
      )
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

  same_person AS (
    SELECT DISTINCT
      p1.external_id::INTEGER AS id_a,
      p2.external_id::INTEGER AS id_b
    FROM providers p1
    JOIN providers p2
      ON p2.organization_id = p1.organization_id
     AND p2.deleted_at IS NULL
     AND p2.external_id IS NOT NULL
     AND LOWER(COALESCE(NULLIF(TRIM(p1.email), ''), p1.name))
       = LOWER(COALESCE(NULLIF(TRIM(p2.email), ''), p2.name))
    WHERE p1.organization_id = p_organization_id
      AND p1.deleted_at IS NULL
      AND p1.external_id IS NOT NULL
  ),

  tpi_home AS (
    SELECT
      tpi.tpi_completed_at,
      tpi.tpi_price,
      tpi.tpi_payment_plan_id
    FROM treatment_plan_items tpi
    LEFT JOIN LATERAL (
      SELECT ap.location_id, ap.apmt_practitioner_id
      FROM treatment_appointments ta
      JOIN appointments ap
        ON ap.organization_id = tpi.organization_id
       AND ap.apmt_id = ta.ta_appointment_id
       AND ap.deleted_at IS NULL
      WHERE ta.organization_id = tpi.organization_id
        AND ta.ta_id = tpi.tpi_treatment_appointment_id
        AND ta.deleted_at IS NULL
      LIMIT 1
    ) ap ON TRUE
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
      AND (
        ap.apmt_practitioner_id IS NULL
        OR ap.apmt_practitioner_id = tpi.tpi_practitioner_id
        OR EXISTS (
          SELECT 1 FROM same_person sp
          WHERE sp.id_a = tpi.tpi_practitioner_id::INTEGER
            AND sp.id_b = ap.apmt_practitioner_id::INTEGER
        )
      )
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
      AND (
        ap.apmt_practitioner_id IS NULL
        OR ap.apmt_practitioner_id = tpi.tpi_practitioner_id
        OR EXISTS (
          SELECT 1 FROM same_person sp
          WHERE sp.id_a = tpi.tpi_practitioner_id::INTEGER
            AND sp.id_b = ap.apmt_practitioner_id::INTEGER
        )
      )
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
