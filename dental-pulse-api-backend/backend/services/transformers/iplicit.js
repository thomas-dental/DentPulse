/**
 * Entity transformation functions for Iplicit.
 * Converts raw Iplicit Enquiry API responses into our database schema.
 *
 * Context object (ctx):
 *   organizationId           — our org UUID
 *   userId                   — the user who triggered sync
 *   platformIntegrationId    — platform_integrations.id
 *   platformIntegrationOrgId — platform_integration_organizations.id (nullable)
 */

/**
 * Transform a single record based on entity type.
 */
function transformRecord(entityAlias, record, ctx) {
  switch (entityAlias) {
    case 'iplicit_legal_entities':
      return transformLegalEntity(record, ctx);
    case 'coa_account_groups':
      return transformCoaAccountGroup(record, ctx);
    case 'iplicit_chart_of_accounts':
      return transformIplicitChartOfAccount(record, ctx);
    case 'iplicit_balance_sheet':
      return transformBalanceSheet(record, ctx);
    case 'iplicit_profit_loss':
      return transformProfitLoss(record, ctx);
    case 'iplicit_suppliers':
      return transformSupplier(record, ctx);
    case 'iplicit_products':
      return transformProduct(record, ctx);
    case 'iplicit_sales_invoices':
      return transformSalesInvoice(record, ctx);
    case 'iplicit_sales_receipts':
      return transformSalesReceipt(record, ctx);
    case 'iplicit_purchase_invoices':
      return transformPurchaseInvoice(record, ctx);
    case 'iplicit_purchase_invoice_payments':
      return transformPurchaseInvoicePayment(record, ctx);
    case 'iplicit_receipt_allocations':
      return transformReceiptAllocation(record, ctx);
    case 'iplicit_payment_allocations':
      return transformPaymentAllocation(record, ctx);
    default:
      console.warn(`[IplicitTransformer] No transformation defined for entity: ${entityAlias}`);
      return null;
  }
}

/**
 * Transform an Iplicit Legal Entity record into platform_integration_organizations format.
 *
 * API: GET /api/LegalEntity
 * API fields: id, code, description, companyNo, countryCode, currency, isActive, isInterco, taxAuthorityId
 */
function transformLegalEntity(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;

  if (!record.id) {
    console.warn('[IplicitTransformer] Legal Entity missing id, skipping');
    return null;
  }

  return {
    organization_id:         organizationId,
    platform_integration_id: platformIntegrationId,
    user_id:                 userId,
    platform_name:           'iplicit',

    platform_org_id:   String(record.id),
    platform_org_name: record.description || null,
    platform_org_code: record.code        || null,
    currency:          record.currency    || null,
    country:           record.countryCode || null,
    status:            record.isActive !== false ? 'active' : 'inactive',
    raw_data:          record,
    // is_selected intentionally omitted — preserves user's existing mapping selection
  };
}

/**
 * Transform a COA Account Group record.
 *
 * Enquiry ID: dfce4c69-7ffe-8959-acec-019c7adf88db
 * API fields: AccountType, Code, Description, HasAttachments, HasNotes,
 *             Id, IsActive, LastModified, LastModifiedBy, LegacyRef,
 *             OrderIndex, ParentCoaGroupId
 */
function transformCoaAccountGroup(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;

  if (!record.Id) {
    console.warn('[IplicitTransformer] COA Account Group missing Id, skipping');
    return null;
  }

  return {
    organization_id:         organizationId,
    platform_integration_id: platformIntegrationId,
    user_id:                 userId,

    account_group_id:    String(record.Id),
    parent_coa_group_id: record.ParentCoaGroupId ? String(record.ParentCoaGroupId) : null,
    account_type:        record.AccountType || null,          // "BS" or "PL"
    code:                record.Code || null,
    description:         record.Description || null,
    is_active:           record.IsActive !== undefined ? Boolean(record.IsActive) : true,
    order_index:         record.OrderIndex != null ? Number(record.OrderIndex) : null,
    legacy_ref:          record.LegacyRef || null,
    has_attachments:     Boolean(record.HasAttachments),
    has_notes:           Boolean(record.HasNotes),
    api_last_modified:   record.LastModified || null,
    api_last_modified_by: record.LastModifiedBy || null,
  };
}

