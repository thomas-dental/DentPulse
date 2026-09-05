-- SQL-first patient roster: join + filter + sort + page in Postgres.
-- Page returns matched patients only; summary KPIs include orphans.

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
  WITH invoice_grain AS (
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
    LEFT JOIN public.patients p
      ON p.id = f.patient_id
     AND p.organization_id = f.practice_id
     AND p.deleted_at IS NULL
    WHERE use_facts
      AND has_scope
      AND f.practice_id = p_practice_id
      AND (f.patient_id IS NOT NULL OR f.pt_id IS NOT NULL)
      AND (p_start_date IS NULL OR f.invoice_date >= p_start_date)
      AND (p_end_date IS NULL OR f.invoice_date <= p_end_date)
      AND (p_location_id IS NULL OR p.location_id = p_location_id)
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
    LEFT JOIN public.patients p
      ON p.id = v.patient_id
     AND p.organization_id = v.practice_id
     AND p.deleted_at IS NULL
    WHERE NOT use_facts
      AND has_scope
      AND v.practice_id = p_practice_id
      AND (v.patient_id IS NOT NULL OR v.pt_id IS NOT NULL)
      AND (p_start_date IS NULL OR v.invoice_date >= p_start_date)
      AND (p_end_date IS NULL OR v.invoice_date <= p_end_date)
      AND (p_location_id IS NULL OR p.location_id = p_location_id)
    GROUP BY
      v.patient_id,
      CASE WHEN v.patient_id IS NULL THEN v.pt_id ELSE NULL END
  ),
  facts_unscoped AS (
    SELECT
      pf.patient_id AS pid,
      pf.pt_id AS dentally_pt_id,
      COALESCE(pf.contribution, 0)::numeric(15, 2) AS contrib,
      COALESCE(pf.revenue_private_plan, 0)::numeric(15, 2) AS rev_pp,
      COALESCE(pf.invoice_count, 0)::bigint AS inv_count,
      pf.confidence_score AS conf_score,
      COALESCE(ic.clin_cost, 0)::numeric(15, 2) AS clin_cost,
      COALESCE(ic.dir_cost, 0)::numeric(15, 2) AS dir_cost,
      pf.retention_status AS ret_status,
      pf.location_id AS fact_location_id
    FROM public.pe_patient_contribution_facts pf
    LEFT JOIN (
      SELECT
        f.patient_id,
        COALESCE(SUM(f.clinician_cost), 0)::numeric(15, 2) AS clin_cost,
        COALESCE(SUM(f.direct_cost), 0)::numeric(15, 2) AS dir_cost
      FROM public.pe_invoice_contribution_facts f
      WHERE use_facts
        AND f.practice_id = p_practice_id
        AND f.patient_id IS NOT NULL
      GROUP BY f.patient_id
    ) ic
      ON ic.patient_id = pf.patient_id
    WHERE NOT has_scope
      AND pf.practice_id = p_practice_id
  ),
  base AS (
    SELECT
      g.pid,
      g.dentally_pt_id,
      g.contrib,
      g.rev_pp,
      g.inv_count,
      g.conf_score,
      g.clin_cost,
      g.dir_cost,
      COALESCE(pf.retention_status, 'active') AS ret_status,
      COALESCE(pf.location_id, p.location_id) AS loc_id
    FROM invoice_grain g
    LEFT JOIN public.pe_patient_contribution_facts pf
      ON has_scope
     AND pf.practice_id = p_practice_id
     AND (
       (g.pid IS NOT NULL AND pf.patient_id = g.pid)
       OR (
         g.pid IS NULL
         AND pf.patient_id IS NULL
         AND pf.pt_id IS NOT DISTINCT FROM g.dentally_pt_id
       )
     )
    LEFT JOIN public.patients p
      ON p.id = g.pid
     AND p.organization_id = p_practice_id
     AND p.deleted_at IS NULL
    WHERE has_scope

    UNION ALL

    SELECT
      f.pid,
      f.dentally_pt_id,
      f.contrib,
      f.rev_pp,
      f.inv_count,
      f.conf_score,
      f.clin_cost,
      f.dir_cost,
      COALESCE(f.ret_status, 'active'),
      COALESCE(f.fact_location_id, p.location_id)
    FROM facts_unscoped f
    LEFT JOIN public.patients p
      ON p.id = f.pid
     AND p.organization_id = p_practice_id
     AND p.deleted_at IS NULL
    WHERE NOT has_scope
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
      AND (
        a.apmt_completed_at IS NOT NULL
        OR LOWER(BTRIM(COALESCE(a.apmt_state, ''))) = 'completed'
      )
      AND LOWER(BTRIM(COALESCE(a.apmt_state, ''))) NOT IN (
        'cancelled', 'did not attend', 'dna'
      )
    GROUP BY a.apmt_patient_id
  ),
  opportunity AS (
    SELECT
      lp.patient_id AS pid,
      COALESCE(SUM(lp.planned_value), 0)::numeric(15, 2) AS opportunity_gross
    FROM (
      SELECT
        el.patient_id,
        COALESCE(
          NULLIF(BTRIM(el.payload ->> 'tp_id'), ''),
          NULLIF(BTRIM(el.payload ->> 'plan_id'), ''),
          NULLIF(BTRIM(el.payload ->> 'ta_treatment_plan_id'), '')
        ) AS plan_id,
        MAX(
          COALESCE(
            NULLIF(el.payload ->> 'planned_value', '')::numeric,
            NULLIF(el.payload ->> 'tp_private_treatment_value', '')::numeric,
            NULLIF(el.payload ->> 'value', '')::numeric,
            NULLIF(el.payload ->> 'amount', '')::numeric,
            NULLIF(el.payload ->> 'total', '')::numeric,
            0::numeric
          )
        )::numeric(15, 2) AS planned_value
      FROM public.event_ledger el
      WHERE el.practice_id = p_practice_id
        AND el.event_type = 'PLAN_CREATED'
        AND el.patient_id IS NOT NULL
      GROUP BY el.patient_id, 2
    ) lp
    WHERE lp.plan_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_ledger done
        WHERE done.practice_id = p_practice_id
          AND done.event_type = 'PLAN_COMPLETED'
          AND done.patient_id = lp.patient_id
          AND COALESCE(
            NULLIF(BTRIM(done.payload ->> 'tp_id'), ''),
            NULLIF(BTRIM(done.payload ->> 'plan_id'), ''),
            NULLIF(BTRIM(done.payload ->> 'ta_treatment_plan_id'), '')
          ) = lp.plan_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (
          SELECT
            COALESCE(
              NULLIF(BTRIM(el.payload ->> 'tp_id'), ''),
              NULLIF(BTRIM(el.payload ->> 'plan_id'), ''),
              NULLIF(BTRIM(el.payload ->> 'ta_treatment_plan_id'), '')
            ) AS plan_id,
            MAX(el.created_at) FILTER (WHERE el.event_type = 'APPOINTMENT_LINKED') AS last_linked_at,
            MAX(el.created_at) FILTER (WHERE el.event_type = 'APPOINTMENT_UNLINKED') AS last_unlinked_at
          FROM public.event_ledger el
          WHERE el.practice_id = p_practice_id
            AND el.patient_id = lp.patient_id
            AND el.event_type IN ('APPOINTMENT_LINKED', 'APPOINTMENT_UNLINKED')
          GROUP BY 1
        ) sched
        WHERE sched.plan_id = lp.plan_id
          AND sched.last_linked_at IS NOT NULL
          AND (
            sched.last_unlinked_at IS NULL
            OR sched.last_unlinked_at <= sched.last_linked_at
          )
      )
    GROUP BY lp.patient_id
  ),
  enriched AS (
    SELECT
      b.pid AS patient_id,
      COALESCE(p.pt_id, b.dentally_pt_id) AS pt_id,
      NULLIF(
        BTRIM(COALESCE(p.pt_first_name, '') || ' ' || COALESCE(p.pt_last_name, '')),
        ''
      ) AS patient_name,
      NULLIF(BTRIM(COALESCE(p.pt_unique_id::text, '')), '') AS patient_uuid,
      COALESCE(p.location_id, b.loc_id) AS location_id,
      NULLIF(BTRIM(COALESCE(pl.location_name, '')), '') AS location_name,
      COALESCE(p.is_active, false) AS is_active,
      (p.pt_payment_plan_id IS NOT NULL) AS has_payment_plan,
      COALESCE(b.ret_status, 'active') AS retention_status,
      b.contrib AS contribution,
      b.rev_pp AS revenue_private_plan,
      b.inv_count AS invoice_count,
      b.conf_score AS confidence_score,
      b.clin_cost AS clinician_cost,
      b.dir_cost AS direct_cost,
      CASE
        WHEN b.rev_pp > 0 THEN ROUND((b.contrib / b.rev_pp) * 100, 1)
        ELSE NULL
      END::numeric(15, 2) AS margin_pct,
      COALESCE(c12.c12, 0)::numeric(15, 2) AS contribution_12mo,
      COALESCE(v12.visit_count, 0)::bigint AS visits_12mo,
      CASE
        WHEN COALESCE(v12.visit_count, 0) > 0 THEN v12.visit_count::numeric(15, 2)
        ELSE NULL
      END AS visit_freq_per_year,
      CASE
        WHEN COALESCE(v12.visit_count, 0) > 0 AND COALESCE(c12.c12, 0) > 0
          THEN ROUND(c12.c12 / v12.visit_count, 2)
        WHEN COALESCE(v12.visit_count, 0) > 0 THEN 0::numeric(15, 2)
        ELSE NULL
      END AS value_per_visit,
      COALESCE(opp.opportunity_gross, 0)::numeric(15, 2) AS opportunity_gross,
      COALESCE(ms.quality_score, 0)::integer AS quality_score,
      ROUND(
        COALESCE(ms.cltv_projection, b.contrib),
        2
      )::numeric(15, 2) AS patient_economic_value,
      ms.cltv_projection::numeric(15, 2) AS cltv_projection,
      ms.cltv_tier::text AS cltv_tier,
      ms.quality_score_tier::text AS quality_score_tier,
      ms.confidence_score::integer AS modelled_confidence_score,
      ms.computed_at AS modelled_computed_at,
      CASE
        WHEN b.rev_pp > 0
          THEN (COALESCE(opp.opportunity_gross, 0) * (b.contrib / b.rev_pp))
        ELSE 0::numeric
      END AS opportunity_sort
    FROM base b
    LEFT JOIN public.patients p
      ON p.id = b.pid
     AND p.organization_id = p_practice_id
     AND p.deleted_at IS NULL
    LEFT JOIN public.practice_locations pl
      ON pl.id = COALESCE(p.location_id, b.loc_id)
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
     AND ms.patient_id = b.pid
  ),
  filtered AS (
    SELECT e.*
    FROM enriched e
    WHERE
      (
        search_q IS NULL
        OR (
          e.patient_id IS NOT NULL
          AND (
            (e.pt_id IS NOT NULL AND e.pt_id::text LIKE '%' || search_q || '%')
            OR LOWER(COALESCE(e.patient_name, '')) LIKE '%' || search_q || '%'
          )
        )
      )
      AND (
        COALESCE(NULLIF(BTRIM(p_retention_filter), ''), 'all') = 'all'
        OR e.retention_status = LOWER(BTRIM(p_retention_filter))
      )
      AND (
        COALESCE(NULLIF(BTRIM(p_type_filter), ''), 'all') = 'all'
        OR (
          LOWER(BTRIM(p_type_filter)) = 'member'
          AND e.has_payment_plan
        )
        OR (
          LOWER(BTRIM(p_type_filter)) = 'private'
          AND NOT e.has_payment_plan
          AND e.revenue_private_plan > 0
        )
        OR (
          LOWER(BTRIM(p_type_filter)) = 'nhs'
          AND NOT e.has_payment_plan
          AND e.revenue_private_plan <= 0
          AND (e.contribution > 0 OR e.invoice_count > 0)
        )
      )
  ),
  matched AS (
    SELECT f.*
    FROM filtered f
    WHERE f.patient_id IS NOT NULL
  ),
  ordered AS (
    SELECT m.*
    FROM matched m
    ORDER BY
      CASE
        WHEN sort_key = 'patientName' AND sort_asc THEN LOWER(COALESCE(m.patient_name, ''))
      END ASC NULLS LAST,
      CASE
        WHEN sort_key = 'patientName' AND NOT sort_asc THEN LOWER(COALESCE(m.patient_name, ''))
      END DESC NULLS LAST,
      CASE WHEN sort_key = 'ptId' AND sort_asc THEN m.pt_id END ASC NULLS LAST,
      CASE WHEN sort_key = 'ptId' AND NOT sort_asc THEN m.pt_id END DESC NULLS LAST,
      CASE WHEN sort_key = 'revenuePrivatePlan' AND sort_asc THEN m.revenue_private_plan END ASC NULLS LAST,
      CASE WHEN sort_key = 'revenuePrivatePlan' AND NOT sort_asc THEN m.revenue_private_plan END DESC NULLS LAST,
      CASE WHEN sort_key = 'directCost' AND sort_asc THEN m.direct_cost END ASC NULLS LAST,
      CASE WHEN sort_key = 'directCost' AND NOT sort_asc THEN m.direct_cost END DESC NULLS LAST,
      CASE WHEN sort_key = 'contribution' AND sort_asc THEN m.contribution END ASC NULLS LAST,
      CASE WHEN sort_key = 'contribution' AND NOT sort_asc THEN m.contribution END DESC NULLS LAST,
      CASE WHEN sort_key = 'contribution12mo' AND sort_asc THEN m.contribution_12mo END ASC NULLS LAST,
      CASE WHEN sort_key = 'contribution12mo' AND NOT sort_asc THEN m.contribution_12mo END DESC NULLS LAST,
      CASE WHEN sort_key = 'visitFreqPerYear' AND sort_asc THEN m.visit_freq_per_year END ASC NULLS LAST,
      CASE WHEN sort_key = 'visitFreqPerYear' AND NOT sort_asc THEN m.visit_freq_per_year END DESC NULLS LAST,
      CASE WHEN sort_key = 'valuePerVisit' AND sort_asc THEN m.value_per_visit END ASC NULLS LAST,
      CASE WHEN sort_key = 'valuePerVisit' AND NOT sort_asc THEN m.value_per_visit END DESC NULLS LAST,
      CASE WHEN sort_key = 'opportunityWeighted' AND sort_asc THEN m.opportunity_sort END ASC NULLS LAST,
      CASE WHEN sort_key = 'opportunityWeighted' AND NOT sort_asc THEN m.opportunity_sort END DESC NULLS LAST,
      CASE WHEN sort_key = 'patientEconomicValue' AND sort_asc THEN m.patient_economic_value END ASC NULLS LAST,
      CASE WHEN sort_key = 'patientEconomicValue' AND NOT sort_asc THEN m.patient_economic_value END DESC NULLS LAST,
      CASE WHEN sort_key = 'qualityScore' AND sort_asc THEN m.quality_score END ASC NULLS LAST,
      CASE WHEN sort_key = 'qualityScore' AND NOT sort_asc THEN m.quality_score END DESC NULLS LAST,
      -- default / tie-break
      CASE WHEN sort_key NOT IN (
        'patientName', 'ptId', 'revenuePrivatePlan', 'directCost', 'contribution',
        'contribution12mo', 'visitFreqPerYear', 'valuePerVisit', 'opportunityWeighted',
        'patientEconomicValue', 'qualityScore'
      ) AND sort_asc THEN m.contribution END ASC NULLS LAST,
      CASE WHEN sort_key NOT IN (
        'patientName', 'ptId', 'revenuePrivatePlan', 'directCost', 'contribution',
        'contribution12mo', 'visitFreqPerYear', 'valuePerVisit', 'opportunityWeighted',
        'patientEconomicValue', 'qualityScore'
      ) AND NOT sort_asc THEN m.contribution END DESC NULLS LAST,
      LOWER(COALESCE(m.patient_name, '')) ASC NULLS LAST
    LIMIT lim
    OFFSET off
  )
  SELECT
    o.patient_id,
    o.pt_id,
    COALESCE(
      o.patient_name,
      CASE WHEN o.pt_id IS NOT NULL THEN 'Patient #' || o.pt_id::text ELSE 'Unknown patient' END
    ) AS patient_name,
    o.patient_uuid,
    o.location_id,
    COALESCE(o.location_name, 'Unassigned') AS location_name,
    o.is_active,
    o.has_payment_plan,
    o.retention_status,
    o.contribution,
    o.revenue_private_plan,
    o.invoice_count,
    o.confidence_score,
    o.clinician_cost,
    o.direct_cost,
    o.margin_pct,
    o.contribution_12mo,
    o.visits_12mo,
    o.visit_freq_per_year,
    o.value_per_visit,
    o.opportunity_gross,
    o.quality_score,
    o.patient_economic_value,
    o.cltv_projection,
    o.cltv_tier,
    o.quality_score_tier,
    o.modelled_confidence_score,
    o.modelled_computed_at
  FROM ordered o;
