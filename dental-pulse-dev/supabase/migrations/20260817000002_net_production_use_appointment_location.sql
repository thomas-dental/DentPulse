-- ============================================================================
-- Net production location filter must follow the APPOINTMENT site, not the
-- practitioner's home-site stamp on treatment_plan_items.location_id.
--
-- Bug (Appoline / Dimitra Tsarouchi / Jan-26):
--   Dentally Appoline = £4,725. Enterprise = £4,540. Gap = £185.
--   No re-download needed — the treatments are already in DentPulse.
--
--   Dimitra has two Dentally practitioner records (Appoline 314694 and
--   St Catherine's 198802). Three £185 periodontal re-assessments were
--   completed at Appoline (appointment location + appointment practitioner
--   314694) but the TPI row kept practitioner 198802. TPI location backfill
--   Method 0 then stamped St Catherine's from the provider home site, so
--   the Appoline location filter dropped them.
--
--   Using appointment location instead yields £4,721 (within £4 of Dentally).
--
-- Fix: COALESCE(appointment.location_id, tpi.location_id) for the site
-- predicate in both net-production RPCs and chart_get_production_metrics.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_setup_category_private_payment_plan_ids(
  p_organization_id UUID,
  p_location_id     UUID DEFAULT NULL
)
RETURNS BIGINT[]
LANGUAGE sql
STABLE
AS $$
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
      ON pp1.pp_id = e.txt::bigint
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
  ), ARRAY[]::bigint[]);
$$;

COMMENT ON FUNCTION get_setup_category_private_payment_plan_ids(UUID, UUID) IS
  'Setup Categories Private Income PMS payment-plan ids for a location (or org-wide union when p_location_id is NULL). NULL when none are mapped.';

