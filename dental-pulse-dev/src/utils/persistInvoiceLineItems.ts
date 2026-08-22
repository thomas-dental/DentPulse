import { supabase } from '@/integrations/supabase/client';

export interface PersistLineItem {
  id?: string;
  description?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  line_total?: number | null;
  tax_amount?: number | null;
  item?: string | null;
  location?: string | null;
  platform_account_id?: string | null;
}

interface OriginalLineItem {
  id?: string;
  platform_account_id?: string | null;
}

/**
 * Persist invoice line items WITHOUT destroying data the form does not edit.
 *
 * The previous approach deleted every line item for the invoice and re-inserted
 * the form's rows. That wiped columns the form never carries —
 * `approver_id`, `approver_percentage`, `approver_amount`, `approval_status`,
 * `approved_at`, `approval_notes` — and even regenerated row ids, breaking any
 * approval already in flight. It also dropped `tax_amount` (not in the insert).
 *
 * Instead this:
 *   - UPDATEs existing rows (matched by id) touching ONLY editable columns, so
 *     approver/approval columns are left untouched,
 *   - INSERTs genuinely new rows,
 *   - DELETEs only the rows the user actually removed.
 *
 * With `preserveAccountOnEmpty` (default true) a blank / unresolved account
 * selection never overwrites an already-saved `platform_account_id` with null.
 */
export async function persistInvoiceLineItems(
  invoiceId: string,
  originalItems: OriginalLineItem[],
  currentItems: PersistLineItem[],
  opts: { preserveAccountOnEmpty?: boolean } = {},
): Promise<void> {
  const { preserveAccountOnEmpty = true } = opts;

  const originalById = new Map<string, OriginalLineItem>(
    (originalItems || []).filter((i) => i.id).map((i) => [i.id as string, i]),
  );
  const currentIds = new Set(
    (currentItems || []).filter((i) => i.id).map((i) => i.id as string),
  );

  // 1. Delete only the rows the user removed.
  const removedIds = [...originalById.keys()].filter((id) => !currentIds.has(id));
  if (removedIds.length > 0) {
    const { error } = await (supabase as any)
      .from('accounts_payable_invoice_line_item')
      .delete()
      .in('id', removedIds);
    if (error) throw error;
  }

  // 2. Update existing rows / insert new ones.
  const toInsert: any[] = [];
  for (const item of currentItems || []) {
    const editable: any = {
      description: item.description ?? null,
      quantity: item.quantity ?? null,
      unit_price: item.unit_price ?? null,
      line_total: item.line_total ?? null,
      tax_amount: item.tax_amount ?? null,
      item: item.item || null,
      location: item.location || null,
    };

    const isExisting = item.id && originalById.has(item.id);

    if (isExisting) {
      // Guard: don't let a blank/unresolved dropdown null an existing account.
      if (item.platform_account_id || !preserveAccountOnEmpty) {
        editable.platform_account_id = item.platform_account_id || null;
      }
      const { error } = await (supabase as any)
        .from('accounts_payable_invoice_line_item')
        .update(editable)
        .eq('id', item.id);
      if (error) throw error;
    } else {
      toInsert.push({
        accounts_payable_invoice_id: invoiceId,
        ...editable,
        platform_account_id: item.platform_account_id || null,
      });
    }
  }

  if (toInsert.length > 0) {
    const { error } = await (supabase as any)
      .from('accounts_payable_invoice_line_item')
      .insert(toInsert);
    if (error) throw error;
  }
}
