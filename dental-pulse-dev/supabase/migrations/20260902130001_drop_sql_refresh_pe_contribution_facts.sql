-- PE contribution facts refresh is Node-only (refreshPeContributionFacts.js post-sync).
-- Remove unused SQL refresh to avoid drift from the Node aggregation path.

DROP FUNCTION IF EXISTS public.refresh_pe_contribution_facts(UUID);
