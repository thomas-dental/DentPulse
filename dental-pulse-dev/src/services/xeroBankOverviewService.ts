/**
 * Bank account overview cards for Money In & Out (synced Xero data only).
 *
 * Does NOT use Finance CashValidation (requires financial partner certification).
 *
 * Sources:
 *   - Accounts: xero_chart_of_accounts (BANK / CREDITCARD)
 *   - Balance: latest xero_balance_sheet amount (shown as both statement & Xero —
 *     true statement-feed balances are not available without Finance API)
 *   - Unreconciled count: xero_bank_transactions where is_reconciled = false
 *
 * Supports All locations (all mapped practice tenants) or a single location.
 * Returns the top 6 accounts by unreconciled count.
 */

import { supabase } from '@/integrations/supabase/client';

const PAGE = 1000;
const MAX_CARDS = 6;

export interface XeroBankOverviewCard {
  accountId: string;
  accountName: string;
  accountCode: string | null;
  accountNumber: string | null;
  accountType: string | null;
  bankBalance: number | null;
  xeroBalance: number | null;
  balanceAsOf: string | null;
  unreconciledCount: number;
  reconciliationUrl: string;
}

export interface XeroBankOverviewResult {
  cards: XeroBankOverviewCard[];
  message?: string | null;
  error?: string | null;
}

function isBankAccount(accountType: string | null, bankAccountType: string | null): boolean {
  const acc = String(accountType || '').trim().toUpperCase();
  const bank = String(bankAccountType || '').trim().toUpperCase();
  return !!bank || acc === 'BANK' || acc === 'CREDITCARD';
}

function isInternalBankAccountName(name: string): boolean {
  const n = name.toLowerCase();
  return (
    /\bcorp(?:oration)?\s*tax\b/.test(n) ||
    /\bretention\b/.test(n) ||
    /\bprovision\b/.test(n) ||
    /\bsuspense\b/.test(n) ||
    /\bclearing\b/.test(n) ||
    /\bsavings\s+and\s+corp\b/.test(n)
  );
}

function buildReconciliationUrl(accountId: string): string {
  return `https://go.xero.com/Bank/BankRec.aspx?accountID=${encodeURIComponent(accountId)}`;
}

