-- ============================================================================
-- Phase D: materialized org × location × month dashboard facts.
--
-- Dashboard / location metrics currently recompute production + profit (+ cashflow)
-- on every load by scanning journals / TPI and fanning out edge calls. This table
-- stores pre-aggregated month rows so reads are a simple range query.
--
-- Grain: organization_id × location_id (NULL = All Locations) × month_start
--        (1st of calendar month; TPI bounds use Europe/London like Phase C).
--
-- v1 refresh fills: PMS production, accounting income slices, PB cost/expense,
-- production_income, actual_profit. Cashflow columns exist for v1.1 (edge/SQL).
--
-- formula_version pins compose rules; bump when deriveActualProfit / income
-- source logic changes and rebuild affected months.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dashboard_month_facts (
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id           uuid NULL REFERENCES public.practice_locations(id) ON DELETE CASCADE,
  month_start           date NOT NULL,

  -- PMS (Provider Net Production rollup for the location / All)
  pms_private           numeric(19, 4) NOT NULL DEFAULT 0,
  pms_membership        numeric(19, 4) NOT NULL DEFAULT 0,
  pms_nhs               numeric(19, 4) NOT NULL DEFAULT 0,
  pms_total             numeric(19, 4) NOT NULL DEFAULT 0,

  -- Accounting App practice-level income (null = not used / not mapped)
  acct_private          numeric(19, 4),
  acct_membership       numeric(19, 4),
  acct_nhs              numeric(19, 4),

  -- Composed Production Income (mirrors composeProductionIncome)
  production_income     numeric(19, 4) NOT NULL DEFAULT 0,

  -- Profit Benchmark expense actuals (mirrors deriveActualProfit inputs)
  pb_treatment_cost     numeric(19, 4) NOT NULL DEFAULT 0,
  pb_operating_expense  numeric(19, 4) NOT NULL DEFAULT 0,
  pb_total_expenses     numeric(19, 4) NOT NULL DEFAULT 0,
  actual_profit         numeric(19, 4) NOT NULL DEFAULT 0,

  -- Cashflow (populated in a later refresh pass / edge)
  cf_total_received     numeric(19, 4),
  cf_total_paid         numeric(19, 4),
  cf_net_cashflow       numeric(19, 4),
  cf_opening_balance    numeric(19, 4),
  cf_closing_balance    numeric(19, 4),

  formula_version       text NOT NULL DEFAULT 'v1',
  refreshed_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dashboard_month_facts_month_start_chk
    CHECK (month_start = date_trunc('month', month_start)::date)
);

-- Unique grain: one row per org × month × location (NULL location = All)
CREATE UNIQUE INDEX IF NOT EXISTS dashboard_month_facts_org_month_loc_uidx
  ON public.dashboard_month_facts (organization_id, month_start, location_id)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_dashboard_month_facts_org_month
  ON public.dashboard_month_facts (organization_id, month_start);

CREATE INDEX IF NOT EXISTS idx_dashboard_month_facts_org_loc_month
  ON public.dashboard_month_facts (organization_id, location_id, month_start)
  WHERE location_id IS NOT NULL;

COMMENT ON TABLE public.dashboard_month_facts IS
  'Phase D pre-aggregated org×location×month facts for Group Dashboard / location metrics.';

