-- Per-provider weekly working-days schedule, set from the Edit Associate
-- screen. One entry per day of week (monday..sunday), each either off, a
-- full/half-day preset (with its resolved start/end time baked in so
-- consumers don't need to hardcode the preset mapping), or a custom time
-- range the user enters themselves. Each day also carries the list of
-- treatments the provider performs on that day.
--
-- Shape: { "monday": { "type": "full-day" | "morning-half" | "afternoon-half"
--   | "custom" | "off", "startTime": "HH:mm" | null, "endTime": "HH:mm" | null,
--   "treatmentIds": string[] }, ... }

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS working_days jsonb;

COMMENT ON COLUMN public.providers.working_days IS 'Weekly working-days schedule keyed by lowercase day name (monday..sunday); each day is {type: off|full-day|morning-half|afternoon-half|custom, startTime, endTime, treatmentIds}. Null/missing days default to off (no treatments) in the app.';
