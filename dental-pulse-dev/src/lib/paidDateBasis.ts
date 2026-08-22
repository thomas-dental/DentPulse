/**
 * "Paid on" date-basis support for the Dentally-matched treatment reports
 * (Treatment Insights and Private Treatment).
 *
 * Dentally's Practitioner Activity report has a Date dropdown: "Completed on"
 * dates every treatment row by the day it was carried out; "Paid on" dates it
 * by the day its invoice was PAID. Our synced data models this the same way:
 *   treatment_plan_items.tpi_invoice_id → platform_integration_invoices
 *   (platform_invoice_id), whose paid_date is a plain DATE stamped by Dentally
 *   (invoice.paid_on) — no timezone conversion needed, unlike tpi_completed_at.
 *
 * In paid mode a report therefore fetches the invoices paid in the window
 * first, then pulls the treatment rows belonging to those invoices — a
 * treatment completed months earlier still appears if its invoice was paid in
 * the period, exactly like Dentally's report.
 */
import { supabase } from '@/integrations/supabase/client';

export type TreatmentDateBasis = 'completed' | 'paid';

/** Plain-language explanation for the Completed on / Paid on control —
 *  shared by both pages so the wording stays identical. */
export const DATE_BASIS_HELP =
  'Choose which date the page reports by. "Completed on" shows treatments on the day they ' +
  'were carried out. "Paid on" shows the same treatments on the day their invoice was paid — ' +
  'so work done earlier appears in the period its payment landed. This matches the Date ' +
  'setting on Dentally’s Practitioner Activity report.';

const PAGE_SIZE = 1000;

export interface PaidInvoiceLookup {
  /** Dentally invoice id → paid date (YYYY-MM-DD), scoped per integration where known. */
  get(invoiceId: number | string | null | undefined, integrationId?: string | null): string | null;
  /** Unique invoice ids paid in the window (chunk these into the TPI fetch). */
  ids: string[];
}

/**
 * Fetch every Dentally invoice PAID within [fromYMD .. toYMD] (inclusive,
 * paid_date is a DATE column) and return a lookup of invoice id → paid date.
 *
 * Dentally numeric ids are only unique PER INTEGRATION (per connected
 * practice), so the lookup keys by integration_id where both sides have one;
 * rows with no integration_id fall back to an org-wide key — same guard as
 * lib/activityReportUtils.inChunks.
 *
 * THROWS on any page error: silently returning a partial map would let React
 * Query cache an under-counted result as fresh (the "hard refresh to get
 * data" bug class), so the query must fail and refetch instead.
 */
export async function fetchPaidInvoiceLookup(
  organizationId: string,
  fromYMD: string,
  toYMD: string,
): Promise<PaidInvoiceLookup> {
  type InvRow = { platform_invoice_id: string; paid_date: string | null; integration_id: string | null };
  const scoped = new Map<string, string>();   // `${integrationId}|${invoiceId}` → paid date
  const unscoped = new Map<string, string>(); // `${invoiceId}` → paid date (any integration)
  const idSet = new Set<string>();

  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await (supabase as any)
      .from('platform_integration_invoices')
      .select('platform_invoice_id, paid_date, integration_id')
      .eq('organization_id', organizationId)
      // Data contains both 'dentally' (node sync engine) and 'Dentally'
      // (earlier writers) — match case-insensitively, no wildcards.
      .ilike('platform_type', 'dentally')
      .eq('is_paid', true)
      .not('paid_date', 'is', null)
      .gte('paid_date', fromYMD)
      .lte('paid_date', toYMD)
      .is('deleted_at', null)
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) { console.error('[fetchPaidInvoiceLookup] error:', error); throw error; }
    const rows = (data ?? []) as InvRow[];
    for (const r of rows) {
      if (!r.platform_invoice_id || !r.paid_date) continue;
      const id = String(r.platform_invoice_id);
      const paid = String(r.paid_date).substring(0, 10);
      idSet.add(id);
      if (r.integration_id) scoped.set(`${r.integration_id}|${id}`, paid);
      if (!unscoped.has(id)) unscoped.set(id, paid);
    }
    hasMore = rows.length === PAGE_SIZE;
    offset += PAGE_SIZE;
  }

  return {
    get(invoiceId, integrationId) {
      if (invoiceId == null) return null;
      const id = String(invoiceId);
      if (integrationId) {
        const hit = scoped.get(`${integrationId}|${id}`);
        if (hit) return hit;
      }
      return unscoped.get(id) ?? null;
    },
    ids: [...idSet],
  };
}

/**
 * Fetch treatment_plan_items rows belonging to a set of Dentally invoice ids,
 * chunked (URL/IN-list limits) and batched at CONCURRENCY parallel requests —
 * fan-out is deliberately capped so a year-long range doesn't stampede the
 * API. THROWS on any chunk error (see fetchPaidInvoiceLookup).
 *
 * `buildChunkQuery` receives one chunk of invoice ids and must return the
 * supabase query for it (caller applies its own select + filters). Chunks are
 * paged internally in case a chunk matches more than PAGE_SIZE rows.
 */
export async function fetchTpisForInvoiceIds<T>(
  invoiceIds: string[],
  buildChunkQuery: (chunkIds: string[]) => any,
): Promise<T[]> {
  const CHUNK_SIZE = 200;
  const CONCURRENCY = 8;
  const chunks: string[][] = [];
  for (let i = 0; i < invoiceIds.length; i += CHUNK_SIZE) {
    chunks.push(invoiceIds.slice(i, i + CHUNK_SIZE));
  }

  const out: T[] = [];
  const fetchChunk = async (chunkIds: string[]) => {
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await buildChunkQuery(chunkIds).range(offset, offset + PAGE_SIZE - 1);
      if (error) { console.error('[fetchTpisForInvoiceIds] chunk error:', error); throw error; }
      const rows = (data ?? []) as T[];
      out.push(...rows);
      hasMore = rows.length === PAGE_SIZE;
      offset += PAGE_SIZE;
    }
  };

  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    await Promise.all(chunks.slice(i, i + CONCURRENCY).map(fetchChunk));
  }
  return out;
}
