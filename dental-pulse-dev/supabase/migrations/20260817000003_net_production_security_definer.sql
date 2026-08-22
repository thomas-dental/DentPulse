-- The appointment-location joins added in 20260817000002 run as INVOKER.
-- RLS on appointments / treatment_appointments then fires for every TPI row
-- and the Production Data RPC times out for logged-in users, so the UI
-- renders "No production data available". chart_get_production_metrics is
-- already SECURITY DEFINER; these two must match.
ALTER FUNCTION get_all_providers_net_production_monthly(UUID, DATE, DATE, UUID)
  SECURITY DEFINER;
ALTER FUNCTION get_all_providers_net_production_monthly(UUID, DATE, DATE, UUID)
  SET search_path = public;

ALTER FUNCTION get_provider_net_production_monthly(UUID, DATE, DATE, INTEGER, UUID)
  SECURITY DEFINER;
ALTER FUNCTION get_provider_net_production_monthly(UUID, DATE, DATE, INTEGER, UUID)
  SET search_path = public;

ALTER FUNCTION get_setup_category_private_payment_plan_ids(UUID, UUID)
  SECURITY DEFINER;
ALTER FUNCTION get_setup_category_private_payment_plan_ids(UUID, UUID)
  SET search_path = public;