/**
 * Transform an Iplicit Chart of Accounts record.
 *
 * Enquiry ID: a5102823-724c-83c3-9111-019c676ced0f
 * API fields: Code, Description, count, AccountType, AccountId, CoaGroupId,
 *             IsActive, ApFlag, ArFlag, IsCharge, IsGoods, IsServices,
 *             LastModified, LastModifiedBy, Name
 */
function transformIplicitChartOfAccount(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;

  if (!record.AccountId) {
    console.warn('[IplicitTransformer] Chart of Account missing AccountId, skipping');
    return null;
  }

  return {
    organization_id:         organizationId,
    platform_integration_id: platformIntegrationId,
    user_id:                 userId,

    account_id:    String(record.AccountId),
    coa_group_id:  record.CoaGroupId ? String(record.CoaGroupId) : null,
    code:          record.Code || null,
    name:          record.Name || record.Description || null,
    description:   record.Description || null,
    account_type:  record.AccountType || null,               // "BS" or "PL"
    is_active:     record.IsActive !== undefined ? Boolean(record.IsActive) : true,

    ap_flag:       Boolean(record.ApFlag),
    ar_flag:       Boolean(record.ArFlag),
    is_charge:     Boolean(record.IsCharge),
    is_goods:      Boolean(record.IsGoods),
    is_services:   Boolean(record.IsServices),

    transaction_count: record.count != null ? Number(record.count) : null,

    api_last_modified:    record.LastModified || null,
    api_last_modified_by: record.LastModifiedBy || null,
  };
}

/**
 * Shared helper — fields common to both Balance Sheet and Profit & Loss.
 */
function transformCommonFinancialFields(record, ctx) {
  const { organizationId, userId, platformIntegrationId, currency } = ctx;
  return {
    organization_id:                  organizationId,
    platform_integration_id:          platformIntegrationId,
    user_id:                          userId,

    // Sync date range is stored in sync_jobs.start_date / sync_jobs.end_date
    currency:                         currency || 'GBP',

    // Identifiers
    account_id:                       String(record.AccountId),
    account_code:                     record.AccountCode   || null,
    coa_group_id:                     record.CoaGroupId    || null,
    doc_id:                           String(record.DocId),
    doc_no:                           record.DocNo         || null,
    doc_type_id:                      record.DocTypeId     || null,
    doc_class:                        record.DocClass      || null,

    // Amounts
    amount:                           record.Amount                        != null ? Number(record.Amount)                        : null,
    amount_no_decimal_places:         record.AmountNoDecimalPlaces         != null ? Number(record.AmountNoDecimalPlaces)         : null,
    currency_amount:                  record.CurrencyAmount                != null ? Number(record.CurrencyAmount)                : null,
    currency_amount_no_decimal_places:record.CurrencyAmountNoDecimalPlaces != null ? Number(record.CurrencyAmountNoDecimalPlaces) : null,
    doc_gross_amount:                 record.DocGrossAmount                != null ? Number(record.DocGrossAmount)                : null,
    doc_gross_currency_amount:        record.DocGrossCurrencyAmount        != null ? Number(record.DocGrossCurrencyAmount)        : null,
    doc_net_amount:                   record.DocNetAmount                  != null ? Number(record.DocNetAmount)                  : null,
    doc_net_currency_amount:          record.DocNetCurrencyAmount          != null ? Number(record.DocNetCurrencyAmount)          : null,
    doc_tax_amount:                   record.DocTaxAmount                  != null ? Number(record.DocTaxAmount)                  : null,
    doc_tax_currency_amount:          record.DocTaxCurrencyAmount          != null ? Number(record.DocTaxCurrencyAmount)          : null,
    tax_amount:                       record.TaxAmount                     != null ? Number(record.TaxAmount)                     : null,
    tax_currency_amount:              record.TaxCurrencyAmount             != null ? Number(record.TaxCurrencyAmount)             : null,
    quantity:                         record.Quantity                      != null ? Number(record.Quantity)                      : null,

    // Currency
    base_currency:                    record.BaseCurrency      || null,
    transaction_currency:             record.Currency          || null,

    // Contact
    contact_account_id:               record.ContactAccountId          || null,
    contact_account_code:             record.ContactAccountCode        || null,
    contact_classification_id:        record.ContactClassificationId   || null,
    contact_group_id:                 record.ContactGroupId            || null,

    country:                          record.Country           || null,

    // Document details
    description:                      record.Description       || null,
    doc_description:                  record.DocDescription    || null,
    invoice_no:                       record.InvoiceNo         || null,
    their_ref:                        record.TheirRef          || null,
    legacy_ref:                       record.LegacyRef         || null,

    // Dates
    invoice_date:                     record.InvoiceDate       || null,
    period_date:                      record.PeriodDate        || null,
    post_date:                        record.PostDate          || null,

    // Period / Year
    period_id:                        record.PeriodId          || null,
    financial_year_id:                record.FinancialYearId   || null,
    quarter:                          record.Quarter           || null,

    // Tax
    tax_band_id:                      record.TaxBandId         || null,
    tax_code_id:                      record.TaxCodeId         || null,

    // Product / Project
    product_id:                       record.ProductId         || null,
    product_code:                     record.ProductCode       || null,
    project_id:                       record.ProjectId         || null,
    project_code:                     record.ProjectCode       || null,

    // Other references
    attribute_id:                     record.AttributeId       || null,
    legal_entity_id:                  record.LegalEntityId     || null,
    fund:                             record.Fund              || null,
    fund_type_id:                     record.FundTypeId        || null,
    income_type:                      record.IncomeType        || null,
    interco:                          record.Interco           || null,
    property:                         record.Property          || null,
    resource:                         record.Resource          || null,

    // Transaction
    trans_line_no:                    record.TransLineNo != null ? Number(record.TransLineNo) : null,
    trans_no:                         record.TransNo     != null ? Number(record.TransNo)     : null,
    status:                           record.Status      != null ? Number(record.Status)      : null,
    elimination:                      Boolean(record.Elimination),

    // Audit
    api_last_modified:                record.LastModified    || null,
    api_last_modified_by:             record.LastModifiedBy  || null,
  };
}

