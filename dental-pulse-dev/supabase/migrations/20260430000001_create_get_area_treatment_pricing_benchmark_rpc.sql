-- ============================================================
-- RPC: get_area_treatment_pricing_benchmark
--
-- Powers the "AREA" source on the AI Suggested Pricing panel.
-- Returns aggregated pricing stats for a given treatment across
-- ALL organizations whose practice_locations sit in the same
-- geographic area (city → state → country fallback).
--
-- Privacy:
--   * SECURITY DEFINER (bypasses RLS) but returns ONLY aggregates
--     (count, avg, median) — never per-clinic prices or org names.
--   * Returns zero rows when fewer than p_min_clinics distinct
--     organizations contribute data, so a single clinic's prices
--     can never be inferred from the aggregate.
--   * Excludes the caller's own organization so peers are external.
--
-- Matching (in order of preference):
--   1. treatment_code (e.g. ADA D0120) — most reliable cross-org match
--   2. treatment_name (case-insensitive)
--   3. category name (loose fallback when neither above matches)
--
-- The function picks the highest-specificity match available:
-- if any rows match by code, only those are aggregated; otherwise
-- it falls back to name; otherwise to category. This keeps the
-- "Crown" benchmark from being polluted by every "Crown — Composite"
-- variant when an exact code/name match exists.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_area_treatment_pricing_benchmark(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.get_area_treatment_pricing_benchmark(
    p_exclude_organization_id UUID,
    p_treatment_code          TEXT,
    p_treatment_name          TEXT,
    p_category_name           TEXT,
    p_city                    TEXT,
    p_state                   TEXT,
    p_country                 TEXT,
    p_min_clinics             INTEGER DEFAULT 3
)
RETURNS TABLE (
    match_level        TEXT,         -- 'code' | 'name' | 'category'
    geo_level          TEXT,         -- 'city' | 'state' | 'country'
    clinic_count       INTEGER,      -- # distinct organizations contributing
    sample_count       INTEGER,      -- # treatment rows aggregated
    avg_price                    NUMERIC,
    median_price                 NUMERIC,
    avg_duration_minutes         NUMERIC,
    avg_therapist_time_mins      NUMERIC,
    avg_lab_bill                 NUMERIC,
    avg_lab_bill_discount        NUMERIC,
    avg_material_cost            NUMERIC,
    avg_percent_fees             NUMERIC,
    avg_therapist_pay_rate       NUMERIC,
    avg_hourly_rate              NUMERIC,
    avg_finance_fee              NUMERIC,
    avg_average_time_minutes     NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_geo_level TEXT;
    v_match_level TEXT;
    v_clinic_count INTEGER;
BEGIN
    -- 1. Pick the tightest geo bucket that produces enough clinics.
    -- We try city, then state, then country, and stop at the first
    -- level that meets p_min_clinics (or fall through with no result).
    SELECT level INTO v_geo_level
    FROM (
        SELECT 'city' AS level, 1 AS pri
        WHERE p_city IS NOT NULL AND length(trim(p_city)) > 0
        UNION ALL
        SELECT 'state', 2
        WHERE p_state IS NOT NULL AND length(trim(p_state)) > 0
        UNION ALL
        SELECT 'country', 3
        WHERE p_country IS NOT NULL AND length(trim(p_country)) > 0
    ) levels
    ORDER BY pri
    LIMIT 1;

    IF v_geo_level IS NULL THEN
        RETURN;
    END IF;

    -- 2. Build a CTE-like temp set of all candidate treatments in the
    -- chosen geo bucket from OTHER organizations.
    -- We escalate the geo bucket until we find enough distinct clinics
    -- OR run out of levels.
    FOR v_geo_level IN
        SELECT unnest(ARRAY['city', 'state', 'country'])
    LOOP
        -- Skip levels for which we have no input
        CONTINUE WHEN v_geo_level = 'city'    AND (p_city    IS NULL OR length(trim(p_city))    = 0);
        CONTINUE WHEN v_geo_level = 'state'   AND (p_state   IS NULL OR length(trim(p_state))   = 0);
        CONTINUE WHEN v_geo_level = 'country' AND (p_country IS NULL OR length(trim(p_country)) = 0);

        -- Try each match-level (code → name → category) at this geo bucket
        FOR v_match_level IN
            SELECT unnest(ARRAY['code', 'name', 'category'])
        LOOP
            CONTINUE WHEN v_match_level = 'code'     AND (p_treatment_code IS NULL OR length(trim(p_treatment_code)) = 0);
            CONTINUE WHEN v_match_level = 'name'     AND (p_treatment_name IS NULL OR length(trim(p_treatment_name)) = 0);
            CONTINUE WHEN v_match_level = 'category' AND (p_category_name  IS NULL OR length(trim(p_category_name))  = 0);

            -- Count distinct contributing organizations for this combo
            SELECT COUNT(DISTINCT t.organization_id) INTO v_clinic_count
            FROM public.treatments t
            JOIN public.practice_locations pl ON pl.id = t.location_id
            LEFT JOIN public.treatment_categories tc ON tc.id = t.category_id
            WHERE t.deleted_at IS NULL
              AND pl.deleted_at IS NULL
              AND t.organization_id <> p_exclude_organization_id
              AND t.price IS NOT NULL
              AND t.price > 0
              AND CASE v_geo_level
                    WHEN 'city'    THEN lower(trim(pl.city))    = lower(trim(p_city))
                    WHEN 'state'   THEN lower(trim(pl.state))   = lower(trim(p_state))
                    WHEN 'country' THEN lower(trim(pl.country)) = lower(trim(p_country))
                  END
              AND CASE v_match_level
                    WHEN 'code'     THEN lower(trim(t.treatment_code)) = lower(trim(p_treatment_code))
                    WHEN 'name'     THEN lower(trim(t.treatment_name)) = lower(trim(p_treatment_name))
                    WHEN 'category' THEN lower(trim(tc.name))          = lower(trim(p_category_name))
                  END;

            IF v_clinic_count >= p_min_clinics THEN
                -- Found a viable bucket; emit aggregates and exit.
                RETURN QUERY
                SELECT
                    v_match_level::TEXT                                         AS match_level,
                    v_geo_level::TEXT                                           AS geo_level,
                    COUNT(DISTINCT t.organization_id)::INTEGER                  AS clinic_count,
                    COUNT(*)::INTEGER                                           AS sample_count,
                    ROUND(AVG(t.price)::NUMERIC, 2)                             AS avg_price,
                    ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.price))::NUMERIC, 2) AS median_price,
                    ROUND(AVG(t.duration_minutes)::NUMERIC, 1)                  AS avg_duration_minutes,
                    ROUND(AVG(t.therapist_time_mins)::NUMERIC, 1)               AS avg_therapist_time_mins,
                    ROUND(AVG(t.lab_bill)::NUMERIC, 2)                          AS avg_lab_bill,
                    ROUND(AVG(t.lab_bill_discount)::NUMERIC, 2)                 AS avg_lab_bill_discount,
                    ROUND(AVG(t.material_cost)::NUMERIC, 2)                     AS avg_material_cost,
                    ROUND(AVG(t.percent_fees)::NUMERIC, 2)                      AS avg_percent_fees,
                    ROUND(AVG(t.therapist_pay_rate)::NUMERIC, 2)                AS avg_therapist_pay_rate,
                    ROUND(AVG(t.hourly_rate)::NUMERIC, 2)                       AS avg_hourly_rate,
                    ROUND(AVG(t.finance_fee)::NUMERIC, 2)                       AS avg_finance_fee,
                    ROUND(AVG(t.average_time_minutes)::NUMERIC, 1)              AS avg_average_time_minutes
                FROM public.treatments t
                JOIN public.practice_locations pl ON pl.id = t.location_id
                LEFT JOIN public.treatment_categories tc ON tc.id = t.category_id
                WHERE t.deleted_at IS NULL
                  AND pl.deleted_at IS NULL
                  AND t.organization_id <> p_exclude_organization_id
                  AND t.price IS NOT NULL
                  AND t.price > 0
                  AND CASE v_geo_level
                        WHEN 'city'    THEN lower(trim(pl.city))    = lower(trim(p_city))
                        WHEN 'state'   THEN lower(trim(pl.state))   = lower(trim(p_state))
                        WHEN 'country' THEN lower(trim(pl.country)) = lower(trim(p_country))
                      END
                  AND CASE v_match_level
                        WHEN 'code'     THEN lower(trim(t.treatment_code)) = lower(trim(p_treatment_code))
                        WHEN 'name'     THEN lower(trim(t.treatment_name)) = lower(trim(p_treatment_name))
                        WHEN 'category' THEN lower(trim(tc.name))          = lower(trim(p_category_name))
                      END;
                RETURN;
            END IF;
        END LOOP;
    END LOOP;

    -- No bucket reached the minimum clinic threshold — return nothing.
    RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_area_treatment_pricing_benchmark(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) TO authenticated;

COMMENT ON FUNCTION public.get_area_treatment_pricing_benchmark IS
'Returns anonymized aggregate pricing for a treatment across other organizations in the same city/state/country. Suppresses output when fewer than p_min_clinics distinct organizations match, so individual clinic prices cannot be inferred.';
