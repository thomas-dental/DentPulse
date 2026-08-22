-- Add tax fields to iplicit_gl_entries table
-- iplicit API provides tax information on line items (taxRate, taxCurrencyAmount, taxType)
-- which was previously not being captured during GL entries sync

ALTER TABLE public.iplicit_gl_entries
ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(10, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(10, 4) DEFAULT 0,
ADD COLUMN IF NOT EXISTS tax_type VARCHAR(100),
ADD COLUMN IF NOT EXISTS gross_amount NUMERIC(10, 2) DEFAULT 0;

COMMENT ON COLUMN public.iplicit_gl_entries.tax_amount IS 'Tax amount on the line item (from iplicit taxCurrencyAmount/taxAmount)';
COMMENT ON COLUMN public.iplicit_gl_entries.tax_rate IS 'Tax rate percentage (from iplicit taxRate)';
COMMENT ON COLUMN public.iplicit_gl_entries.tax_type IS 'Tax type/code name (from iplicit taxType/taxCode/taxName)';
COMMENT ON COLUMN public.iplicit_gl_entries.gross_amount IS 'Gross amount: net_amount + tax_amount';

-- Backfill gross_amount for any existing rows
UPDATE public.iplicit_gl_entries
SET gross_amount = COALESCE(net_amount, 0) + COALESCE(tax_amount, 0)
WHERE gross_amount = 0 OR gross_amount IS NULL;