async function fetchAllPages<T>(
  queryPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE - 1;
    const { data, error } = await queryPage(from, to);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

/** Mapped practice Xero tenant PIO ids — one location or all locations. */
async function resolveTenantOrgIds(
  organizationId: string,
  locationId?: string | null,
): Promise<string[]> {
  let q = (supabase as any)
    .from('platform_integration_organization_mapping')
    .select('platform_integration_organizations_id, location_id')
    .eq('organization_id', organizationId)
    .not('location_id', 'is', null);

  if (locationId) {
    q = q.eq('location_id', locationId);
  }

  const { data, error } = await q;
  if (error) {
    console.warn('[xero-bank-overview] tenant mapping:', error.message);
    return [];
  }

  return [
    ...new Set(
      ((data ?? []) as Array<{ platform_integration_organizations_id: string | null }>)
        .map((r) => r.platform_integration_organizations_id)
        .filter(Boolean)
        .map(String),
    ),
  ];
}

export async function getXeroBankOverviewCards(
  organizationId: string,
  locationId?: string | null,
): Promise<XeroBankOverviewResult> {
  if (!organizationId) {
    return { cards: [], error: 'Missing organization' };
  }

  const tenantIds = await resolveTenantOrgIds(organizationId, locationId);
  if (tenantIds.length === 0) {
    return {
      cards: [],
      message: locationId
        ? 'No Xero organisation is mapped to this location.'
        : 'No practice locations are mapped to Xero.',
    };
  }

  let coaQuery = (supabase as any)
    .from('xero_chart_of_accounts')
    .select('xero_account_id, account_name, account_code, account_type, bank_account_type, is_active')
    .eq('organization_id', organizationId)
    .eq('is_active', true);

  if (tenantIds.length === 1) {
    coaQuery = coaQuery.eq('xero_tenant_id', tenantIds[0]);
  } else {
    coaQuery = coaQuery.in('xero_tenant_id', tenantIds);
  }

  const { data: coaRows, error: coaError } = await coaQuery;
  if (coaError) {
    console.warn('[xero-bank-overview] COA:', coaError.message);
    throw new Error(coaError.message);
  }

  const accounts = (
    (coaRows ?? []) as Array<{
      xero_account_id: string;
      account_name: string | null;
      account_code: string | null;
      account_type: string | null;
      bank_account_type: string | null;
    }>
  ).filter((r) => {
    if (!isBankAccount(r.account_type, r.bank_account_type)) return false;
    const name = r.account_name?.trim() || '';
    if (name && isInternalBankAccountName(name)) return false;
    return true;
  });

  if (accounts.length === 0) return { cards: [] };

  const accountIds = [...new Set(accounts.map((a) => a.xero_account_id).filter(Boolean))];

  const balanceByAccount = new Map<string, { amount: number; asOf: string }>();

  for (let i = 0; i < accountIds.length; i += 200) {
    const chunk = accountIds.slice(i, i + 200);
    let bsQuery = (supabase as any)
      .from('xero_balance_sheet')
      .select('xero_account_id, amount, to_date')
      .eq('organization_id', organizationId)
      .in('xero_account_id', chunk)
      .order('to_date', { ascending: false });

    if (tenantIds.length === 1) {
      bsQuery = bsQuery.eq('xero_tenant_id', tenantIds[0]);
    } else {
      bsQuery = bsQuery.in('xero_tenant_id', tenantIds);
    }

    const { data: bsRows, error: bsError } = await bsQuery;
    if (bsError) {
      console.warn('[xero-bank-overview] balance sheet:', bsError.message);
      continue;
    }

    for (const row of (bsRows ?? []) as Array<{
      xero_account_id: string;
      amount: number | string | null;
      to_date: string;
    }>) {
      const id = String(row.xero_account_id || '').trim();
      if (!id || balanceByAccount.has(id)) continue;
      balanceByAccount.set(id, {
        amount: Number(row.amount) || 0,
        asOf: row.to_date,
      });
    }
  }

  const txnCountByAccount = new Map<string, number>();
  const unreconciledByAccount = new Map<string, number>();

  try {
    const txnRows = await fetchAllPages<{
      bank_account_id: string | null;
      is_reconciled: boolean | null;
    }>(async (from, to) => {
      let q = (supabase as any)
        .from('xero_bank_transactions')
        .select('bank_account_id, is_reconciled')
        .eq('organization_id', organizationId)
        .not('bank_account_id', 'is', null)
        .range(from, to);

      if (tenantIds.length === 1) {
        q = q.eq('platform_integration_organization_id', tenantIds[0]);
      } else {
        q = q.in('platform_integration_organization_id', tenantIds);
      }

      return q;
    });

    for (const row of txnRows) {
      const id = String(row.bank_account_id || '').trim();
      if (!id) continue;
      txnCountByAccount.set(id, (txnCountByAccount.get(id) || 0) + 1);
      if (row.is_reconciled === false) {
        unreconciledByAccount.set(id, (unreconciledByAccount.get(id) || 0) + 1);
      }
    }
  } catch (err) {
    console.warn(
      '[xero-bank-overview] bank transaction activity unavailable:',
      err instanceof Error ? err.message : err,
    );
  }

  const accountCcById = new Map<string, boolean>();
  for (const acc of accounts) {
    const id = String(acc.xero_account_id || '').trim();
    if (!id) continue;
    const bank = String(acc.bank_account_type || '').trim().toUpperCase();
    const type = String(acc.account_type || '').trim().toUpperCase();
    accountCcById.set(id, bank === 'CREDITCARD' || type === 'CREDITCARD');
  }

  const seen = new Set<string>();
  const cards: XeroBankOverviewCard[] = [];

  for (const acc of accounts) {
    const accountId = String(acc.xero_account_id || '').trim();
    if (!accountId || seen.has(accountId)) continue;
    seen.add(accountId);

    const txnCount = txnCountByAccount.get(accountId) || 0;
    if (txnCount === 0) continue;

    const bal = balanceByAccount.get(accountId) ?? null;
    const unreconciledCount = unreconciledByAccount.get(accountId) || 0;
    // BS CREDITCARD amounts are sign-inverted vs journals/Excel — flip for display.
    const rawBal = bal ? bal.amount : null;
    const xeroBalance =
      rawBal == null
        ? null
        : accountCcById.get(accountId)
          ? -rawBal
          : rawBal;

    cards.push({
      accountId,
      accountName: acc.account_name?.trim() || 'Bank account',
      accountCode: acc.account_code?.trim() || null,
      accountNumber: null,
      accountType: acc.account_type || acc.bank_account_type || null,
      bankBalance: xeroBalance,
      xeroBalance,
      balanceAsOf: bal?.asOf ?? null,
      unreconciledCount,
      reconciliationUrl: buildReconciliationUrl(accountId),
    });
  }

  // Top accounts needing reconcile first, then largest cash.
  cards.sort((a, b) => {
    if (b.unreconciledCount !== a.unreconciledCount) {
      return b.unreconciledCount - a.unreconciledCount;
    }
    const absA = Math.abs(a.xeroBalance ?? 0);
    const absB = Math.abs(b.xeroBalance ?? 0);
    if (absB !== absA) return absB - absA;
    return a.accountName.localeCompare(b.accountName);
  });

  return { cards: cards.slice(0, MAX_CARDS) };
}
