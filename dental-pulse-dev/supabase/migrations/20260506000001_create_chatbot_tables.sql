-- ============================================================
-- Chatbot V2 — All tables, indexes, RLS policies, triggers
-- Phase 0: Foundation tables for chatbot version control,
-- sessions, messages, AI settings, token tracking.
-- Phase 1-4: Monitor, alias, anomaly, recommendation tables.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. chatbot_version_config (singleton — admin panel toggle)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chatbot_version_config (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    active_version  VARCHAR(10) NOT NULL DEFAULT 'v1'
                    CHECK (active_version IN ('v1', 'v2')),
    v1_enabled      BOOLEAN NOT NULL DEFAULT true,
    v2_enabled      BOOLEAN NOT NULL DEFAULT true,

    -- V1 settings (Gemini)
    v1_provider     VARCHAR(40) NOT NULL DEFAULT 'gemini',
    v1_model        VARCHAR(80) NOT NULL DEFAULT 'google/gemini-2.5-flash',
    v1_streaming    BOOLEAN NOT NULL DEFAULT true,

    -- V2 settings (Claude)
    v2_intent_model VARCHAR(80) NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
    v2_format_model VARCHAR(80) NOT NULL DEFAULT 'claude-sonnet-4-6',
    v2_local_classifier_enabled BOOLEAN NOT NULL DEFAULT true,
    v2_max_tools    INTEGER NOT NULL DEFAULT 25,

    -- Feature flags (apply to active version)
    feature_at_mentions     BOOLEAN NOT NULL DEFAULT false,
    feature_inline_charts   BOOLEAN NOT NULL DEFAULT false,
    feature_pdf_reports     BOOLEAN NOT NULL DEFAULT false,
    feature_email_reports   BOOLEAN NOT NULL DEFAULT false,
    feature_briefing        BOOLEAN NOT NULL DEFAULT false,
    feature_anomaly_alerts  BOOLEAN NOT NULL DEFAULT false,
    feature_recommendations BOOLEAN NOT NULL DEFAULT false,
    feature_monitors        BOOLEAN NOT NULL DEFAULT false,
    feature_forecasting     BOOLEAN NOT NULL DEFAULT false,

    -- Audit
    switched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    switched_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed singleton row
INSERT INTO public.chatbot_version_config (active_version)
SELECT 'v1'
WHERE NOT EXISTS (SELECT 1 FROM public.chatbot_version_config);

-- Auto-touch updated_at
CREATE OR REPLACE FUNCTION public.touch_chatbot_version_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chatbot_version_touch ON public.chatbot_version_config;
CREATE TRIGGER trg_chatbot_version_touch
  BEFORE UPDATE ON public.chatbot_version_config
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_chatbot_version_updated_at();

ALTER TABLE public.chatbot_version_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read chatbot config"
ON public.chatbot_version_config FOR SELECT
USING (auth.uid() IS NOT NULL);

-- ============================================================
-- 2. ai_org_settings (per-org Claude API key + model config)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_org_settings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID UNIQUE NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    claude_api_key  TEXT,
    monthly_budget  DECIMAL(10,2),
    intent_model    VARCHAR(80) DEFAULT 'claude-haiku-4-5-20251001',
    format_model    VARCHAR(80) DEFAULT 'claude-sonnet-4-6',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.touch_ai_org_settings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_org_settings_touch ON public.ai_org_settings;
CREATE TRIGGER trg_ai_org_settings_touch
  BEFORE UPDATE ON public.ai_org_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_ai_org_settings_updated_at();

ALTER TABLE public.ai_org_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can manage AI org settings"
ON public.ai_org_settings FOR ALL
USING (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role)
)
WITH CHECK (
    public.has_org_role(auth.uid(), organization_id, 'owner'::app_role)
);

CREATE POLICY "Members can read AI org settings"
ON public.ai_org_settings FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

-- ============================================================
-- 3. chat_sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_sessions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    title            TEXT,
    context_json     JSONB DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_org
