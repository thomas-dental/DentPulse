-- ============================================================
-- iplicit_products
-- Source: POST https://api.iplicit.com/api/Enquiry/run/a20de046-c776-40cd-a073-f1d5a730d107
-- No date filter — full product list synced on each run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.iplicit_products (
  -- Primary key
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_integration_id     UUID NOT NULL REFERENCES public.platform_integrations(id) ON DELETE CASCADE,
  user_id                     UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Identifiers
  product_id                  VARCHAR(500) NOT NULL,   -- Api: ProductId (unique product UUID)
  product_code                VARCHAR(100),            -- Api: Product code
  product_name                VARCHAR(500),            -- Api: Product

  -- Product group
  product_group_id            VARCHAR(500),            -- Api: ProductGroupId
  product_group               VARCHAR(255),            -- Api: Group

  -- Unit of measure
  uom_id                      VARCHAR(500),            -- Api: UomId
  product_uom                 VARCHAR(100),            -- Api: Product UOM

  -- Product type flags
  is_expense                  BOOLEAN,                 -- Api: Expense
  is_sale                     BOOLEAN,                 -- Api: Sale
  is_purchase                 BOOLEAN,                 -- Api: Purchase
  is_job                      BOOLEAN,                 -- Api: Job
  is_loan                     BOOLEAN,                 -- Api: Loan
  is_stock                    BOOLEAN,                 -- Api: Stock
  is_payroll                  BOOLEAN,                 -- Api: Payroll
  is_timesheet                BOOLEAN,                 -- Api: Timesheet

  -- Purchase details
  purchase_id                 VARCHAR(500),            -- Api: PurchaseId
  purchase_account            VARCHAR(100),            -- Api: Purchase account (code)
  purchase_account_id         VARCHAR(500),            -- Api: PurchaseAccountId
  purchase_account_type       VARCHAR(50),             -- Api: Purchase account type (e.g. "PL")
  purchase_name               VARCHAR(500),            -- Api: Purchase name
  purchase_effective_date     DATE,                    -- Api: Purchase effective date
  purchase_unit_price         NUMERIC(18,6),           -- Api: Purchase unit price
  purchase_currency           VARCHAR(10),             -- Api: Purchase currency
  purchase_price_uom_id       VARCHAR(500),            -- Api: PurchasePriceUomId
  purchase_price_uom          VARCHAR(100),            -- Api: Purchase price UOM
  purchase_price_currency     VARCHAR(10),             -- Api: PurchasePriceCurrency

  -- Sale details
  sale_id                     VARCHAR(500),            -- Api: SaleId
  sale_account                VARCHAR(100),            -- Api: Sale account (code)
  sale_account_id             VARCHAR(500),            -- Api: SaleAccountId
  sale_account_type           VARCHAR(50),             -- Api: Sale account type
  sale_name                   VARCHAR(500),            -- Api: Sale name
  sale_effective_date         DATE,                    -- Api: Sale effective date
  sale_unit_price             NUMERIC(18,6),           -- Api: Sale unit price
  sale_currency               VARCHAR(10),             -- Api: Sale currency
  sale_price_uom_id           VARCHAR(500),            -- Api: SalePriceUomId
  sale_price_uom              VARCHAR(100),            -- Api: Sale price UOM
  sale_price_currency         VARCHAR(10),             -- Api: SalePriceCurrency

  -- Status
  only_active                 SMALLINT,                -- Api: Only active products (1 = active)

  -- Timestamps
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW(),

  -- Unique: one product per org + integration
  CONSTRAINT iplicit_products_unique
    UNIQUE (organization_id, platform_integration_id, product_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_iplicit_products_org_id
  ON public.iplicit_products(organization_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_products_integration_id
  ON public.iplicit_products(platform_integration_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_products_product_id
  ON public.iplicit_products(product_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_products_product_group_id
  ON public.iplicit_products(product_group_id);

CREATE INDEX IF NOT EXISTS idx_iplicit_products_is_purchase
  ON public.iplicit_products(is_purchase);

CREATE INDEX IF NOT EXISTS idx_iplicit_products_is_sale
  ON public.iplicit_products(is_sale);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_iplicit_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER iplicit_products_updated_at_trigger
  BEFORE UPDATE ON public.iplicit_products
  FOR EACH ROW
  EXECUTE FUNCTION update_iplicit_products_updated_at();

-- Enable RLS
ALTER TABLE public.iplicit_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY iplicit_products_org_isolation
  ON public.iplicit_products
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.user_roles WHERE user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.iplicit_products IS
  'Iplicit Products synced via Enquiry API (a20de046-c776-40cd-a073-f1d5a730d107). No date filter — full list.';
