-- Increase timeout for large table alteration
SET statement_timeout = '300s';

-- Fix acr_id column type: Dentally returns UUIDs, not integers
ALTER TABLE public.appointment_cancellation_reasons
  ALTER COLUMN acr_id TYPE TEXT USING acr_id::TEXT;

-- Fix appointments table: change cancellation reason ID from BIGINT to TEXT
-- to store Dentally's UUID-based cancellation reason IDs
ALTER TABLE public.appointments
  ALTER COLUMN apmt_appointment_cancellation_reason_id TYPE TEXT USING apmt_appointment_cancellation_reason_id::TEXT;

-- Reset timeout
RESET statement_timeout;
