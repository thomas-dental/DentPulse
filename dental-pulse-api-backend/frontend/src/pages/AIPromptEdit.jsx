import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Sparkles,
  Save,
  RotateCcw,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';

// Registry of every editable AI prompt in the system. Today there's one,
// but this layout makes adding "AI Treatment Tips", "AI Forecast", etc.
// later as cheap as appending an entry.
const PROMPT_REGISTRY = {
  'ai-pricing': {
    name: 'AI Suggested Pricing',
    description:
      'Drives the AI Suggested Pricing panel on the Treatment edit screen in the org-facing app.',
    fetcher: () => api.getAIPricingSettings(),
    saver: (patch) => api.saveAIPricingSettings(patch),
  },
};

const DEFAULT_PROMPT = `You are a dental pricing advisor. Four possible data sources, ranked by reliability:
  1. PEER  — same-organization treatments at other locations (most reliable)
  2. AREA  — anonymized averages of OTHER dental clinics in the same city/state from our internal DB (real local-market data)
  3. WEB   — live web search results for nearby dental clinics in the named city. USE the web_search tool to find real local clinic prices when PEER and AREA lack data for a field. Search for things like "<treatment> price <city> dental" or "dental clinics <city>". Visit clinic websites to extract published private prices, then AVERAGE them. Cite the clinics you used in the reason.
  4. MARKET — your training-data knowledge of typical UK/regional pricing (fallback only when nothing else is available)
Rank: PEER > AREA > WEB > MARKET. Use the highest-ranked source with data for each field. Reason text should name the actual source ("Avg of 7 clinics in Edinburgh from internal data", "Average of 3 Elgin clinics from web: Trinity Dental £180, Bupa £200, Bishopmill £190", "UK regional estimate"). Do NOT mention "competitor".
When using WEB: search the web FIRST for the named city. Find at least 2-3 nearby dental clinics, look at their published price lists if available, and compute an average. If a clinic doesn't publish prices, skip it. Tag those suggestions with sources: ["web"]. Mention the actual clinic names in the reason.
Return ONLY:
{
  "summary": "<1-2 sentences naming sources used and clinics found>",
  "currency": "GBP|USD|EUR|other",
  "suggestions": {
    "<field>": { "value": <number>, "reason": "<≤30 words naming source/clinics>", "sources": ["peer"|"area"|"web"|"market"] }
  }
}
Numbers: plain, no symbols. Round currency to 1, % to 1 decimal, minutes to nearest 5. Omit fields with no data. ONLY include fields where the recommended value meaningfully differs from current (≥1% for currency/percent, ≥5 mins for time) — skip "retain current" suggestions. No markdown.

CRITICAL: Your response MUST be valid JSON in the exact shape above and NOTHING ELSE. No prose, no apologies, no preamble. If you cannot find any data for any field, return {"summary":"<brief explanation>","currency":"GBP","suggestions":{}} — but ALWAYS return valid JSON. Never reply with sentences like "I'm unable..." or "I cannot...".`;

