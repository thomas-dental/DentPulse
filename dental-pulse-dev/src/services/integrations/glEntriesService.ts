import { supabase } from '@/integrations/supabase/client';

export interface GLEntry {
  id: string;
  organization_id: string;
  connection_id: string;
  external_id: string;
  source_type: string;
  source_ref: string;
  doc_date: string;
  entry_date: string;
  account_code: string;
  account_id: string;
  account_name: string;
  debit_amount: number;
  credit_amount: number;
  net_amount: number;
  tax_amount: number;
  tax_rate: number;
  tax_type: string;
  gross_amount: number;
  narrative: string;
  description: string;
  line_description: string;
  doc_class: string;
  counterparty_name: string;
  counterparty_ref: string;
  currency_code: string;
  line_number: number;
  synced_at: string;
}

export interface FetchGLEntriesResult {
  success: boolean;
  entries: GLEntry[];
  totalAmount: number;
  lastSyncedAt: string | null;
  error?: string;
}

/**
 * Fetch GL entries from iplicit_gl_entries table, filtered by org, date range,
 * and expense account settings (3-way matching: account_code, account_id, account_name).
 */
export async function fetchGLEntries(
  organizationId: string,
  options: {
    fromDate?: string;
    toDate?: string;
    accountCodes?: string[];
    accountUuids?: string[];
  } = {}
): Promise<FetchGLEntriesResult> {
  const { fromDate, toDate, accountCodes = [], accountUuids = [] } = options;

  try {
    // Step 1: Resolve accountUuids to account_code / account_id / account_name from CoA
    let resolvedCodes: string[] = [...accountCodes];
    let resolvedIds: string[] = [];
    let resolvedNames: string[] = [];

    if (accountUuids.length > 0) {
      // Try iplicit_chart_of_accounts first (Iplicit platform)
      const { data: iplicitRows, error: iplicitErr } = await (supabase as any)
        .from('iplicit_chart_of_accounts')
        .select('id, code, account_id, name')
        .eq('organization_id', organizationId)
        .in('id', accountUuids);

      if (!iplicitErr && iplicitRows && iplicitRows.length > 0) {
        iplicitRows.forEach((row: any) => {
          if (row.code) resolvedCodes.push(row.code.toString().trim());
          if (row.account_id) resolvedIds.push(row.account_id.toString().trim());
          if (row.name) resolvedNames.push(row.name.toString().trim());
        });
      } else {
        // Fallback to platform_integration_chart_of_accounts (Xero/QB)
        const { data: coaRows, error: coaError } = await (supabase as any)
          .from('platform_integration_chart_of_accounts')
          .select('id, coa_account_code, coa_account_id, coa_account_name')
          .eq('organization_id', organizationId)
          .in('id', accountUuids);

        if (coaError) {
          console.error('[fetchGLEntries] CoA lookup error:', coaError);
        }

        if (coaRows && coaRows.length > 0) {
          coaRows.forEach((row: any) => {
            if (row.coa_account_code) resolvedCodes.push(row.coa_account_code.toString().trim());
            if (row.coa_account_id) resolvedIds.push(row.coa_account_id.toString().trim());
            if (row.coa_account_name) resolvedNames.push(row.coa_account_name.toString().trim());
          });
        }
      }
    }

    // Deduplicate
    resolvedCodes = [...new Set(resolvedCodes)];
    resolvedIds = [...new Set(resolvedIds)];
    resolvedNames = [...new Set(resolvedNames)];

    const hasAccountFilter = resolvedCodes.length > 0 || resolvedIds.length > 0 || resolvedNames.length > 0;
    console.log('[fetchGLEntries] Resolved filters:', { resolvedCodes, resolvedIds, resolvedNames, hasAccountFilter });

    // Step 2: Query iplicit_gl_entries with org + date filters only (no account filter at DB level)
    // Account filtering done client-side with 3-way matching to avoid mismatches
    let query = (supabase as any)
      .from('iplicit_gl_entries')
      .select('*')
      .eq('organization_id', organizationId);

    if (fromDate) query = query.gte('doc_date', fromDate);
    if (toDate) query = query.lte('doc_date', toDate);

    const { data: entries, error } = await query.order('doc_date', { ascending: false });

    if (error) {
      console.error('[fetchGLEntries] Query error:', error);
      return { success: false, entries: [], totalAmount: 0, lastSyncedAt: null, error: error.message };
    }

    console.log('[fetchGLEntries] Raw entries from DB:', entries?.length || 0);

    if (!entries || entries.length === 0) {
      console.log('[fetchGLEntries] No entries found for org:', organizationId, 'dateRange:', fromDate, '-', toDate);
      return { success: true, entries: [], totalAmount: 0, lastSyncedAt: null };
    }

    // Log unique account values in the table for debugging
    const uniqueCodes = [...new Set(entries.map((e: any) => e.account_code).filter(Boolean))];
    const uniqueIds = [...new Set(entries.map((e: any) => e.account_id).filter(Boolean))];
    const uniqueNames = [...new Set(entries.map((e: any) => e.account_name).filter(Boolean))];
    console.log('[fetchGLEntries] Unique account_codes in DB:', uniqueCodes.slice(0, 20));
    console.log('[fetchGLEntries] Unique account_ids in DB:', uniqueIds.slice(0, 20));
    console.log('[fetchGLEntries] Unique account_names in DB:', uniqueNames.slice(0, 20));

    // Step 3: Client-side 3-way account filter (account_code OR account_id OR account_name)
    let filteredEntries = entries as GLEntry[];

    if (hasAccountFilter) {
      filteredEntries = entries.filter((entry: GLEntry) => {
        const entryCode = (entry.account_code || '').toString().trim();
        const entryId = (entry.account_id || '').toString().trim();
        const entryName = (entry.account_name || '').toString().trim();

        const matchesCode = resolvedCodes.some(code => code === entryCode);
        const matchesId = resolvedIds.some(id => id === entryId);
        const matchesName = resolvedNames.some(name => name === entryName);

        return matchesCode || matchesId || matchesName;
      });

      console.log('[fetchGLEntries] After 3-way account filter:', filteredEntries.length, 'of', entries.length, 'entries matched');
    }

    // Step 4: Calculate total (gross = net + tax) and find last synced
    const totalAmount = filteredEntries.reduce((sum, entry) => sum + (entry.gross_amount || ((entry.net_amount || 0) + (entry.tax_amount || 0))), 0);

    const lastSyncedAt = filteredEntries.length > 0
      ? filteredEntries.reduce((latest, entry) => {
          const syncDate = entry.synced_at || '';
          return syncDate > latest ? syncDate : latest;
        }, '')
      : null;

    console.log('[fetchGLEntries] Found', filteredEntries.length, 'entries, total:', totalAmount);

    return {
      success: true,
      entries: filteredEntries,
      totalAmount,
      lastSyncedAt: lastSyncedAt || null,
    };
  } catch (err: any) {
    console.error('[fetchGLEntries] Exception:', err);
    return { success: false, entries: [], totalAmount: 0, lastSyncedAt: null, error: err.message };
  }
}
