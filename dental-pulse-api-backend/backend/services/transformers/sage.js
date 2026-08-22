/**
 * Entity transformation functions for Sage Business Cloud Accounting.
 * Converts raw Sage API responses into our database schema.
 *
 * Mirrors transformers/iplicit.js and transformers/dentally.js — single
 * `transformRecord(entityAlias, record, ctx)` dispatcher.
 *
 * Context object (ctx):
 *   organizationId         — our org UUID
 *   userId                 — the user who triggered sync (nullable)
 *   platformIntegrationId  — platform_integrations.id
 */

const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

function transformRecord(entityAlias, record, ctx) {
  let result;
  switch (entityAlias) {
    case 'sage_suppliers':
      result = transformSupplier(record, ctx); break;
    case 'sage_chart_of_accounts':
      result = transformChartOfAccount(record, ctx); break;
    case 'sage_invoices':
      result = transformPurchaseInvoice(record, ctx); break;
    case 'sage_bank_accounts':
      result = transformBankAccount(record, ctx); break;
    case 'sage_bank_transactions':
      result = transformBankTransaction(record, ctx); break;
    case 'sage_tax_rates':
      result = transformTaxRate(record, ctx); break;
    case 'sage_credit_notes':
      result = transformPurchaseCreditNote(record, ctx); break;
    case 'sage_journals':
      result = transformJournal(record, ctx); break;
    case 'sage_payment_methods':
      result = transformPaymentMethod(record, ctx); break;
    case 'sage_products':
      result = transformProduct(record, ctx); break;
    case 'sage_other_payments':
      result = transformOtherPayment(record, ctx); break;
    case 'sage_other_receipts':
      result = transformOtherReceipt(record, ctx); break;
    case 'sage_bank_transfers':
      result = transformBankTransfer(record, ctx); break;
    case 'sage_attachments':
      result = transformAttachment(record, ctx); break;
    default:
      console.warn(`[SageTransformer] No transformation defined for entity: ${entityAlias}`);
      return null;
  }

  // Multi-business: stamp the Sage business this row belongs to so the frontend
  // can scope a location's data to its mapped business. Injected centrally so
  // every entity (header rows + {header} of header/lines pairs) gets it.
  if (result && ctx && ctx.businessId) {
    if (result.header) {
      result.header.sage_business_id = ctx.businessId;
    } else {
      result.sage_business_id = ctx.businessId;
    }
  }

  return result;
}

/**
 * Transform a Sage `/bank_accounts` record into a `sage_bank_accounts` row.
 */
function transformBankAccount(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;

  if (!record || !record.id) {
    console.warn('[SageTransformer] Bank account record missing id, skipping');
    return null;
  }

  return {
    organization_id:         organizationId,
    platform_integration_id: platformIntegrationId,
    user_id:                 userId || null,

    sage_bank_account_id: record.id,
    displayed_as:         record.displayed_as || record.account_name || 'Unnamed Bank Account',

    account_name:   record.account_name   || null,
    account_number: record.account_number || null,
    sort_code:      record.sort_code      || null,
    iban:           record.iban           || null,
    bic_swift:      record.bic_swift      || null,
    bank_name:      record.bank_name      || null,

    bank_account_type_id:    record.bank_account_type?.id          || null,
    bank_account_type_label: record.bank_account_type?.displayed_as || null,
    ledger_account_id:       record.ledger_account?.id             || null,

    opening_balance: parseAmount(record.opening_balance),
    current_balance: parseAmount(record.current_balance),

    currency_id: record.currency?.id || null,

    is_default: Boolean(record.is_default),
    is_visible: record.is_visible !== false,
    is_active:  record.deleted !== true,

    active_bank_feed:        Boolean(record.active_bank_feed),
    bank_feed_imported_from: record.bank_feed_imported_from || null,

    raw_data: record,

    source_created_at: record.created_at || null,
    source_updated_at: record.updated_at || null,
    last_synced_at:    new Date().toISOString(),
  };
}

/**
 * Transform a Sage `/bank_transactions` record into a `sage_bank_transactions` row.
 */
