-- ============================================================
-- RPC: get_area_treatment_pricing_competitors
--
-- Powers the "Show 3 nearby clinics" accordion on the AI Suggested
-- Pricing panel. Returns up to N competitor rows from OTHER orgs
-- in the same geographic area as the calling clinic, ranked by
-- postcode proximity (tightest tier first).
--
-- Privacy / data exposure:
--   * SECURITY DEFINER (bypasses RLS).
--   * NAMED clinics: this RPC returns `clinic_name` (the contributing
--     organization's name), so every DentPulse customer can see what
--     every nearby DentPulse customer charges. This is an explicit
--     product decision — anonymizing was the prior default. Flip back
--     by dropping `clinic_name` from the SELECT and the RETURNS table.
--   * `proximity_tier` is the locality hint exposed alongside the name:
--       'postcode_exact' | 'postcode_outward' | 'postcode_area'
--       | 'city' | 'state' | 'country'
--   * Excludes the caller's own organization.
--   * Capped at p_limit rows (default 3).
--
-- Postcode tiering (UK-aware, degrades gracefully for non-UK):
--   1. Exact postcode match     "IV30 1AB" = same building/street
--   2. Outward code match       "IV30"     = same district
--      (everything before the first space)
--   3. Postcode area match      "IV"       = same region
--      (leading alphabetic characters; NULL for numeric-only ZIPs)
--   4. city → state → country fallbacks (no postcode used)
--
-- Matching (in order of preference, same as the benchmark RPC):
--   1. treatment_code  2. treatment_name  3. category name
-- ============================================================

-- Drop both signatures (anonymized prototype + named version) so re-running
-- this migration in dev cleanly replaces whatever is currently in place.
DROP FUNCTION IF EXISTS public.get_area_treatment_pricing_competitors(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.get_area_treatment_pricing_competitors(
    p_exclude_organization_id UUID,
    p_treatment_code          TEXT,
    p_treatment_name          TEXT,
    p_category_name           TEXT,
    p_postal_code             TEXT,
    p_city                    TEXT,
    p_state                   TEXT,
    p_country                 TEXT,
    p_limit                   INTEGER DEFAULT 3
)
RETURNS TABLE (
    clinic_name           TEXT,
    proximity_tier        TEXT,
    match_level           TEXT,
    price                 NUMERIC,
    duration_minutes      NUMERIC,
    therapist_time_mins   NUMERIC,
    lab_bill              NUMERIC,
    lab_bill_discount     NUMERIC,
    material_cost         NUMERIC,
    percent_fees          NUMERIC,
    therapist_pay_rate    NUMERIC,
    hourly_rate           NUMERIC,
    finance_fee           NUMERIC,
    average_time_minutes  NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_outward      TEXT;
    v_area         TEXT;
    v_match_level  TEXT;
    v_count        INTEGER;
BEGIN
    -- Derive postcode tiers from the caller's postal code.
    -- Outward = upper, trimmed text before the first space (or the
    -- whole code if there's no space — handles US ZIPs gracefully).
    -- Area    = leading alphabetic characters (UK-style); NULL for
    -- numeric-only postcodes (US, etc), so the area tier is skipped.
    IF p_postal_code IS NOT NULL AND length(trim(p_postal_code)) > 0 THEN
        v_outward := split_part(upper(trim(p_postal_code)), ' ', 1);
        v_area    := (regexp_match(upper(trim(p_postal_code)), '^([A-Z]+)'))[1];
    END IF;

    -- Walk proximity tiers from tightest to loosest. At each tier we
    -- also try match_level (code → name → category). First tier+match
    -- combo that yields any competitor row wins; we return up to p_limit
    -- rows from that bucket, ordered for stability so the anonymous
    -- letter labels (Clinic A/B/C) don't shuffle on refresh.
    FOR v_match_level IN
        SELECT unnest(ARRAY['code', 'name', 'category'])
    LOOP
        CONTINUE WHEN v_match_level = 'code'     AND (p_treatment_code IS NULL OR length(trim(p_treatment_code)) = 0);
        CONTINUE WHEN v_match_level = 'name'     AND (p_treatment_name IS NULL OR length(trim(p_treatment_name)) = 0);
        CONTINUE WHEN v_match_level = 'category' AND (p_category_name  IS NULL OR length(trim(p_category_name))  = 0);

        FOR proximity_tier IN
            SELECT unnest(ARRAY['postcode_exact', 'postcode_outward', 'postcode_area', 'city', 'state', 'country'])
        LOOP
            -- Skip tiers we have no input for
            CONTINUE WHEN proximity_tier = 'postcode_exact'   AND (p_postal_code IS NULL OR length(trim(p_postal_code)) = 0);
            CONTINUE WHEN proximity_tier = 'postcode_outward' AND v_outward IS NULL;
            CONTINUE WHEN proximity_tier = 'postcode_area'    AND v_area    IS NULL;
            CONTINUE WHEN proximity_tier = 'city'              AND (p_city    IS NULL OR length(trim(p_city))    = 0);
            CONTINUE WHEN proximity_tier = 'state'             AND (p_state   IS NULL OR length(trim(p_state))   = 0);
            CONTINUE WHEN proximity_tier = 'country'           AND (p_country IS NULL OR length(trim(p_country)) = 0);

            -- Count distinct competitor orgs in this tier+match combo
            SELECT COUNT(DISTINCT t.organization_id) INTO v_count
            FROM public.treatments t
            JOIN public.practice_locations pl ON pl.id = t.location_id
            LEFT JOIN public.treatment_categories tc ON tc.id = t.category_id
            WHERE t.deleted_at IS NULL
              AND pl.deleted_at IS NULL
              AND t.organization_id <> p_exclude_organization_id
              AND t.price IS NOT NULL
              AND t.price > 0
              AND CASE proximity_tier
                    WHEN 'postcode_exact'   THEN upper(trim(pl.postal_code)) = upper(trim(p_postal_code))
                    WHEN 'postcode_outward' THEN split_part(upper(trim(pl.postal_code)), ' ', 1) = v_outward
                    WHEN 'postcode_area'    THEN (regexp_match(upper(trim(pl.postal_code)), '^([A-Z]+)'))[1] = v_area
                    WHEN 'city'             THEN lower(trim(pl.city))    = lower(trim(p_city))
                    WHEN 'state'            THEN lower(trim(pl.state))   = lower(trim(p_state))
                    WHEN 'country'          THEN lower(trim(pl.country)) = lower(trim(p_country))
                  END
              AND CASE v_match_level
                    WHEN 'code'     THEN lower(trim(t.treatment_code)) = lower(trim(p_treatment_code))
                    WHEN 'name'     THEN lower(trim(t.treatment_name)) = lower(trim(p_treatment_name))
                    WHEN 'category' THEN lower(trim(tc.name))          = lower(trim(p_category_name))
                  END;

            IF v_count >= 1 THEN
                -- Emit one row per competitor org. Per-org aggregation
                -- (a single org with multiple matching rows averages to
                -- one figure) keeps the "3 clinics" promise honest, and
                -- nothing in the result identifies which org is which.
                RETURN QUERY
                SELECT
                    o.name                                              AS clinic_name,
                    proximity_tier::TEXT                                AS proximity_tier,
                    v_match_level::TEXT                                 AS match_level,
                    ROUND(AVG(t.price)::NUMERIC, 2)                     AS price,
                    ROUND(AVG(t.duration_minutes)::NUMERIC, 1)          AS duration_minutes,
                    ROUND(AVG(t.therapist_time_mins)::NUMERIC, 1)       AS therapist_time_mins,
                    ROUND(AVG(t.lab_bill)::NUMERIC, 2)                  AS lab_bill,
                    ROUND(AVG(t.lab_bill_discount)::NUMERIC, 2)         AS lab_bill_discount,
                    ROUND(AVG(t.material_cost)::NUMERIC, 2)             AS material_cost,
                    ROUND(AVG(t.percent_fees)::NUMERIC, 2)              AS percent_fees,
                    ROUND(AVG(t.therapist_pay_rate)::NUMERIC, 2)        AS therapist_pay_rate,
                    ROUND(AVG(t.hourly_rate)::NUMERIC, 2)               AS hourly_rate,
                    ROUND(AVG(t.finance_fee)::NUMERIC, 2)               AS finance_fee,
                    ROUND(AVG(t.average_time_minutes)::NUMERIC, 1)      AS average_time_minutes
                FROM public.treatments t
                JOIN public.practice_locations pl ON pl.id = t.location_id
                JOIN public.organizations o ON o.id = t.organization_id
                LEFT JOIN public.treatment_categories tc ON tc.id = t.category_id
                WHERE t.deleted_at IS NULL
                  AND pl.deleted_at IS NULL
                  AND t.organization_id <> p_exclude_organization_id
                  AND t.price IS NOT NULL
                  AND t.price > 0
                  AND CASE proximity_tier
                        WHEN 'postcode_exact'   THEN upper(trim(pl.postal_code)) = upper(trim(p_postal_code))
                        WHEN 'postcode_outward' THEN split_part(upper(trim(pl.postal_code)), ' ', 1) = v_outward
                        WHEN 'postcode_area'    THEN (regexp_match(upper(trim(pl.postal_code)), '^([A-Z]+)'))[1] = v_area
                        WHEN 'city'             THEN lower(trim(pl.city))    = lower(trim(p_city))
                        WHEN 'state'            THEN lower(trim(pl.state))   = lower(trim(p_state))
                        WHEN 'country'          THEN lower(trim(pl.country)) = lower(trim(p_country))
                      END
                  AND CASE v_match_level
                        WHEN 'code'     THEN lower(trim(t.treatment_code)) = lower(trim(p_treatment_code))
                        WHEN 'name'     THEN lower(trim(t.treatment_name)) = lower(trim(p_treatment_name))
                        WHEN 'category' THEN lower(trim(tc.name))          = lower(trim(p_category_name))
                      END
                -- GROUP BY org_id keeps a single row per competitor org even
                -- if they have several matching treatment rows. o.name is
                -- functionally dependent on t.organization_id (= o.id) but
                -- PostgreSQL still requires it in GROUP BY unless we group
                -- by the org's primary key — easier to just include both.
                GROUP BY t.organization_id, o.name
                ORDER BY t.organization_id
                LIMIT p_limit;

                RETURN;
            END IF;
        END LOOP;
    END LOOP;

    -- No tier produced any competitor — return empty.
    RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_area_treatment_pricing_competitors(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) TO authenticated;

COMMENT ON FUNCTION public.get_area_treatment_pricing_competitors IS
'Returns up to p_limit named competitor pricing rows for a treatment in the same postcode/city/state/country as the caller. Each row is one organization (aggregated across its locations) and includes the organization name. Postcode tiering: exact → outward → area → city → state → country.';
