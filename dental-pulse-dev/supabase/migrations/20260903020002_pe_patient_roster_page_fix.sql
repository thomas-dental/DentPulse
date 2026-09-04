-- Fix pe_patient_roster_page: avoid UNION of unused grains + simplify opportunity.
-- Empty-string UUID cast was raised inside the previous monolithic RETURN QUERY.

CREATE OR REPLACE FUNCTION public.pe_patient_roster_page(
  p_practice_id UUID,
  p_location_id UUID DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_retention_filter TEXT DEFAULT 'all',
  p_type_filter TEXT DEFAULT 'all',
  p_sort_key TEXT DEFAULT 'contribution',
  p_sort_dir TEXT DEFAULT 'desc',
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0,
  p_metrics_since DATE DEFAULT NULL
)
RETURNS TABLE (
  patient_id UUID,
  pt_id BIGINT,
  patient_name TEXT,
  patient_uuid TEXT,
  location_id UUID,
  location_name TEXT,
  is_active BOOLEAN,
  has_payment_plan BOOLEAN,
  retention_status TEXT,
  contribution NUMERIC(15, 2),
  revenue_private_plan NUMERIC(15, 2),
  invoice_count BIGINT,
  confidence_score INTEGER,
  clinician_cost NUMERIC(15, 2),
  direct_cost NUMERIC(15, 2),
  margin_pct NUMERIC(15, 2),
  contribution_12mo NUMERIC(15, 2),
  visits_12mo BIGINT,
  visit_freq_per_year NUMERIC(15, 2),
  value_per_visit NUMERIC(15, 2),
  opportunity_gross NUMERIC(15, 2),
  quality_score INTEGER,
  patient_economic_value NUMERIC(15, 2),
  cltv_projection NUMERIC(15, 2),
  cltv_tier TEXT,
  quality_score_tier TEXT,
  modelled_confidence_score INTEGER,
  modelled_computed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  use_facts boolean;
  has_scope boolean;
  metrics_since date;
  visits_since date;
  search_q text;
  sort_key text;
  sort_asc boolean;
  lim int;
  off int;
BEGIN
  use_facts := public.pe_invoice_source_has_facts(p_practice_id);
  has_scope := (p_location_id IS NOT NULL)
    OR (p_start_date IS NOT NULL AND p_end_date IS NOT NULL);
  metrics_since := COALESCE(
    p_metrics_since,
    CASE
      WHEN p_start_date IS NOT NULL AND p_end_date IS NOT NULL THEN p_start_date
      ELSE (CURRENT_DATE - INTERVAL '12 months')::date
    END
  );
  visits_since := (CURRENT_DATE - INTERVAL '12 months')::date;
  search_q := NULLIF(LOWER(BTRIM(COALESCE(p_search, ''))), '');
  sort_key := COALESCE(NULLIF(BTRIM(p_sort_key), ''), 'contribution');
  sort_asc := LOWER(COALESCE(p_sort_dir, 'desc')) = 'asc';
  lim := GREATEST(1, LEAST(COALESCE(p_limit, 25), 10000));
  off := GREATEST(0, COALESCE(p_offset, 0));

  RETURN QUERY
  WITH base AS (
    -- Scoped: aggregate invoice grain
    SELECT
      s.pid,
      s.dentally_pt_id,
      s.contrib,
      s.rev_pp,
      s.inv_count,
      s.conf_score,
      s.clin_cost,
      s.dir_cost,
      COALESCE(pf.retention_status, 'active') AS ret_status,
      COALESCE(pf.location_id, p.location_id) AS loc_id
    FROM (
      SELECT
        f.patient_id AS pid,
        MAX(f.pt_id) AS dentally_pt_id,
        COALESCE(SUM(f.contribution), 0)::numeric(15, 2) AS contrib,
        COALESCE(SUM(f.revenue_private_plan), 0)::numeric(15, 2) AS rev_pp,
        COUNT(*)::bigint AS inv_count,
        MAX(f.confidence_score) AS conf_score,
        COALESCE(SUM(f.clinician_cost), 0)::numeric(15, 2) AS clin_cost,
        COALESCE(SUM(f.direct_cost), 0)::numeric(15, 2) AS dir_cost
      FROM public.pe_invoice_contribution_facts f
      LEFT JOIN public.patients p0
        ON p0.id = f.patient_id
       AND p0.organization_id = f.practice_id
       AND p0.deleted_at IS NULL
      WHERE has_scope
        AND use_facts
        AND f.practice_id = p_practice_id
        AND (f.patient_id IS NOT NULL OR f.pt_id IS NOT NULL)
        AND (p_start_date IS NULL OR f.invoice_date >= p_start_date)
        AND (p_end_date IS NULL OR f.invoice_date <= p_end_date)
        AND (p_location_id IS NULL OR p0.location_id = p_location_id)
      GROUP BY
        f.patient_id,
        CASE WHEN f.patient_id IS NULL THEN f.pt_id ELSE NULL END

      UNION ALL

      SELECT
        v.patient_id AS pid,
        MAX(v.pt_id) AS dentally_pt_id,
        COALESCE(SUM(v.contribution), 0)::numeric(15, 2) AS contrib,
        COALESCE(SUM(v.revenue_private_plan), 0)::numeric(15, 2) AS rev_pp,
        COUNT(*)::bigint AS inv_count,
        MAX(v.confidence_score) AS conf_score,
        COALESCE(SUM(v.clinician_cost), 0)::numeric(15, 2) AS clin_cost,
        COALESCE(SUM(v.direct_cost), 0)::numeric(15, 2) AS dir_cost
      FROM public.v_invoice_contribution v
      LEFT JOIN public.patients p0
        ON p0.id = v.patient_id
       AND p0.organization_id = v.practice_id
       AND p0.deleted_at IS NULL
      WHERE has_scope
        AND NOT use_facts
        AND v.practice_id = p_practice_id
        AND (v.patient_id IS NOT NULL OR v.pt_id IS NOT NULL)
        AND (p_start_date IS NULL OR v.invoice_date >= p_start_date)
        AND (p_end_date IS NULL OR v.invoice_date <= p_end_date)
        AND (p_location_id IS NULL OR p0.location_id = p_location_id)
      GROUP BY
        v.patient_id,
        CASE WHEN v.patient_id IS NULL THEN v.pt_id ELSE NULL END
    ) s
    LEFT JOIN public.pe_patient_contribution_facts pf
      ON has_scope
     AND pf.practice_id = p_practice_id
     AND (
       (s.pid IS NOT NULL AND pf.patient_id = s.pid)
       OR (
         s.pid IS NULL
         AND pf.patient_id IS NULL
         AND pf.pt_id IS NOT DISTINCT FROM s.dentally_pt_id
       )
     )
    LEFT JOIN public.patients p
      ON p.id = s.pid
     AND p.organization_id = p_practice_id
     AND p.deleted_at IS NULL
    WHERE has_scope

    UNION ALL

    -- Unscoped: patient facts + cost rollup
    SELECT
      pf.patient_id AS pid,
      pf.pt_id AS dentally_pt_id,
      COALESCE(pf.contribution, 0)::numeric(15, 2) AS contrib,
      COALESCE(pf.revenue_private_plan, 0)::numeric(15, 2) AS rev_pp,
      COALESCE(pf.invoice_count, 0)::bigint AS inv_count,
      pf.confidence_score AS conf_score,
      COALESCE(ic.clin_cost, 0)::numeric(15, 2) AS clin_cost,
      COALESCE(ic.dir_cost, 0)::numeric(15, 2) AS dir_cost,
      COALESCE(pf.retention_status, 'active') AS ret_status,
      COALESCE(pf.location_id, p.location_id) AS loc_id
    FROM public.pe_patient_contribution_facts pf
    LEFT JOIN public.patients p
      ON p.id = pf.patient_id
     AND p.organization_id = p_practice_id
     AND p.deleted_at IS NULL
    LEFT JOIN (
      SELECT
        f.patient_id,
        COALESCE(SUM(f.clinician_cost), 0)::numeric(15, 2) AS clin_cost,
        COALESCE(SUM(f.direct_cost), 0)::numeric(15, 2) AS dir_cost
      FROM public.pe_invoice_contribution_facts f
      WHERE NOT has_scope
        AND use_facts
        AND f.practice_id = p_practice_id
        AND f.patient_id IS NOT NULL
      GROUP BY f.patient_id
    ) ic
      ON ic.patient_id = pf.patient_id
    WHERE NOT has_scope
      AND pf.practice_id = p_practice_id
  ),
  contrib_12 AS (
    SELECT
      f.patient_id AS pid,
      COALESCE(SUM(f.contribution), 0)::numeric(15, 2) AS c12
    FROM public.pe_invoice_contribution_facts f
    WHERE use_facts
      AND f.practice_id = p_practice_id
      AND f.patient_id IS NOT NULL
      AND f.invoice_date >= metrics_since
      AND (p_end_date IS NULL OR f.invoice_date <= p_end_date)
    GROUP BY f.patient_id

    UNION ALL

    SELECT
      v.patient_id AS pid,
      COALESCE(SUM(v.contribution), 0)::numeric(15, 2) AS c12
    FROM public.v_invoice_contribution v
    WHERE NOT use_facts
      AND v.practice_id = p_practice_id
      AND v.patient_id IS NOT NULL
      AND v.invoice_date >= metrics_since
      AND (p_end_date IS NULL OR v.invoice_date <= p_end_date)
    GROUP BY v.patient_id
  ),
  visits_12 AS (
    SELECT
      a.apmt_patient_id AS dentally_pt_id,
      COUNT(*)::bigint AS visit_count
    FROM public.appointments a
    WHERE a.organization_id = p_practice_id
      AND a.apmt_patient_id IS NOT NULL
      AND a.apmt_completed_at >= visits_since
      AND LOWER(BTRIM(COALESCE(a.apmt_state, ''))) NOT IN (
        'cancelled', 'did not attend', 'dna'
      )
    GROUP BY a.apmt_patient_id
  ),
  -- Gross open pipeline (sort proxy for commitment-weighted opportunity).
  opportunity AS (
    SELECT
      el.patient_id AS pid,
      COALESCE(
        SUM(
          COALESCE(
            NULLIF(el.payload ->> 'planned_value', '')::numeric,
            NULLIF(el.payload ->> 'tp_private_treatment_value', '')::numeric,
            NULLIF(el.payload ->> 'value', '')::numeric,
            0::numeric
          )
        ),
        0
      )::numeric(15, 2) AS opportunity_gross
    FROM public.event_ledger el
    WHERE el.practice_id = p_practice_id
      AND el.event_type = 'PLAN_CREATED'
      AND el.patient_id IS NOT NULL
    GROUP BY el.patient_id
  ),
  enriched AS (
    SELECT
      b.pid AS eid,
      COALESCE(p.pt_id, b.dentally_pt_id) AS e_pt_id,
      NULLIF(
        BTRIM(COALESCE(p.pt_first_name, '') || ' ' || COALESCE(p.pt_last_name, '')),
        ''
      ) AS e_patient_name,
      NULLIF(BTRIM(COALESCE(p.pt_unique_id::text, '')), '') AS e_patient_uuid,
      COALESCE(p.location_id, b.loc_id) AS e_location_id,
      CASE
        WHEN COALESCE(p.location_id, b.loc_id) IS NULL THEN NULL
        ELSE NULLIF(BTRIM(COALESCE(pl.location_name, '')), '')
      END AS e_location_name,
      COALESCE(p.is_active, false) AS e_is_active,
      COALESCE(p.pt_payment_plan_id IS NOT NULL, false) AS e_has_payment_plan,
      COALESCE(b.ret_status, 'active') AS e_retention_status,
      b.contrib AS e_contribution,
      b.rev_pp AS e_revenue_private_plan,
      b.inv_count AS e_invoice_count,
      b.conf_score AS e_confidence_score,
      b.clin_cost AS e_clinician_cost,
      b.dir_cost AS e_direct_cost,
      CASE
        WHEN b.rev_pp > 0 THEN ROUND((b.contrib / b.rev_pp) * 100, 1)
        ELSE NULL
      END::numeric(15, 2) AS e_margin_pct,
      COALESCE(c12.c12, 0)::numeric(15, 2) AS e_contribution_12mo,
      COALESCE(v12.visit_count, 0)::bigint AS e_visits_12mo,
      CASE
        WHEN COALESCE(v12.visit_count, 0) > 0 THEN v12.visit_count::numeric(15, 2)
        ELSE NULL
      END AS e_visit_freq_per_year,
      CASE
        WHEN COALESCE(v12.visit_count, 0) > 0 AND COALESCE(c12.c12, 0) > 0
          THEN ROUND(c12.c12 / v12.visit_count, 2)
        WHEN COALESCE(v12.visit_count, 0) > 0 THEN 0::numeric(15, 2)
        ELSE NULL
      END AS e_value_per_visit,
      COALESCE(opp.opportunity_gross, 0)::numeric(15, 2) AS e_opportunity_gross,
      COALESCE(ms.quality_score, 0)::integer AS e_quality_score,
      ROUND(COALESCE(ms.cltv_projection, b.contrib), 2)::numeric(15, 2)
        AS e_patient_economic_value,
      ms.cltv_projection::numeric(15, 2) AS e_cltv_projection,
      ms.cltv_tier::text AS e_cltv_tier,
      ms.quality_score_tier::text AS e_quality_score_tier,
      ms.confidence_score::integer AS e_modelled_confidence_score,
      ms.computed_at AS e_modelled_computed_at,
      CASE
        WHEN b.rev_pp > 0
          THEN (COALESCE(opp.opportunity_gross, 0) * (b.contrib / b.rev_pp))
        ELSE 0::numeric
      END AS e_opportunity_sort
    FROM base b
    LEFT JOIN public.patients p
      ON p.id = b.pid
     AND p.organization_id = p_practice_id
     AND p.deleted_at IS NULL
    LEFT JOIN public.practice_locations pl
      ON COALESCE(p.location_id, b.loc_id) IS NOT NULL
     AND pl.id = COALESCE(p.location_id, b.loc_id)
     AND pl.organization_id = p_practice_id
     AND pl.deleted_at IS NULL
    LEFT JOIN contrib_12 c12
      ON c12.pid = b.pid
    LEFT JOIN visits_12 v12
      ON v12.dentally_pt_id = COALESCE(p.pt_id, b.dentally_pt_id)
    LEFT JOIN opportunity opp
      ON opp.pid = b.pid
    LEFT JOIN public.patient_economics_modelled_scores ms
      ON ms.practice_id = p_practice_id
     AND b.pid IS NOT NULL
     AND ms.patient_id = b.pid
  ),
  filtered AS (
    SELECT e.*
    FROM enriched e
    WHERE
      (
        search_q IS NULL
        OR (
          e.eid IS NOT NULL
          AND (
            (e.e_pt_id IS NOT NULL AND e.e_pt_id::text LIKE '%' || search_q || '%')
            OR LOWER(COALESCE(e.e_patient_name, '')) LIKE '%' || search_q || '%'
          )
        )
      )
      AND (
        COALESCE(NULLIF(BTRIM(p_retention_filter), ''), 'all') = 'all'
        OR e.e_retention_status = LOWER(BTRIM(p_retention_filter))
      )
      AND (
        COALESCE(NULLIF(BTRIM(p_type_filter), ''), 'all') = 'all'
        OR (
          LOWER(BTRIM(p_type_filter)) = 'member'
          AND e.e_has_payment_plan
        )
        OR (
          LOWER(BTRIM(p_type_filter)) = 'private'
          AND NOT e.e_has_payment_plan
          AND e.e_revenue_private_plan > 0
        )
        OR (
          LOWER(BTRIM(p_type_filter)) = 'nhs'
          AND NOT e.e_has_payment_plan
          AND e.e_revenue_private_plan <= 0
          AND (e.e_contribution > 0 OR e.e_invoice_count > 0)
        )
      )
  ),
  matched AS (
    SELECT f.*
    FROM filtered f
    WHERE f.eid IS NOT NULL
  ),
  ordered AS (
    SELECT m.*
    FROM matched m
    ORDER BY
      CASE WHEN sort_key = 'patientName' AND sort_asc THEN LOWER(COALESCE(m.e_patient_name, '')) END ASC NULLS LAST,
      CASE WHEN sort_key = 'patientName' AND NOT sort_asc THEN LOWER(COALESCE(m.e_patient_name, '')) END DESC NULLS LAST,
      CASE WHEN sort_key = 'ptId' AND sort_asc THEN m.e_pt_id END ASC NULLS LAST,
      CASE WHEN sort_key = 'ptId' AND NOT sort_asc THEN m.e_pt_id END DESC NULLS LAST,
      CASE WHEN sort_key = 'revenuePrivatePlan' AND sort_asc THEN m.e_revenue_private_plan END ASC NULLS LAST,
      CASE WHEN sort_key = 'revenuePrivatePlan' AND NOT sort_asc THEN m.e_revenue_private_plan END DESC NULLS LAST,
      CASE WHEN sort_key = 'directCost' AND sort_asc THEN m.e_direct_cost END ASC NULLS LAST,
      CASE WHEN sort_key = 'directCost' AND NOT sort_asc THEN m.e_direct_cost END DESC NULLS LAST,
      CASE WHEN sort_key = 'contribution' AND sort_asc THEN m.e_contribution END ASC NULLS LAST,
      CASE WHEN sort_key = 'contribution' AND NOT sort_asc THEN m.e_contribution END DESC NULLS LAST,
      CASE WHEN sort_key = 'contribution12mo' AND sort_asc THEN m.e_contribution_12mo END ASC NULLS LAST,
      CASE WHEN sort_key = 'contribution12mo' AND NOT sort_asc THEN m.e_contribution_12mo END DESC NULLS LAST,
      CASE WHEN sort_key = 'visitFreqPerYear' AND sort_asc THEN m.e_visit_freq_per_year END ASC NULLS LAST,
      CASE WHEN sort_key = 'visitFreqPerYear' AND NOT sort_asc THEN m.e_visit_freq_per_year END DESC NULLS LAST,
      CASE WHEN sort_key = 'valuePerVisit' AND sort_asc THEN m.e_value_per_visit END ASC NULLS LAST,
      CASE WHEN sort_key = 'valuePerVisit' AND NOT sort_asc THEN m.e_value_per_visit END DESC NULLS LAST,
      CASE WHEN sort_key = 'opportunityWeighted' AND sort_asc THEN m.e_opportunity_sort END ASC NULLS LAST,
      CASE WHEN sort_key = 'opportunityWeighted' AND NOT sort_asc THEN m.e_opportunity_sort END DESC NULLS LAST,
      CASE WHEN sort_key = 'patientEconomicValue' AND sort_asc THEN m.e_patient_economic_value END ASC NULLS LAST,
      CASE WHEN sort_key = 'patientEconomicValue' AND NOT sort_asc THEN m.e_patient_economic_value END DESC NULLS LAST,
      CASE WHEN sort_key = 'qualityScore' AND sort_asc THEN m.e_quality_score END ASC NULLS LAST,
      CASE WHEN sort_key = 'qualityScore' AND NOT sort_asc THEN m.e_quality_score END DESC NULLS LAST,
      CASE WHEN sort_key NOT IN (
        'patientName', 'ptId', 'revenuePrivatePlan', 'directCost', 'contribution',
        'contribution12mo', 'visitFreqPerYear', 'valuePerVisit', 'opportunityWeighted',
        'patientEconomicValue', 'qualityScore'
      ) AND sort_asc THEN m.e_contribution END ASC NULLS LAST,
      CASE WHEN sort_key NOT IN (
        'patientName', 'ptId', 'revenuePrivatePlan', 'directCost', 'contribution',
        'contribution12mo', 'visitFreqPerYear', 'valuePerVisit', 'opportunityWeighted',
        'patientEconomicValue', 'qualityScore'
      ) AND NOT sort_asc THEN m.e_contribution END DESC NULLS LAST,
      LOWER(COALESCE(m.e_patient_name, '')) ASC NULLS LAST
    LIMIT lim
    OFFSET off
  )
  SELECT
    o.eid,
    o.e_pt_id,
    COALESCE(
      o.e_patient_name,
      CASE WHEN o.e_pt_id IS NOT NULL THEN 'Patient #' || o.e_pt_id::text ELSE 'Unknown patient' END
    ),
    o.e_patient_uuid,
    o.e_location_id,
    COALESCE(o.e_location_name, 'Unassigned'),
    o.e_is_active,
    o.e_has_payment_plan,
    o.e_retention_status,
    o.e_contribution,
    o.e_revenue_private_plan,
    o.e_invoice_count,
    o.e_confidence_score,
    o.e_clinician_cost,
    o.e_direct_cost,
    o.e_margin_pct,
    o.e_contribution_12mo,
    o.e_visits_12mo,
    o.e_visit_freq_per_year,
    o.e_value_per_visit,
    o.e_opportunity_gross,
    o.e_quality_score,
    o.e_patient_economic_value,
    o.e_cltv_projection,
    o.e_cltv_tier,
    o.e_quality_score_tier,
    o.e_modelled_confidence_score,
    o.e_modelled_computed_at
  FROM ordered o;
END;
$$;