function transformBankTransaction(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;

  if (!record || !record.id) {
    console.warn('[SageTransformer] Bank transaction record missing id, skipping');
    return null;
  }

  return {
    organization_id:         organizationId,
    platform_integration_id: platformIntegrationId,
    user_id:                 userId || null,

    sage_bank_transaction_id: record.id,
    displayed_as:             record.displayed_as || null,

    bank_account_id:   record.bank_account?.id          || null,
    bank_account_name: record.bank_account?.displayed_as || null,

    transaction_type_id:    record.transaction_type?.id          || null,
    transaction_type_label: record.transaction_type?.displayed_as || null,
    transaction_date:       record.date || null,

    contact_id:   record.contact?.id          || null,
    contact_name: record.contact?.displayed_as || null,

    reference:   record.reference   || null,
    description: record.description || null,

    total_amount: parseAmount(record.total_amount),
    net_amount:   parseAmount(record.net_amount),
    tax_amount:   parseAmount(record.tax_amount),

    status_id:    record.status?.id          || null,
    status_label: record.status?.displayed_as || null,
    currency_id:  record.currency?.id || null,
    exchange_rate: parseAmount(record.exchange_rate),

    is_reconciled: Boolean(record.is_reconciled),

    raw_data: record,

    source_created_at: record.created_at || null,
    source_updated_at: record.updated_at || null,
    last_synced_at:    new Date().toISOString(),
  };
}

/**
 * Map Sage purchase invoice status → our canonical status string.
 */
function mapSageInvoiceStatus(sageStatusId) {
  switch ((sageStatusId || '').toUpperCase()) {
    case 'PAID':              return 'paid';
    case 'UNPAID':            return 'unpaid';
    case 'PART_PAID':
    case 'PARTLY_PAID':
    case 'PARTIAL':           return 'partial';
    case 'VOIDED':
    case 'VOID':              return 'voided';
    case 'OVERDUE':           return 'overdue';
    case 'DRAFT':             return 'draft';
    default:                  return (sageStatusId || 'unknown').toLowerCase();
  }
}

