-- Dentally inbound webhook audit log + per-integration signing secret storage.

ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS webhook_secret TEXT,
  ADD COLUMN IF NOT EXISTS webhook_secret_hint VARCHAR(8);

COMMENT ON COLUMN public.integrations.webhook_secret IS
  'Dentally webhook signing secret (from Developer Settings). Used to verify X-Dentally-Signature on inbound events.';
COMMENT ON COLUMN public.integrations.webhook_secret_hint IS
  'Last 4 chars of webhook secret for UI display.';

CREATE TABLE IF NOT EXISTS public.dentally_webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resource VARCHAR(64) NOT NULL,
  action VARCHAR(32) NOT NULL,
  object_id VARCHAR(64),
  event_name VARCHAR(128),
  signature_valid BOOLEAN NOT NULL DEFAULT false,
  status_code INTEGER,
  processing_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  error_message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  invoice_ids BIGINT[] NOT NULL DEFAULT '{}'::bigint[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dentally_webhook_logs_practice_received
  ON public.dentally_webhook_logs(practice_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_dentally_webhook_logs_resource_action
  ON public.dentally_webhook_logs(resource, action);

COMMENT ON TABLE public.dentally_webhook_logs IS
  'Audit log for inbound Dentally webhooks (payments, etc.). Written by API backend on receipt.';

ALTER TABLE public.dentally_webhook_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.dentally_webhook_logs FROM anon, authenticated;
GRANT ALL ON TABLE public.dentally_webhook_logs TO service_role;