END;
$$;

COMMENT ON FUNCTION public.pe_patient_roster_page IS
  'Paginated PE patient roster: SQL join + filter + sort + LIMIT/OFFSET. Matched patients only.';

CREATE OR REPLACE FUNCTION public.pe_patient_roster_summary(
  p_practice_id UUID,
  p_location_id UUID DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_retention_filter TEXT DEFAULT 'all',
  p_type_filter TEXT DEFAULT 'all',
  p_metrics_since DATE DEFAULT NULL
)
RETURNS TABLE (
  matched_total BIGINT,
  matched_unfiltered BIGINT,
  total_patients BIGINT,
  active_patients BIGINT,
  retention_active_count BIGINT,
  retention_drifting_count BIGINT,
  retention_lapsed_count BIGINT,
  retention_effectively_lost_count BIGINT,
  private_plan_patients BIGINT,
  member_patients BIGINT,
  private_type_patients BIGINT,
  nhs_type_patients BIGINT,
  average_contribution NUMERIC(15, 2),
  average_projected_ltv NUMERIC(15, 2),
  baseline_total_patients BIGINT,
  baseline_active_patients BIGINT,
  baseline_retention_active_count BIGINT,
  baseline_retention_drifting_count BIGINT,
  baseline_retention_lapsed_count BIGINT,
  baseline_retention_effectively_lost_count BIGINT,
  baseline_private_plan_patients BIGINT,
  baseline_member_patients BIGINT,
  baseline_private_type_patients BIGINT,
  baseline_nhs_type_patients BIGINT,
  baseline_average_contribution NUMERIC(15, 2),
  baseline_average_projected_ltv NUMERIC(15, 2)
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

  RETURN QUERY
  WITH scoped_agg AS (
    SELECT
      f.patient_id AS pid,
      MAX(f.pt_id) AS dentally_pt_id,
      COALESCE(SUM(f.contribution), 0)::numeric(15, 2) AS contrib,
      COALESCE(SUM(f.revenue_private_plan), 0)::numeric(15, 2) AS rev_pp,
      COUNT(*)::bigint AS inv_count
    FROM public.pe_invoice_contribution_facts f
    LEFT JOIN public.patients p
      ON p.id = f.patient_id
     AND p.organization_id = f.practice_id
     AND p.deleted_at IS NULL
    WHERE use_facts
      AND has_scope
      AND f.practice_id = p_practice_id
      AND (f.patient_id IS NOT NULL OR f.pt_id IS NOT NULL)
      AND (p_start_date IS NULL OR f.invoice_date >= p_start_date)
      AND (p_end_date IS NULL OR f.invoice_date <= p_end_date)
      AND (p_location_id IS NULL OR p.location_id = p_location_id)
    GROUP BY
      f.patient_id,
      CASE WHEN f.patient_id IS NULL THEN f.pt_id ELSE NULL END

    UNION ALL

    SELECT
      v.patient_id AS pid,
      MAX(v.pt_id) AS dentally_pt_id,
      COALESCE(SUM(v.contribution), 0)::numeric(15, 2) AS contrib,
      COALESCE(SUM(v.revenue_private_plan), 0)::numeric(15, 2) AS rev_pp,
      COUNT(*)::bigint AS inv_count
    FROM public.v_invoice_contribution v
    LEFT JOIN public.patients p
      ON p.id = v.patient_id
     AND p.organization_id = v.practice_id
     AND p.deleted_at IS NULL
    WHERE NOT use_facts
      AND has_scope
      AND v.practice_id = p_practice_id
      AND (v.patient_id IS NOT NULL OR v.pt_id IS NOT NULL)
      AND (p_start_date IS NULL OR v.invoice_date >= p_start_date)
      AND (p_end_date IS NULL OR v.invoice_date <= p_end_date)
      AND (p_location_id IS NULL OR p.location_id = p_location_id)
    GROUP BY
      v.patient_id,
      CASE WHEN v.patient_id IS NULL THEN v.pt_id ELSE NULL END
  ),
  invoice_grain AS (
    SELECT
      s.pid,
      s.dentally_pt_id,
      s.contrib,
      s.rev_pp,
      s.inv_count,
      COALESCE(pf.retention_status, 'active') AS ret_status,
      COALESCE(pf.location_id, p.location_id) AS loc_id
    FROM scoped_agg s
    LEFT JOIN public.pe_patient_contribution_facts pf
      ON pf.practice_id = p_practice_id
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

    SELECT
      pf.patient_id AS pid,
      pf.pt_id AS dentally_pt_id,
      COALESCE(pf.contribution, 0)::numeric(15, 2) AS contrib,
      COALESCE(pf.revenue_private_plan, 0)::numeric(15, 2) AS rev_pp,
      COALESCE(pf.invoice_count, 0)::bigint AS inv_count,
      COALESCE(pf.retention_status, 'active') AS ret_status,
      COALESCE(pf.location_id, p.location_id) AS loc_id
    FROM public.pe_patient_contribution_facts pf
    LEFT JOIN public.patients p
      ON p.id = pf.patient_id
     AND p.organization_id = p_practice_id
     AND p.deleted_at IS NULL
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
  enriched AS (
    SELECT
      b.pid AS patient_id,
      COALESCE(p.pt_id, b.dentally_pt_id) AS pt_id,
      NULLIF(
        BTRIM(COALESCE(p.pt_first_name, '') || ' ' || COALESCE(p.pt_last_name, '')),
        ''
      ) AS patient_name,
      COALESCE(p.is_active, false) AS is_active,
      (p.id IS NOT NULL AND p.pt_payment_plan_id IS NOT NULL) AS has_payment_plan,
      COALESCE(b.ret_status, 'active') AS retention_status,
      b.contrib AS contribution,
      b.rev_pp AS revenue_private_plan,
      b.inv_count AS invoice_count,
      COALESCE(c12.c12, 0)::numeric(15, 2) AS contribution_12mo,
      ROUND(COALESCE(ms.cltv_projection, b.contrib), 2)::numeric(15, 2) AS patient_economic_value
    FROM invoice_grain b
    LEFT JOIN public.patients p
      ON p.id = b.pid
     AND p.organization_id = p_practice_id
     AND p.deleted_at IS NULL
    LEFT JOIN contrib_12 c12
      ON c12.pid = b.pid
    LEFT JOIN public.patient_economics_modelled_scores ms
      ON ms.practice_id = p_practice_id
     AND ms.patient_id = b.pid
  ),
  baseline AS (
    SELECT e.* FROM enriched e
  ),
  filtered AS (
    SELECT e.*
    FROM enriched e
    WHERE
      (
        search_q IS NULL
        OR (
          e.patient_id IS NOT NULL
          AND (
            (e.pt_id IS NOT NULL AND e.pt_id::text LIKE '%' || search_q || '%')
            OR LOWER(COALESCE(e.patient_name, '')) LIKE '%' || search_q || '%'
          )
        )
      )
      AND (
        COALESCE(NULLIF(BTRIM(p_retention_filter), ''), 'all') = 'all'
        OR e.retention_status = LOWER(BTRIM(p_retention_filter))
      )
      AND (
        COALESCE(NULLIF(BTRIM(p_type_filter), ''), 'all') = 'all'
        OR (
          LOWER(BTRIM(p_type_filter)) = 'member'
          AND e.has_payment_plan
        )
        OR (
          LOWER(BTRIM(p_type_filter)) = 'private'
          AND NOT e.has_payment_plan
          AND e.revenue_private_plan > 0
        )
        OR (
          LOWER(BTRIM(p_type_filter)) = 'nhs'
          AND NOT e.has_payment_plan
          AND e.revenue_private_plan <= 0
          AND (e.contribution > 0 OR e.invoice_count > 0)
        )
      )
  )
  SELECT
    (SELECT COUNT(*)::bigint FROM filtered f WHERE f.patient_id IS NOT NULL),
    (SELECT COUNT(*)::bigint FROM baseline b WHERE b.patient_id IS NOT NULL),
    (SELECT COUNT(*)::bigint FROM filtered),
    (SELECT COUNT(*)::bigint FROM filtered f WHERE f.is_active),
    (SELECT COUNT(*)::bigint FROM filtered f WHERE f.retention_status = 'active'),
    (SELECT COUNT(*)::bigint FROM filtered f WHERE f.retention_status = 'drifting'),
    (SELECT COUNT(*)::bigint FROM filtered f WHERE f.retention_status = 'lapsed'),
    (SELECT COUNT(*)::bigint FROM filtered f WHERE f.retention_status = 'effectively_lost'),
    (SELECT COUNT(*)::bigint FROM filtered f WHERE f.has_payment_plan OR f.revenue_private_plan > 0),
    (SELECT COUNT(*)::bigint FROM filtered f WHERE f.has_payment_plan),
    (SELECT COUNT(*)::bigint FROM filtered f WHERE NOT f.has_payment_plan AND f.revenue_private_plan > 0),
    (SELECT COUNT(*)::bigint FROM filtered f
      WHERE NOT f.has_payment_plan AND f.revenue_private_plan <= 0
        AND (f.contribution > 0 OR f.invoice_count > 0)),
    COALESCE((SELECT ROUND(AVG(f.contribution_12mo), 2) FROM filtered f), 0)::numeric(15, 2),
    COALESCE((SELECT ROUND(AVG(f.patient_economic_value), 2) FROM filtered f), 0)::numeric(15, 2),
    (SELECT COUNT(*)::bigint FROM baseline),
    (SELECT COUNT(*)::bigint FROM baseline b WHERE b.is_active),
    (SELECT COUNT(*)::bigint FROM baseline b WHERE b.retention_status = 'active'),
    (SELECT COUNT(*)::bigint FROM baseline b WHERE b.retention_status = 'drifting'),
    (SELECT COUNT(*)::bigint FROM baseline b WHERE b.retention_status = 'lapsed'),
    (SELECT COUNT(*)::bigint FROM baseline b WHERE b.retention_status = 'effectively_lost'),
    (SELECT COUNT(*)::bigint FROM baseline b WHERE b.has_payment_plan OR b.revenue_private_plan > 0),
    (SELECT COUNT(*)::bigint FROM baseline b WHERE b.has_payment_plan),
    (SELECT COUNT(*)::bigint FROM baseline b WHERE NOT b.has_payment_plan AND b.revenue_private_plan > 0),
    (SELECT COUNT(*)::bigint FROM baseline b
      WHERE NOT b.has_payment_plan AND b.revenue_private_plan <= 0
        AND (b.contribution > 0 OR b.invoice_count > 0)),
    COALESCE((SELECT ROUND(AVG(b.contribution_12mo), 2) FROM baseline b), 0)::numeric(15, 2),
    COALESCE((SELECT ROUND(AVG(b.patient_economic_value), 2) FROM baseline b), 0)::numeric(15, 2);
END;
$$;

COMMENT ON FUNCTION public.pe_patient_roster_summary IS
  'PE patient roster aggregates: includes orphans in KPI math; matched_total excludes orphans.';

REVOKE ALL ON FUNCTION public.pe_patient_roster_page(
  UUID, UUID, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, DATE
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pe_patient_roster_page(
  UUID, UUID, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, DATE
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.pe_patient_roster_summary(
  UUID, UUID, DATE, DATE, TEXT, TEXT, TEXT, DATE
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pe_patient_roster_summary(
  UUID, UUID, DATE, DATE, TEXT, TEXT, TEXT, DATE
) TO authenticated, service_role;