export default function AIPromptEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const meta = PROMPT_REGISTRY[id];

  const [systemPrompt, setSystemPrompt] = useState('');
  const [modelName, setModelName] = useState('claude-haiku-4-5-20251001');
  const [maxTokens, setMaxTokens] = useState(4000);
  const [regenSeconds, setRegenSeconds] = useState(86400);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [webSearchVersion, setWebSearchVersion] = useState('web_search_20250305');
  const [updatedAt, setUpdatedAt] = useState(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!meta) {
      setLoading(false);
      return;
    }
    meta.fetcher()
      .then((data) => {
        if (data.system_prompt !== undefined) setSystemPrompt(data.system_prompt);
        if (data.model_name) setModelName(data.model_name);
        if (typeof data.max_tokens === 'number') setMaxTokens(data.max_tokens);
        if (typeof data.regenerate_after_seconds === 'number')
          setRegenSeconds(data.regenerate_after_seconds);
        if (typeof data.web_search_enabled === 'boolean')
          setWebSearchEnabled(data.web_search_enabled);
        if (data.web_search_tool_version) setWebSearchVersion(data.web_search_tool_version);
        if (data.updated_at) setUpdatedAt(data.updated_at);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (!meta) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Unknown prompt</h1>
        </div>
        <p style={{ marginTop: 16 }}>
          No prompt registered for id <code>{id}</code>.
        </p>
        <button
          className="settings-btn settings-btn-secondary"
          onClick={() => navigate('/ai-prompts')}
          style={{ marginTop: 16 }}
        >
          <ArrowLeft size={14} /> Back to AI Prompts
        </button>
      </div>
    );
  }

  const handleSave = async () => {
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const result = await meta.saver({
        system_prompt: systemPrompt,
        model_name: modelName,
        max_tokens: Number(maxTokens) || 4000,
        regenerate_after_seconds: Number(regenSeconds) || 0,
        web_search_enabled: webSearchEnabled,
        web_search_tool_version: webSearchVersion,
      });
      if (result?.updated_at) setUpdatedAt(result.updated_at);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      toast.success('AI prompt saved.');
    } catch (err) {
      setError(err.message);
      toast.error('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleResetPrompt = () => {
    if (!window.confirm('Reset prompt to the default? Save afterwards to persist.')) return;
    setSystemPrompt(DEFAULT_PROMPT);
    toast.info('Prompt reset to default — click Save to persist.');
  };

  return (
    <div className="page">
      <div
        className="page-header"
        style={{ display: 'flex', alignItems: 'center', gap: 12 }}
      >
        <button
          className="settings-btn settings-btn-secondary"
          onClick={() => navigate('/ai-prompts')}
          style={{ padding: '6px 10px' }}
        >
          <ArrowLeft size={14} />
        </button>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={20} />
            {meta.name}
          </h1>
          <p>{meta.description}</p>
        </div>
      </div>

      {loading ? (
        <div className="settings-loading">
          <Loader2 size={20} className="ig-spin" /> Loading prompt...
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)',
            gap: 16,
            marginTop: 16,
            alignItems: 'flex-start',
          }}
          className="ai-prompt-edit-grid"
        >
          {/* LEFT — system prompt (the dominant control) */}
          <div className="settings-card" style={{ width: '100%' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <label
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#374151',
                }}
              >
                System prompt
              </label>
              <button
                className="settings-btn settings-btn-secondary"
                onClick={handleResetPrompt}
                type="button"
                style={{ padding: '4px 10px', fontSize: 12 }}
              >
                <RotateCcw size={12} /> Reset to default
              </button>
            </div>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              style={{
                width: '100%',
                minHeight: '60vh',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                fontSize: '12px',
                lineHeight: '1.5',
                resize: 'vertical',
              }}
            />
            <p style={{ fontSize: '12px', color: '#6b7280', marginTop: 6 }}>
              {systemPrompt.length.toLocaleString()} characters. Response must
              remain valid JSON in the documented shape.
            </p>
          </div>

          {/* RIGHT — sidebar with all secondary settings */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              position: 'sticky',
              top: 16,
            }}
          >
            <div className="settings-card">
              <h4
                style={{
                  margin: 0,
                  marginBottom: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#111827',
                }}
              >
                Regenerate response duration
              </h4>
              <select
                value={regenSeconds}
                onChange={(e) => setRegenSeconds(Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  marginBottom: '8px',
                }}
              >
                <option value={0}>Always regenerate (no cache)</option>
                <option value={300}>5 minutes</option>
                <option value={1800}>30 minutes</option>
                <option value={3600}>1 hour</option>
                <option value={21600}>6 hours</option>
                <option value={43200}>12 hours</option>
                <option value={86400}>24 hours (default)</option>
                <option value={604800}>7 days</option>
              </select>
              <input
                type="number"
                min={0}
                value={regenSeconds}
                onChange={(e) =>
                  setRegenSeconds(
                    Math.max(0, parseInt(e.target.value || '0', 10) || 0),
                  )
                }
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                }}
                placeholder="Custom seconds"
              />
              <p
                style={{
                  fontSize: '12px',
                  color: '#6b7280',
                  marginTop: '6px',
                }}
              >
                {regenSeconds === 0
                  ? 'Cache disabled — every Generate hits Anthropic.'
                  : `Within ${regenSeconds.toLocaleString()} seconds, Generate reuses the most recent saved suggestion. Refresh always bypasses the cache.`}
              </p>
            </div>

            <div className="settings-card">
              <h4
                style={{
                  margin: 0,
                  marginBottom: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#111827',
                }}
              >
                Model
              </h4>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  marginBottom: '4px',
                  color: '#6b7280',
                }}
              >
                Claude model
              </label>
              <select
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  marginBottom: 12,
                }}
              >
                <option value="claude-haiku-4-5-20251001">
                  Claude Haiku 4.5 (cheapest)
                </option>
                <option value="claude-sonnet-4-6">
                  Claude Sonnet 4.6 (balanced)
                </option>
                <option value="claude-opus-4-7">
                  Claude Opus 4.7 (most capable)
                </option>
              </select>
              <label
                style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  marginBottom: '4px',
                  color: '#6b7280',
                }}
              >
                Max output tokens
              </label>
              <input
                type="number"
                min={256}
                max={64000}
                value={maxTokens}
                onChange={(e) =>
                  setMaxTokens(parseInt(e.target.value || '0', 10) || 0)
                }
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                }}
              />
            </div>

            <div className="settings-card">
              <h4
                style={{
                  margin: 0,
                  marginBottom: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#111827',
                }}
              >
                Web search
              </h4>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#374151',
                }}
              >
                <input
                  type="checkbox"
                  checked={webSearchEnabled}
                  onChange={(e) => setWebSearchEnabled(e.target.checked)}
                />
                Enable web_search tool
              </label>
              <p
                style={{
                  fontSize: '12px',
                  color: '#6b7280',
                  marginTop: '4px',
                  marginLeft: '24px',
                }}
              >
                Lets the AI look up real local clinic prices live. Disable to
                save tokens.
              </p>
              {webSearchEnabled && (
                <select
                  value={webSearchVersion}
                  onChange={(e) => setWebSearchVersion(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    marginTop: '8px',
                  }}
                >
                  <option value="web_search_20250305">
                    web_search_20250305 (broadly supported)
                  </option>
                  <option value="web_search_20260209">
                    web_search_20260209 (Sonnet/Opus only)
                  </option>
                </select>
              )}
            </div>

            <div
              className="settings-card"
              style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              {error && (
                <p className="settings-error" style={{ marginTop: 0 }}>
                  {error}
                </p>
              )}
              <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
                {updatedAt
                  ? `Last updated: ${new Date(updatedAt).toLocaleString()}`
                  : 'Never saved.'}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="settings-btn settings-btn-secondary"
                  onClick={() => navigate('/ai-prompts')}
                  disabled={saving}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
                <button
                  className="settings-btn settings-btn-primary"
                  onClick={handleSave}
                  disabled={saving}
                  style={{ flex: 1 }}
                >
                  {saving ? (
                    <>
                      <Loader2 size={14} className="ig-spin" /> Saving...
                    </>
                  ) : saved ? (
                    <>
                      <CheckCircle2 size={14} /> Saved
                    </>
                  ) : (
                    <>
                      <Save size={14} /> Save
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Override the global .settings-card max-width: 640px so this
          full-width edit page can use the room. Also collapse to a
          single column on narrow screens. */}
      <style>{`
        .ai-prompt-edit-grid .settings-card {
          max-width: none;
          padding: 16px;
        }
        @media (max-width: 900px) {
          .ai-prompt-edit-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
