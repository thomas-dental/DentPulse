-- Point roster + rollup joins at v_pe_patient_live_retention (all patients).

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
  need_c12 boolean;
  need_visits boolean;
  need_opp boolean;
  need_cost boolean;
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
  need_c12 := sort_key IN ('contribution12mo', 'valuePerVisit');
  need_visits := sort_key IN ('visitFreqPerYear', 'valuePerVisit');
  need_opp := sort_key = 'opportunityWeighted';
  need_cost := sort_key = 'directCost';

  PERFORM set_config('statement_timeout', '180000', true);

  -- Default list sort is contribution: page facts, then enrich ~25 rows.
  RETURN QUERY
  WITH scoped_grain AS (
    SELECT
      f.patient_id AS pid,
      MAX(f.pt_id) AS dentally_pt_id,
      COALESCE(SUM(f.contribution), 0)::numeric(15, 2) AS contrib,
      COALESCE(SUM(f.revenue_private_plan), 0)::numeric(15, 2) AS rev_pp,
      COUNT(*)::bigint AS inv_count,
      MAX(f.confidence_score) AS conf_score,
      COALESCE(SUM(f.clinician_cost), 0)::numeric(15, 2) AS clin_cost,
      COALESCE(SUM(f.direct_cost), 0)::numeric(15, 2) AS dir_cost,
      COALESCE(
        MAX(public.pe_normalize_retention_status(rs.retention_status)),
        'active'
      ) AS ret_status,
      (array_agg(COALESCE(pf.location_id, p0.location_id))
        FILTER (WHERE COALESCE(pf.location_id, p0.location_id) IS NOT NULL))[1] AS loc_id
    FROM public.pe_invoice_contribution_facts f
    LEFT JOIN public.patients p0
      ON p0.id = f.patient_id
     AND p0.organization_id = f.practice_id
     AND p0.deleted_at IS NULL
    LEFT JOIN public.v_pe_patient_live_retention rs
      ON rs.practice_id = p_practice_id
     AND rs.patient_id = f.patient_id
    LEFT JOIN public.pe_patient_contribution_facts pf
      ON pf.practice_id = p_practice_id
     AND pf.patient_id = f.patient_id
    WHERE has_scope
      AND use_facts
      AND f.practice_id = p_practice_id
      AND f.patient_id IS NOT NULL
      AND (p_start_date IS NULL OR f.invoice_date >= p_start_date)
      AND (p_end_date IS NULL OR f.invoice_date <= p_end_date)
      AND (p_location_id IS NULL OR p0.location_id = p_location_id)
    GROUP BY f.patient_id

    UNION ALL

    SELECT
      v.patient_id,
      MAX(v.pt_id),
      COALESCE(SUM(v.contribution), 0)::numeric(15, 2),
      COALESCE(SUM(v.revenue_private_plan), 0)::numeric(15, 2),
      COUNT(*)::bigint,
      MAX(v.confidence_score),
      COALESCE(SUM(v.clinician_cost), 0)::numeric(15, 2),
      COALESCE(SUM(v.direct_cost), 0)::numeric(15, 2),
      COALESCE(
        MAX(public.pe_normalize_retention_status(rs.retention_status)),
        'active'
      ),
      (array_agg(COALESCE(pf.location_id, p0.location_id))
        FILTER (WHERE COALESCE(pf.location_id, p0.location_id) IS NOT NULL))[1]
    FROM public.v_invoice_contribution v
    LEFT JOIN public.patients p0
      ON p0.id = v.patient_id
     AND p0.organization_id = v.practice_id
     AND p0.deleted_at IS NULL
    LEFT JOIN public.v_pe_patient_live_retention rs
      ON rs.practice_id = p_practice_id
     AND rs.patient_id = v.patient_id
    LEFT JOIN public.pe_patient_contribution_facts pf
      ON pf.practice_id = p_practice_id
     AND pf.patient_id = v.patient_id
    WHERE has_scope
      AND NOT use_facts
      AND v.practice_id = p_practice_id
      AND v.patient_id IS NOT NULL
      AND (p_start_date IS NULL OR v.invoice_date >= p_start_date)
      AND (p_end_date IS NULL OR v.invoice_date <= p_end_date)
      AND (p_location_id IS NULL OR p0.location_id = p_location_id)
    GROUP BY v.patient_id
  ),
  candidates AS (
    SELECT
      pf.patient_id AS pid,
      COALESCE(p.pt_id, pf.pt_id) AS dentally_pt_id,
      NULLIF(BTRIM(COALESCE(p.pt_first_name, '') || ' ' || COALESCE(p.pt_last_name, '')), '') AS patient_name,
      NULLIF(BTRIM(COALESCE(p.pt_unique_id::text, '')), '') AS patient_uuid,
      COALESCE(p.location_id, pf.location_id) AS loc_id,
      CASE
        WHEN COALESCE(p.location_id, pf.location_id) IS NULL THEN NULL
        ELSE NULLIF(BTRIM(COALESCE(pl.location_name, '')), '')
      END AS loc_name,
      COALESCE(p.is_active, false) AS is_active,
      COALESCE(p.pt_payment_plan_id IS NOT NULL, false) AS has_payment_plan,
      public.pe_normalize_retention_status(rs.retention_status) AS ret_status,
      COALESCE(pf.contribution, 0)::numeric(15, 2) AS contrib,
      COALESCE(pf.revenue_private_plan, 0)::numeric(15, 2) AS rev_pp,
      COALESCE(pf.invoice_count, 0)::bigint AS inv_count,
      pf.confidence_score AS conf_score,
      0::numeric(15, 2) AS grain_clin,
      0::numeric(15, 2) AS grain_dir,
      false AS costs_from_grain,
      COALESCE(ms.quality_score, 0)::integer AS quality_score,
      ROUND(COALESCE(ms.cltv_projection, pf.contribution), 2)::numeric(15, 2) AS pev,
      ms.cltv_projection::numeric(15, 2) AS cltv_projection,
      ms.cltv_tier::text AS cltv_tier,
      ms.quality_score_tier::text AS quality_score_tier,
      ms.confidence_score::integer AS modelled_confidence_score,
      ms.computed_at AS modelled_computed_at
    FROM public.pe_patient_contribution_facts pf
    LEFT JOIN public.v_pe_patient_live_retention rs
      ON rs.practice_id = p_practice_id
     AND rs.patient_id = pf.patient_id
    LEFT JOIN public.patients p
      ON p.id = pf.patient_id
     AND p.organization_id = p_practice_id
     AND p.deleted_at IS NULL
    LEFT JOIN public.practice_locations pl
      ON COALESCE(p.location_id, pf.location_id) IS NOT NULL
     AND pl.id = COALESCE(p.location_id, pf.location_id)
     AND pl.organization_id = p_practice_id
     AND pl.deleted_at IS NULL
    LEFT JOIN public.patient_economics_modelled_scores ms
      ON ms.practice_id = p_practice_id
     AND ms.patient_id = pf.patient_id
    WHERE NOT has_scope
      AND pf.practice_id = p_practice_id
      AND pf.patient_id IS NOT NULL

    UNION ALL

    SELECT
      s.pid,
      COALESCE(p.pt_id, s.dentally_pt_id),
      NULLIF(BTRIM(COALESCE(p.pt_first_name, '') || ' ' || COALESCE(p.pt_last_name, '')), ''),
      NULLIF(BTRIM(COALESCE(p.pt_unique_id::text, '')), ''),
      COALESCE(p.location_id, s.loc_id),
      CASE
        WHEN COALESCE(p.location_id, s.loc_id) IS NULL THEN NULL
        ELSE NULLIF(BTRIM(COALESCE(pl.location_name, '')), '')
      END,
      COALESCE(p.is_active, false),
      COALESCE(p.pt_payment_plan_id IS NOT NULL, false),
      COALESCE(s.ret_status, 'active'),
      s.contrib,
      s.rev_pp,
      s.inv_count,
      s.conf_score,
      s.clin_cost,
      s.dir_cost,
      true,
      COALESCE(ms.quality_score, 0)::integer,
      ROUND(COALESCE(ms.cltv_projection, s.contrib), 2)::numeric(15, 2),
      ms.cltv_projection::numeric(15, 2),
      ms.cltv_tier::text,
      ms.quality_score_tier::text,
      ms.confidence_score::integer,
      ms.computed_at
    FROM scoped_grain s
    LEFT JOIN public.patients p
      ON p.id = s.pid
     AND p.organization_id = p_practice_id
     AND p.deleted_at IS NULL
    LEFT JOIN public.practice_locations pl
      ON COALESCE(p.location_id, s.loc_id) IS NOT NULL
     AND pl.id = COALESCE(p.location_id, s.loc_id)
     AND pl.organization_id = p_practice_id
     AND pl.deleted_at IS NULL
    LEFT JOIN public.patient_economics_modelled_scores ms
      ON ms.practice_id = p_practice_id
     AND ms.patient_id = s.pid
    WHERE has_scope
      AND s.pid IS NOT NULL
  ),
  filtered AS (
    SELECT c.*
    FROM candidates c
    WHERE
      (
        search_q IS NULL
        OR (c.dentally_pt_id IS NOT NULL AND c.dentally_pt_id::text LIKE '%' || search_q || '%')
        OR LOWER(COALESCE(c.patient_name, '')) LIKE '%' || search_q || '%'
      )
      AND (
        COALESCE(NULLIF(BTRIM(p_retention_filter), ''), 'all') = 'all'
        OR c.ret_status = LOWER(BTRIM(p_retention_filter))
      )
      AND (
        COALESCE(NULLIF(BTRIM(p_type_filter), ''), 'all') = 'all'
        OR (LOWER(BTRIM(p_type_filter)) = 'member' AND c.has_payment_plan)
        OR (LOWER(BTRIM(p_type_filter)) = 'private' AND NOT c.has_payment_plan AND c.rev_pp > 0)
        OR (
          LOWER(BTRIM(p_type_filter)) = 'nhs'
          AND NOT c.has_payment_plan
          AND c.rev_pp <= 0
          AND (c.contrib > 0 OR c.inv_count > 0)
        )
      )
  ),
  sort_c12 AS (
    SELECT
      inv.patient_id AS pid,
      COALESCE(SUM(inv.contribution), 0)::numeric(15, 2) AS c12
    FROM public.pe_invoice_contribution_facts inv
    WHERE need_c12
      AND use_facts
      AND inv.practice_id = p_practice_id
      AND inv.patient_id IS NOT NULL
      AND inv.invoice_date >= metrics_since
      AND (p_end_date IS NULL OR inv.invoice_date <= p_end_date)
    GROUP BY inv.patient_id

    UNION ALL

    SELECT
      vw.patient_id,
      COALESCE(SUM(vw.contribution), 0)::numeric(15, 2)
    FROM public.v_invoice_contribution vw
    WHERE need_c12
      AND NOT use_facts
      AND vw.practice_id = p_practice_id
      AND vw.patient_id IS NOT NULL
      AND vw.invoice_date >= metrics_since
      AND (p_end_date IS NULL OR vw.invoice_date <= p_end_date)
    GROUP BY vw.patient_id
  ),
  sort_visits AS (
    SELECT
      a.apmt_patient_id AS dentally_pt_id,
      COUNT(*)::bigint AS visit_count
    FROM public.appointments a
    WHERE need_visits
      AND a.organization_id = p_practice_id
      AND a.apmt_patient_id IS NOT NULL
      AND a.apmt_completed_at >= visits_since
      AND LOWER(BTRIM(COALESCE(a.apmt_state, ''))) NOT IN (
        'cancelled', 'did not attend', 'dna'
      )
    GROUP BY a.apmt_patient_id
  ),
  sort_opp AS (
    SELECT
      el.patient_id AS pid,
      COALESCE(SUM(COALESCE(
        NULLIF(el.payload ->> 'planned_value', '')::numeric,
        NULLIF(el.payload ->> 'tp_private_treatment_value', '')::numeric,
        NULLIF(el.payload ->> 'value', '')::numeric,
        0::numeric
      )), 0)::numeric(15, 2) AS opportunity_gross
    FROM public.event_ledger el
    WHERE need_opp
      AND el.practice_id = p_practice_id
      AND el.event_type = 'PLAN_CREATED'
      AND el.patient_id IS NOT NULL
    GROUP BY el.patient_id
  ),
  sort_cost AS (
    SELECT
      inv.patient_id AS pid,
      COALESCE(SUM(inv.clinician_cost), 0)::numeric(15, 2) AS clin_cost,
      COALESCE(SUM(inv.direct_cost), 0)::numeric(15, 2) AS dir_cost
    FROM public.pe_invoice_contribution_facts inv
    WHERE need_cost
      AND NOT has_scope
      AND use_facts
      AND inv.practice_id = p_practice_id
      AND inv.patient_id IS NOT NULL
    GROUP BY inv.patient_id
  ),
  ranked AS (
    SELECT
      f.*,
      COALESCE(sc.c12, 0)::numeric(15, 2) AS sort_c12,
      sv.visit_count AS sort_visits,
      COALESCE(so.opportunity_gross, 0)::numeric(15, 2) AS sort_opp,
      COALESCE(f.grain_dir, sk.dir_cost) AS sort_dir_cost,
      CASE
        WHEN f.rev_pp > 0 THEN ROUND((f.contrib / f.rev_pp) * 100, 1)
        ELSE NULL
      END::numeric(15, 2) AS margin_pct,
      CASE
        WHEN f.rev_pp > 0 THEN COALESCE(so.opportunity_gross, 0) * (f.contrib / f.rev_pp)
        ELSE 0::numeric
      END AS opportunity_sort
    FROM filtered f
    LEFT JOIN sort_c12 sc ON need_c12 AND sc.pid = f.pid
    LEFT JOIN sort_visits sv ON need_visits AND sv.dentally_pt_id = f.dentally_pt_id
    LEFT JOIN sort_opp so ON need_opp AND so.pid = f.pid
    LEFT JOIN sort_cost sk ON need_cost AND NOT f.costs_from_grain AND sk.pid = f.pid
  ),
  page AS (
    SELECT r.*
    FROM ranked r
    ORDER BY
      CASE WHEN sort_key = 'patientName' AND sort_asc THEN LOWER(COALESCE(r.patient_name, '')) END ASC NULLS LAST,
      CASE WHEN sort_key = 'patientName' AND NOT sort_asc THEN LOWER(COALESCE(r.patient_name, '')) END DESC NULLS LAST,
      CASE WHEN sort_key = 'ptId' AND sort_asc THEN r.dentally_pt_id END ASC NULLS LAST,
      CASE WHEN sort_key = 'ptId' AND NOT sort_asc THEN r.dentally_pt_id END DESC NULLS LAST,
      CASE WHEN sort_key = 'revenuePrivatePlan' AND sort_asc THEN r.rev_pp END ASC NULLS LAST,
      CASE WHEN sort_key = 'revenuePrivatePlan' AND NOT sort_asc THEN r.rev_pp END DESC NULLS LAST,
      CASE WHEN sort_key = 'directCost' AND sort_asc THEN r.sort_dir_cost END ASC NULLS LAST,
      CASE WHEN sort_key = 'directCost' AND NOT sort_asc THEN r.sort_dir_cost END DESC NULLS LAST,
      CASE WHEN sort_key = 'contribution' AND sort_asc THEN r.contrib END ASC NULLS LAST,
      CASE WHEN sort_key = 'contribution' AND NOT sort_asc THEN r.contrib END DESC NULLS LAST,
      CASE WHEN sort_key = 'contribution12mo' AND sort_asc THEN r.sort_c12 END ASC NULLS LAST,
      CASE WHEN sort_key = 'contribution12mo' AND NOT sort_asc THEN r.sort_c12 END DESC NULLS LAST,
      CASE WHEN sort_key = 'visitFreqPerYear' AND sort_asc THEN r.sort_visits END ASC NULLS LAST,
      CASE WHEN sort_key = 'visitFreqPerYear' AND NOT sort_asc THEN r.sort_visits END DESC NULLS LAST,
      CASE WHEN sort_key = 'valuePerVisit' AND sort_asc THEN
        CASE
          WHEN COALESCE(r.sort_visits, 0) > 0 AND COALESCE(r.sort_c12, 0) > 0
            THEN ROUND(r.sort_c12 / r.sort_visits, 2)
          WHEN COALESCE(r.sort_visits, 0) > 0 THEN 0::numeric
          ELSE NULL
        END
      END ASC NULLS LAST,
      CASE WHEN sort_key = 'valuePerVisit' AND NOT sort_asc THEN
        CASE
          WHEN COALESCE(r.sort_visits, 0) > 0 AND COALESCE(r.sort_c12, 0) > 0
            THEN ROUND(r.sort_c12 / r.sort_visits, 2)
          WHEN COALESCE(r.sort_visits, 0) > 0 THEN 0::numeric
          ELSE NULL
        END
      END DESC NULLS LAST,
      CASE WHEN sort_key = 'opportunityWeighted' AND sort_asc THEN r.opportunity_sort END ASC NULLS LAST,
      CASE WHEN sort_key = 'opportunityWeighted' AND NOT sort_asc THEN r.opportunity_sort END DESC NULLS LAST,
      CASE WHEN sort_key = 'patientEconomicValue' AND sort_asc THEN r.pev END ASC NULLS LAST,
      CASE WHEN sort_key = 'patientEconomicValue' AND NOT sort_asc THEN r.pev END DESC NULLS LAST,
      CASE WHEN sort_key = 'qualityScore' AND sort_asc THEN r.quality_score END ASC NULLS LAST,
      CASE WHEN sort_key = 'qualityScore' AND NOT sort_asc THEN r.quality_score END DESC NULLS LAST,
      CASE WHEN sort_key NOT IN (
        'patientName', 'ptId', 'revenuePrivatePlan', 'directCost', 'contribution',
        'contribution12mo', 'visitFreqPerYear', 'valuePerVisit', 'opportunityWeighted',
        'patientEconomicValue', 'qualityScore'
      ) AND sort_asc THEN r.contrib END ASC NULLS LAST,
      CASE WHEN sort_key NOT IN (
        'patientName', 'ptId', 'revenuePrivatePlan', 'directCost', 'contribution',
        'contribution12mo', 'visitFreqPerYear', 'valuePerVisit', 'opportunityWeighted',
        'patientEconomicValue', 'qualityScore'
      ) AND NOT sort_asc THEN r.contrib END DESC NULLS LAST,
      LOWER(COALESCE(r.patient_name, '')) ASC NULLS LAST
    LIMIT lim
    OFFSET off
  )
  SELECT
    pg.pid,
    pg.dentally_pt_id,
    COALESCE(
      pg.patient_name,
      CASE
        WHEN pg.dentally_pt_id IS NOT NULL THEN 'Patient #' || pg.dentally_pt_id::text
        ELSE 'Unknown patient'
      END
    ),
    pg.patient_uuid,
    pg.loc_id,
    COALESCE(pg.loc_name, 'Unassigned'),
    pg.is_active,
    pg.has_payment_plan,
    pg.ret_status,
    pg.contrib,
    pg.rev_pp,
    pg.inv_count,
    pg.conf_score,
    CASE
      WHEN pg.costs_from_grain THEN pg.grain_clin
      ELSE COALESCE(cost.clin_cost, 0)
    END::numeric(15, 2),
    CASE
      WHEN pg.costs_from_grain THEN pg.grain_dir
      ELSE COALESCE(cost.dir_cost, 0)
    END::numeric(15, 2),
    pg.margin_pct,
    COALESCE(c12.c12, 0)::numeric(15, 2),
    COALESCE(vis.visit_count, 0)::bigint,
    CASE
      WHEN COALESCE(vis.visit_count, 0) > 0 THEN vis.visit_count::numeric(15, 2)
      ELSE NULL
    END,
    CASE
      WHEN COALESCE(vis.visit_count, 0) > 0 AND COALESCE(c12.c12, 0) > 0
        THEN ROUND(c12.c12 / vis.visit_count, 2)
      WHEN COALESCE(vis.visit_count, 0) > 0 THEN 0::numeric(15, 2)
      ELSE NULL
    END,
    COALESCE(opp.opportunity_gross, 0)::numeric(15, 2),
    pg.quality_score,
    pg.pev,
    pg.cltv_projection,
    pg.cltv_tier,
    pg.quality_score_tier,
    pg.modelled_confidence_score,
    pg.modelled_computed_at
  FROM page pg
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(x.contribution), 0)::numeric(15, 2) AS c12
    FROM (
      SELECT inv.contribution
      FROM public.pe_invoice_contribution_facts inv
      WHERE use_facts
        AND inv.practice_id = p_practice_id
        AND inv.patient_id = pg.pid
        AND inv.invoice_date >= metrics_since
        AND (p_end_date IS NULL OR inv.invoice_date <= p_end_date)
      UNION ALL
      SELECT vw.contribution
      FROM public.v_invoice_contribution vw
      WHERE NOT use_facts
        AND vw.practice_id = p_practice_id
        AND vw.patient_id = pg.pid
        AND vw.invoice_date >= metrics_since
        AND (p_end_date IS NULL OR vw.invoice_date <= p_end_date)
    ) x
  ) c12 ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::bigint AS visit_count
    FROM public.appointments a
    WHERE a.organization_id = p_practice_id
      AND a.apmt_patient_id = pg.dentally_pt_id
      AND a.apmt_completed_at >= visits_since
      AND LOWER(BTRIM(COALESCE(a.apmt_state, ''))) NOT IN (
        'cancelled', 'did not attend', 'dna'
      )
  ) vis ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(COALESCE(
      NULLIF(el.payload ->> 'planned_value', '')::numeric,
      NULLIF(el.payload ->> 'tp_private_treatment_value', '')::numeric,
      NULLIF(el.payload ->> 'value', '')::numeric,
      0::numeric
    )), 0)::numeric(15, 2) AS opportunity_gross
    FROM public.event_ledger el
    WHERE el.practice_id = p_practice_id
      AND el.event_type = 'PLAN_CREATED'
      AND el.patient_id = pg.pid
  ) opp ON true
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(x.clinician_cost), 0)::numeric(15, 2) AS clin_cost,
      COALESCE(SUM(x.direct_cost), 0)::numeric(15, 2) AS dir_cost
    FROM (
      SELECT inv.clinician_cost, inv.direct_cost
      FROM public.pe_invoice_contribution_facts inv
      WHERE NOT pg.costs_from_grain
        AND use_facts
        AND inv.practice_id = p_practice_id
        AND inv.patient_id = pg.pid
      UNION ALL
      SELECT vw.clinician_cost, vw.direct_cost
      FROM public.v_invoice_contribution vw
      WHERE NOT pg.costs_from_grain
        AND NOT use_facts
        AND vw.practice_id = p_practice_id
        AND vw.patient_id = pg.pid
    ) x
  ) cost ON NOT pg.costs_from_grain;