/**
 * Transform a Balance Sheet record.
 * Enquiry ID: e3531a0b-7234-4b35-9b37-f407720f1f6d
 * BS-only fields: bank_account_id, asset_id, movement_type_id, cost_centre (string), department (string)
 */
function transformBalanceSheet(record, ctx) {
  if (!record.DocId || !record.AccountId) {
    console.warn('[IplicitTransformer] Balance Sheet record missing DocId or AccountId, skipping');
    return null;
  }

  return {
    ...transformCommonFinancialFields(record, ctx),
    // BS-specific fields
    bank_account_id:   record.BankAccountId  || null,
    asset_id:          record.AssetId        || null,
    movement_type_id:  record.MovementTypeId || null,
    cost_centre:       record.CostCentre     || null,
    department:        record.Department     || null,
  };
}

/**
 * Transform a Profit & Loss record.
 * Enquiry ID: ebfa85a2-72a3-4b25-8fb3-2ce3fce3185a
 * P&L-only fields: cost_centre_id/code, department_id/code, parent_*, salesperson
 */
function transformProfitLoss(record, ctx) {
  if (!record.DocId || !record.AccountId) {
    console.warn('[IplicitTransformer] Profit & Loss record missing DocId or AccountId, skipping');
    return null;
  }

  return {
    ...transformCommonFinancialFields(record, ctx),
    // P&L-specific fields
    cost_centre_id:        record.CostCentreId       || null,
    parent_cost_centre_id: record.ParentCostCentreId || null,
    cost_centre_code:      record.CostCentreCode     || null,
    department_id:         record.DepartmentId       || null,
    parent_department_id:  record.ParentDepartmentId || null,
    department_code:       record.DepartmentCode     || null,
    parent_department:     record.ParentDepartment   || null,
    salesperson:           record.Salesperson        || null,
  };
}

/**
 * Transform an Iplicit Supplier record.
 * Enquiry ID: 8c7f1fc7-7d82-4bd2-aac3-cc435d486164
 * Note: API field names contain spaces (e.g. "Contact group", "Contact code").
 */
