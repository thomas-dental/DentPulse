-- ============================================================================
-- PE Read Performance — indexes, materialized contribution facts, SQL RPCs
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1A. Supporting indexes for invoice grain, visits, and location scope
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_piili_org_invoice
  ON public.platform_integration_invoice_line_items (organization_id, invoice_id);

CREATE INDEX IF NOT EXISTS idx_pii_org_date
  ON public.platform_integration_invoices (organization_id, invoice_date)
  WHERE platform_type = 'dentally';

CREATE INDEX IF NOT EXISTS idx_appt_org_completed
  ON public.appointments (organization_id, apmt_completed_at);

CREATE INDEX IF NOT EXISTS idx_patients_org_location
  ON public.patients (organization_id, location_id)
  WHERE deleted_at IS NULL;

-- Net production RPC — treatment_plan_items scan paths
CREATE INDEX IF NOT EXISTS idx_tpi_org_completed_at
  ON public.treatment_plan_items (organization_id, tpi_completed_at)
  WHERE tpi_completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tpi_org_practitioner
  ON public.treatment_plan_items (organization_id, tpi_practitioner_id);

-- ---------------------------------------------------------------------------
-- 2A. Materialized contribution facts (refreshed post-sync by backend)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pe_invoice_contribution_facts (
  practice_id UUID NOT NULL,
  invoice_id UUID NOT NULL,
  platform_invoice_id TEXT,
  invoice_date DATE,
  patient_id UUID,
  pt_id BIGINT,
  revenue_private_plan NUMERIC(15, 2) NOT NULL DEFAULT 0,
  revenue_nhs NUMERIC(15, 2) NOT NULL DEFAULT 0,
  nhs_excluded_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  is_private_or_plan BOOLEAN NOT NULL DEFAULT false,
  is_nhs BOOLEAN NOT NULL DEFAULT false,
  dominant_practitioner_id UUID,
  private_share_rate NUMERIC(8, 4),
  has_missing_practitioner BOOLEAN NOT NULL DEFAULT false,
  has_missing_rate BOOLEAN NOT NULL DEFAULT false,
  revenue_no_practitioner NUMERIC(15, 2) NOT NULL DEFAULT 0,
  revenue_missing_rate NUMERIC(15, 2) NOT NULL DEFAULT 0,
  clinician_cost NUMERIC(15, 2) NOT NULL DEFAULT 0,
  lab_cost NUMERIC(15, 2) NOT NULL DEFAULT 0,
  materials_cost NUMERIC(15, 2) NOT NULL DEFAULT 0,
  membership_service_cost NUMERIC(15, 2) NOT NULL DEFAULT 0,
  allocated_cac NUMERIC(15, 2) NOT NULL DEFAULT 0,
  direct_cost NUMERIC(15, 2) NOT NULL DEFAULT 0,
  contribution NUMERIC(15, 2) NOT NULL DEFAULT 0,
  contribution_provenance_status TEXT NOT NULL DEFAULT 'complete',
  revenue_tier TEXT,
  clinician_cost_tier TEXT,
  lab_cost_tier TEXT,
  material_cost_tier TEXT,
  membership_service_cost_tier TEXT,
  allocated_cac_tier TEXT,
  contribution_tier TEXT,
  confidence_score INTEGER,
  confidence TEXT,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pe_invoice_contribution_facts_pkey
    PRIMARY KEY (practice_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_pe_invoice_facts_practice_date
  ON public.pe_invoice_contribution_facts (practice_id, invoice_date);

CREATE INDEX IF NOT EXISTS idx_pe_invoice_facts_practice_patient
  ON public.pe_invoice_contribution_facts (practice_id, patient_id);

CREATE TABLE IF NOT EXISTS public.pe_patient_contribution_facts (
  practice_id UUID NOT NULL,
  patient_id UUID NOT NULL,
  pt_id BIGINT,
  retention_status TEXT,
  contribution NUMERIC(15, 2) NOT NULL DEFAULT 0,
  revenue_private_plan NUMERIC(15, 2) NOT NULL DEFAULT 0,
  invoice_count BIGINT NOT NULL DEFAULT 0,
  confidence_score INTEGER,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pe_patient_contribution_facts_pkey
    PRIMARY KEY (practice_id, patient_id)
);

CREATE INDEX IF NOT EXISTS idx_pe_patient_facts_practice_retention
  ON public.pe_patient_contribution_facts (practice_id, retention_status);

CREATE TABLE IF NOT EXISTS public.pe_practice_contribution_facts (
  practice_id UUID NOT NULL PRIMARY KEY,
  invoice_count BIGINT NOT NULL DEFAULT 0,
  invoices_with_revenue BIGINT NOT NULL DEFAULT 0,
  patient_count BIGINT NOT NULL DEFAULT 0,
  patients_with_revenue BIGINT NOT NULL DEFAULT 0,
  revenue_private_plan NUMERIC(15, 2) NOT NULL DEFAULT 0,
  clinician_cost NUMERIC(15, 2) NOT NULL DEFAULT 0,
  direct_cost NUMERIC(15, 2) NOT NULL DEFAULT 0,
  contribution NUMERIC(15, 2) NOT NULL DEFAULT 0,
  margin_pct NUMERIC(8, 1),
  invoices_complete BIGINT NOT NULL DEFAULT 0,
  invoices_partial_no_practitioner BIGINT NOT NULL DEFAULT 0,
  invoices_partial_missing_rate BIGINT NOT NULL DEFAULT 0,
  pct_complete NUMERIC(8, 1),
  pct_partial_no_practitioner NUMERIC(8, 1),
  pct_partial_missing_rate NUMERIC(8, 1),
  contribution_provenance_status TEXT NOT NULL DEFAULT 'complete',
  revenue_tier TEXT,
  clinician_cost_tier TEXT,
  lab_cost_tier TEXT,
  material_cost_tier TEXT,
  contribution_tier TEXT,
  confidence_score INTEGER,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS (PE pattern — org members read; service_role upserts)
ALTER TABLE public.pe_invoice_contribution_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pe_patient_contribution_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pe_practice_contribution_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view invoice contribution facts for their practice"
  ON public.pe_invoice_contribution_facts;
CREATE POLICY "Users can view invoice contribution facts for their practice"
  ON public.pe_invoice_contribution_facts
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.user_in_org(auth.uid(), practice_id));

DROP POLICY IF EXISTS "Users can view patient contribution facts for their practice"
  ON public.pe_patient_contribution_facts;
CREATE POLICY "Users can view patient contribution facts for their practice"
  ON public.pe_patient_contribution_facts
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.user_in_org(auth.uid(), practice_id));

DROP POLICY IF EXISTS "Users can view practice contribution facts for their practice"
  ON public.pe_practice_contribution_facts;
CREATE POLICY "Users can view practice contribution facts for their practice"
  ON public.pe_practice_contribution_facts
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.user_in_org(auth.uid(), practice_id));

