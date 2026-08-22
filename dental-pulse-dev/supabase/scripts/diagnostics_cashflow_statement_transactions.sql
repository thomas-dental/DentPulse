-- =============================================================================
-- Cashflow statement — "Transactions to review" (ONE result grid for Supabase SQL Editor)
-- =============================================================================
-- Supabase SQL Editor only displays the FIRST statement’s result. This file is
-- a SINGLE query: edit `params` below, then run once. You get metrics first,
-- then optional LOCATION rows, then SAMPLE_COA / SAMPLE_JOURNAL rows.
--
-- Column meanings:
--   sort_key  — order (1–19 metrics, 20+ location, 100+ COA samples, 200+ journal samples)
--   row_type  — METRIC | LOCATION_ROW | SAMPLE_COA | SAMPLE_JOURNAL
--   label     — metric id or row title
--   value     — count / id / details
-- =============================================================================

WITH params AS (
  SELECT
    '00000000-0000-0000-0000-000000000001'::uuid AS organization_id, -- <<< REPLACE
    '2026-01-01'::date AS from_date,                               -- <<< REPLACE
    '2026-12-31'::date AS to_date,                                 -- <<< REPLACE
    NULL::uuid AS location_id                                      -- <<< REPLACE or NULL
),

p AS (SELECT * FROM params),

xero_pi AS (
  SELECT pi.id
  FROM platform_integrations pi, p
  WHERE pi.organization_id = p.organization_id
    AND pi.platform_name = 'xero'
    AND pi.is_connected = true
  ORDER BY pi.updated_at DESC
  LIMIT 1
),

iplicit_pi AS (
  SELECT pi.id
  FROM platform_integrations pi, p
  WHERE pi.organization_id = p.organization_id
    AND pi.platform_name = 'iplicit'
    AND pi.is_connected = true
  ORDER BY pi.updated_at DESC
  LIMIT 1
),

xero_source AS (
  SELECT fds.id AS source_id
  FROM finance_data_sources fds, p, xero_pi x
  WHERE fds.organization_id = p.organization_id
    AND fds.platform = 'xero'
    AND fds.platform_integration_id = x.id
  ORDER BY fds.created_at DESC
  LIMIT 1
),

bank_coa_rows AS (
  SELECT
    coa.coa_account_id,
    coa.coa_account_name,
    coa.coa_account_type,
    coa.coa_bank_account_type
  FROM platform_integration_chart_of_accounts coa, p, xero_pi x
  WHERE coa.organization_id = p.organization_id
    AND coa.platform_integration_id = x.id
    AND coa.platform_name = 'xero'
    AND (
      coa.coa_bank_account_type IS NOT NULL
      OR coa.coa_account_type IN ('BANK', 'CREDITCARD')
    )
),

bank_coa AS (SELECT b.coa_account_id FROM bank_coa_rows b),

bank_fa AS (
  SELECT fa.id
  FROM finance_accounts fa, p, xero_source xs, bank_coa b
  WHERE fa.organization_id = p.organization_id
    AND fa.source_id = xs.source_id
    AND fa.canonical_account_code = b.coa_account_id::text
),

