-- ============================================================================
-- Drop old 4-param overloads of chart functions that conflict with the
-- 5-param versions (which have p_location_id UUID DEFAULT NULL).
--
-- PostgreSQL cannot resolve which overload to call when named params are
-- used (p_provider_type, p_location_id) and both signatures exist.
-- The 5-param version with DEFAULT NULL handles all 4-param call sites.
-- ============================================================================

DROP FUNCTION IF EXISTS chart_get_profit_metrics(DATE, DATE, UUID, TEXT);
DROP FUNCTION IF EXISTS chart_get_associate_performance_metrics(DATE, DATE, UUID, TEXT);
