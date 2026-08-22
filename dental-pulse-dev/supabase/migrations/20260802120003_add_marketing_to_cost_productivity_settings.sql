-- Allow 'marketing' as a cost_productivity_settings category, alongside
-- staff/clinician/overhead/material, so the Marketing Costs page's
-- Productivity Target and Monthly Trend popovers can save settings.
ALTER TABLE cost_productivity_settings
  DROP CONSTRAINT IF EXISTS cost_productivity_settings_category_check;

ALTER TABLE cost_productivity_settings
  ADD CONSTRAINT cost_productivity_settings_category_check
  CHECK (category IN ('staff', 'clinician', 'overhead', 'material', 'marketing'));