metrics AS (
  SELECT 1 AS sort_key, 'METRIC' AS row_type, '01_xero_integration_id' AS label, (SELECT id::text FROM xero_pi) AS value
  UNION ALL
  SELECT 2, 'METRIC', '02_iplicit_fallback_connection_id', (SELECT id::text FROM iplicit_pi)
  UNION ALL
  SELECT 3, 'METRIC', '03_xero_finance_data_sources_id', (SELECT source_id::text FROM xero_source)
  UNION ALL
  SELECT 4, 'METRIC', '04_finance_journal_lines_all_time_for_xero_source',
    (SELECT COUNT(*)::text FROM finance_journal_lines fjl, xero_source xs, p
     WHERE fjl.source_id = xs.source_id AND fjl.organization_id = p.organization_id)
  UNION ALL
  SELECT 5, 'METRIC', '05_finance_journal_lines_in_date_range_for_xero_source',
    (SELECT COUNT(*)::text FROM finance_journal_lines fjl, p, xero_source xs
     WHERE fjl.organization_id = p.organization_id AND fjl.source_id = xs.source_id
       AND fjl.posting_date BETWEEN p.from_date AND p.to_date)
  UNION ALL
  SELECT 6, 'METRIC', '06_lines_in_range_with_dimensions_legal_entity_id_set',
    (SELECT COUNT(*)::text FROM finance_journal_lines fjl, p, xero_source xs
     WHERE fjl.organization_id = p.organization_id AND fjl.source_id = xs.source_id
       AND fjl.posting_date BETWEEN p.from_date AND p.to_date
       AND COALESCE(fjl.dimensions_json->>'legal_entity_id', '') <> '')
  UNION ALL
  SELECT 7, 'METRIC', '07_bank_coa_rows_xero', (SELECT COUNT(*)::text FROM bank_coa_rows)
  UNION ALL
  SELECT 8, 'METRIC', '08_bank_finance_accounts_mapped', (SELECT COUNT(*)::text FROM bank_fa)
  UNION ALL
  SELECT 9, 'METRIC', '09_journal_lines_in_range_on_bank_finance_accounts',
    (SELECT COUNT(*)::text FROM finance_journal_lines fjl, p, bank_fa bf
     WHERE fjl.organization_id = p.organization_id
       AND fjl.account_id = bf.id
       AND fjl.posting_date BETWEEN p.from_date AND p.to_date)
  UNION ALL
  SELECT 10, 'METRIC', '10_platform_bank_transactions_in_range_any_integration',
    (SELECT COUNT(*)::text FROM platform_bank_transactions t, p
     WHERE t.organization_id = p.organization_id
       AND t.transaction_date BETWEEN p.from_date AND p.to_date)
  UNION ALL
  SELECT 11, 'METRIC', '11_platform_bank_transactions_scoped_xero_pi',
    (SELECT COUNT(*)::text FROM platform_bank_transactions t, p, xero_pi x
     WHERE t.organization_id = p.organization_id
       AND t.platform_integration_id = x.id
       AND t.transaction_date BETWEEN p.from_date AND p.to_date)
  UNION ALL
  SELECT 12, 'METRIC', '12_iplicit_profit_loss_in_range_if_connection',
    (SELECT COUNT(*)::text FROM iplicit_profit_loss pl, p, iplicit_pi ip
     WHERE pl.organization_id = p.organization_id
       AND pl.platform_integration_id = ip.id
       AND pl.period_date IS NOT NULL
       AND pl.period_date BETWEEN p.from_date AND p.to_date)
  UNION ALL
  SELECT 13, 'METRIC', '13_iplicit_balance_sheet_in_range_if_connection',
    (SELECT COUNT(*)::text FROM iplicit_balance_sheet bs, p, iplicit_pi ip
     WHERE bs.organization_id = p.organization_id
       AND bs.platform_integration_id = ip.id
       AND bs.period_date IS NOT NULL
       AND bs.period_date BETWEEN p.from_date AND p.to_date)
),

location_rows AS (
  SELECT
    20 + ROW_NUMBER() OVER (ORDER BY m.id) AS sort_key,
    'LOCATION_ROW' AS row_type,
    'mapping for location_id=' || p.location_id::text AS label,
    'platform_integration_id=' || m.platform_integration_id::text
      || ' | pio.platform_name=' || pio.platform_name
      || ' | platform_org_id=' || COALESCE(pio.platform_org_id::text, '') AS value
  FROM platform_integration_organization_mapping m
  JOIN p ON m.organization_id = p.organization_id
  JOIN platform_integration_organizations pio ON pio.id = m.platform_integration_organizations_id
  WHERE p.location_id IS NOT NULL
    AND m.location_id = p.location_id
),

coa_samples AS (
  SELECT
    100 + ROW_NUMBER() OVER (ORDER BY b.coa_account_name) AS sort_key,
    'SAMPLE_COA' AS row_type,
    b.coa_account_name AS label,
    b.coa_account_id::text || ' | type=' || b.coa_account_type
      || ' | bankType=' || COALESCE(b.coa_bank_account_type::text, '') AS value
  FROM bank_coa_rows b
  LIMIT 20
),

journal_samples AS (
  SELECT
    200 + ROW_NUMBER() OVER (ORDER BY fjl.posting_date, fjl.id) AS sort_key,
    'SAMPLE_JOURNAL' AS row_type,
    'posting_date=' || fjl.posting_date::text AS label,
    'debit=' || COALESCE(fjl.debit_amount::text, '0')
      || ' credit=' || COALESCE(fjl.credit_amount::text, '0')
      || ' | dimensions_json=' || COALESCE(fjl.dimensions_json::text, '{}') AS value
  FROM finance_journal_lines fjl
  JOIN p ON fjl.organization_id = p.organization_id
  JOIN xero_source xs ON fjl.source_id = xs.source_id
  WHERE fjl.posting_date BETWEEN p.from_date AND p.to_date
  LIMIT 15
)

SELECT sort_key, row_type, label, value
FROM (
  SELECT * FROM metrics
  UNION ALL
  SELECT * FROM location_rows
  UNION ALL
  SELECT * FROM coa_samples
  UNION ALL
  SELECT * FROM journal_samples
) u
ORDER BY sort_key, label;
