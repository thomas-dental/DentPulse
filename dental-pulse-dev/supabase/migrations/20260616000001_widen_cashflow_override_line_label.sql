-- Widen cashflow_forecast_overrides.line_label from VARCHAR(255) to TEXT.
--
-- The column originally held only custom-row titles and short note text. It now
-- also stores Auto/Repeating/Linked automation config as JSON (section 'rule').
-- A Linked rule with several inputs (each a percentage of another line) plus a
-- category name can exceed 255 characters, which would error on save. TEXT
-- removes the limit; existing values are unaffected.

ALTER TABLE public.cashflow_forecast_overrides
  ALTER COLUMN line_label TYPE TEXT;
