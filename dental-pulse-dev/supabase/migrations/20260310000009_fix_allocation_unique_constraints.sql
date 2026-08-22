-- Fix allocation unique constraints to include parent id
-- Same allocation_id can appear under different receipts/payments with different data
-- Old: UNIQUE (org, platform_integration_id, allocation_id)
-- New: UNIQUE (org, platform_integration_id, receipt_id/payment_id, allocation_id)

ALTER TABLE public.iplicit_receipt_allocations
  DROP CONSTRAINT IF EXISTS unique_iplicit_receipt_allocation;

ALTER TABLE public.iplicit_receipt_allocations
  ADD CONSTRAINT unique_iplicit_receipt_allocation
    UNIQUE (organization_id, platform_integration_id, receipt_id, allocation_id);


ALTER TABLE public.iplicit_payment_allocations
  DROP CONSTRAINT IF EXISTS unique_iplicit_payment_allocation;

ALTER TABLE public.iplicit_payment_allocations
  ADD CONSTRAINT unique_iplicit_payment_allocation
    UNIQUE (organization_id, platform_integration_id, payment_id, allocation_id);