function transformSupplier(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;

  if (!record.ContactAccountId) {
    console.warn('[IplicitTransformer] Supplier missing ContactAccountId, skipping');
    return null;
  }

  return {
    organization_id:             organizationId,
    platform_integration_id:     platformIntegrationId,
    user_id:                     userId,

    contact_account_id:          String(record.ContactAccountId),
    contact_group_id:            record.ContactGroupId              || null,
    contact_group:               record['Contact group']            || null,
    contact_code:                record['Contact code']             || null,
    contact_classification_id:   record.ContactClassificationId     || null,
    contact_classification:      record['Contact classification']   || null,

    company:                     record.Company                     || null,
    company_no:                  record['Company No']               || null,
    legacy_ref:                  record['Legacy Ref']               || null,
    is_active:                   record.IsActive !== false,

    payment_method:              record['Payment method']           || null,
    payment_method_id:           record.PaymentMethodId             || null,
    payment_term:                record['Payment term']             || null,
    payment_term_id:             record.PaymentTermId               || null,
  };
}

/**
 * Transform an Iplicit Product record.
 * Enquiry ID: a20de046-c776-40cd-a073-f1d5a730d107
 * Note: API field names contain spaces (e.g. "Product code", "Purchase account type").
 */
function transformProduct(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;

  if (!record.ProductId) {
    console.warn('[IplicitTransformer] Product missing ProductId, skipping');
    return null;
  }

  return {
    organization_id:             organizationId,
    platform_integration_id:     platformIntegrationId,
    user_id:                     userId,

    product_id:                  String(record.ProductId),
    product_code:                record['Product code']          || null,
    product_name:                record.Product                  || null,

    product_group_id:            record.ProductGroupId           || null,
    product_group:               record.Group                    || null,

    uom_id:                      record.UomId                    || null,
    product_uom:                 record['Product UOM']           || null,

    is_expense:                  record.Expense  != null ? Boolean(record.Expense)  : null,
    is_sale:                     record.Sale     != null ? Boolean(record.Sale)     : null,
    is_purchase:                 record.Purchase != null ? Boolean(record.Purchase) : null,
    is_job:                      record.Job      != null ? Boolean(record.Job)      : null,
    is_loan:                     record.Loan     != null ? Boolean(record.Loan)     : null,
    is_stock:                    record.Stock    != null ? Boolean(record.Stock)    : null,
    is_payroll:                  record.Payroll  != null ? Boolean(record.Payroll)  : null,
    is_timesheet:                record.Timesheet != null ? Boolean(record.Timesheet) : null,

    purchase_id:                 record.PurchaseId               || null,
    purchase_account:            record['Purchase account']      || null,
    purchase_account_id:         record.PurchaseAccountId        || null,
    purchase_account_type:       record['Purchase account type'] || null,
    purchase_name:               record['Purchase name']         || null,
    purchase_effective_date:     record['Purchase effective date'] || null,
    purchase_unit_price:         record['Purchase unit price']   != null ? Number(record['Purchase unit price'])   : null,
    purchase_currency:           record['Purchase currency']     || null,
    purchase_price_uom_id:       record.PurchasePriceUomId       || null,
    purchase_price_uom:          record['Purchase price UOM']    || null,
    purchase_price_currency:     record.PurchasePriceCurrency    || null,

    sale_id:                     record.SaleId                   || null,
    sale_account:                record['Sale account']          || null,
    sale_account_id:             record.SaleAccountId            || null,
    sale_account_type:           record['Sale account type']     || null,
    sale_name:                   record['Sale name']             || null,
    sale_effective_date:         record['Sale effective date']   || null,
    sale_unit_price:             record['Sale unit price']       != null ? Number(record['Sale unit price'])       : null,
    sale_currency:               record['Sale currency']         || null,
    sale_price_uom_id:           record.SalePriceUomId           || null,
    sale_price_uom:              record['Sale price UOM']        || null,
    sale_price_currency:         record.SalePriceCurrency        || null,

    only_active:                 record['Only active products']  != null ? Number(record['Only active products']) : null,
  };
}

/**
 * Transform an Iplicit Sales Invoice record.
 * Enquiry ID: 976a85e6-caa5-4eed-9fca-a4ab47132a6f
 * Note: API field names contain spaces (e.g. "Trans No", "Doc No", "Invoice date").
 */
