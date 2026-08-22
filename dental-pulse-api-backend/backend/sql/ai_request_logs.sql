-- ai_request_logs — full request/response log for every Claude API call.
-- Run once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Records BOTH successful and failed calls (unlike ai_token_usage_logs, which
-- only logs successful responses). organization_id / user_id are NULLABLE here
-- on purpose, so a call with no org (or a failed call) is still recorded rather
-- than silently dropped.

create table if not exists public.ai_request_logs (
  id                uuid primary key default gen_random_uuid(),
  request_id        text,                         -- Anthropic req_... id (matches Console → Logs)
  organization_id   uuid,
  user_id           uuid,
  feature           text,                         -- e.g. cashflow-forecast-ai, chatbot-intent
  model             text,
  status            text not null,                -- 'success' | 'error'
  http_status       integer,                      -- populated on error (e.g. 429, 400)
  error_type        text,
  error_message     text,
  request_payload   jsonb,                        -- { model, system, messages, tools, output_config, ... }
  response_payload  jsonb,                        -- { stop_reason, content } (success only)
  input_tokens      integer,
  output_tokens     integer,
  latency_ms        integer,
  created_at        timestamptz not null default now()
);

create index if not exists ai_request_logs_created_at_idx  on public.ai_request_logs (created_at desc);
create index if not exists ai_request_logs_org_idx         on public.ai_request_logs (organization_id);
create index if not exists ai_request_logs_request_id_idx  on public.ai_request_logs (request_id);
create index if not exists ai_request_logs_feature_idx     on public.ai_request_logs (feature);
create index if not exists ai_request_logs_status_idx      on public.ai_request_logs (status);

-- Server access is via the service-role key (bypasses RLS), matching how
-- ai_token_usage_logs is written. If you enable RLS, add a service-role policy.
