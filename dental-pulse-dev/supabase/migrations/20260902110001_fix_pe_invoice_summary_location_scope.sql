-- Fix pe_invoice_contribution_summary facts branch: pe_invoice_contribution_facts
-- has no location_id column; filter location via patients.location_id only.

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
BEGIN
  use_facts := public.pe_invoice_source_has_facts(p_practice_id);

  IF use_facts THEN
    SELECT
      COALESCE(SUM(f.revenue_private_plan) FILTER (
        WHERE f.revenue_private_plan > 0
          AND f.pt_id IS NOT NULL
          AND f.pt_id IN (
            SELECT p.pt_id
            FROM public.patients p
            WHERE p.organization_id = p_practice_id
              AND p.deleted_at IS NULL
              AND (p_location_id IS NULL OR p.location_id = p_location_id)
              AND p.pt_payment_plan_id IN (
                SELECT public.pe_membership_plan_pp_ids(p_practice_id)
              )
          )
      ), 0),
      COALESCE(SUM(f.revenue_private_plan) FILTER (
        WHERE f.revenue_private_plan > 0
          AND (
            f.pt_id IS NULL
            OR f.pt_id NOT IN (
              SELECT p.pt_id
              FROM public.patients p
              WHERE p.organization_id = p_practice_id
                AND p.deleted_at IS NULL
                AND (p_location_id IS NULL OR p.location_id = p_location_id)
                AND p.pt_payment_plan_id IN (
                  SELECT public.pe_membership_plan_pp_ids(p_practice_id)
                )
            )
          )
      ), 0),
      COALESCE(SUM(f.revenue_private_plan), 0)
    INTO revenue_plan, revenue_private, total_revenue
    FROM public.pe_invoice_contribution_facts f
    LEFT JOIN public.patients p
      ON p.id = f.patient_id
     AND p.organization_id = f.practice_id
     AND p.deleted_at IS NULL
    WHERE f.practice_id = p_practice_id
      AND (p_start_date IS NULL OR f.invoice_date >= p_start_date)
      AND (p_end_date IS NULL OR f.invoice_date <= p_end_date)
      AND (p_location_id IS NULL OR p.location_id = p_location_id);

    IF revenue_plan = 0 AND revenue_private = 0 AND total_revenue > 0 THEN
      revenue_private := total_revenue;
    END IF;

    SELECT jsonb_build_object(
      'invoice_count', COUNT(*)::bigint,
      'invoices_with_revenue', COUNT(*) FILTER (WHERE revenue_private_plan > 0)::bigint,
      'patient_count', COUNT(DISTINCT patient_id)::bigint,
      'patients_with_revenue', COUNT(DISTINCT patient_id) FILTER (WHERE revenue_private_plan > 0)::bigint,
      'total_contribution', COALESCE(SUM(contribution), 0),
      'total_revenue', COALESCE(SUM(revenue_private_plan), 0),
      'revenue_nhs', COALESCE(SUM(revenue_nhs), 0),
      'revenue_private', revenue_private,
      'revenue_plan', revenue_plan,
      'invoices_missing_practitioner', COUNT(*) FILTER (WHERE has_missing_practitioner)::bigint,
      'invoices_missing_rate', COUNT(*) FILTER (WHERE has_missing_rate)::bigint,
      'revenue_no_practitioner', COALESCE(SUM(revenue_no_practitioner), 0),
      'revenue_missing_rate', COALESCE(SUM(revenue_missing_rate), 0)
    )
    INTO result
    FROM public.pe_invoice_contribution_facts f
    LEFT JOIN public.patients p
      ON p.id = f.patient_id
     AND p.organization_id = f.practice_id
     AND p.deleted_at IS NULL
    WHERE f.practice_id = p_practice_id
      AND (p_start_date IS NULL OR f.invoice_date >= p_start_date)
      AND (p_end_date IS NULL OR f.invoice_date <= p_end_date)
      AND (p_location_id IS NULL OR p.location_id = p_location_id);
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
    LEFT JOIN public.patients p
      ON p.id = v.patient_id
     AND p.organization_id = v.practice_id
     AND p.deleted_at IS NULL
    WHERE v.practice_id = p_practice_id
      AND (p_start_date IS NULL OR v.invoice_date >= p_start_date)
      AND (p_end_date IS NULL OR v.invoice_date <= p_end_date)
      AND (
        p_location_id IS NULL
        OR p.location_id = p_location_id
      );
  END IF;

  RETURN COALESCE(result, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pe_invoice_contribution_summary(UUID, UUID, DATE, DATE)
  TO authenticated, service_role;