ALTER TABLE public.dashboard_month_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dashboard_month_facts_select ON public.dashboard_month_facts;
CREATE POLICY dashboard_month_facts_select
  ON public.dashboard_month_facts FOR SELECT
  USING (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS dashboard_month_facts_insert ON public.dashboard_month_facts;
CREATE POLICY dashboard_month_facts_insert
  ON public.dashboard_month_facts FOR INSERT
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS dashboard_month_facts_update ON public.dashboard_month_facts;
CREATE POLICY dashboard_month_facts_update
  ON public.dashboard_month_facts FOR UPDATE
  USING (public.user_in_org(auth.uid(), organization_id))
  WITH CHECK (public.user_in_org(auth.uid(), organization_id));

DROP POLICY IF EXISTS dashboard_month_facts_delete ON public.dashboard_month_facts;
CREATE POLICY dashboard_month_facts_delete
  ON public.dashboard_month_facts FOR DELETE
  USING (public.user_in_org(auth.uid(), organization_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dashboard_month_facts TO authenticated;
GRANT ALL ON public.dashboard_month_facts TO service_role;

-- ── Read RPC ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_dashboard_month_facts(
  p_organization_id uuid,
  p_from_date       date,
  p_to_date         date,
  p_location_id     uuid DEFAULT NULL
)
RETURNS SETOF public.dashboard_month_facts
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT f.*
  FROM public.dashboard_month_facts f
  WHERE f.organization_id = p_organization_id
    AND f.month_start >= date_trunc('month', p_from_date)::date
    AND f.month_start <= date_trunc('month', p_to_date)::date
    AND (
      (p_location_id IS NULL AND f.location_id IS NULL)
      OR f.location_id = p_location_id
    )
  ORDER BY f.month_start;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_month_facts(uuid, date, date, uuid)
  TO authenticated, service_role;

-- ── Refresh RPC (production + profit v1) ─────────────────────────────────────
-- Rebuilds facts for one org (optionally one location) over [from, to] months.
-- Uses existing get_all_providers_net_production_monthly for PMS parity, and
-- Xero journal SUM for accounting income + PB cost/expense (group_account maps).

CREATE OR REPLACE FUNCTION public.refresh_dashboard_month_facts(
  p_organization_id uuid,
  p_from_date       date,
  p_to_date         date,
  p_location_id     uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '180s'
AS $$
DECLARE
  v_from date := date_trunc('month', p_from_date)::date;
  v_to   date := date_trunc('month', p_to_date)::date;
  v_loc  record;
  v_rows integer := 0;
  v_upserted integer;
BEGIN
  IF p_organization_id IS NULL OR p_from_date IS NULL OR p_to_date IS NULL THEN
    RAISE EXCEPTION 'organization_id, from_date and to_date are required';
  END IF;
  IF v_to < v_from THEN
    RAISE EXCEPTION 'to_date must be >= from_date';
  END IF;

  -- Targets: each active location (+ All Locations NULL), or a single location.
  FOR v_loc IN
    SELECT pl.id AS location_id
    FROM public.practice_locations pl
    WHERE pl.organization_id = p_organization_id
      AND pl.deleted_at IS NULL
      AND (p_location_id IS NULL OR pl.id = p_location_id)
    UNION ALL
    SELECT NULL::uuid
    WHERE p_location_id IS NULL
  LOOP
    SELECT public._refresh_dashboard_month_facts_for_location(
      p_organization_id, v_from, v_to, v_loc.location_id
    ) INTO v_upserted;
    v_rows := v_rows + COALESCE(v_upserted, 0);
  END LOOP;

  RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_dashboard_month_facts(uuid, date, date, uuid)
  TO authenticated, service_role;

-- Internal helper: one location (or All Locations when p_location_id IS NULL)
CREATE OR REPLACE FUNCTION public._refresh_dashboard_month_facts_for_location(
  p_organization_id uuid,
  p_from_month      date,
  p_to_month        date,
  p_location_id     uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_range_from date := p_from_month;
  v_range_to   date := (date_trunc('month', p_to_month) + interval '1 month - 1 day')::date;
  v_priv_src   text;
  v_mem_src    text;
  v_nhs_src    text;
  v_priv_level text;
  v_mem_level  text;
  v_nhs_level  text;
  v_count      integer := 0;
BEGIN
  -- Income source defaults (practice_locations). For All Locations: accounting
  -- wins if ANY site uses accounting for that type (matches client).
  IF p_location_id IS NOT NULL THEN
    SELECT
      LOWER(COALESCE(pl.private_income_source, 'pms')),
      LOWER(COALESCE(pl.membership_income_source, 'accounting')),
      LOWER(COALESCE(pl.nhs_income_source, 'accounting'))
    INTO v_priv_src, v_mem_src, v_nhs_src
    FROM public.practice_locations pl
    WHERE pl.id = p_location_id;

    SELECT
      LOWER(COALESCE(rs.private_income_level, 'practice')),
      LOWER(COALESCE(rs.membership_income_level, 'practice')),
      LOWER(COALESCE(rs.nhs_income_level, 'practice'))
    INTO v_priv_level, v_mem_level, v_nhs_level
    FROM public.revenue_settings rs
    WHERE rs.organization_id = p_organization_id
      AND rs.location_id = p_location_id
    LIMIT 1;

    IF v_priv_level IS NULL THEN
      SELECT
        LOWER(COALESCE(rs.private_income_level, 'practice')),
        LOWER(COALESCE(rs.membership_income_level, 'practice')),
        LOWER(COALESCE(rs.nhs_income_level, 'practice'))
      INTO v_priv_level, v_mem_level, v_nhs_level
      FROM public.revenue_settings rs
      WHERE rs.organization_id = p_organization_id
        AND rs.location_id IS NULL
      LIMIT 1;
    END IF;
  ELSE
    SELECT
      CASE WHEN bool_or(LOWER(COALESCE(pl.private_income_source, 'pms')) = 'accounting')
        THEN 'accounting' ELSE 'pms' END,
      CASE WHEN bool_or(LOWER(COALESCE(pl.membership_income_source, 'accounting')) = 'accounting')
        THEN 'accounting' ELSE 'pms' END,
      CASE WHEN bool_or(LOWER(COALESCE(pl.nhs_income_source, 'accounting')) = 'accounting')
        THEN 'accounting' ELSE 'pms' END
    INTO v_priv_src, v_mem_src, v_nhs_src
    FROM public.practice_locations pl
    WHERE pl.organization_id = p_organization_id
      AND pl.deleted_at IS NULL;

    SELECT
      LOWER(COALESCE(rs.private_income_level, 'practice')),
      LOWER(COALESCE(rs.membership_income_level, 'practice')),
      LOWER(COALESCE(rs.nhs_income_level, 'practice'))
    INTO v_priv_level, v_mem_level, v_nhs_level
    FROM public.revenue_settings rs
    WHERE rs.organization_id = p_organization_id
      AND rs.location_id IS NULL
    LIMIT 1;
  END IF;

  v_priv_src   := COALESCE(v_priv_src, 'pms');
  v_mem_src    := COALESCE(v_mem_src, 'accounting');
  v_nhs_src    := COALESCE(v_nhs_src, 'accounting');
  v_priv_level := COALESCE(v_priv_level, 'practice');
  v_mem_level  := COALESCE(v_mem_level, 'practice');
  v_nhs_level  := COALESCE(v_nhs_level, 'practice');

  WITH
  month_series AS (
    SELECT d::date AS month_start
    FROM generate_series(p_from_month, p_to_month, '1 month'::interval) AS d
  ),

  -- PMS via existing RPC (same figures as Provider Net Production).
  -- Join on Mon-YY label (matches TO_CHAR locale used by the RPC).
  pms_raw AS (
    SELECT
      r.month                 AS mon_label,
      SUM(r.private_amount)   AS pms_private,
      SUM(r.membership_amount) AS pms_membership,
      SUM(r.nhs_amount)       AS pms_nhs,
      SUM(r.total_amount)     AS pms_total
    FROM public.get_all_providers_net_production_monthly(
      p_organization_id, v_range_from, v_range_to, p_location_id
    ) r
    GROUP BY 1
  ),

  -- Revenue / expense COA maps from Setup Categories (group_account)
  rev_masters AS (
    SELECT id, LOWER(regexp_replace(COALESCE(group_code, ''), '[^a-z]', '', 'g')) AS code
    FROM public.group_account_master
    WHERE group_type = 1
  ),
  exp_masters AS (
    SELECT id, group_type
    FROM public.group_account_master
    WHERE group_type IN (2, 3)
  ),
  rev_accounts AS (
    SELECT
      rm.code,
      COALESCE(
        array_agg(DISTINCT NULLIF(TRIM(ga.account_id), ''))
          FILTER (WHERE NULLIF(TRIM(ga.account_id), '') IS NOT NULL),
        ARRAY[]::text[]
      ) AS account_ids
    FROM public.group_account ga
    JOIN rev_masters rm ON rm.id = ga.group_account_master_id
    WHERE ga.organization_id = p_organization_id
      AND rm.code IN ('privateincome', 'membershipincome', 'nhsincome')
      AND (
        (p_location_id IS NOT NULL AND ga.mapping_location_id = p_location_id)
        OR (p_location_id IS NULL AND ga.mapping_location_id IS NOT NULL)
      )
    GROUP BY rm.code
  ),
  exp_accounts AS (
    SELECT
      em.group_type,
      COALESCE(
        array_agg(DISTINCT NULLIF(TRIM(ga.account_id), ''))
          FILTER (WHERE NULLIF(TRIM(ga.account_id), '') IS NOT NULL),
        ARRAY[]::text[]
      ) AS account_ids
    FROM public.group_account ga
    JOIN exp_masters em ON em.id = ga.group_account_master_id
    WHERE ga.organization_id = p_organization_id
      AND (
        (p_location_id IS NOT NULL AND ga.mapping_location_id = p_location_id)
        OR (p_location_id IS NULL AND ga.mapping_location_id IS NOT NULL)
      )
    GROUP BY em.group_type
  ),

  -- Inline journal month sums. Never call get_xero_journal_net_by_month with
  -- NULL/empty accounts (that RPC treats empty as "all accounts").
  acct_private_m AS (
    SELECT date_trunc('month', j.journal_date)::date AS month_start,
           ABS(SUM(j.net_amount)) AS amt
    FROM public.xero_journal_details j
    JOIN rev_accounts ra ON ra.code = 'privateincome' AND cardinality(ra.account_ids) > 0
    WHERE j.organization_id = p_organization_id
      AND j.journal_date >= v_range_from
      AND j.journal_date <= v_range_to
      AND j.account_id = ANY (ra.account_ids)
    GROUP BY 1
  ),
  acct_mem_m AS (
    SELECT date_trunc('month', j.journal_date)::date AS month_start,
           ABS(SUM(j.net_amount)) AS amt
    FROM public.xero_journal_details j
    JOIN rev_accounts ra ON ra.code = 'membershipincome' AND cardinality(ra.account_ids) > 0
    WHERE j.organization_id = p_organization_id
      AND j.journal_date >= v_range_from
      AND j.journal_date <= v_range_to
      AND j.account_id = ANY (ra.account_ids)
    GROUP BY 1
  ),
  acct_nhs_m AS (
    SELECT date_trunc('month', j.journal_date)::date AS month_start,
           ABS(SUM(j.net_amount)) AS amt
    FROM public.xero_journal_details j
    JOIN rev_accounts ra ON ra.code = 'nhsincome' AND cardinality(ra.account_ids) > 0
    WHERE j.organization_id = p_organization_id
      AND j.journal_date >= v_range_from
      AND j.journal_date <= v_range_to
      AND j.account_id = ANY (ra.account_ids)
    GROUP BY 1
  ),
  pb_cost_m AS (
    SELECT date_trunc('month', j.journal_date)::date AS month_start,
           ABS(SUM(j.net_amount)) AS amt
    FROM public.xero_journal_details j
    JOIN exp_accounts ea ON ea.group_type = 2 AND cardinality(ea.account_ids) > 0
    WHERE j.organization_id = p_organization_id
      AND j.journal_date >= v_range_from
      AND j.journal_date <= v_range_to
      AND j.account_id = ANY (ea.account_ids)
    GROUP BY 1
  ),
  pb_exp_m AS (
    SELECT date_trunc('month', j.journal_date)::date AS month_start,
           ABS(SUM(j.net_amount)) AS amt
    FROM public.xero_journal_details j
    JOIN exp_accounts ea ON ea.group_type = 3 AND cardinality(ea.account_ids) > 0
    WHERE j.organization_id = p_organization_id
      AND j.journal_date >= v_range_from
      AND j.journal_date <= v_range_to
      AND j.account_id = ANY (ea.account_ids)
    GROUP BY 1
  ),

  composed AS (
    SELECT
      ms.month_start,
      ROUND(COALESCE(p.pms_private, 0), 4)      AS pms_private,
      ROUND(COALESCE(p.pms_membership, 0), 4)   AS pms_membership,
      ROUND(COALESCE(p.pms_nhs, 0), 4)          AS pms_nhs,
      ROUND(COALESCE(p.pms_total, 0), 4)        AS pms_total,
      CASE WHEN v_priv_src = 'accounting' AND v_priv_level = 'practice'
        THEN ROUND(COALESCE(ap.amt, 0), 4) ELSE NULL END AS acct_private,
      CASE WHEN v_mem_src = 'accounting' AND v_mem_level = 'practice'
        THEN ROUND(COALESCE(am.amt, 0), 4) ELSE NULL END AS acct_membership,
      CASE WHEN v_nhs_src = 'accounting' AND v_nhs_level = 'practice'
        THEN ROUND(COALESCE(an.amt, 0), 4) ELSE NULL END AS acct_nhs,
      ROUND(COALESCE(pc.amt, 0), 4) AS pb_treatment_cost,
      ROUND(COALESCE(pe.amt, 0), 4) AS pb_operating_expense
    FROM month_series ms
    LEFT JOIN pms_raw p ON p.mon_label = TO_CHAR(ms.month_start, 'Mon-YY')
    LEFT JOIN acct_private_m ap ON ap.month_start = ms.month_start
    LEFT JOIN acct_mem_m am ON am.month_start = ms.month_start
    LEFT JOIN acct_nhs_m an ON an.month_start = ms.month_start
    LEFT JOIN pb_cost_m pc ON pc.month_start = ms.month_start
    LEFT JOIN pb_exp_m pe ON pe.month_start = ms.month_start
  ),
  final_rows AS (
    SELECT
      c.*,
      ROUND(
        COALESCE(c.acct_private, c.pms_private)
        + COALESCE(c.acct_membership, c.pms_membership)
        + COALESCE(c.acct_nhs, c.pms_nhs)
      , 4) AS production_income,
      ROUND(c.pb_treatment_cost + c.pb_operating_expense, 4) AS pb_total_expenses
    FROM composed c
  )
  INSERT INTO public.dashboard_month_facts AS f (
    organization_id, location_id, month_start,
    pms_private, pms_membership, pms_nhs, pms_total,
    acct_private, acct_membership, acct_nhs,
    production_income,
    pb_treatment_cost, pb_operating_expense, pb_total_expenses,
    actual_profit,
    formula_version, refreshed_at
  )
  SELECT
    p_organization_id,
    p_location_id,
    r.month_start,
    r.pms_private, r.pms_membership, r.pms_nhs, r.pms_total,
    r.acct_private, r.acct_membership, r.acct_nhs,
    r.production_income,
    r.pb_treatment_cost, r.pb_operating_expense, r.pb_total_expenses,
    ROUND(ABS(r.production_income) - r.pb_total_expenses, 4),
    'v1',
    now()
  FROM final_rows r
  ON CONFLICT (organization_id, month_start, location_id)
  DO UPDATE SET
    pms_private          = EXCLUDED.pms_private,
    pms_membership       = EXCLUDED.pms_membership,
    pms_nhs              = EXCLUDED.pms_nhs,
    pms_total            = EXCLUDED.pms_total,
    acct_private         = EXCLUDED.acct_private,
    acct_membership      = EXCLUDED.acct_membership,
    acct_nhs             = EXCLUDED.acct_nhs,
    production_income    = EXCLUDED.production_income,
    pb_treatment_cost    = EXCLUDED.pb_treatment_cost,
    pb_operating_expense = EXCLUDED.pb_operating_expense,
    pb_total_expenses    = EXCLUDED.pb_total_expenses,
    actual_profit        = EXCLUDED.actual_profit,
    formula_version      = EXCLUDED.formula_version,
    refreshed_at         = EXCLUDED.refreshed_at;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public._refresh_dashboard_month_facts_for_location(uuid, date, date, uuid)
  FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public._refresh_dashboard_month_facts_for_location(uuid, date, date, uuid)
  TO service_role;

COMMENT ON FUNCTION public.refresh_dashboard_month_facts(uuid, date, date, uuid) IS
  'Phase D: rebuild dashboard_month_facts for an org (and optional location) over a month range.';

COMMENT ON FUNCTION public.get_dashboard_month_facts(uuid, date, date, uuid) IS
  'Phase D: read pre-aggregated dashboard month facts (NULL location_id = All Locations).';