function transformSalesInvoice(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;

  if (!record['Doc No']) {
    console.warn('[IplicitTransformer] Sales Invoice missing Doc No, skipping');
    return null;
  }

  // Parse invoice_date — "2025-12-01T00:00:00"
  const rawDate = record['Invoice date'];
  const invoiceDate = rawDate ? String(rawDate).substring(0, 10) : null;

  return {
    organization_id:             organizationId,
    platform_integration_id:     platformIntegrationId,
    user_id:                     userId,

    doc_no:                      String(record['Doc No']),
    doc_serie_id:                record['Doc Serie Id']  || null,
    trans_no:                    record['Trans No']       != null ? Number(record['Trans No'])       : null,
    doc_class:                   record.DocClass          || null,

    customer_id:                 record.CustomerId        || null,
    customer_name:               record.Customer          || null,

    legal_entity_id:             record.LegalEntityId     || null,
    legal_entity_code:           record['Legal Entity code'] || null,
    legal_entity_name:           record['Legal Entity']   || null,

    currency:                    record.Currency          || null,
    base_currency:               record.BaseCurrency      || null,
    amount:                      record.Amount            != null ? Number(record.Amount)            : null,
    currency_amount:             record['Currency Amount'] != null ? Number(record['Currency Amount']) : null,
    outstanding_amount:          record['Outs Amount']    != null ? Number(record['Outs Amount'])    : null,
    outstanding_currency_amount: record['Outs Cur Amount'] != null ? Number(record['Outs Cur Amount']) : null,
    invoice_count:               record['Invoice Count']  != null ? Number(record['Invoice Count'])  : null,

    description:                 record.Description       || null,
    invoice_date:                invoiceDate,
    last_printed:                record['Last Printed']   || null,
  };
}

/**
 * Transform an Iplicit Sales Receipt record.
 * Source: GET /api/Receipt (REST, paginated)
 * API fields are camelCase.
 */
function transformSalesReceipt(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;

  if (!record.id) {
    console.warn('[IplicitTransformer] Sales Receipt missing id, skipping');
    return null;
  }

  return {
    organization_id:             organizationId,
    platform_integration_id:     platformIntegrationId,
    user_id:                     userId,

    receipt_id:                  record.id                           || null,
    doc_class:                   record.docClass                     || null,
    doc_type_id:                 record.docTypeId                    || null,
    doc_no:                      record.docNo                        || null,
    doc_serie_id:                record.docSerieId                   || null,
    doc_date:                    record.docDate    ? String(record.docDate).substring(0, 10)    : null,

    contact_account_id:          record.contactAccountId             || null,
    contact_account_description: record.contactAccountDescription    || null,
    legal_entity_id:             record.legalEntityId                || null,
    period_id:                   record.periodId                     || null,

    net_amount:                  record.netAmount              != null ? Number(record.netAmount)              : null,
    tax_amount:                  record.taxAmount              != null ? Number(record.taxAmount)              : null,
    gross_amount:                record.grossAmount            != null ? Number(record.grossAmount)            : null,

    base_currency:               record.baseCurrency                 || null,
    currency:                    record.currency                     || null,
    currency_rate:               record.currencyRate           != null ? Number(record.currencyRate)           : null,

    net_currency_amount:         record.netCurrencyAmount      != null ? Number(record.netCurrencyAmount)      : null,
    tax_currency_amount:         record.taxCurrencyAmount      != null ? Number(record.taxCurrencyAmount)      : null,
    gross_currency_amount:       record.grossCurrencyAmount    != null ? Number(record.grossCurrencyAmount)    : null,

    tax_authority_id:            record.taxAuthorityId               || null,
    tax_date:                    record.taxDate    ? String(record.taxDate).substring(0, 10)    : null,
    is_deferred_tax:             Boolean(record.isDeferredTax),

    outstanding_amount:          record.outstandingAmount       != null ? Number(record.outstandingAmount)       : null,
    outstanding_currency_amount: record.outstandingCurrencyAmount != null ? Number(record.outstandingCurrencyAmount) : null,

    payment_method_id:           record.paymentMethodId              || null,
    bank_account_id:             record.bankAccountId                || null,
    bank_currency:               record.bankCurrency                 || null,
    bank_currency_amount:        record.bankCurrencyAmount     != null ? Number(record.bankCurrencyAmount)     : null,
    bank_currency_rate:          record.bankCurrencyRate       != null ? Number(record.bankCurrencyRate)       : null,

    account_id:                  record.accountId                    || null,
    status:                      record.status                 != null ? Number(record.status)                 : null,
    status_list:                 Array.isArray(record.statusList) ? record.statusList.map(s => s.trim()) : null,

    is_net_entry:                Boolean(record.isNetEntry),
    trans_time:                  record.transTime                    || null,
    trans_date:                  record.transDate  ? String(record.transDate).substring(0, 10)  : null,
    trans_no:                    record.transNo                != null ? Number(record.transNo)                : null,

    description:                 record.description                  || null,

    created_date:                record.createdDate                  || null,
    created_by:                  record.createdBy                    || null,
    last_modified:               record.lastModified                 || null,
    last_modified_by:            record.lastModifiedBy               || null,
    has_notes:                   Boolean(record.hasNotes),
    has_attachments:             Boolean(record.hasAttachments),
    stock_date:                  record.stockDate                    || null,
  };
}