ON public.chat_sessions (user_id, organization_id, last_activity_at DESC);

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own chat sessions"
ON public.chat_sessions FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 4. chat_messages
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
    role        VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content     TEXT NOT NULL,
    intent_json JSONB,
    data_json   JSONB,
    chart_json  JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session
ON public.chat_messages (session_id, created_at ASC);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own chat messages"
ON public.chat_messages FOR SELECT
USING (EXISTS (
    SELECT 1 FROM public.chat_sessions cs
    WHERE cs.id = chat_messages.session_id AND cs.user_id = auth.uid()
));

CREATE POLICY "Users can insert own chat messages"
ON public.chat_messages FOR INSERT
WITH CHECK (EXISTS (
    SELECT 1 FROM public.chat_sessions cs
    WHERE cs.id = chat_messages.session_id AND cs.user_id = auth.uid()
));

-- ============================================================
-- 5. ai_token_usage_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_token_usage_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    feature         VARCHAR(50) NOT NULL,
    model           VARCHAR(80) NOT NULL,
    input_tokens    INTEGER NOT NULL,
    output_tokens   INTEGER NOT NULL,
    estimated_cost  DECIMAL(10,6) NOT NULL,
    latency_ms      INTEGER NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_token_usage_org_date
ON public.ai_token_usage_logs (organization_id, created_at DESC);

ALTER TABLE public.ai_token_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view token usage"
ON public.ai_token_usage_logs FOR SELECT
USING (public.user_in_org(auth.uid(), organization_id));

-- Backend inserts via service role (bypasses RLS)

-- ============================================================
-- 6. chat_mention_aliases (Phase 1)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_mention_aliases (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    alias_name          VARCHAR(80) NOT NULL,
    bound_provider_ids  JSONB NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE(organization_id, user_id, alias_name)
);

ALTER TABLE public.chat_mention_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own aliases"
ON public.chat_mention_aliases FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 7. chat_monitor_watches (Phase 4)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_monitor_watches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    doctor_name     VARCHAR(200) NOT NULL,
    provider_id     UUID,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, organization_id, doctor_name)
);

ALTER TABLE public.chat_monitor_watches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own monitors"
ON public.chat_monitor_watches FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 8. chat_monitor_alerts (Phase 4)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_monitor_alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    doctor_name     VARCHAR(200) NOT NULL,
    alert_type      VARCHAR(50) NOT NULL,
    message         TEXT NOT NULL,
    is_read         BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_monitor_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own alerts"
ON public.chat_monitor_alerts FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 9. chat_anomaly_alerts (Phase 4)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_anomaly_alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    metric          VARCHAR(50) NOT NULL,
    severity        VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
    week_start_date DATE NOT NULL,
    observed_value  DECIMAL(18,2) NOT NULL,
    baseline_mean   DECIMAL(18,2) NOT NULL,
    baseline_stdev  DECIMAL(18,2) NOT NULL,
    z_score         DECIMAL(10,4) NOT NULL,
    direction       VARCHAR(10) NOT NULL CHECK (direction IN ('up', 'down')),
    description     VARCHAR(500) NOT NULL,
    user_action     VARCHAR(20),
    actioned_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(organization_id, metric, week_start_date, direction)
);

ALTER TABLE public.chat_anomaly_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can manage anomaly alerts"
ON public.chat_anomaly_alerts FOR ALL
USING (public.user_in_org(auth.uid(), organization_id));

-- ============================================================
-- 10. chat_smart_recommendations (Phase 4)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_smart_recommendations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    recommendation_type VARCHAR(40) NOT NULL,
    title               VARCHAR(200) NOT NULL,
    body                TEXT NOT NULL,
    suggested_action    TEXT,
    user_action         VARCHAR(20),
    actioned_at         TIMESTAMPTZ,
    snooze_until        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_smart_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can manage recommendations"
ON public.chat_smart_recommendations FOR ALL
USING (public.user_in_org(auth.uid(), organization_id));

COMMIT;
