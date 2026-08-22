/**
 * Re-download Xero entities for Appoline (St Catherine's group) Mar 2025–31 Jul 2026
 * with tracking, then verify cashflow journals for the Appoline location by month.
 *
 * Usage:
 *   node backend/scripts/redownloadAppolineXeroAndVerifyCashflow.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { supabaseAdmin } = require('../config/supabase');
const { processXeroSyncJob } = require('../queue/xero/processor');

const ORG_ID = 'a5892c50-2ac1-4190-9fee-d79bb48878c5';
const APPOLINE_LOCATION_ID = '82b581e3-29e6-41e5-8f36-18b36e1120e3';
const START_DATE = '2025-03-01';
const END_DATE = '2026-07-31';

const ENTITIES = [
  'xero_chart_of_accounts',
  'xero_tracking_categories',
  'xero_invoices',
  'xero_bank_transactions',
  'xero_credit_notes',
  'xero_overpayments',
  'xero_journals',
  'xero_profit_loss',
  'xero_balance_sheet',
];

function monthsInRange(fromYmd, toYmd) {
  const out = [];
  let y = Number(fromYmd.slice(0, 4));
  let m = Number(fromYmd.slice(5, 7));
  const endY = Number(toYmd.slice(0, 4));
  const endM = Number(toYmd.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const end = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    out.push({ key: `${y}-${String(m).padStart(2, '0')}`, start, end });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

async function headCount(table, filters) {
  let q = supabaseAdmin.from(table).select('id', { count: 'exact', head: true });
  for (const [op, args] of filters) {
    q = q[op](...args);
  }
  const { count, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function sumNet(table, filters) {
  let q = supabaseAdmin.from(table).select('net_amount');
  for (const [op, args] of filters) {
    q = q[op](...args);
  }
  const { data, error } = await q;
  if (error) throw new Error(`${table} sum: ${error.message}`);
  return (data || []).reduce((s, r) => s + (Number(r.net_amount) || 0), 0);
}

async function pagedSumAndCount(filters) {
  let offset = 0;
  const page = 1000;
  let count = 0;
  let net = 0;
  let gross = 0;
  while (true) {
    let q = supabaseAdmin
      .from('xero_journal_details')
      .select('id, net_amount, gross_amount')
      .range(offset, offset + page - 1);
    for (const [op, args] of filters) {
      q = q[op](...args);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    count += data.length;
    for (const r of data) {
      net += Number(r.net_amount) || 0;
      const g = r.gross_amount;
      gross += g != null && g !== '' && !Number.isNaN(Number(g)) ? Number(g) : Number(r.net_amount) || 0;
    }
    if (data.length < page) break;
    offset += page;
  }
  return { count, net, gross };
}

async function runEntity(connection, userId, entityAlias) {
  console.log(`\n========== ${entityAlias} ==========`);
  const { data: jobs, error: insertError } = await supabaseAdmin
    .from('sync_jobs')
    .insert({
      organization_id: ORG_ID,
      integration_id: connection.id,
      user_id: userId,
      job_type: 'entity_sync',
      entity_alias: entityAlias,
      status: 'queued',
      progress_percentage: 0,
      current_page: 1,
      records_processed: 0,
      records_failed: 0,
      retry_count: 0,
      max_retries: 3,
      start_date: START_DATE,
      end_date: END_DATE,
    })
    .select();

  if (insertError || !jobs?.length) {
    throw new Error(`Failed to create ${entityAlias} job: ${insertError?.message || 'unknown'}`);
  }

  const job = jobs[0];
  console.log(`[sync] job ${job.id} ${START_DATE} → ${END_DATE}`);
  const started = Date.now();
  await processXeroSyncJob(job, connection, new Map());
  const { data: done } = await supabaseAdmin
    .from('sync_jobs')
    .select('status, records_processed, records_failed, error_message, progress_percentage')
    .eq('id', job.id)
    .single();
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[sync] ${entityAlias} ${done?.status} processed=${done?.records_processed} failed=${done?.records_failed} ${secs}s` +
      (done?.error_message ? ` error=${done.error_message}` : ''),
  );
  return done;
}

async function verifyCashflow(connection) {
  const { data: mapping } = await supabaseAdmin
    .from('platform_integration_organization_mapping')
    .select(
      'location_id, platform_integration_organizations_id, xero_tracking_category_id, xero_tracking_option_id, xero_tracking_category_name, xero_tracking_option_name',
    )
    .eq('organization_id', ORG_ID)
    .eq('location_id', APPOLINE_LOCATION_ID)
    .maybeSingle();

  if (!mapping?.xero_tracking_option_id) {
    throw new Error('Appoline location is not mapped to a Xero tracking option');
  }

  const tenantId = mapping.platform_integration_organizations_id;
  const optionId = mapping.xero_tracking_option_id;
  console.log(
    `\n========== CASHFLOW VERIFY Appoline ==========`,
  );
  console.log(
    `tenant=${tenantId} category=${mapping.xero_tracking_category_name} option=${mapping.xero_tracking_option_name} (${optionId})`,
  );

  const months = monthsInRange(START_DATE, END_DATE);
  const rows = [];

  for (const month of months) {
    const base = [
      ['eq', ['organization_id', ORG_ID]],
      ['eq', ['platform_integration_id', connection.id]],
      ['eq', ['platform_integration_organization_id', tenantId]],
      ['gte', ['journal_date', month.start]],
      ['lte', ['journal_date', month.end]],
    ];
    const all = await pagedSumAndCount(base);
    const appoline = await pagedSumAndCount([
      ...base,
      ['contains', ['tracking_option_ids', [optionId]]],
    ]);
    const tagged = await pagedSumAndCount([
      ...base,
      ['neq', ['tracking_option_ids', '{}']],
    ]);
    rows.push({
      month: month.key,
      tenant_lines: all.count,
      appoline_lines: appoline.count,
      tagged_lines: tagged.count,
      untagged_lines: all.count - tagged.count,
      appoline_net: Number(appoline.net.toFixed(2)),
      appoline_gross: Number(appoline.gross.toFixed(2)),
      tenant_net: Number(all.net.toFixed(2)),
    });
    console.log(
      `${month.key}  Appoline lines=${appoline.count} net=${appoline.net.toFixed(2)}  |  tenant lines=${all.count} tagged=${tagged.count} untagged=${all.count - tagged.count}`,
    );
  }

  const monthsWithAppoline = rows.filter((r) => r.appoline_lines > 0).length;
  const identicalToTenant = rows.filter(
    (r) => r.appoline_lines > 0 && r.appoline_lines === r.tenant_lines,
  ).length;

  console.log('\n========== VERDICT ==========');
  console.log(`Months in window: ${rows.length}`);
  console.log(`Months with Appoline tracking on journals: ${monthsWithAppoline}`);
  console.log(
    `Months where Appoline == full tenant (tracking not splitting): ${identicalToTenant}`,
  );

  const catCount = await headCount('xero_tracking_categories', [
    ['eq', ['organization_id', ORG_ID]],
    ['eq', ['platform_integration_organizations_id', tenantId]],
  ]);
  const optCount = await headCount('xero_tracking_options', [
    ['eq', ['organization_id', ORG_ID]],
    ['eq', ['platform_integration_organizations_id', tenantId]],
  ]);
  let pnlAppoline = null;
  let invTagged = null;
  let bankTagged = null;
  try {
    pnlAppoline = await headCount('xero_profit_loss', [
      ['eq', ['organization_id', ORG_ID]],
      ['eq', ['xero_tenant_id', tenantId]],
      ['eq', ['xero_tracking_option_id', optionId]],
      ['gte', ['from_date', START_DATE]],
      ['lte', ['to_date', END_DATE]],
    ]);
  } catch (e) {
    console.warn('[verify] P&L count failed:', e.message);
  }
  try {
    invTagged = await headCount('xero_invoice_line_items', [
      ['eq', ['organization_id', ORG_ID]],
      ['contains', ['tracking_option_ids', [optionId]]],
    ]);
  } catch (e) {
    console.warn('[verify] invoice tracking count failed:', e.message);
  }
  try {
    bankTagged = await headCount('xero_bank_transactions', [
      ['eq', ['organization_id', ORG_ID]],
      ['contains', ['tracking_option_ids', [optionId]]],
    ]);
  } catch (e) {
    console.warn('[verify] bank tracking count failed:', e.message);
  }

  console.log(`Tracking categories (A&R): ${catCount}`);
  console.log(`Tracking options (A&R): ${optCount}`);
  console.log(`P&L cache rows for Appoline option: ${pnlAppoline}`);
  console.log(`Invoice lines tagged Appoline: ${invTagged}`);
  console.log(`Bank txns tagged Appoline: ${bankTagged}`);

  return {
    mapping,
    months: rows,
    monthsWithAppoline,
    identicalToTenant,
    catalog: { categories: catCount, options: optCount },
    pnlAppoline,
    invTagged,
    bankTagged,
  };
}

async function main() {
  const { data: connection, error: connError } = await supabaseAdmin
    .from('platform_integrations')
    .select('id, access_token, refresh_token, token_expires_at, is_connected, last_synced_at')
    .eq('organization_id', ORG_ID)
    .eq('platform_name', 'xero')
    .eq('is_connected', true)
    .not('access_token', 'is', null)
    .limit(1)
    .maybeSingle();

  if (connError || !connection) {
    throw new Error('No connected Xero integration for St Catherine / Appoline org');
  }

  const { data: tenants } = await supabaseAdmin
    .from('platform_integration_organizations')
    .select('id, platform_org_name, status')
    .eq('organization_id', ORG_ID)
    .eq('platform_integration_id', connection.id)
    .eq('platform_name', 'xero');

  console.log(
    `[setup] org=${ORG_ID} connection=${connection.id} window=${START_DATE}→${END_DATE}`,
  );
  console.log('[setup] tenants:', (tenants || []).map((t) => `${t.platform_org_name} (${t.status})`).join('; '));

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('user_id, name')
    .eq('id', ORG_ID)
    .single();
  const userId = org?.user_id || null;
  console.log(`[setup] org name=${org?.name}`);

  const results = [];
  for (const entity of ENTITIES) {
    const done = await runEntity(connection, userId, entity);
    results.push({ entity, ...done });
    if (done?.status === 'failed') {
      console.warn(`[sync] ${entity} failed — continuing remaining entities`);
    }
  }

  const verify = await verifyCashflow(connection);
  console.log('\n[done] entity statuses:', results.map((r) => `${r.entity}:${r.status}`).join(', '));
  return { results, verify };
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
