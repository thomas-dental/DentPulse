-- Unified growth levers read: one round-trip (facts + lifetime metrics).

CREATE OR REPLACE FUNCTION public.pe_growth_levers_summary(
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
  v_trailing_months integer;
  v_since_date date;
  v_facts JSONB;
  v_lifetime JSONB;
BEGIN
  PERFORM set_config('statement_timeout', '120000', true);

  SELECT COALESCE(ea.growth_levers_trailing_months, 12)
  INTO v_trailing_months
  FROM public.pe_economic_assumptions ea
  WHERE ea.practice_id = p_practice_id
  LIMIT 1;

  IF v_trailing_months IS NULL OR v_trailing_months <= 0 THEN
    v_trailing_months := 12;
  END IF;

  v_since_date := (CURRENT_DATE - make_interval(months => v_trailing_months))::date;

  v_facts := public.pe_growth_levers_facts(p_practice_id, v_since_date, p_location_id);
  v_lifetime := public.pe_patient_lifetime_metrics(p_practice_id, p_location_id);

  RETURN COALESCE(v_facts, '{}'::jsonb)
    || jsonb_build_object(
      'trailingMonths', v_trailing_months,
      'sinceDate', v_since_date
    )
    || COALESCE(v_lifetime, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pe_growth_levers_summary(UUID, UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.pe_growth_levers_summary(UUID, UUID) IS
  'Growth levers card payload: trailing visit/revenue facts plus patient lifetime metrics in one call.';
