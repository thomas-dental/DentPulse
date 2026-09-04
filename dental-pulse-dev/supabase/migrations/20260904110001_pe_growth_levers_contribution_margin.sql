-- Growth levers facts: trailing contribution + margin for simulator £ uplift.

CREATE OR REPLACE FUNCTION public.pe_growth_levers_facts(
  p_practice_id UUID,
  p_since_date DATE,
  p_location_id UUID DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  use_facts boolean;
  active_count bigint;
  visit_total bigint;
  revenue_total numeric(15, 2);
  contribution_total numeric(15, 2);
  margin_pct numeric(8, 1);
  visits_by_month JSONB;
  revenue_by_month JSONB;
BEGIN
  PERFORM set_config('statement_timeout', '180000', true);

  use_facts := public.pe_invoice_source_has_facts(p_practice_id);

  SELECT COUNT(*)::bigint
  INTO active_count
  FROM public.patients p
  WHERE p.organization_id = p_practice_id
    AND p.is_active = true
    AND p.deleted_at IS NULL
    AND (p_location_id IS NULL OR p.location_id = p_location_id);

  SELECT COUNT(*)::bigint
  INTO visit_total
  FROM public.appointments a
  WHERE a.organization_id = p_practice_id
    AND a.apmt_completed_at >= p_since_date
    AND (p_end_date IS NULL OR a.apmt_completed_at::date <= p_end_date)
    AND (
      a.apmt_completed_at IS NOT NULL
      OR LOWER(BTRIM(COALESCE(a.apmt_state, ''))) = 'completed'
    )
    AND LOWER(BTRIM(COALESCE(a.apmt_state, ''))) NOT IN (
      'cancelled', 'did not attend', 'dna'
    )
    AND (p_location_id IS NULL OR a.location_id = p_location_id);

  SELECT COALESCE(
    jsonb_object_agg(month_key, cnt),
    '{}'::jsonb
  )
  INTO visits_by_month
  FROM (
    SELECT
      to_char(a.apmt_completed_at, 'YYYY-MM') AS month_key,
      COUNT(*)::bigint AS cnt
    FROM public.appointments a
    WHERE a.organization_id = p_practice_id
      AND a.apmt_completed_at >= p_since_date
      AND (p_end_date IS NULL OR a.apmt_completed_at::date <= p_end_date)
      AND (
        a.apmt_completed_at IS NOT NULL
        OR LOWER(BTRIM(COALESCE(a.apmt_state, ''))) = 'completed'
      )
      AND LOWER(BTRIM(COALESCE(a.apmt_state, ''))) NOT IN (
        'cancelled', 'did not attend', 'dna'
      )
      AND (p_location_id IS NULL OR a.location_id = p_location_id)
    GROUP BY to_char(a.apmt_completed_at, 'YYYY-MM')
  ) v;

  IF use_facts THEN
    SELECT
      COALESCE(SUM(f.revenue_private_plan), 0),
      COALESCE(SUM(f.contribution), 0)
    INTO revenue_total, contribution_total
    FROM public.pe_invoice_contribution_facts f
    LEFT JOIN public.patients p
      ON p.id = f.patient_id
     AND p.organization_id = f.practice_id
     AND p.deleted_at IS NULL
    WHERE f.practice_id = p_practice_id
      AND f.invoice_date >= p_since_date
      AND (p_end_date IS NULL OR f.invoice_date <= p_end_date)
      AND f.revenue_private_plan > 0
      AND (p_location_id IS NULL OR p.location_id = p_location_id);

    SELECT COALESCE(
      jsonb_object_agg(month_key, revenue),
      '{}'::jsonb
    )
    INTO revenue_by_month
    FROM (
      SELECT
        to_char(f.invoice_date, 'YYYY-MM') AS month_key,
        ROUND(SUM(f.revenue_private_plan), 2) AS revenue
      FROM public.pe_invoice_contribution_facts f
      LEFT JOIN public.patients p
        ON p.id = f.patient_id
       AND p.organization_id = f.practice_id
       AND p.deleted_at IS NULL
      WHERE f.practice_id = p_practice_id
        AND f.invoice_date >= p_since_date
        AND (p_end_date IS NULL OR f.invoice_date <= p_end_date)
        AND f.revenue_private_plan > 0
        AND (p_location_id IS NULL OR p.location_id = p_location_id)
      GROUP BY to_char(f.invoice_date, 'YYYY-MM')
    ) r;
  ELSE
    SELECT
      COALESCE(SUM(v.revenue_private_plan), 0),
      COALESCE(SUM(v.contribution), 0)
    INTO revenue_total, contribution_total
    FROM public.v_invoice_contribution v
    LEFT JOIN public.patients p
      ON p.id = v.patient_id
     AND p.organization_id = v.practice_id
     AND p.deleted_at IS NULL
    WHERE v.practice_id = p_practice_id
      AND v.invoice_date >= p_since_date
      AND (p_end_date IS NULL OR v.invoice_date <= p_end_date)
      AND v.revenue_private_plan > 0
      AND (p_location_id IS NULL OR p.location_id = p_location_id);

    SELECT COALESCE(
      jsonb_object_agg(month_key, revenue),
      '{}'::jsonb
    )
    INTO revenue_by_month
    FROM (
      SELECT
        to_char(v.invoice_date, 'YYYY-MM') AS month_key,
        ROUND(SUM(v.revenue_private_plan), 2) AS revenue
      FROM public.v_invoice_contribution v
      LEFT JOIN public.patients p
        ON p.id = v.patient_id
       AND p.organization_id = v.practice_id
       AND p.deleted_at IS NULL
      WHERE v.practice_id = p_practice_id
        AND v.invoice_date >= p_since_date
        AND (p_end_date IS NULL OR v.invoice_date <= p_end_date)
        AND v.revenue_private_plan > 0
        AND (p_location_id IS NULL OR p.location_id = p_location_id)
      GROUP BY to_char(v.invoice_date, 'YYYY-MM')
    ) r;
  END IF;

  revenue_total := ROUND(COALESCE(revenue_total, 0), 2);
  contribution_total := ROUND(COALESCE(contribution_total, 0), 2);
  margin_pct := CASE
    WHEN revenue_total > 0 THEN ROUND((contribution_total / revenue_total) * 100, 1)
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'active_patient_count', active_count,
    'total_completed_visits', visit_total,
    'total_revenue_private_plan', revenue_total,
    'total_contribution', contribution_total,
    'margin_pct', margin_pct,
    'visits_by_month', COALESCE(visits_by_month, '{}'::jsonb),
    'revenue_by_month', COALESCE(revenue_by_month, '{}'::jsonb)
  );
END;
$$;
