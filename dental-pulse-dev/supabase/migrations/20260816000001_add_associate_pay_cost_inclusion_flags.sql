-- Adds the two "Is Associate Pay Including Lab Cost" / "Is Associate Pay
-- Including Material Cost" toggles to Business Settings, per location —
-- mirrors what already exists in the legacy live app's Business Information
-- tab (setting2 component: isAssociatePayIncludingLabCost /
-- isAssociatePayIncludingMaterialCost), added here to practice_locations
-- alongside the rest of the per-location business info fields.
--
-- Defaults preserve current Associate Profit Planning behaviour rather than
-- both starting false: lab cost has always been unconditionally deducted
-- from associate net pay (useAssociateProfitPlanning.ts), so it defaults to
-- true; material cost has never been deducted from associate pay anywhere,
-- so it defaults to false. This way enabling these columns doesn't silently
-- change existing customers' profit numbers until they actively toggle them.

ALTER TABLE practice_locations
ADD COLUMN IF NOT EXISTS is_associate_pay_including_lab_cost BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS is_associate_pay_including_material_cost BOOLEAN DEFAULT false;

COMMENT ON COLUMN practice_locations.is_associate_pay_including_lab_cost IS 'Whether associate pay calculations include lab cost for this location';
COMMENT ON COLUMN practice_locations.is_associate_pay_including_material_cost IS 'Whether associate pay calculations include material cost for this location';
