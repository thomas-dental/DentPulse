-- Total paid: return exact numeric sum (no ROUND on total_paid_value).

CREATE OR REPLACE FUNCTION public.pe_invoice_contribution_summary(
  p_practice_id UUID,
  p_location_id UUID DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
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
  result JSONB;
  revenue_plan numeric;
  revenue_private numeric;
  total_revenue numeric;
  v_total_paid numeric;
BEGIN
  PERFORM set_config('statement_timeout', '180000', true);

  use_facts := public.pe_invoice_source_has_facts(p_practice_id);

  IF use_facts THEN
    WITH membership_pts AS MATERIALIZED (
      SELECT p.pt_id
      FROM public.patients p
      WHERE p.organization_id = p_practice_id
        AND p.deleted_at IS NULL
        AND p.pt_id IS NOT NULL
        AND (p_location_id IS NULL OR p.location_id = p_location_id)
        AND p.pt_payment_plan_id IN (
          SELECT public.pe_membership_plan_pp_ids(p_practice_id)
        )
    ),
    scoped AS (
      SELECT
        f.patient_id,
        f.revenue_private_plan,
        f.contribution,
        f.revenue_nhs,
        f.has_missing_practitioner,
        f.has_missing_rate,
        f.revenue_no_practitioner,
        f.revenue_missing_rate,
        (f.revenue_private_plan > 0 AND mp.pt_id IS NOT NULL) AS is_plan_revenue
      FROM public.pe_invoice_contribution_facts f
      LEFT JOIN public.platform_integration_invoices inv
        ON inv.organization_id = f.practice_id
       AND inv.id = f.invoice_id
       AND inv.deleted_at IS NULL
      LEFT JOIN public.patients p
        ON p.id = f.patient_id
       AND p.organization_id = f.practice_id
       AND p.deleted_at IS NULL
      LEFT JOIN membership_pts mp
        ON mp.pt_id = f.pt_id
      WHERE f.practice_id = p_practice_id
        AND f.is_paid = true
        AND (p_start_date IS NULL OR f.invoice_date >= p_start_date)
        AND (p_end_date IS NULL OR f.invoice_date <= p_end_date)
        AND (
          p_location_id IS NULL
          OR COALESCE(inv.location_id, p.location_id) = p_location_id
        )
    )
    SELECT
      COALESCE(SUM(s.revenue_private_plan) FILTER (WHERE s.is_plan_revenue), 0),
      COALESCE(SUM(s.revenue_private_plan) FILTER (
        WHERE s.revenue_private_plan > 0 AND NOT s.is_plan_revenue
      ), 0),
      COALESCE(SUM(s.revenue_private_plan), 0),
      jsonb_build_object(
        'invoice_count', COUNT(*)::bigint,
        'invoices_with_revenue', COUNT(*) FILTER (WHERE s.revenue_private_plan > 0)::bigint,
        'patient_count', COUNT(DISTINCT s.patient_id)::bigint,
        'patients_with_revenue', COUNT(DISTINCT s.patient_id) FILTER (WHERE s.revenue_private_plan > 0)::bigint,
        'total_contribution', COALESCE(SUM(s.contribution), 0),
        'total_revenue', COALESCE(SUM(s.revenue_private_plan), 0),
        'revenue_nhs', COALESCE(SUM(s.revenue_nhs), 0),
        'revenue_private', 0,
        'revenue_plan', 0,
        'invoices_missing_practitioner', COUNT(*) FILTER (WHERE s.has_missing_practitioner)::bigint,
        'invoices_missing_rate', COUNT(*) FILTER (WHERE s.has_missing_rate)::bigint,
        'revenue_no_practitioner', COALESCE(SUM(s.revenue_no_practitioner), 0),
        'revenue_missing_rate', COALESCE(SUM(s.revenue_missing_rate), 0)
      )
    INTO revenue_plan, revenue_private, total_revenue, result
    FROM scoped s;

    IF revenue_plan = 0 AND revenue_private = 0 AND total_revenue > 0 THEN
      revenue_private := total_revenue;
    END IF;

    result := result
      || jsonb_build_object(
        'revenue_private', revenue_private,
        'revenue_plan', revenue_plan
      );
  ELSE
    SELECT jsonb_build_object(
      'invoice_count', COUNT(*)::bigint,
      'invoices_with_revenue', COUNT(*) FILTER (WHERE v.revenue_private_plan > 0)::bigint,
      'patient_count', COUNT(DISTINCT v.patient_id)::bigint,
      'patients_with_revenue', COUNT(DISTINCT v.patient_id) FILTER (WHERE v.revenue_private_plan > 0)::bigint,
      'total_contribution', COALESCE(SUM(v.contribution), 0),
      'total_revenue', COALESCE(SUM(v.revenue_private_plan), 0),
      'revenue_nhs', COALESCE(SUM(v.revenue_nhs), 0),
      'revenue_private', COALESCE(SUM(v.revenue_private_plan), 0),
      'revenue_plan', 0,
      'invoices_missing_practitioner', COUNT(*) FILTER (WHERE v.has_missing_practitioner)::bigint,
      'invoices_missing_rate', COUNT(*) FILTER (WHERE v.has_missing_rate)::bigint,
      'revenue_no_practitioner', COALESCE(SUM(v.revenue_no_practitioner), 0),
      'revenue_missing_rate', COALESCE(SUM(v.revenue_missing_rate), 0)
    )
    INTO result
    FROM public.v_invoice_contribution v
    LEFT JOIN public.platform_integration_invoices inv
      ON inv.organization_id = v.practice_id
     AND inv.id = v.invoice_id
     AND inv.deleted_at IS NULL
    LEFT JOIN public.patients p
      ON p.id = v.patient_id
     AND p.organization_id = v.practice_id
     AND p.deleted_at IS NULL
    WHERE v.practice_id = p_practice_id
      AND v.is_paid = true
      AND (p_start_date IS NULL OR v.invoice_date >= p_start_date)
      AND (p_end_date IS NULL OR v.invoice_date <= p_end_date)
      AND (
        p_location_id IS NULL
        OR COALESCE(inv.location_id, p.location_id) = p_location_id
      );
  END IF;

  SELECT COALESCE(SUM(
    COALESCE(inv.subtotal, inv.total_amount, 0) - COALESCE(inv.nhs_amount, 0)
  ), 0)
  INTO v_total_paid
  FROM public.platform_integration_invoices inv
  LEFT JOIN public.patients p
    ON p.organization_id = inv.organization_id
   AND p.pt_id = NULLIF(BTRIM(inv.patient_id::text), '')::bigint
   AND p.deleted_at IS NULL
  WHERE inv.organization_id = p_practice_id
    AND inv.platform_type = 'dentally'
    AND inv.deleted_at IS NULL
    AND LOWER(BTRIM(COALESCE(inv.status, ''))) = 'paid'
    AND (p_start_date IS NULL OR inv.invoice_date >= p_start_date)
    AND (p_end_date IS NULL OR inv.invoice_date <= p_end_date)
    AND (
      p_location_id IS NULL
      OR COALESCE(inv.location_id, p.location_id) = p_location_id
    );

  RETURN COALESCE(result, '{}'::jsonb)
    || jsonb_build_object('total_paid_value', COALESCE(v_total_paid, 0));
END;
$$;