/**
 * Transform an Iplicit Purchase Invoice record.
 * Enquiry ID: 67541faa-203d-4e38-9a44-90b1f45b666a
 * Note: Multiple lines per DocNo — unique key is doc_id + line_no.
 */
function transformPurchaseInvoice(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;

  if (!record.DocId || record.LineNo == null) {
    console.warn('[IplicitTransformer] Purchase Invoice missing DocId or LineNo, skipping');
    return null;
  }

  const invoiceDate    = record.InvoiceDate    ? String(record.InvoiceDate).substring(0, 10)    : null;
  const periodDateFrom = record.PeriodDateFrom ? String(record.PeriodDateFrom).substring(0, 10) : null;

  return {
    organization_id:         organizationId,
    platform_integration_id: platformIntegrationId,
    user_id:                 userId,

    doc_id:                  record.DocId           || null,
    doc_no:                  record.DocNo           || null,
    doc_type_id:             record.DocTypeId       || null,
    gl_id:                   record.GlId            || null,
    line_no:                 Number(record.LineNo),

    invoice_no:              record.InvoiceNo       || null,
    invoice_date:            invoiceDate,

    supplier_id:             record.SupplierId      || null,
    their_ref:               record.TheirRef        || null,

    account_id:              record.AccountId       || null,
    coa_group_id:            record.CoaGroupId      || null,
    tax_code_id:             record.TaxCodeId       || null,
    product_id:              record.ProductId       || null,

    legal_entity_id:         record.LegalEntityId   || null,
    financial_year_id:       record.FinancialYearId || null,
    period_id:               record.PeriodId        || null,
    period_date_from:        periodDateFrom,

    currency:                record.Currency        || null,
    base_currency:           record.BaseCurrency    || null,
    amount:                  record.Amount          != null ? Number(record.Amount)         : null,
    currency_amount:         record.CurrencyAmount  != null ? Number(record.CurrencyAmount) : null,

    cost_centre:             record.CostCentre      || null,
    department:              record.Department      || null,
    attribute_id:            record.AttributeId     || null,

    description:             record.Description     || null,
  };
}

/**
 * Transform an Iplicit Purchase Invoice Payment record.
 * Source: GET /api/Payment (REST, paginated)
 * API fields are camelCase. Unique key: payment_id (= record.id).
 */
