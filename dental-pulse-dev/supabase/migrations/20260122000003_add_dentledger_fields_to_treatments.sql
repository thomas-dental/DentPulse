-- Add DentLedger-specific analytics fields to treatments table
ALTER TABLE public.treatments
  ADD COLUMN IF NOT EXISTS no_items integer,
  ADD COLUMN IF NOT EXISTS average numeric(10, 2),
  ADD COLUMN IF NOT EXISTS percent_fees numeric(5, 2),
  ADD COLUMN IF NOT EXISTS hourly_rate numeric(10, 2),
  ADD COLUMN IF NOT EXISTS average_time_minutes numeric(6, 2);

-- Add comments for new fields
COMMENT ON COLUMN public.treatments.no_items IS 'Number of items/treatments performed (from DentLedger report)';
COMMENT ON COLUMN public.treatments.average IS 'Average price per item (from DentLedger report)';
COMMENT ON COLUMN public.treatments.percent_fees IS 'Percentage of total fees (from DentLedger report)';
COMMENT ON COLUMN public.treatments.hourly_rate IS 'Calculated hourly rate (from DentLedger report)';
COMMENT ON COLUMN public.treatments.average_time_minutes IS 'Average time per treatment in minutes (from DentLedger report)';

-- Add index for no_items if needed for filtering/reporting
CREATE INDEX IF NOT EXISTS idx_treatments_no_items ON public.treatments(no_items) WHERE no_items IS NOT NULL;