END;
$$;

COMMENT ON FUNCTION public.pe_patient_roster_page IS
  'Paginated PE patient roster. Live retention from v_pe_patient_live_retention; ranks on facts/grain then enriches page rows.';

REVOKE ALL ON FUNCTION public.pe_patient_roster_page(
  UUID, UUID, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, DATE
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pe_patient_roster_page(
  UUID, UUID, DATE, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT, DATE
) TO authenticated, service_role;


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

  PERFORM set_config('statement_timeout', '180000', true);

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
      public.pe_normalize_retention_status(rs.retention_status) AS ret_status,
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
    LEFT JOIN public.v_pe_patient_live_retention rs
      ON rs.practice_id = p_practice_id
     AND rs.patient_id = s.pid
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
      public.pe_normalize_retention_status(rs.retention_status) AS ret_status,
      COALESCE(pf.location_id, p.location_id) AS loc_id
    FROM public.pe_patient_contribution_facts pf
    LEFT JOIN public.v_pe_patient_live_retention rs
      ON rs.practice_id = p_practice_id
     AND rs.patient_id = pf.patient_id
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
  'PE patient roster aggregates; live retention from v_pe_patient_live_retention.';

REVOKE ALL ON FUNCTION public.pe_patient_roster_summary(
  UUID, UUID, DATE, DATE, TEXT, TEXT, TEXT, DATE
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pe_patient_roster_summary(
  UUID, UUID, DATE, DATE, TEXT, TEXT, TEXT, DATE
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pe_retention_segment_rollup(
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
        public.pe_normalize_retention_status(rs.retention_status) AS retention_status,
        COUNT(*)::bigint AS patient_count,
        ROUND(COALESCE(SUM(f.contribution), 0), 2) AS contribution_gbp
      FROM public.pe_patient_contribution_facts f
      INNER JOIN public.patients p
        ON p.id = f.patient_id
       AND p.organization_id = f.practice_id
       AND p.deleted_at IS NULL
      LEFT JOIN public.v_pe_patient_live_retention rs
        ON rs.practice_id = f.practice_id
       AND rs.patient_id = f.patient_id
      WHERE f.practice_id = p_practice_id
        AND (p_location_id IS NULL OR p.location_id = p_location_id)
        AND (
          p_start_date IS NULL
          AND p_end_date IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.pe_invoice_contribution_facts inv
            WHERE inv.practice_id = p_practice_id
              AND inv.patient_id = f.patient_id
              AND inv.invoice_date >= p_start_date
              AND inv.invoice_date <= p_end_date
          )
        )
      GROUP BY public.pe_normalize_retention_status(rs.retention_status)
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
      LEFT JOIN public.v_pe_patient_live_retention seg
        ON seg.practice_id = pc.practice_id
       AND seg.patient_id = pc.patient_id
      INNER JOIN public.patients p
        ON p.id = pc.patient_id
       AND p.organization_id = pc.practice_id
       AND p.deleted_at IS NULL
      WHERE pc.practice_id = p_practice_id
        AND (p_location_id IS NULL OR p.location_id = p_location_id)
        AND (
          p_start_date IS NULL
          AND p_end_date IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.v_invoice_contribution inv
            WHERE inv.practice_id = p_practice_id
              AND inv.patient_id = pc.patient_id
              AND inv.invoice_date >= p_start_date
              AND inv.invoice_date <= p_end_date
          )
        )
      GROUP BY COALESCE(seg.retention_status, 'active')
    ) rolled;
  END IF;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.pe_retention_segment_rollup(UUID, UUID, DATE, DATE) IS
  'Retention segment rollup; live status from v_pe_patient_live_retention when facts exist.';

REVOKE ALL ON FUNCTION public.pe_retention_segment_rollup(UUID, UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pe_retention_segment_rollup(UUID, UUID, DATE, DATE) TO authenticated, service_role;
