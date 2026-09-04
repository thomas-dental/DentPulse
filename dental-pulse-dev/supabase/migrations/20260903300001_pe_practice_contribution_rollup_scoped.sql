-- Batch scoped practice contribution rollup: one facts scan per org (all locations),
-- replaces N pe_invoice_contribution_summary calls from practiceContributionRollup.js.

CREATE OR REPLACE FUNCTION public.pe_practice_contribution_rollup_scoped(
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
BEGIN
  PERFORM set_config('statement_timeout', '180000', true);

  use_facts := public.pe_invoice_source_has_facts(p_practice_id);

  IF use_facts THEN
    WITH scoped AS (
      SELECT
        COALESCE(inv.location_id, p.location_id) AS effective_location_id,
        f.patient_id,
        f.revenue_private_plan,
        f.contribution,
        f.has_missing_practitioner,
        f.has_missing_rate
      FROM public.pe_invoice_contribution_facts f
      LEFT JOIN public.platform_integration_invoices inv
        ON inv.organization_id = f.practice_id
       AND inv.id = f.invoice_id
       AND inv.deleted_at IS NULL
      LEFT JOIN public.patients p
        ON p.id = f.patient_id
       AND p.organization_id = f.practice_id
       AND p.deleted_at IS NULL
      WHERE f.practice_id = p_practice_id
        AND f.is_paid = true
        AND (p_start_date IS NULL OR f.invoice_date >= p_start_date)
        AND (p_end_date IS NULL OR f.invoice_date <= p_end_date)
        AND (
          p_location_id IS NULL
          OR COALESCE(inv.location_id, p.location_id) = p_location_id
        )
    ),
    practice_total AS (
      SELECT
        COUNT(*)::bigint AS invoice_count,
        COUNT(*) FILTER (WHERE revenue_private_plan > 0)::bigint AS invoices_with_revenue,
        COUNT(DISTINCT patient_id)::bigint AS patient_count,
        COUNT(DISTINCT patient_id) FILTER (WHERE revenue_private_plan > 0)::bigint
          AS patients_with_revenue,
        COALESCE(SUM(contribution), 0) AS total_contribution,
        COALESCE(SUM(revenue_private_plan), 0) AS total_revenue,
        COUNT(*) FILTER (WHERE has_missing_practitioner)::bigint AS invoices_missing_practitioner,
        COUNT(*) FILTER (WHERE has_missing_rate)::bigint AS invoices_missing_rate
      FROM scoped
    ),
    by_location AS (
      SELECT
        effective_location_id AS location_id,
        COUNT(*)::bigint AS invoice_count,
        COUNT(*) FILTER (WHERE revenue_private_plan > 0)::bigint AS invoices_with_revenue,
        COUNT(DISTINCT patient_id)::bigint AS patient_count,
        COUNT(DISTINCT patient_id) FILTER (WHERE revenue_private_plan > 0)::bigint
          AS patients_with_revenue,
        COALESCE(SUM(contribution), 0) AS total_contribution,
        COALESCE(SUM(revenue_private_plan), 0) AS total_revenue,
        COUNT(*) FILTER (WHERE has_missing_practitioner)::bigint AS invoices_missing_practitioner,
        COUNT(*) FILTER (WHERE has_missing_rate)::bigint AS invoices_missing_rate
      FROM scoped
      GROUP BY effective_location_id
    )
    SELECT jsonb_build_object(
      'practice_total', (
        SELECT jsonb_build_object(
          'invoice_count', pt.invoice_count,
          'invoices_with_revenue', pt.invoices_with_revenue,
          'patient_count', pt.patient_count,
          'patients_with_revenue', pt.patients_with_revenue,
          'total_contribution', pt.total_contribution,
          'total_revenue', pt.total_revenue,
          'invoices_missing_practitioner', pt.invoices_missing_practitioner,
          'invoices_missing_rate', pt.invoices_missing_rate
        )
        FROM practice_total pt
      ),
      'by_location', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'location_id', bl.location_id,
              'invoice_count', bl.invoice_count,
              'invoices_with_revenue', bl.invoices_with_revenue,
              'patient_count', bl.patient_count,
              'patients_with_revenue', bl.patients_with_revenue,
              'total_contribution', bl.total_contribution,
              'total_revenue', bl.total_revenue,
              'invoices_missing_practitioner', bl.invoices_missing_practitioner,
              'invoices_missing_rate', bl.invoices_missing_rate
            )
            ORDER BY bl.total_contribution DESC, bl.location_id NULLS LAST
          )
          FROM by_location bl
        ),
        '[]'::jsonb
      )
    )
    INTO result;
  ELSE
    WITH scoped AS (
      SELECT
        COALESCE(inv.location_id, p.location_id) AS effective_location_id,
        v.patient_id,
        v.revenue_private_plan,
        v.contribution,
        v.has_missing_practitioner,
        v.has_missing_rate
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
        )
    ),
    practice_total AS (
      SELECT
        COUNT(*)::bigint AS invoice_count,
        COUNT(*) FILTER (WHERE revenue_private_plan > 0)::bigint AS invoices_with_revenue,
        COUNT(DISTINCT patient_id)::bigint AS patient_count,
        COUNT(DISTINCT patient_id) FILTER (WHERE revenue_private_plan > 0)::bigint
          AS patients_with_revenue,
        COALESCE(SUM(contribution), 0) AS total_contribution,
        COALESCE(SUM(revenue_private_plan), 0) AS total_revenue,
        COUNT(*) FILTER (WHERE has_missing_practitioner)::bigint AS invoices_missing_practitioner,
        COUNT(*) FILTER (WHERE has_missing_rate)::bigint AS invoices_missing_rate
      FROM scoped
    ),
    by_location AS (
      SELECT
        effective_location_id AS location_id,
        COUNT(*)::bigint AS invoice_count,
        COUNT(*) FILTER (WHERE revenue_private_plan > 0)::bigint AS invoices_with_revenue,
        COUNT(DISTINCT patient_id)::bigint AS patient_count,
        COUNT(DISTINCT patient_id) FILTER (WHERE revenue_private_plan > 0)::bigint
          AS patients_with_revenue,
        COALESCE(SUM(contribution), 0) AS total_contribution,
        COALESCE(SUM(revenue_private_plan), 0) AS total_revenue,
        COUNT(*) FILTER (WHERE has_missing_practitioner)::bigint AS invoices_missing_practitioner,
        COUNT(*) FILTER (WHERE has_missing_rate)::bigint AS invoices_missing_rate
      FROM scoped
      GROUP BY effective_location_id
    )
    SELECT jsonb_build_object(
      'practice_total', (
        SELECT jsonb_build_object(
          'invoice_count', pt.invoice_count,
          'invoices_with_revenue', pt.invoices_with_revenue,
          'patient_count', pt.patient_count,
          'patients_with_revenue', pt.patients_with_revenue,
          'total_contribution', pt.total_contribution,
          'total_revenue', pt.total_revenue,
          'invoices_missing_practitioner', pt.invoices_missing_practitioner,
          'invoices_missing_rate', pt.invoices_missing_rate
        )
        FROM practice_total pt
      ),
      'by_location', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'location_id', bl.location_id,
              'invoice_count', bl.invoice_count,
              'invoices_with_revenue', bl.invoices_with_revenue,
              'patient_count', bl.patient_count,
              'patients_with_revenue', bl.patients_with_revenue,
              'total_contribution', bl.total_contribution,
              'total_revenue', bl.total_revenue,
              'invoices_missing_practitioner', bl.invoices_missing_practitioner,
              'invoices_missing_rate', bl.invoices_missing_rate
            )
            ORDER BY bl.total_contribution DESC, bl.location_id NULLS LAST
          )
          FROM by_location bl
        ),
        '[]'::jsonb
      )
    )
    INTO result;
  END IF;

  RETURN COALESCE(result, jsonb_build_object(
    'practice_total', '{}'::jsonb,
    'by_location', '[]'::jsonb
  ));
END;
$$;

GRANT EXECUTE ON FUNCTION public.pe_practice_contribution_rollup_scoped(UUID, UUID, DATE, DATE)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.pe_practice_contribution_rollup_scoped(UUID, UUID, DATE, DATE) IS
  'Scoped PE contribution rollup: one scan returns practice_total + per-location rows (invoice location scope).';
