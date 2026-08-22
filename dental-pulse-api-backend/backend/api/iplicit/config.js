/**
 * Configuration for all syncable Iplicit entities.
 * Priority order determines sync sequence (lower = synced first).
 *
 * dateFilter: true  — entity requires PeriodDateFrom / PeriodDateTo / Currency in POST body.
 *                     Default range: last 13 months including current month.
 * topLimit          — max records fetched per call (default 1000; use higher for date-range entities).
 *
 * Enquiry IDs:
 *   COA Account Groups : dfce4c69-7ffe-8959-acec-019c7adf88db
 *   Chart of Accounts  : a5102823-724c-83c3-9111-019c676ced0f
 *   Balance Sheet      : e3531a0b-7234-4b35-9b37-f407720f1f6d
 *   Profit & Loss      : ebfa85a2-72a3-4b25-8fb3-2ce3fce3185a
 */

const ENQUIRY_IDS = {
  coa_account_groups:        'dfce4c69-7ffe-8959-acec-019c7adf88db',
  iplicit_chart_of_accounts: 'a5102823-724c-83c3-9111-019c676ced0f',
  iplicit_balance_sheet:     'e3531a0b-7234-4b35-9b37-f407720f1f6d',
  iplicit_profit_loss:       'ebfa85a2-72a3-4b25-8fb3-2ce3fce3185a',
  iplicit_suppliers:         '8c7f1fc7-7d82-4bd2-aac3-cc435d486164',
  iplicit_products:          'a20de046-c776-40cd-a073-f1d5a730d107',
  iplicit_sales_invoices:    '976a85e6-caa5-4eed-9fca-a4ab47132a6f',
  iplicit_sales_receipts:    '7b3bc9fd-13ae-42e3-9c37-51dce46a0f59',
  iplicit_purchase_invoices:         '67541faa-203d-4e38-9a44-90b1f45b666a',
  iplicit_purchase_invoice_payments: 'a42e3c25-f135-4e59-b1c6-6fb594046cc4',
};

const ENTITIES = [
  {
    alias: 'iplicit_legal_entities',
    table: 'platform_integration_organizations',
    onConflict: 'platform_integration_id,platform_org_id',
    priority: 0,       // sync first — other entities may reference legal entity IDs
    dateFilter: false,
    topLimit: 1000,
    enquiryId: null,
    fetchType: 'legal_entities',  // uses GET /api/LegalEntity, not Enquiry API
  },
  {
    alias: 'coa_account_groups',
    table: 'iplicit_coa_account_groups',
    onConflict: 'organization_id,platform_integration_id,account_group_id',
    priority: 1,
    dateFilter: false,
    topLimit: 1000,
    enquiryId: ENQUIRY_IDS.coa_account_groups,
  },
  {
    alias: 'iplicit_chart_of_accounts',
    table: 'iplicit_chart_of_accounts',
    onConflict: 'organization_id,platform_integration_id,account_id',
    priority: 2,
    dateFilter: false,
    topLimit: 1000,
    enquiryId: ENQUIRY_IDS.iplicit_chart_of_accounts,
  },
  {
    alias: 'iplicit_balance_sheet',
    table: 'iplicit_balance_sheet',
    onConflict: 'organization_id,platform_integration_id,doc_id,trans_line_no',
    priority: 3,
    dateFilter: true,   // requires PeriodDateFrom / PeriodDateTo / Currency
    topLimit: 50000,
    enquiryId: ENQUIRY_IDS.iplicit_balance_sheet,
  },
  {
    alias: 'iplicit_profit_loss',
    table: 'iplicit_profit_loss',
    onConflict: 'organization_id,platform_integration_id,doc_id,trans_line_no',
    priority: 4,
    dateFilter: true,   // requires PeriodDateFrom / PeriodDateTo / Currency
    topLimit: 50000,
    enquiryId: ENQUIRY_IDS.iplicit_profit_loss,
  },
  {
    alias: 'iplicit_suppliers',
    table: 'iplicit_suppliers',
    onConflict: 'organization_id,platform_integration_id,contact_account_id',
    priority: 5,
    dateFilter: false,
    topLimit: 1000,
    enquiryId: ENQUIRY_IDS.iplicit_suppliers,
  },
  {
    alias: 'iplicit_products',
    table: 'iplicit_products',
    onConflict: 'organization_id,platform_integration_id,product_id',
    priority: 6,
    dateFilter: false,
    topLimit: 1000,
    enquiryId: ENQUIRY_IDS.iplicit_products,
  },
  {
    alias: 'iplicit_sales_invoices',
    table: 'iplicit_sales_invoices',
    onConflict: 'organization_id,platform_integration_id,doc_no',
    priority: 7,
    dateFilter: true,
    topLimit: 50000,
    enquiryId: ENQUIRY_IDS.iplicit_sales_invoices,
  },
  {
    alias: 'iplicit_sales_receipts',
    table: 'iplicit_sales_receipts',
    onConflict: 'organization_id,platform_integration_id,receipt_id',
    priority: 8,
    dateFilter: true,
    topLimit: 100,
    enquiryId: null,
    fetchType: 'rest_api_paged',
    restEndpoint: '/api/Receipt',
  },
  {
    alias: 'iplicit_receipt_allocations',
    table: 'iplicit_receipt_allocations',
    onConflict: 'organization_id,platform_integration_id,receipt_id,allocation_id',
    priority: 9,                          // after iplicit_sales_receipts (8)
    dateFilter: false,
    topLimit: 0,
    enquiryId: null,
    fetchType: 'detail_allocations',
    restEndpoint: '/api/Receipt',
    parentTable: 'iplicit_sales_receipts',
    parentIdField: 'receipt_id',
  },
  {
    alias: 'iplicit_purchase_invoices',
    table: 'iplicit_purchase_invoices',
    onConflict: 'organization_id,platform_integration_id,doc_id,line_no',
    priority: 10,
    dateFilter: true,
    topLimit: 50000,
    enquiryId: ENQUIRY_IDS.iplicit_purchase_invoices,
  },
  {
    alias: 'iplicit_purchase_invoice_payments',
    table: 'iplicit_payments',
    onConflict: 'organization_id,platform_integration_id,payment_id',
    priority: 11,
    dateFilter: true,
    topLimit: 100,
    enquiryId: null,
    fetchType: 'rest_api_paged',
    restEndpoint: '/api/Payment',
  },
  {
    alias: 'iplicit_payment_allocations',
    table: 'iplicit_payment_allocations',
    onConflict: 'organization_id,platform_integration_id,payment_id,allocation_id',
    priority: 12,                         // after iplicit_purchase_invoice_payments (11)
    dateFilter: false,
    topLimit: 0,
    enquiryId: null,
    fetchType: 'detail_allocations',
    restEndpoint: '/api/Payment',
    parentTable: 'iplicit_payments',
    parentIdField: 'payment_id',
  },
];

/** Lookup helpers */
const ENTITY_BY_ALIAS = {};
const TABLE_MAP = {};
const ON_CONFLICT_MAP = {};
const ENQUIRY_MAP = {};

for (const e of ENTITIES) {
  ENTITY_BY_ALIAS[e.alias] = e;
  TABLE_MAP[e.alias] = e.table;
  ON_CONFLICT_MAP[e.alias] = e.onConflict;
  ENQUIRY_MAP[e.alias] = e.enquiryId;
}

module.exports = {
  ENTITIES,
  ENTITY_BY_ALIAS,
  TABLE_MAP,
  ON_CONFLICT_MAP,
  ENQUIRY_MAP,
  ENQUIRY_IDS,
};