GRANT EXECUTE ON FUNCTION get_setup_category_private_payment_plan_ids(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_setup_category_private_payment_plan_ids(UUID, UUID) TO anon;

-- ── 1) get_all_providers_net_production_monthly ───────────────────────────────
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
  SET LOCAL statement_timeout = '120s';

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

  tpi_rows AS (
    SELECT
      tpi.tpi_practitioner_id::INTEGER                                                                             AS ext_id,
      TO_CHAR(tpi.tpi_completed_at AT TIME ZONE 'Europe/London', 'Mon-YY')                                         AS mon,
      SUM(tpi.tpi_price)                                                                                           AS tot,
      SUM(CASE WHEN pri.ids IS NOT NULL AND tpi.tpi_payment_plan_id = ANY(pri.ids) THEN tpi.tpi_price ELSE 0 END)  AS priv
    FROM treatment_plan_items tpi
    CROSS JOIN private_ids pri
    LEFT JOIN treatment_appointments ta
      ON ta.organization_id = tpi.organization_id
     AND ta.ta_id = tpi.tpi_treatment_appointment_id
     AND ta.deleted_at IS NULL
    LEFT JOIN appointments ap
      ON ap.organization_id = tpi.organization_id
     AND ap.apmt_id = ta.ta_appointment_id
     AND ap.deleted_at IS NULL
    WHERE tpi.organization_id       = p_organization_id
      AND tpi.tpi_practitioner_id   IS NOT NULL
      AND tpi.tpi_completed_at      IS NOT NULL
      AND tpi.tpi_completed         = true
      AND tpi.tpi_completed_at >= (p_from_date::timestamp AT TIME ZONE 'Europe/London')
      AND tpi.tpi_completed_at <  ((p_to_date + 1)::timestamp AT TIME ZONE 'Europe/London')
      AND tpi.tpi_price             IS NOT NULL
      AND tpi.tpi_price             <> 0
      AND tpi.deleted_at            IS NULL
      AND tpi.tpi_treatment_appointment_id IS NOT NULL
      AND (
        p_location_id IS NULL
        OR COALESCE(ap.location_id, tpi.location_id) = p_location_id
        OR (ap.location_id IS NULL AND tpi.location_id IS NULL)
      )
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

-- ── 2) get_provider_net_production_monthly ───────────────────────────────────
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
BEGIN
  SET LOCAL statement_timeout = '60s';

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

  private_ids AS (
    SELECT get_setup_category_private_payment_plan_ids(p_organization_id, p_location_id) AS ids
  ),

  tpi_monthly AS (
    SELECT
      TO_CHAR(tpi.tpi_completed_at AT TIME ZONE 'Europe/London', 'Mon-YY')                                        AS month,
      SUM(tpi.tpi_price)                                                                                           AS total_amount,
      SUM(CASE WHEN pri.ids IS NOT NULL AND tpi.tpi_payment_plan_id = ANY(pri.ids) THEN tpi.tpi_price ELSE 0 END) AS private_amount
    FROM treatment_plan_items tpi
    CROSS JOIN private_ids pri
    LEFT JOIN treatment_appointments ta
      ON ta.organization_id = tpi.organization_id
     AND ta.ta_id = tpi.tpi_treatment_appointment_id
     AND ta.deleted_at IS NULL
    LEFT JOIN appointments ap
      ON ap.organization_id = tpi.organization_id
     AND ap.apmt_id = ta.ta_appointment_id
     AND ap.deleted_at IS NULL
    WHERE tpi.organization_id     = p_organization_id
      AND tpi.tpi_practitioner_id = p_practitioner_id
      AND tpi.tpi_completed_at    IS NOT NULL
      AND tpi.tpi_completed       = true
      AND tpi.tpi_completed_at >= (p_from_date::timestamp AT TIME ZONE 'Europe/London')
      AND tpi.tpi_completed_at <  ((p_to_date + 1)::timestamp AT TIME ZONE 'Europe/London')
      AND tpi.tpi_price           IS NOT NULL
      AND tpi.tpi_price           <> 0
      AND tpi.deleted_at          IS NULL
      AND tpi.tpi_treatment_appointment_id IS NOT NULL
      AND (
        p_location_id IS NULL
        OR COALESCE(ap.location_id, tpi.location_id) = p_location_id
        OR (ap.location_id IS NULL AND tpi.location_id IS NULL)
      )
    GROUP BY TO_CHAR(tpi.tpi_completed_at AT TIME ZONE 'Europe/London', 'Mon-YY')
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

-- ── 3) chart_get_production_metrics — same Private Income plan filter ────────
DROP FUNCTION IF EXISTS chart_get_production_metrics(DATE, DATE, UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION chart_get_production_metrics(
  p_start_date      DATE,
  p_end_date        DATE,
  p_organization_id UUID,
  p_provider_type   TEXT DEFAULT NULL,
  p_location_id     UUID DEFAULT NULL
)
RETURNS TABLE (
  provider_id          UUID,
  provider_name        TEXT,
  production_amount    NUMERIC,
  days_worked          NUMERIC,
  avg_daily_production NUMERIC,
  rank                 INTEGER
) AS $$
DECLARE
  v_org_hours_per_day NUMERIC;
BEGIN
  SELECT COALESCE(loc.open_hours_per_day, org_avg.avg_hours, 8)
  INTO v_org_hours_per_day
  FROM (SELECT 1) AS dummy
  LEFT JOIN practice_locations loc
    ON p_location_id IS NOT NULL AND loc.id = p_location_id
  LEFT JOIN (
    SELECT AVG(pl.open_hours_per_day) AS avg_hours
    FROM practice_locations pl
    WHERE pl.organization_id = p_organization_id
      AND pl.deleted_at IS NULL
      AND pl.is_active = true
  ) AS org_avg ON true;

  RETURN QUERY
  WITH
  private_ids AS (
    SELECT get_setup_category_private_payment_plan_ids(p_organization_id, p_location_id) AS ids
  ),
  base_providers AS (
    SELECT
      LOWER(COALESCE(NULLIF(TRIM(p.email), ''), p.name)) AS group_key,
      MIN(p.id::TEXT)::UUID AS provider_id,
      MIN(p.name)           AS provider_name,
      COALESCE(
        ARRAY_AGG(DISTINCT p.external_id::TEXT) FILTER (WHERE p.external_id IS NOT NULL),
        ARRAY[]::TEXT[]
      ) AS external_ids
    FROM providers p
    WHERE
      p.is_active = true
      AND p.deleted_at IS NULL
      AND p.organization_id = p_organization_id
      AND (
        p_provider_type IS NULL
        OR (
          p_provider_type = 'Other'
          AND LOWER(COALESCE(p.provider_role, '')) NOT IN (
            'dentist', 'dental surgeon', 'principal dentist',
            'hygienist', 'dental hygienist', 'hygiene',
            'therapist', 'dental therapist', 'therapy'
          )
          AND LOWER(COALESCE(p.provider_role, '')) NOT LIKE '%dentist%'
          AND LOWER(COALESCE(p.provider_role, '')) NOT LIKE '%hygienist%'
          AND LOWER(COALESCE(p.provider_role, '')) NOT LIKE '%hygiene%'
          AND LOWER(COALESCE(p.provider_role, '')) NOT LIKE '%therapist%'
          AND LOWER(COALESCE(p.provider_role, '')) NOT LIKE '%therapy%'
        )
        OR (
          p_provider_type <> 'Other'
          AND p.provider_role ILIKE '%' || p_provider_type || '%'
        )
      )
      AND (p_location_id IS NULL OR p.location_id = p_location_id OR p.location_id IS NULL)
    GROUP BY LOWER(COALESCE(NULLIF(TRIM(p.email), ''), p.name))
  ),
  provider_production AS (
    SELECT
      bp.provider_id,
      COALESCE(SUM(
        CASE
          WHEN tpi.tpi_price IS NULL THEN 0
          WHEN p_location_id IS NOT NULL
           AND NOT (
             COALESCE(ap.location_id, tpi.location_id) = p_location_id
             OR (ap.location_id IS NULL AND tpi.location_id IS NULL)
           ) THEN 0
          -- No Private Income plans mapped → keep legacy all-TPI total.
          WHEN pri.ids IS NULL THEN tpi.tpi_price
          WHEN tpi.tpi_payment_plan_id = ANY(pri.ids) THEN tpi.tpi_price
          ELSE 0
        END
      ), 0) AS total_production
    FROM base_providers bp
    CROSS JOIN private_ids pri
    CROSS JOIN UNNEST(bp.external_ids) AS u(ext_id)
    LEFT JOIN treatment_plan_items tpi
      ON u.ext_id::BIGINT = tpi.tpi_practitioner_id
      AND tpi.tpi_completed = true
      AND tpi.tpi_completed_at IS NOT NULL
      AND tpi.tpi_completed_at >= (p_start_date::timestamp AT TIME ZONE 'Europe/London')
      AND tpi.tpi_completed_at <  ((p_end_date + 1)::timestamp AT TIME ZONE 'Europe/London')
      AND tpi.tpi_price IS NOT NULL
      AND tpi.tpi_price <> 0
      AND tpi.tpi_treatment_appointment_id IS NOT NULL
      AND tpi.deleted_at IS NULL
      AND tpi.organization_id = p_organization_id
    LEFT JOIN treatment_appointments ta
      ON ta.organization_id = tpi.organization_id
     AND ta.ta_id = tpi.tpi_treatment_appointment_id
     AND ta.deleted_at IS NULL
    LEFT JOIN appointments ap
      ON ap.organization_id = tpi.organization_id
     AND ap.apmt_id = ta.ta_appointment_id
     AND ap.deleted_at IS NULL
    GROUP BY bp.provider_id
  ),
  appt_monthly_hours AS (
    SELECT
      a.apmt_practitioner_id AS ext_id,
      DATE_TRUNC('month', a.apmt_start_time AT TIME ZONE 'Europe/London')::DATE AS month,
      SUM(a.apmt_duration)::NUMERIC / 60.0 AS month_hours
    FROM appointments a
    WHERE a.apmt_state IN ('Completed', 'Pending', 'In surgery', 'Confirmed')
      AND a.apmt_start_time IS NOT NULL
      AND a.apmt_start_time >= (p_start_date::timestamp AT TIME ZONE 'Europe/London')
      AND a.apmt_start_time <  ((p_end_date + 1)::timestamp AT TIME ZONE 'Europe/London')
      AND a.apmt_duration IS NOT NULL
      AND a.apmt_patient_id IS NOT NULL
      AND a.deleted_at IS NULL
      AND a.organization_id = p_organization_id
      AND (
        p_location_id IS NULL
        OR a.location_id = p_location_id
        OR a.location_id IS NULL
      )
    GROUP BY a.apmt_practitioner_id,
             DATE_TRUNC('month', a.apmt_start_time AT TIME ZONE 'Europe/London')
  ),
  appt_monthly_days AS (
    SELECT
      amh.ext_id,
      COALESCE(
        amh.month_hours / NULLIF(COALESCE(am.working_hours_per_day, v_org_hours_per_day, 8), 0),
        0
      ) AS month_days
    FROM appt_monthly_hours amh
    LEFT JOIN appointment_summary am
      ON am.organization_id = p_organization_id
      AND am.practitioner_id = amh.ext_id
      AND am.month = amh.month
  ),
  provider_hours AS (
    SELECT
      bp.provider_id,
      COALESCE(SUM(amd.month_days), 0) AS working_days
    FROM base_providers bp
    CROSS JOIN UNNEST(bp.external_ids) AS u(ext_id)
    LEFT JOIN appt_monthly_days amd ON amd.ext_id = u.ext_id::BIGINT
    GROUP BY bp.provider_id
  ),
  production_data AS (
    SELECT
      bp.provider_id,
      bp.provider_name,
      COALESCE(pp.total_production, 0) AS prod_amount,
      COALESCE(ph.working_days, 0)     AS days_count
    FROM base_providers bp
    LEFT JOIN provider_production pp ON bp.provider_id = pp.provider_id
    LEFT JOIN provider_hours      ph ON bp.provider_id = ph.provider_id
  ),
  ranked_data AS (
    SELECT
      pd.provider_id,
      pd.provider_name,
      pd.prod_amount    AS production_amount,
      pd.days_count     AS days_worked,
      CASE
        WHEN pd.days_count > 0 THEN ROUND(pd.prod_amount / pd.days_count, 2)
        ELSE 0
      END AS avg_daily_production,
      ROW_NUMBER() OVER (
        ORDER BY CASE WHEN pd.days_count > 0 THEN pd.prod_amount / pd.days_count ELSE 0 END DESC
      )::INTEGER AS rank
    FROM production_data pd
  )
  SELECT rd.provider_id, rd.provider_name, rd.production_amount, rd.days_worked, rd.avg_daily_production, rd.rank
  FROM ranked_data rd
  WHERE rd.production_amount > 0 OR rd.days_worked > 0
  ORDER BY rd.rank;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION chart_get_production_metrics(DATE, DATE, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION chart_get_production_metrics(DATE, DATE, UUID, TEXT, UUID) TO anon;