function transformPurchaseInvoicePayment(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;

  if (!record.id) {
    console.warn('[IplicitTransformer] Purchase Invoice Payment missing id, skipping');
    return null;
  }

  return {
    organization_id:             organizationId,
    platform_integration_id:     platformIntegrationId,
    user_id:                     userId,

    payment_id:                  record.id                           || null,
    doc_class:                   record.docClass                     || null,
    doc_type_id:                 record.docTypeId                    || null,
    doc_no:                      record.docNo                        || null,
    doc_serie_id:                record.docSerieId                   || null,
    doc_date:                    record.docDate    ? String(record.docDate).substring(0, 10)    : null,

    contact_account_id:          record.contactAccountId             || null,
    contact_account_description: record.contactAccountDescription    || null,
    legal_entity_id:             record.legalEntityId                || null,
    period_id:                   record.periodId                     || null,

    net_amount:                  record.netAmount              != null ? Number(record.netAmount)              : null,
    tax_amount:                  record.taxAmount              != null ? Number(record.taxAmount)              : null,
    gross_amount:                record.grossAmount            != null ? Number(record.grossAmount)            : null,

    base_currency:               record.baseCurrency                 || null,
    currency:                    record.currency                     || null,
    currency_rate:               record.currencyRate           != null ? Number(record.currencyRate)           : null,

    net_currency_amount:         record.netCurrencyAmount      != null ? Number(record.netCurrencyAmount)      : null,
    tax_currency_amount:         record.taxCurrencyAmount      != null ? Number(record.taxCurrencyAmount)      : null,
    gross_currency_amount:       record.grossCurrencyAmount    != null ? Number(record.grossCurrencyAmount)    : null,

    tax_authority_id:            record.taxAuthorityId               || null,
    tax_date:                    record.taxDate    ? String(record.taxDate).substring(0, 10)    : null,
    is_deferred_tax:             Boolean(record.isDeferredTax),

    outstanding_amount:          record.outstandingAmount       != null ? Number(record.outstandingAmount)       : null,
    outstanding_currency_amount: record.outstandingCurrencyAmount != null ? Number(record.outstandingCurrencyAmount) : null,

    payment_method_id:           record.paymentMethodId              || null,
    bank_account_id:             record.bankAccountId                || null,
    bank_currency:               record.bankCurrency                 || null,
    bank_currency_amount:        record.bankCurrencyAmount     != null ? Number(record.bankCurrencyAmount)     : null,
    bank_currency_rate:          record.bankCurrencyRate       != null ? Number(record.bankCurrencyRate)       : null,

    account_id:                  record.accountId                    || null,
    status:                      record.status                 != null ? Number(record.status)                 : null,
    status_list:                 Array.isArray(record.statusList) ? record.statusList.map(s => s.trim()) : null,

    is_net_entry:                Boolean(record.isNetEntry),
    trans_time:                  record.transTime                    || null,
    trans_date:                  record.transDate  ? String(record.transDate).substring(0, 10)  : null,
    trans_no:                    record.transNo                != null ? Number(record.transNo)                : null,

    description:                 record.description                  || null,

    created_date:                record.createdDate                  || null,
    created_by:                  record.createdBy                    || null,
    last_modified:               record.lastModified                 || null,
    last_modified_by:            record.lastModifiedBy               || null,
    has_notes:                   Boolean(record.hasNotes),
    has_attachments:             Boolean(record.hasAttachments),
    stock_date:                  record.stockDate                    || null,
  };
}

/**
 * Transform a receipt allocation record.
 * Source: GET /api/Receipt/{id} → allocations[]
 * record._parentId = Iplicit receipt id (= iplicit_sales_receipts.receipt_id)
 */
function transformReceiptAllocation(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;

  if (!record.id || !record._parentId) {
    console.warn('[IplicitTransformer] Receipt Allocation missing id or _parentId, skipping');
    return null;
  }

  return {
    organization_id:         organizationId,
    platform_integration_id: platformIntegrationId,
    user_id:                 userId,

    receipt_id:              record._parentId,
    allocation_id:           record.id,
    doc_id:                  record.docId   || null,
    doc_no:                  record.docNo   || null,
    alloc_amount_currency:   record.allocAmountCurrency != null ? Number(record.allocAmountCurrency) : null,
    alloc_amount_base:       record.allocAmountBase     != null ? Number(record.allocAmountBase)     : null,
    alloc_currency_rate:     record.allocCurrencyRate   != null ? Number(record.allocCurrencyRate)   : null,
  };
}

/**
 * Transform a payment allocation record.
 * Source: GET /api/Payment/{id} → allocations[]
 * record._parentId = Iplicit payment id (= iplicit_payments.payment_id)
 */
function transformPaymentAllocation(record, ctx) {
  const { organizationId, userId, platformIntegrationId } = ctx;

  if (!record.id || !record._parentId) {
    console.warn('[IplicitTransformer] Payment Allocation missing id or _parentId, skipping');
    return null;
  }

  return {
    organization_id:         organizationId,
    platform_integration_id: platformIntegrationId,
    user_id:                 userId,

    payment_id:              record._parentId,
    allocation_id:           record.id,
    doc_id:                  record.docId   || null,
    doc_no:                  record.docNo   || null,
    alloc_amount_currency:   record.allocAmountCurrency != null ? Number(record.allocAmountCurrency) : null,
    alloc_amount_base:       record.allocAmountBase     != null ? Number(record.allocAmountBase)     : null,
    alloc_currency_rate:     record.allocCurrencyRate   != null ? Number(record.allocCurrencyRate)   : null,
  };
}

module.exports = { transformRecord };
