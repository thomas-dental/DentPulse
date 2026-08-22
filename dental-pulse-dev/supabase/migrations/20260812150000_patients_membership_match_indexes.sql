-- Fix statement timeout (57014) when matching a Practice Plan / Denplan
-- membership upload against patients.
--
-- useMembershipUploadData.ts's candidate fetch runs two kinds of queries per
-- org (see its own comments, which assumed both were "indexed and fast" —
-- one half of that assumption was wrong):
--   Phase 1: patients WHERE organization_id = ? AND pt_dob IN (...)   -- NO INDEX on pt_dob at all
--   Phase 2: patients WHERE organization_id = ? AND pt_last_name ILIKE ANY(...) -- idx_patients_pt_last_name
--            is a plain btree, which Postgres cannot use for ILIKE (a
--            pattern-match operator, ~~*) — every chunk is a sequential scan.
--
-- On a large org (confirmed: 56,850 patients on The Old Surgery Dental
-- Practice) several of these chunked, concurrent sequential scans stack up
-- and blow the statement timeout, surfacing in the browser as "Reading
-- membership file..." followed by 57014 canceling statement due to
-- statement timeout — the PDF/CSV upload can't be previewed or imported.
--
-- Fix: an index for each phase.
--   1. pg_trgm GIN index on pt_last_name — the standard way to make ILIKE
--      (with or without wildcards) index-friendly; a plain btree cannot do
--      this regardless of column order.
--   2. Composite (organization_id, pt_dob) btree for the DOB phase, which
--      had no index whatsoever.
-- Not CONCURRENTLY: the SQL runner applying this wraps it in a transaction,
-- and Postgres rejects CONCURRENTLY inside one (25001). A plain CREATE INDEX
-- takes a SHARE lock — blocks writes to patients, not reads — for the
-- duration of the build, which at 56,850 rows is a few seconds; acceptable
-- for a one-off index build outside of an active sync window.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_patients_pt_last_name_trgm
  ON patients USING gin (pt_last_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_patients_org_pt_dob
  ON patients (organization_id, pt_dob)
  WHERE deleted_at IS NULL;
