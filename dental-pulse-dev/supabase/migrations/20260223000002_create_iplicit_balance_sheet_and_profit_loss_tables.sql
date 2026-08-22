-- ============================================================
-- iplicit_balance_sheet
-- Source: POST https://api.iplicit.com/api/Enquiry/run/e3531a0b-7234-4b35-9b37-f407720f1f6d
-- Body:   { "PeriodDateFrom": "...", "PeriodDateTo": "...", "Currency": "GBP" }
-- Default range: last 13 months (including current month)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.iplicit_balance_sheet (
  -- Primary key
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  organization_id                 UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id         UUID NOT NULL REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  user_id                         UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Query parameters stored for reference
  period_date_from                DATE,                            -- PeriodDateFrom sent in request
  period_date_to                  DATE,                            -- PeriodDateTo sent in request
  currency                        VARCHAR(3) DEFAULT 'GBP',        -- Currency sent in request

  -- Identifiers
  account_id                      VARCHAR(500) NOT NULL,           -- Api: AccountId
  account_code                    VARCHAR(100),                    -- Api: AccountCode
  coa_group_id                    VARCHAR(500),                    -- Api: CoaGroupId
  doc_id                          VARCHAR(500) NOT NULL,           -- Api: DocId
  doc_no                          VARCHAR(100),                    -- Api: DocNo
  doc_type_id                     VARCHAR(500),                    -- Api: DocTypeId
  doc_class                       VARCHAR(100),                    -- Api: DocClass

  -- Amounts
  amount                          NUMERIC(20, 5),                  -- Api: Amount
  amount_no_decimal_places        NUMERIC(20, 5),                  -- Api: AmountNoDecimalPlaces
  currency_amount                 NUMERIC(20, 5),                  -- Api: CurrencyAmount
  currency_amount_no_decimal_places NUMERIC(20, 5),               -- Api: CurrencyAmountNoDecimalPlaces
  doc_gross_amount                NUMERIC(20, 5),                  -- Api: DocGrossAmount
  doc_gross_currency_amount       NUMERIC(20, 5),                  -- Api: DocGrossCurrencyAmount
  doc_net_amount                  NUMERIC(20, 5),                  -- Api: DocNetAmount
  doc_net_currency_amount         NUMERIC(20, 5),                  -- Api: DocNetCurrencyAmount
  doc_tax_amount                  NUMERIC(20, 5),                  -- Api: DocTaxAmount
  doc_tax_currency_amount         NUMERIC(20, 5),                  -- Api: DocTaxCurrencyAmount
  tax_amount                      NUMERIC(20, 5),                  -- Api: TaxAmount
  tax_currency_amount             NUMERIC(20, 5),                  -- Api: TaxCurrencyAmount
  quantity                        NUMERIC(20, 5),                  -- Api: Quantity

  -- Currency
  base_currency                   VARCHAR(3),                      -- Api: BaseCurrency
  transaction_currency            VARCHAR(3),                      -- Api: Currency

  -- Contact
  contact_account_id              VARCHAR(500),                    -- Api: ContactAccountId
  contact_account_code            VARCHAR(100),                    -- Api: ContactAccountCode
  contact_classification_id       VARCHAR(500),                    -- Api: ContactClassificationId
  contact_group_id                VARCHAR(500),                    -- Api: ContactGroupId

  -- Cost / Dept (BS stores as plain string)
  cost_centre                     VARCHAR(255),                    -- Api: CostCentre
  department                      VARCHAR(255),                    -- Api: Department
  country                         VARCHAR(100),                    -- Api: Country

  -- Document details
  description                     TEXT,                            -- Api: Description
  doc_description                 TEXT,                            -- Api: DocDescription
  invoice_no                      VARCHAR(100),                    -- Api: InvoiceNo
  their_ref                       VARCHAR(255),                    -- Api: TheirRef
  legacy_ref                      VARCHAR(255),                    -- Api: LegacyRef

  -- Dates
  invoice_date                    TIMESTAMPTZ,                     -- Api: InvoiceDate
  period_date                     TIMESTAMPTZ,                     -- Api: PeriodDate
  post_date                       TIMESTAMPTZ,                     -- Api: PostDate

  -- Period / Year
  period_id                       VARCHAR(500),                    -- Api: PeriodId
  financial_year_id               VARCHAR(500),                    -- Api: FinancialYearId
  quarter                         VARCHAR(10),                     -- Api: Quarter

  -- Tax
  tax_band_id                     VARCHAR(500),                    -- Api: TaxBandId
  tax_code_id                     VARCHAR(500),                    -- Api: TaxCodeId

  -- Product / Project
  product_id                      VARCHAR(500),                    -- Api: ProductId
  product_code                    VARCHAR(255),                    -- Api: ProductCode
  project_id                      VARCHAR(500),                    -- Api: ProjectId
  project_code                    VARCHAR(255),                    -- Api: ProjectCode

  -- Other references
  attribute_id                    VARCHAR(500),                    -- Api: AttributeId
  bank_account_id                 VARCHAR(500),                    -- Api: BankAccountId (BS only)
  legal_entity_id                 VARCHAR(500),                    -- Api: LegalEntityId
  asset_id                        VARCHAR(500),                    -- Api: AssetId (BS only)
  movement_type_id                VARCHAR(500),                    -- Api: MovementTypeId (BS only)
  fund                            VARCHAR(255),                    -- Api: Fund
  fund_type_id                    VARCHAR(500),                    -- Api: FundTypeId
  income_type                     VARCHAR(255),                    -- Api: IncomeType
  interco                         VARCHAR(255),                    -- Api: Interco
  property                        VARCHAR(255),                    -- Api: Property
  resource                        VARCHAR(255),                    -- Api: Resource

  -- Transaction
  trans_line_no                   INTEGER,                         -- Api: TransLineNo
  trans_no                        INTEGER,                         -- Api: TransNo
  status                          INTEGER,                         -- Api: Status
  elimination                     BOOLEAN DEFAULT FALSE,           -- Api: Elimination

  -- Audit from Iplicit
  api_last_modified               TIMESTAMPTZ,                     -- Api: LastModified
  api_last_modified_by            VARCHAR(255),                    -- Api: LastModifiedBy

  -- Timestamps
  created_at                      TIMESTAMPTZ DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ DEFAULT NOW(),

  -- Unique: one line per org + integration + document + line number
  CONSTRAINT iplicit_balance_sheet_unique
    UNIQUE (organization_id, platform_integration_id, doc_id, trans_line_no)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_iplicit_bs_org_id
  ON public.iplicit_balance_sheet(organization_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_bs_integration_id
  ON public.iplicit_balance_sheet(platform_integration_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_bs_account_id
  ON public.iplicit_balance_sheet(account_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_bs_doc_id
  ON public.iplicit_balance_sheet(doc_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_bs_period_date
  ON public.iplicit_balance_sheet(period_date);

CREATE INDEX IF NOT EXISTS idx_iplicit_bs_period_range
  ON public.iplicit_balance_sheet(period_date_from, period_date_to);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_iplicit_balance_sheet_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER iplicit_balance_sheet_updated_at_trigger
  BEFORE UPDATE ON public.iplicit_balance_sheet
  FOR EACH ROW
  EXECUTE FUNCTION update_iplicit_balance_sheet_updated_at();

-- Enable RLS
ALTER TABLE public.iplicit_balance_sheet ENABLE ROW LEVEL SECURITY;

CREATE POLICY iplicit_balance_sheet_org_isolation
  ON public.iplicit_balance_sheet
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.iplicit_balance_sheet IS
  'Iplicit Balance Sheet transaction lines synced via Enquiry API (e3531a0b-7234-4b35-9b37-f407720f1f6d). Default range: last 13 months.';


-- ============================================================
-- iplicit_profit_loss
-- Source: POST https://api.iplicit.com/api/Enquiry/run/ebfa85a2-72a3-4b25-8fb3-2ce3fce3185a
-- Body:   { "PeriodDateFrom": "...", "PeriodDateTo": "...", "Currency": "GBP" }
-- Default range: last 13 months (including current month)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.iplicit_profit_loss (
  -- Primary key
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  organization_id                 UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id         UUID NOT NULL REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  user_id                         UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Query parameters stored for reference
  period_date_from                DATE,                            -- PeriodDateFrom sent in request
  period_date_to                  DATE,                            -- PeriodDateTo sent in request
  currency                        VARCHAR(3) DEFAULT 'GBP',        -- Currency sent in request

  -- Identifiers
  account_id                      VARCHAR(500) NOT NULL,           -- Api: AccountId
  account_code                    VARCHAR(100),                    -- Api: AccountCode
  coa_group_id                    VARCHAR(500),                    -- Api: CoaGroupId
  doc_id                          VARCHAR(500) NOT NULL,           -- Api: DocId
  doc_no                          VARCHAR(100),                    -- Api: DocNo
  doc_type_id                     VARCHAR(500),                    -- Api: DocTypeId
  doc_class                       VARCHAR(100),                    -- Api: DocClass

  -- Amounts
  amount                          NUMERIC(20, 5),                  -- Api: Amount
  amount_no_decimal_places        NUMERIC(20, 5),                  -- Api: AmountNoDecimalPlaces
  currency_amount                 NUMERIC(20, 5),                  -- Api: CurrencyAmount
  currency_amount_no_decimal_places NUMERIC(20, 5),               -- Api: CurrencyAmountNoDecimalPlaces
  doc_gross_amount                NUMERIC(20, 5),                  -- Api: DocGrossAmount
  doc_gross_currency_amount       NUMERIC(20, 5),                  -- Api: DocGrossCurrencyAmount
  doc_net_amount                  NUMERIC(20, 5),                  -- Api: DocNetAmount
  doc_net_currency_amount         NUMERIC(20, 5),                  -- Api: DocNetCurrencyAmount
  doc_tax_amount                  NUMERIC(20, 5),                  -- Api: DocTaxAmount
  doc_tax_currency_amount         NUMERIC(20, 5),                  -- Api: DocTaxCurrencyAmount
  tax_amount                      NUMERIC(20, 5),                  -- Api: TaxAmount
  tax_currency_amount             NUMERIC(20, 5),                  -- Api: TaxCurrencyAmount
  quantity                        NUMERIC(20, 5),                  -- Api: Quantity

  -- Currency
  base_currency                   VARCHAR(3),                      -- Api: BaseCurrency
  transaction_currency            VARCHAR(3),                      -- Api: Currency

  -- Contact
  contact_account_id              VARCHAR(500),                    -- Api: ContactAccountId
  contact_account_code            VARCHAR(100),                    -- Api: ContactAccountCode
  contact_classification_id       VARCHAR(500),                    -- Api: ContactClassificationId
  contact_group_id                VARCHAR(500),                    -- Api: ContactGroupId

  -- Cost Centre (P&L stores as structured IDs + code)
  cost_centre_id                  VARCHAR(500),                    -- Api: CostCentreId (P&L only)
  parent_cost_centre_id           VARCHAR(500),                    -- Api: ParentCostCentreId (P&L only)
  cost_centre_code                VARCHAR(255),                    -- Api: CostCentreCode (P&L only)

  -- Department (P&L stores as structured IDs + code)
  department_id                   VARCHAR(500),                    -- Api: DepartmentId (P&L only)
  parent_department_id            VARCHAR(500),                    -- Api: ParentDepartmentId (P&L only)
  department_code                 VARCHAR(255),                    -- Api: DepartmentCode (P&L only)
  parent_department               VARCHAR(255),                    -- Api: ParentDepartment (P&L only)

  country                         VARCHAR(100),                    -- Api: Country

  -- Document details
  description                     TEXT,                            -- Api: Description
  doc_description                 TEXT,                            -- Api: DocDescription
  invoice_no                      VARCHAR(100),                    -- Api: InvoiceNo
  their_ref                       VARCHAR(255),                    -- Api: TheirRef
  legacy_ref                      VARCHAR(255),                    -- Api: LegacyRef

  -- Dates
  invoice_date                    TIMESTAMPTZ,                     -- Api: InvoiceDate
  period_date                     TIMESTAMPTZ,                     -- Api: PeriodDate
  post_date                       TIMESTAMPTZ,                     -- Api: PostDate

  -- Period / Year
  period_id                       VARCHAR(500),                    -- Api: PeriodId
  financial_year_id               VARCHAR(500),                    -- Api: FinancialYearId
  quarter                         VARCHAR(10),                     -- Api: Quarter

  -- Tax
  tax_band_id                     VARCHAR(500),                    -- Api: TaxBandId
  tax_code_id                     VARCHAR(500),                    -- Api: TaxCodeId

  -- Product / Project
  product_id                      VARCHAR(500),                    -- Api: ProductId
  product_code                    VARCHAR(255),                    -- Api: ProductCode
  project_id                      VARCHAR(500),                    -- Api: ProjectId
  project_code                    VARCHAR(255),                    -- Api: ProjectCode

  -- Other references
  attribute_id                    VARCHAR(500),                    -- Api: AttributeId
  legal_entity_id                 VARCHAR(500),                    -- Api: LegalEntityId
  fund                            VARCHAR(255),                    -- Api: Fund
  fund_type_id                    VARCHAR(500),                    -- Api: FundTypeId
  income_type                     VARCHAR(255),                    -- Api: IncomeType
  interco                         VARCHAR(255),                    -- Api: Interco
  property                        VARCHAR(255),                    -- Api: Property
  resource                        VARCHAR(255),                    -- Api: Resource
  salesperson                     VARCHAR(255),                    -- Api: Salesperson (P&L only)

  -- Transaction
  trans_line_no                   INTEGER,                         -- Api: TransLineNo
  trans_no                        INTEGER,                         -- Api: TransNo
  status                          INTEGER,                         -- Api: Status
  elimination                     BOOLEAN DEFAULT FALSE,           -- Api: Elimination

  -- Audit from Iplicit
  api_last_modified               TIMESTAMPTZ,                     -- Api: LastModified
  api_last_modified_by            VARCHAR(255),                    -- Api: LastModifiedBy

  -- Timestamps
  created_at                      TIMESTAMPTZ DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ DEFAULT NOW(),

  -- Unique: one line per org + integration + document + line number
  CONSTRAINT iplicit_profit_loss_unique
    UNIQUE (organization_id, platform_integration_id, doc_id, trans_line_no)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_iplicit_pl_org_id
  ON public.iplicit_profit_loss(organization_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_pl_integration_id
  ON public.iplicit_profit_loss(platform_integration_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_pl_account_id
  ON public.iplicit_profit_loss(account_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_pl_doc_id
  ON public.iplicit_profit_loss(doc_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_pl_period_date
  ON public.iplicit_profit_loss(period_date);

CREATE INDEX IF NOT EXISTS idx_iplicit_pl_period_range
  ON public.iplicit_profit_loss(period_date_from, period_date_to);

CREATE INDEX IF NOT EXISTS idx_iplicit_pl_cost_centre
  ON public.iplicit_profit_loss(cost_centre_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_iplicit_profit_loss_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER iplicit_profit_loss_updated_at_trigger
  BEFORE UPDATE ON public.iplicit_profit_loss
  FOR EACH ROW
  EXECUTE FUNCTION update_iplicit_profit_loss_updated_at();

-- Enable RLS
ALTER TABLE public.iplicit_profit_loss ENABLE ROW LEVEL SECURITY;

CREATE POLICY iplicit_profit_loss_org_isolation
  ON public.iplicit_profit_loss
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.iplicit_profit_loss IS
  'Iplicit Profit & Loss transaction lines synced via Enquiry API (ebfa85a2-72a3-4b25-8fb3-2ce3fce3185a). Default range: last 13 months.';