REVOKE ALL ON TABLE public.pe_invoice_contribution_facts FROM anon, authenticated;
GRANT SELECT ON TABLE public.pe_invoice_contribution_facts TO authenticated;
REVOKE ALL ON TABLE public.pe_invoice_contribution_facts FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pe_invoice_contribution_facts TO service_role;

REVOKE ALL ON TABLE public.pe_patient_contribution_facts FROM anon, authenticated;
GRANT SELECT ON TABLE public.pe_patient_contribution_facts TO authenticated;
REVOKE ALL ON TABLE public.pe_patient_contribution_facts FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pe_patient_contribution_facts TO service_role;

REVOKE ALL ON TABLE public.pe_practice_contribution_facts FROM anon, authenticated;
GRANT SELECT ON TABLE public.pe_practice_contribution_facts TO authenticated;
REVOKE ALL ON TABLE public.pe_practice_contribution_facts FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pe_practice_contribution_facts TO service_role;

-- ---------------------------------------------------------------------------
-- 2B. Refresh job (full practice upsert from live views — post-sync path)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_pe_contribution_facts(p_practice_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.pe_invoice_contribution_facts
  WHERE practice_id = p_practice_id;

  INSERT INTO public.pe_invoice_contribution_facts (
    practice_id, invoice_id, platform_invoice_id, invoice_date, patient_id, pt_id,
    revenue_private_plan, revenue_nhs, nhs_excluded_amount, is_private_or_plan, is_nhs,
    dominant_practitioner_id, private_share_rate, has_missing_practitioner, has_missing_rate,
    revenue_no_practitioner, revenue_missing_rate, clinician_cost, lab_cost, materials_cost,
    membership_service_cost, allocated_cac, direct_cost, contribution,
    contribution_provenance_status, revenue_tier, clinician_cost_tier, lab_cost_tier,
    material_cost_tier, membership_service_cost_tier, allocated_cac_tier, contribution_tier,
    confidence_score, confidence, refreshed_at
  )
  SELECT
    practice_id, invoice_id, platform_invoice_id, invoice_date, patient_id, pt_id,
    revenue_private_plan, revenue_nhs, nhs_excluded_amount, is_private_or_plan, is_nhs,
    dominant_practitioner_id, private_share_rate, has_missing_practitioner, has_missing_rate,
    revenue_no_practitioner, revenue_missing_rate, clinician_cost, lab_cost, materials_cost,
    membership_service_cost, allocated_cac, direct_cost, contribution,
    contribution_provenance_status, revenue_tier, clinician_cost_tier, lab_cost_tier,
    material_cost_tier, membership_service_cost_tier, allocated_cac_tier, contribution_tier,
    confidence_score, confidence, NOW()
  FROM public.v_invoice_contribution
  WHERE practice_id = p_practice_id;

  DELETE FROM public.pe_patient_contribution_facts
  WHERE practice_id = p_practice_id;

  INSERT INTO public.pe_patient_contribution_facts (
    practice_id, patient_id, pt_id, retention_status, contribution,
    revenue_private_plan, invoice_count, confidence_score, refreshed_at
  )
  SELECT
    pc.practice_id,
    pc.patient_id,
    pc.pt_id,
    COALESCE(seg.retention_status, 'active'),
    pc.contribution,
    pc.revenue_private_plan,
    pc.invoice_count,
    pc.confidence_score,
    NOW()
  FROM public.v_patient_contribution pc
  LEFT JOIN public.v_pe_retention_segment seg
    ON seg.practice_id = pc.practice_id
   AND seg.patient_id = pc.patient_id
  WHERE pc.practice_id = p_practice_id
    AND pc.patient_id IS NOT NULL;

  DELETE FROM public.pe_practice_contribution_facts
  WHERE practice_id = p_practice_id;

  INSERT INTO public.pe_practice_contribution_facts (
    practice_id, invoice_count, invoices_with_revenue, patient_count, patients_with_revenue,
    revenue_private_plan, clinician_cost, direct_cost, contribution, margin_pct,
    invoices_complete, invoices_partial_no_practitioner, invoices_partial_missing_rate,
    pct_complete, pct_partial_no_practitioner, pct_partial_missing_rate,
    contribution_provenance_status, revenue_tier, clinician_cost_tier, lab_cost_tier,
    material_cost_tier, contribution_tier, confidence_score, refreshed_at
  )
  SELECT
    practice_id, invoice_count, invoices_with_revenue, patient_count, patients_with_revenue,
    revenue_private_plan, clinician_cost, direct_cost, contribution, margin_pct,
    invoices_complete, invoices_partial_no_practitioner, invoices_partial_missing_rate,
    pct_complete, pct_partial_no_practitioner, pct_partial_missing_rate,
    contribution_provenance_status, revenue_tier, clinician_cost_tier, lab_cost_tier,
    material_cost_tier, contribution_tier, confidence_score, NOW()
  FROM public.v_practice_contribution
  WHERE practice_id = p_practice_id;
END;
$$;

COMMENT ON FUNCTION public.refresh_pe_contribution_facts(UUID) IS
  'Rebuild PE contribution fact tables for one practice from live views. Called after invoice sync chunks.';

GRANT EXECUTE ON FUNCTION public.refresh_pe_contribution_facts(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- Helper: invoice grain source (facts when populated, else live view)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pe_invoice_source_has_facts(p_practice_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pe_invoice_contribution_facts
    WHERE practice_id = p_practice_id
    LIMIT 1
  );
$$;

-- ---------------------------------------------------------------------------
-- 1A. pe_invoice_contribution_summary — one JSON row per practice
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pe_invoice_contribution_summary(p_practice_id UUID)
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
  use_facts := public.pe_invoice_source_has_facts(p_practice_id);

  IF use_facts THEN
    SELECT jsonb_build_object(
      'invoice_count', COUNT(*)::bigint,
      'invoices_with_revenue', COUNT(*) FILTER (WHERE revenue_private_plan > 0)::bigint,
      'patient_count', COUNT(DISTINCT patient_id)::bigint,
      'patients_with_revenue', COUNT(DISTINCT patient_id) FILTER (WHERE revenue_private_plan > 0)::bigint,
      'total_contribution', COALESCE(SUM(contribution), 0),
      'total_revenue', COALESCE(SUM(revenue_private_plan), 0),
      'revenue_nhs', COALESCE(SUM(revenue_nhs), 0),
      'invoices_missing_practitioner', COUNT(*) FILTER (WHERE has_missing_practitioner)::bigint,
      'invoices_missing_rate', COUNT(*) FILTER (WHERE has_missing_rate)::bigint,
      'revenue_no_practitioner', COALESCE(SUM(revenue_no_practitioner), 0),
      'revenue_missing_rate', COALESCE(SUM(revenue_missing_rate), 0)
    )
    INTO result
    FROM public.pe_invoice_contribution_facts
    WHERE practice_id = p_practice_id;
  ELSE
    SELECT jsonb_build_object(
      'invoice_count', COUNT(*)::bigint,
      'invoices_with_revenue', COUNT(*) FILTER (WHERE revenue_private_plan > 0)::bigint,
      'patient_count', COUNT(DISTINCT patient_id)::bigint,
      'patients_with_revenue', COUNT(DISTINCT patient_id) FILTER (WHERE revenue_private_plan > 0)::bigint,
      'total_contribution', COALESCE(SUM(contribution), 0),
      'total_revenue', COALESCE(SUM(revenue_private_plan), 0),
      'revenue_nhs', COALESCE(SUM(revenue_nhs), 0),
      'invoices_missing_practitioner', COUNT(*) FILTER (WHERE has_missing_practitioner)::bigint,
      'invoices_missing_rate', COUNT(*) FILTER (WHERE has_missing_rate)::bigint,
      'revenue_no_practitioner', COALESCE(SUM(revenue_no_practitioner), 0),
      'revenue_missing_rate', COALESCE(SUM(revenue_missing_rate), 0)
    )
    INTO result
    FROM public.v_invoice_contribution
    WHERE practice_id = p_practice_id;
  END IF;

  RETURN COALESCE(result, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pe_invoice_contribution_summary(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- pe_retention_segment_rollup — segment counts + contribution sums
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pe_retention_segment_rollup(
  p_practice_id UUID,
  p_location_id UUID DEFAULT NULL
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
  use_facts := EXISTS (
    SELECT 1 FROM public.pe_patient_contribution_facts
    WHERE practice_id = p_practice_id LIMIT 1
  );

  IF use_facts THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'retention_status', retention_status,
          'patient_count', patient_count,
          'contribution_gbp', contribution_gbp
        )
        ORDER BY retention_status
      ),
      '[]'::jsonb
    )
    INTO result
    FROM (
      SELECT
        COALESCE(f.retention_status, 'active') AS retention_status,
        COUNT(*)::bigint AS patient_count,
        ROUND(COALESCE(SUM(f.contribution), 0), 2) AS contribution_gbp
      FROM public.pe_patient_contribution_facts f
      LEFT JOIN public.patients p
        ON p.id = f.patient_id
       AND p.organization_id = f.practice_id
       AND p.deleted_at IS NULL
      WHERE f.practice_id = p_practice_id
        AND (
          p_location_id IS NULL
          OR p.location_id = p_location_id
        )
      GROUP BY COALESCE(f.retention_status, 'active')
    ) seg;
  ELSE
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'retention_status', retention_status,
          'patient_count', patient_count,
          'contribution_gbp', contribution_gbp
        )
        ORDER BY retention_status
      ),
      '[]'::jsonb
    )
    INTO result
    FROM (
      SELECT
        COALESCE(seg.retention_status, 'active') AS retention_status,
        COUNT(*)::bigint AS patient_count,
        ROUND(COALESCE(SUM(pc.contribution), 0), 2) AS contribution_gbp
      FROM public.v_patient_contribution pc
      LEFT JOIN public.v_pe_retention_segment seg
        ON seg.practice_id = pc.practice_id
       AND seg.patient_id = pc.patient_id
      LEFT JOIN public.patients p
        ON p.id = pc.patient_id
       AND p.organization_id = pc.practice_id
       AND p.deleted_at IS NULL
      WHERE pc.practice_id = p_practice_id
        AND (
          p_location_id IS NULL
          OR p.location_id = p_location_id
        )
      GROUP BY COALESCE(seg.retention_status, 'active')
    ) seg;
  END IF;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pe_retention_segment_rollup(UUID, UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- pe_growth_levers_facts — visits + revenue aggregates (location via patients join)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pe_growth_levers_facts(
  p_practice_id UUID,
  p_since_date DATE,
  p_location_id UUID DEFAULT NULL
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
  visits_by_month JSONB;
  revenue_by_month JSONB;
BEGIN
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
    SELECT COALESCE(SUM(f.revenue_private_plan), 0)
    INTO revenue_total
    FROM public.pe_invoice_contribution_facts f
    LEFT JOIN public.patients p
      ON p.id = f.patient_id
     AND p.organization_id = f.practice_id
     AND p.deleted_at IS NULL
    WHERE f.practice_id = p_practice_id
      AND f.invoice_date >= p_since_date
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
        AND f.revenue_private_plan > 0
        AND (p_location_id IS NULL OR p.location_id = p_location_id)
      GROUP BY to_char(f.invoice_date, 'YYYY-MM')
    ) r;
  ELSE
    SELECT COALESCE(SUM(v.revenue_private_plan), 0)
    INTO revenue_total
    FROM public.v_invoice_contribution v
    LEFT JOIN public.patients p
      ON p.id = v.patient_id
     AND p.organization_id = v.practice_id
     AND p.deleted_at IS NULL
    WHERE v.practice_id = p_practice_id
      AND v.invoice_date >= p_since_date
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
        AND v.revenue_private_plan > 0
        AND (p_location_id IS NULL OR p.location_id = p_location_id)
      GROUP BY to_char(v.invoice_date, 'YYYY-MM')
    ) r;
  END IF;

  RETURN jsonb_build_object(
    'active_patient_count', active_count,
    'total_completed_visits', visit_total,
    'total_revenue_private_plan', ROUND(COALESCE(revenue_total, 0), 2),
    'visits_by_month', COALESCE(visits_by_month, '{}'::jsonb),
    'revenue_by_month', COALESCE(revenue_by_month, '{}'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pe_growth_levers_facts(UUID, DATE, UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- pe_practice_contribution_rollup — practice row from facts or view
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pe_practice_contribution_row(p_practice_id UUID)
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
  use_facts := EXISTS (
    SELECT 1 FROM public.pe_practice_contribution_facts
    WHERE practice_id = p_practice_id
  );

  IF use_facts THEN
    SELECT to_jsonb(f)
    INTO result
    FROM public.pe_practice_contribution_facts f
    WHERE f.practice_id = p_practice_id;
  ELSE
    SELECT to_jsonb(v)
    INTO result
    FROM public.v_practice_contribution v
    WHERE v.practice_id = p_practice_id;
  END IF;

  RETURN COALESCE(result, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pe_practice_contribution_row(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- pe_location_contribution_rollup — per-location aggregates for multi-site bars
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pe_location_contribution_rollup(p_practice_id UUID)
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
  use_facts := public.pe_invoice_source_has_facts(p_practice_id);

  IF use_facts THEN
    SELECT COALESCE(
      jsonb_agg(row_to_json(loc)::jsonb ORDER BY loc.location_id NULLS LAST),
      '[]'::jsonb
    )
    INTO result
    FROM (
      SELECT
        p.location_id,
        COUNT(*)::bigint AS invoice_count,
        COUNT(*) FILTER (WHERE f.revenue_private_plan > 0)::bigint AS invoices_with_revenue,
        COUNT(DISTINCT f.patient_id)::bigint AS patient_count,
        COUNT(DISTINCT f.patient_id) FILTER (WHERE f.revenue_private_plan > 0)::bigint
          AS patients_with_revenue,
        COALESCE(SUM(f.revenue_private_plan), 0)::numeric(15, 2) AS revenue_private_plan,
        COALESCE(SUM(f.clinician_cost), 0)::numeric(15, 2) AS clinician_cost,
        COALESCE(SUM(f.direct_cost), 0)::numeric(15, 2) AS direct_cost,
        COALESCE(SUM(f.contribution), 0)::numeric(15, 2) AS contribution,
        COUNT(*) FILTER (WHERE f.contribution_provenance_status = 'complete')::bigint
          AS invoices_complete,
        COUNT(*) FILTER (
          WHERE f.contribution_provenance_status = 'partial_no_practitioner'
        )::bigint AS invoices_partial_no_practitioner,
        COUNT(*) FILTER (
          WHERE f.contribution_provenance_status = 'partial_missing_rate'
        )::bigint AS invoices_partial_missing_rate,
        ROUND(AVG(f.confidence_score))::integer AS confidence_score_sum
      FROM public.pe_invoice_contribution_facts f
      INNER JOIN public.patients p
        ON p.id = f.patient_id
       AND p.organization_id = f.practice_id
       AND p.deleted_at IS NULL
      WHERE f.practice_id = p_practice_id
      GROUP BY p.location_id
    ) loc;
  ELSE
    SELECT COALESCE(
      jsonb_agg(row_to_json(loc)::jsonb ORDER BY loc.location_id NULLS LAST),
      '[]'::jsonb
    )
    INTO result
    FROM (
      SELECT
        p.location_id,
        COUNT(*)::bigint AS invoice_count,
        COUNT(*) FILTER (WHERE v.revenue_private_plan > 0)::bigint AS invoices_with_revenue,
        COUNT(DISTINCT v.patient_id)::bigint AS patient_count,
        COUNT(DISTINCT v.patient_id) FILTER (WHERE v.revenue_private_plan > 0)::bigint
          AS patients_with_revenue,
        COALESCE(SUM(v.revenue_private_plan), 0)::numeric(15, 2) AS revenue_private_plan,
        COALESCE(SUM(v.clinician_cost), 0)::numeric(15, 2) AS clinician_cost,
        COALESCE(SUM(v.direct_cost), 0)::numeric(15, 2) AS direct_cost,
        COALESCE(SUM(v.contribution), 0)::numeric(15, 2) AS contribution,
        COUNT(*) FILTER (WHERE v.contribution_provenance_status = 'complete')::bigint
          AS invoices_complete,
        COUNT(*) FILTER (
          WHERE v.contribution_provenance_status = 'partial_no_practitioner'
        )::bigint AS invoices_partial_no_practitioner,
        COUNT(*) FILTER (
          WHERE v.contribution_provenance_status = 'partial_missing_rate'
        )::bigint AS invoices_partial_missing_rate,
        ROUND(AVG(v.confidence_score))::integer AS confidence_score_sum
      FROM public.v_invoice_contribution v
      INNER JOIN public.patients p
        ON p.id = v.patient_id
       AND p.organization_id = v.practice_id
       AND p.deleted_at IS NULL
      WHERE v.practice_id = p_practice_id
      GROUP BY p.location_id
    ) loc;
  END IF;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pe_location_contribution_rollup(UUID) TO authenticated, service_role;