/** Parse Sage's numeric strings (e.g. "350.0") to number, null on missing. */
function parseAmount(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract account_code from Sage ledger_account.displayed_as.
 * Examples:
 *   "Cost of Sales - Goods (5000)"        → "5000"
 *   "Office equipment and IT - Cost (0030)" → "0030"
 *
 * Falls back to null if no trailing code in parentheses.
 */
function extractCodeFromDisplayedAs(displayedAs) {
  if (!displayedAs || typeof displayedAs !== 'string') return null;
  const m = displayedAs.match(/\((\d{3,5})\)\s*$/);
  return m ? m[1] : null;
}

/**
 * Transform a Sage `/purchase_invoices` record into a header for
 * `sage_invoices` AND its line items for `sage_invoice_line_items`.
 *
 * Returns `{ header, lines }` so the service can upsert the header first
 * (to obtain its UUID) and then insert the lines with that FK.
 *
 * @param {object} record — raw Sage purchase invoice (with `attributes=all`)
 * @param {object} ctx
 * @returns {{ header: object, lines: object[] }|null}
 */
function transformPurchaseInvoice(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;

  if (!record || !record.id) {
    console.warn('[SageTransformer] Purchase invoice missing id, skipping');
    return null;
  }

  const sageStatusId = record.status?.id || null;
  const status       = mapSageInvoiceStatus(sageStatusId);
  const isPaid       = status === 'paid';
  const invoiceUrl   = record.links?.find?.(l => l.rel === 'alternate')?.href || null;

  const header = {
    organization_id:         organizationId,
    platform_integration_id: platformIntegrationId,
    location_id:             ctx.locationId || null, // practice this Sage business maps to
    user_id:                 userId || null,

    sage_invoice_id: record.id,

    invoice_number: record.vendor_reference || record.reference || null,
    invoice_type:   'ACCPAY',  // Purchase invoice (accounts payable)
    reference:      record.reference || null,

    invoice_date: record.date     || null,
    due_date:     record.due_date || null,
    paid_date:    isPaid ? (record.updated_at ? record.updated_at.split('T')[0] : null) : null,

    status:  status,
    is_paid: isPaid,

    currency:      record.currency?.id     || 'GBP',
    currency_rate: parseAmount(record.exchange_rate) ?? 1.0,

    subtotal:           parseAmount(record.net_amount),
    tax_amount:         parseAmount(record.tax_amount),
    total_amount:       parseAmount(record.total_amount),
    amount_paid:        parseAmount(record.total_paid),
    amount_due:         parseAmount(record.outstanding_amount),
    amount_outstanding: parseAmount(record.outstanding_amount),

    contact_id:    record.contact?.id   || null,
    contact_name:  record.contact_name  || record.contact?.displayed_as || null,
    contact_email: null,

    private_note: record.notes || null,
    tax_type:     null,
    invoice_url:  invoiceUrl,

    raw_data:      record,

    sync_status:    'synced',
    last_synced_at: new Date().toISOString(),
  };

  const rawLines = Array.isArray(record.invoice_lines) ? record.invoice_lines : [];
  const lines = rawLines.map((line, idx) => ({
    organization_id: organizationId,
    // invoice_id assigned by service AFTER header upsert.
    sage_line_item_id: line.id || null,
    line_number:       idx + 1,

    description: line.description || line.displayed_as || null,
    item_code:   null,
    item_name:   line.product?.displayed_as || line.service?.displayed_as || null,

    quantity:    parseAmount(line.quantity),
    unit_amount: parseAmount(line.unit_price),

    line_amount:     parseAmount(line.net_amount),
    tax_amount:      parseAmount(line.tax_amount),
    discount_amount: null,
    discount_rate:   null,

    tax_type: line.tax_rate?.id || null,
    tax_rate: null,  // Sage doesn't directly expose % — could derive from tax_rate.displayed_as

    account_id:   line.ledger_account?.id            || null,
    account_code: extractCodeFromDisplayedAs(line.ledger_account?.displayed_as),
    account_name: line.ledger_account?.displayed_as  || null,
  }));

  return { header, lines };
}

/**
 * Transform a Sage `/ledger_accounts` record into a `sage_chart_of_accounts` row.
 *
 * Sage ledger_accounts are organized as:
 *   ledger_account_group   → high-level (ASSET/LIABILITY/INCOME/EXPENSE/EQUITY)
 *   ledger_account_type    → detailed   (FIXED_ASSETS / CURRENT_ASSETS / DIRECT_COSTS / SALES / etc.)
 *
 * @param {object} record — raw Sage ledger account (with `attributes=all`)
 * @param {object} ctx    — { organizationId, userId, platformIntegrationId }
 * @returns {object|null}
 */
function transformChartOfAccount(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;

  if (!record || !record.id) {
    console.warn('[SageTransformer] COA record missing id, skipping');
    return null;
  }

  // Pad nominal_code to 4 digits (Sage convention shown in display_formatted)
  let coaCode = null;
  if (record.nominal_code !== null && record.nominal_code !== undefined) {
    coaCode = String(record.nominal_code).padStart(4, '0');
  }

  // ledger_account_type is required by the DB column (NOT NULL).
  // Fall back to group id, then 'UNKNOWN' if both are missing — should never happen.
  const accountType = record.ledger_account_type?.id
    || record.ledger_account_group?.id
    || 'UNKNOWN';

  // Bank account type — only populate when this is a bank-attached account
  let bankAccountType = null;
  if (record.bank_attached === true) {
    bankAccountType = record.ledger_account_type?.id || 'BANK';
  }

  return {
    organization_id:         organizationId,
    platform_integration_id: platformIntegrationId,
    user_id:                 userId || null,

    sage_account_id:   record.id,
    account_code:      coaCode,
    account_name:      record.name || record.display_name || record.displayed_as || 'Unnamed Account',
    account_type:      accountType,
    account_sub_type:  record.ledger_account_classification?.id
                         || record.ledger_account_classification
                         || null,
    classification:    record.ledger_account_group?.id || null,
    description:       record.display_name || null,
    tax_type:          record.tax_rate?.displayed_as || record.tax_rate?.id || null,
    bank_account_type: bankAccountType,
    reporting_code:    coaCode,
    reporting_name:    record.displayed_as || record.display_formatted || null,
    is_active:         (record.ui_visible !== false) && (record.included_in_chart !== false),

    raw_data: record,

    source_created_at: record.created_at || null,
    source_updated_at: record.updated_at || null,
    last_synced_at:    new Date().toISOString(),
  };
}

/**
 * Transform a Sage `/contacts` record into a `sage_suppliers` row.
 *
 * Only contacts with contact_types containing VENDOR are considered suppliers.
 * Customers (CONTACT_TYPE=CUSTOMER) are NOT stored in sage_suppliers — callers
 * should filter the contact list before invoking this transformer if they only
 * want suppliers.
 *
 * @param {object} record — raw Sage contact (with `attributes=all`)
 * @param {object} ctx
 * @returns {object|null} sage_suppliers row, or null if record is invalid
 */
function transformSupplier(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;

  if (!record || !record.id) {
    console.warn('[SageTransformer] Supplier record missing id, skipping');
    return null;
  }

  const contactTypeIds = (record.contact_types || []).map(t => t?.id).filter(Boolean);
  const contactTypesCsv = contactTypeIds.join(',');
  const isVendor   = contactTypeIds.includes('VENDOR');
  const isCustomer = contactTypeIds.includes('CUSTOMER');

  const address = parseAddressDisplayedAs(record.main_address?.displayed_as);

  return {
    organization_id:         organizationId,
    platform_integration_id: platformIntegrationId,
    user_id:                 userId || null,

    sage_contact_id: record.id,
    reference:       record.reference || null,
    displayed_as:    record.displayed_as || record.name || 'Unknown Supplier',

    name:         record.name || null,
    contact_name: record.main_contact_person?.displayed_as || null,

    email:     record.email || null,
    telephone: null,            // Only available via /contact_persons follow-up call
    mobile:    null,
    fax:       null,
    website:   null,

    address_line_1: address.line1,
    address_line_2: address.line2,
    city:           address.city,
    region:         address.region,
    postal_code:    address.postcode,
    country_id:     address.country || (record.gb_based ? 'GB' : null),

    contact_types: contactTypesCsv || null,
    is_vendor:     isVendor,
    is_customer:   isCustomer,
    is_active:     record.is_active !== false,

    tax_number:      record.tax_number || null,
    tax_calculation: record.tax_calculation || null,

    default_sales_ledger_account_id:    record.default_sales_ledger_account?.id    || null,
    default_purchase_ledger_account_id: record.default_purchase_ledger_account?.id || null,
    credit_limit:                       record.credit_limit ?? null,
    credit_days:                        record.credit_days  ?? null,
    currency_id:                        record.currency?.id || null,

    notes: record.notes || null,

    raw_data: record,

    source_created_at: record.created_at || null,
    source_updated_at: record.updated_at || null,
    last_synced_at:    new Date().toISOString(),
  };
}

/**
 * Best-effort parse of Sage's `main_address.displayed_as` newline-joined string.
 * Sage returns the address pre-formatted like:
 *    "12 Lab Street\nLondon\nUnited Kingdom\nEC1A 1BB"
 *
 * We extract the postcode (last line matching UK regex), country (penultimate
 * line if known), and treat the rest as line1/line2/city.
 *
 * Full structured address is in `record.main_address` reference — fetching the
 * referenced /addresses/{id} would give exact fields, but that's an extra API
 * call per supplier. raw_data preserves the original for later re-processing.
 */
function parseAddressDisplayedAs(displayedAs) {
  if (!displayedAs || typeof displayedAs !== 'string') {
    return { line1: null, line2: null, city: null, region: null, postcode: null, country: null };
  }

  const lines = displayedAs.split('\n').map(l => l.trim()).filter(Boolean);

  let postcode = null;
  let country  = null;
  let city     = null;
  let line1    = null;
  let line2    = null;

  if (lines.length === 0) {
    return { line1: null, line2: null, city: null, region: null, postcode: null, country: null };
  }

  // Detect postcode (last line matching UK pattern)
  if (UK_POSTCODE_RE.test(lines[lines.length - 1])) {
    postcode = lines.pop();
  }

  // Detect country (last remaining line if it looks like a country name)
  const KNOWN_COUNTRIES = ['United Kingdom', 'UK', 'England', 'Scotland', 'Wales', 'Northern Ireland', 'Ireland'];
  if (lines.length > 0 && KNOWN_COUNTRIES.includes(lines[lines.length - 1])) {
    country = lines.pop() === 'United Kingdom' ? 'GB' : null;
  }

  // Remaining lines: first = line1, second = city (UK common form), or line2 if 3
  line1 = lines[0] || null;
  if (lines.length === 2) {
    city = lines[1];
  } else if (lines.length === 3) {
    line2 = lines[1];
    city  = lines[2];
  } else if (lines.length > 3) {
    line2 = lines.slice(1, -1).join(', ');
    city  = lines[lines.length - 1];
  }

  return { line1, line2, city, region: null, postcode, country };
}

/**
 * Transform a Sage `/tax_rates` record into a `sage_tax_rates` row.
 *
 * Sage exposes tax rates as a small lookup set (typically UK VAT: 20%/5%/0%/exempt).
 * Schema returned by attributes=all:
 *   { id, displayed_as, name, percentage (string), agency, tax_code,
 *     is_visible, is_default, effective_date, ... }
 */
function transformTaxRate(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;

  if (!record || !record.id) {
    console.warn('[SageTransformer] Tax rate record missing id, skipping');
    return null;
  }

  return {
    organization_id:         organizationId,
    platform_integration_id: platformIntegrationId,
    user_id:                 userId || null,

    sage_tax_rate_id: record.id,
    displayed_as:     record.displayed_as || null,
    name:             record.name || null,
    percentage:       parseAmount(record.percentage),
    agency:           record.agency?.displayed_as || record.agency || null,
    tax_code:         record.tax_code || record.code || null,
    is_visible:       record.is_visible !== false,
    is_default:       Boolean(record.is_default),
    effective_date:   record.effective_date || null,

    raw_data: record,

    source_created_at: record.created_at || null,
    source_updated_at: record.updated_at || null,
    last_synced_at:    new Date().toISOString(),
  };
}

/**
 * Map Sage credit note status → our canonical status string.
 * Sage credit note statuses: DRAFT / UNALLOCATED / PART_ALLOCATED / FULLY_ALLOCATED / VOIDED
 */
function mapSageCreditNoteStatus(sageStatusId) {
  switch ((sageStatusId || '').toUpperCase()) {
    case 'DRAFT':            return 'draft';
    case 'UNALLOCATED':      return 'unallocated';
    case 'PART_ALLOCATED':
    case 'PARTLY_ALLOCATED': return 'part_allocated';
    case 'FULLY_ALLOCATED':
    case 'ALLOCATED':        return 'fully_allocated';
    case 'VOIDED':
    case 'VOID':             return 'voided';
    default:                 return (sageStatusId || 'unknown').toLowerCase();
  }
}

/**
 * Transform a Sage `/purchase_credit_notes` record into a header for
 * `sage_credit_notes` AND its line items for `sage_credit_note_line_items`.
 *
 * Returns `{ header, lines }` — same shape as transformPurchaseInvoice.
 */
function transformPurchaseCreditNote(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;

  if (!record || !record.id) {
    console.warn('[SageTransformer] Purchase credit note missing id, skipping');
    return null;
  }

  const sageStatusId = record.status?.id || null;
  const status       = mapSageCreditNoteStatus(sageStatusId);
  const creditNoteUrl = record.links?.find?.(l => l.rel === 'alternate')?.href || null;

  const header = {
    organization_id:         organizationId,
    platform_integration_id: platformIntegrationId,
    user_id:                 userId || null,

    sage_credit_note_id: record.id,

    credit_note_number: record.vendor_reference || record.reference || null,
    credit_note_type:   'ACCPAYCREDIT',
    reference:          record.reference || null,

    credit_note_date: record.date || null,

    status: status,

    currency:      record.currency?.id || 'GBP',
    currency_rate: parseAmount(record.exchange_rate) ?? 1.0,

    subtotal:           parseAmount(record.net_amount),
    tax_amount:         parseAmount(record.tax_amount),
    total_amount:       parseAmount(record.total_amount),
    total_allocated:    parseAmount(record.total_allocated),
    outstanding_amount: parseAmount(record.outstanding_amount),

    contact_id:    record.contact?.id  || null,
    contact_name:  record.contact_name || record.contact?.displayed_as || null,
    contact_email: null,

    private_note:    record.notes || null,
    void_reason:     record.void_reason || null,
    credit_note_url: creditNoteUrl,

    raw_data: record,

    sync_status:    'synced',
    last_synced_at: new Date().toISOString(),
  };

  // Sage uses credit_note_lines[] (or invoice_lines[] in some response shapes)
  const rawLines = Array.isArray(record.credit_note_lines) ? record.credit_note_lines
                  : Array.isArray(record.invoice_lines)    ? record.invoice_lines
                  : [];
  const lines = rawLines.map((line, idx) => ({
    organization_id: organizationId,
    // credit_note_id assigned by service AFTER header upsert.
    sage_line_item_id: line.id || null,
    line_number:       idx + 1,

    description: line.description || line.displayed_as || null,
    item_code:   null,
    item_name:   line.product?.displayed_as || line.service?.displayed_as || null,

    quantity:    parseAmount(line.quantity),
    unit_amount: parseAmount(line.unit_price),

    line_amount:     parseAmount(line.net_amount),
    tax_amount:      parseAmount(line.tax_amount),
    discount_amount: null,
    discount_rate:   null,

    tax_type: line.tax_rate?.id || null,
    tax_rate: null,

    account_id:   line.ledger_account?.id           || null,
    account_code: extractCodeFromDisplayedAs(line.ledger_account?.displayed_as),
    account_name: line.ledger_account?.displayed_as || null,
  }));

  return { header, lines };
}

/**
 * Map Sage journal status → our canonical status string.
 */
function mapSageJournalStatus(sageStatusId) {
  switch ((sageStatusId || '').toUpperCase()) {
    case 'POSTED':   return 'posted';
    case 'DRAFT':    return 'draft';
    case 'REVERSED': return 'reversed';
    default:         return (sageStatusId || 'posted').toLowerCase();
  }
}

/**
 * Transform a Sage `/journals` record into a header for `sage_journals`
 * AND its DR/CR lines for `sage_journal_lines`.
 *
 * Returns `{ header, lines }`.
 *
 * Sage journal_lines have either `debit` or `credit` populated (the other is 0/null)
 * and reference a ledger_account.
 */
function transformJournal(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;

  if (!record || !record.id) {
    console.warn('[SageTransformer] Journal record missing id, skipping');
    return null;
  }

  const status = mapSageJournalStatus(record.status?.id || (record.is_reverse_journal ? 'reversed' : 'posted'));

  // Pre-compute totals from lines if Sage didn't provide them at header level
  const rawLines = Array.isArray(record.journal_lines) ? record.journal_lines : [];
  let computedDebits  = 0;
  let computedCredits = 0;
  for (const line of rawLines) {
    computedDebits  += (parseAmount(line.debit)  ?? 0);
    computedCredits += (parseAmount(line.credit) ?? 0);
  }

  const header = {
    organization_id:         organizationId,
    platform_integration_id: platformIntegrationId,
    user_id:                 userId || null,

    sage_journal_id: record.id,

    reference:    record.reference || null,
    narrative:    record.description || record.narrative || null,
    journal_date: record.date || null,

    status: status,

    total_debits:  parseAmount(record.total_debits)  ?? Math.round(computedDebits  * 100) / 100,
    total_credits: parseAmount(record.total_credits) ?? Math.round(computedCredits * 100) / 100,

    is_reverse_journal:  Boolean(record.is_reverse_journal),
    reversal_journal_id: record.original_journal?.id || record.reversal_journal?.id || null,

    currency:      record.currency?.id || 'GBP',
    currency_rate: parseAmount(record.exchange_rate) ?? 1.0,

    raw_data: record,

    source_created_at: record.created_at || null,
    source_updated_at: record.updated_at || null,
    last_synced_at:    new Date().toISOString(),
  };

  const lines = rawLines.map((line, idx) => ({
    organization_id: organizationId,
    // journal_id assigned by service AFTER header upsert.
    sage_journal_line_id: line.id || null,
    line_number:          idx + 1,

    ledger_account_id:   line.ledger_account?.id           || null,
    ledger_account_name: line.ledger_account?.displayed_as || null,
    account_code:        extractCodeFromDisplayedAs(line.ledger_account?.displayed_as),

    debit:  parseAmount(line.debit)  ?? 0,
    credit: parseAmount(line.credit) ?? 0,

    description: line.description || null,
    details:     line.details     || null,

    raw_data: line,
  }));

  return { header, lines };
}

// ─────────────────────────────────────────────────────────────
// Wave 2 transformers (added 2026-05-28)
// ─────────────────────────────────────────────────────────────

/**
 * Transform a Sage `/payment_methods` record into `sage_payment_methods` row.
 */
function transformPaymentMethod(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;
  if (!record || !record.id) {
    console.warn('[SageTransformer] Payment method missing id, skipping');
    return null;
  }
  return {
    organization_id:         organizationId,
    platform_integration_id: platformIntegrationId,
    user_id:                 userId || null,

    sage_payment_method_id: record.id,
    displayed_as:           record.displayed_as || null,
    name:                   record.name || record.displayed_as || null,
    payment_method_type:    record.type?.id || record.payment_method_type?.id || null,
    is_visible:             record.is_visible !== false,

    raw_data: record,

    source_created_at: record.created_at || null,
    source_updated_at: record.updated_at || null,
    last_synced_at:    new Date().toISOString(),
  };
}

/**
 * Transform a Sage `/products` or `/services` record into `sage_products` row.
 * The caller passes `_productType: 'product' | 'service'` on the record OR via ctx.
 */
function transformProduct(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;
  if (!record || !record.id) {
    console.warn('[SageTransformer] Product/service missing id, skipping');
    return null;
  }

  const productType = record._productType || ctx.productType || 'product';

  return {
    organization_id:         organizationId,
    platform_integration_id: platformIntegrationId,
    user_id:                 userId || null,

    sage_product_id: record.id,
    displayed_as:    record.displayed_as || record.description || null,
    item_code:       record.item_code || record.code || null,
    description:     record.description || null,
    notes:           record.notes || null,

    product_type: productType,

    sales_price:    parseAmount(record.sales_prices?.[0]?.price)    ?? parseAmount(record.sales_price),
    purchase_price: parseAmount(record.purchase_prices?.[0]?.price) ?? parseAmount(record.purchase_price),
    cost_price:     parseAmount(record.cost_price),

    sales_ledger_account_id:      record.sales_ledger_account?.id           || null,
    sales_ledger_account_name:    record.sales_ledger_account?.displayed_as || null,
    purchase_ledger_account_id:   record.purchase_ledger_account?.id           || null,
    purchase_ledger_account_name: record.purchase_ledger_account?.displayed_as || null,

    sales_tax_rate_id:    record.sales_tax_rate?.id    || null,
    purchase_tax_rate_id: record.purchase_tax_rate?.id || null,

    is_sold:      record.is_sold !== false,
    is_purchased: record.is_purchased !== false,
    is_visible:   record.is_visible !== false,
    is_active:    record.deleted !== true,

    raw_data: record,

    source_created_at: record.created_at || null,
    source_updated_at: record.updated_at || null,
    last_synced_at:    new Date().toISOString(),
  };
}

/**
 * Shared helper for /other_payments and /other_receipts — both have the same
 * schema (bank-side movement not tied to a contact).
 */
function transformBankSideMovement(record, ctx, idField) {
  const { organizationId, userId, platformIntegrationId } = ctx;
  if (!record || !record.id) return null;

  // /other_payments and /other_receipts may have line-items under different keys.
  // We collapse to header-level totals for now and preserve raw_data.
  const firstLine = Array.isArray(record.payment_lines)
    ? record.payment_lines[0]
    : Array.isArray(record.receipt_lines)
      ? record.receipt_lines[0]
      : null;

  return {
    organization_id:         organizationId,
    platform_integration_id: platformIntegrationId,
    user_id:                 userId || null,

    [idField]:    record.id,
    displayed_as: record.displayed_as || null,

    bank_account_id:   record.bank_account?.id          || null,
    bank_account_name: record.bank_account?.displayed_as || null,

    transaction_type_id:    record.transaction_type?.id          || null,
    transaction_type_label: record.transaction_type?.displayed_as || null,
    transaction_date:       record.date || null,

    reference:   record.reference   || null,
    description: record.description || record.notes || null,

    total_amount: parseAmount(record.total_amount),
    net_amount:   parseAmount(record.net_amount) ?? parseAmount(firstLine?.net_amount),
    tax_amount:   parseAmount(record.tax_amount) ?? parseAmount(firstLine?.tax_amount),

    tax_rate_id:    firstLine?.tax_rate?.id          || null,
    tax_rate_label: firstLine?.tax_rate?.displayed_as || null,

    ledger_account_id:   firstLine?.ledger_account?.id          || null,
    ledger_account_name: firstLine?.ledger_account?.displayed_as || null,

    currency_id:   record.currency?.id || null,
    exchange_rate: parseAmount(record.exchange_rate),

    payment_method_id: record.payment_method?.id || null,

    raw_data: record,

    source_created_at: record.created_at || null,
    source_updated_at: record.updated_at || null,
    last_synced_at:    new Date().toISOString(),
  };
}

function transformOtherPayment(record, ctx) {
  return transformBankSideMovement(record, ctx, 'sage_other_payment_id');
}

function transformOtherReceipt(record, ctx) {
  return transformBankSideMovement(record, ctx, 'sage_other_receipt_id');
}

/**
 * Transform a Sage `/bank_transfers` record into `sage_bank_transfers` row.
 */
function transformBankTransfer(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;
  if (!record || !record.id) {
    console.warn('[SageTransformer] Bank transfer missing id, skipping');
    return null;
  }

  return {
    organization_id:         organizationId,
    platform_integration_id: platformIntegrationId,
    user_id:                 userId || null,

    sage_bank_transfer_id: record.id,
    displayed_as:          record.displayed_as || null,

    from_bank_account_id:   record.from_bank_account?.id          || record.source_bank_account?.id          || null,
    from_bank_account_name: record.from_bank_account?.displayed_as || record.source_bank_account?.displayed_as || null,
    to_bank_account_id:     record.to_bank_account?.id            || record.target_bank_account?.id          || null,
    to_bank_account_name:   record.to_bank_account?.displayed_as   || record.target_bank_account?.displayed_as || null,

    transfer_date: record.date || null,
    reference:     record.reference || null,
    description:   record.description || record.notes || null,

    amount:        parseAmount(record.amount) ?? parseAmount(record.total_amount),
    exchange_rate: parseAmount(record.exchange_rate),
    currency_id:   record.currency?.id || null,

    raw_data: record,

    source_created_at: record.created_at || null,
    source_updated_at: record.updated_at || null,
    last_synced_at:    new Date().toISOString(),
  };
}

/**
 * Transform a Sage `/attachments` record into `sage_attachments` row.
 *
 * `attached_to` is a reference like { id, $path } e.g. /purchase_invoices/<id>
 * — we parse $path to derive entity type.
 */
function transformAttachment(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;
  if (!record || !record.id) {
    console.warn('[SageTransformer] Attachment missing id, skipping');
    return null;
  }

  // Derive entity type from $path (e.g. "/purchase_invoices/abc" → "purchase_invoice")
  let attachedToEntity = null;
  let attachedToId     = record.attached_to?.id || null;
  const path           = record.attached_to?.$path || null;
  if (path) {
    const m = path.match(/^\/?([a-z_]+)\//i);
    if (m) {
      // strip trailing 's' to get singular (e.g. purchase_invoices → purchase_invoice)
      attachedToEntity = m[1].replace(/s$/, '');
    }
  }

  return {
    organization_id:         organizationId,
    platform_integration_id: platformIntegrationId,
    user_id:                 userId || null,

    sage_attachment_id: record.id,
    displayed_as:       record.displayed_as || record.file_name || null,

    file_name:    record.file_name    || null,
    content_type: record.content_type || record.mime_type || null,
    file_size:    record.file_size    || record.size || null,

    attached_to_entity: attachedToEntity,
    attached_to_id:     attachedToId,
    attached_to_path:   path,

    source_url:   record.$path || null,
    download_url: record.download_url || record.url || null,

    raw_data: record,

    source_created_at: record.created_at || null,
    source_updated_at: record.updated_at || null,
    last_synced_at:    new Date().toISOString(),
  };
}

module.exports = {
  transformRecord,
  transformSupplier,
  transformChartOfAccount,
  transformPurchaseInvoice,
  transformBankAccount,
  transformBankTransaction,
  transformTaxRate,
  transformPurchaseCreditNote,
  transformJournal,
  transformPaymentMethod,
  transformProduct,
  transformOtherPayment,
  transformOtherReceipt,
  transformBankTransfer,
  transformAttachment,
  parseAddressDisplayedAs,    // exported for testability
  extractCodeFromDisplayedAs, // exported for testability
  mapSageInvoiceStatus,       // exported for testability
  mapSageCreditNoteStatus,
  mapSageJournalStatus,
};
