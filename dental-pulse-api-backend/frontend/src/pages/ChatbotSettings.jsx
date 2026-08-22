import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { toast } from 'sonner';

const V2_FEATURE_FLAGS = [
  { key: 'feature_at_mentions', label: '@-Mentions (providers, periods, pages)', phase: 'Phase 1' },
  { key: 'feature_pdf_reports', label: 'PDF Reports from chat', phase: 'Phase 1' },
  { key: 'feature_email_reports', label: 'Email Reports from chat', phase: 'Phase 1' },
  { key: 'feature_inline_charts', label: 'Inline Charts in bubbles', phase: 'Phase 3' },
  { key: 'feature_forecasting', label: 'Forecasting (linear regression)', phase: 'Phase 3' },
  { key: 'feature_briefing', label: 'Daily Briefing card', phase: 'Phase 4' },
  { key: 'feature_anomaly_alerts', label: 'Anomaly Alerts', phase: 'Phase 4' },
  { key: 'feature_recommendations', label: 'Smart Recommendations', phase: 'Phase 4' },
  { key: 'feature_monitors', label: 'Provider Monitors', phase: 'Phase 4' },
];

const V1_MODELS = [
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'google/gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
];

const V2_INTENT_MODELS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (cheapest)' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (balanced)' },
];

const V2_FORMAT_MODELS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (cheapest)' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (balanced)' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6 (most capable)' },
];

export default function ChatbotSettings() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    try {
      setLoading(true);
      const data = await api.getChatbotVersion();
      setConfig(data);
    } catch (err) {
      toast.error('Failed to load chatbot settings: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleVersionSwitch(version) {
    if (config.active_version === version) return;
    setSwitching(true);
    try {
      const data = await api.saveChatbotVersion({ active_version: version });
      setConfig(data);
      toast.success(`Switched to ${version.toUpperCase()} successfully`);
    } catch (err) {
      toast.error('Failed to switch version: ' + err.message);
    } finally {
      setSwitching(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const data = await api.saveChatbotVersion(config);
      setConfig(data);
      toast.success('Chatbot settings saved');
    } catch (err) {
      toast.error('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  function updateConfig(key, value) {
    setConfig(prev => ({ ...prev, [key]: value }));
  }

  if (loading) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1>Chatbot Settings</h1>
        </div>
        <div className="loading-spinner">Loading...</div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1>Chatbot Settings</h1>
        </div>
        <div className="error-message">Failed to load chatbot configuration. Please try refreshing.</div>
      </div>
    );
  }

  const isV1Active = config.active_version === 'v1';
  const isV2Active = config.active_version === 'v2';

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Chatbot Settings</h1>
        <p className="page-subtitle">Control which chatbot version is active and configure features</p>
      </div>

      {/* Version Switch Cards */}
      <div className="chatbot-section">
        <h2 className="section-title">Active Version</h2>
        <div className="version-cards">
          {/* V1 Card */}
          <div className={`version-card ${isV1Active ? 'active' : ''}`}>
            <div className="version-card-header">
              <span className="version-badge v1">V1</span>
              <h3>Basic</h3>
              {isV1Active && <span className="active-indicator">Active</span>}
            </div>
            <div className="version-card-provider">Gemini Flash</div>
            <ul className="version-features">
              <li>Plain text responses</li>
              <li>Context-aware (page data)</li>
              <li>Streaming responses</li>
              <li>Role-based prompts</li>
              <li className="feature-missing">No data fetching</li>
              <li className="feature-missing">No charts</li>
              <li className="feature-missing">No @-mentions</li>
            </ul>
            {!isV1Active && (
              <button
                className="version-activate-btn"
                onClick={() => handleVersionSwitch('v1')}
                disabled={switching}
              >
                {switching ? 'Switching...' : 'Activate V1'}
              </button>
            )}
          </div>

          {/* V2 Card */}
          <div className={`version-card ${isV2Active ? 'active' : ''}`}>
            <div className="version-card-header">
              <span className="version-badge v2">V2</span>
              <h3>Advanced</h3>
              {isV2Active && <span className="active-indicator">Active</span>}
            </div>
            <div className="version-card-provider">Claude Tool-Use</div>
            <ul className="version-features">
              <li>Markdown + tables</li>
              <li>Data from Supabase RPCs</li>
              <li>Tool-use pipeline (no hallucination)</li>
              <li>Conversation persistence</li>
              <li>Inline charts</li>
              <li>@-mentions</li>
              <li>PDF/email reports</li>
              <li>Anomaly alerts & forecasting</li>
            </ul>
            {!isV2Active && (
              <button
                className="version-activate-btn v2-btn"
                onClick={() => handleVersionSwitch('v2')}
                disabled={switching}
              >
                {switching ? 'Switching...' : 'Activate V2'}
              </button>
            )}
          </div>
        </div>

        {/* Status line */}
        <div className="version-status">
          <span className={`status-dot ${isV2Active ? 'v2' : 'v1'}`} />
          <span>
            {config.active_version.toUpperCase()} active since{' '}
            {config.switched_at ? new Date(config.switched_at).toLocaleString() : 'initial setup'}
          </span>
        </div>
      </div>

      {/* V2 Feature Flags */}
      <div className="chatbot-section">
        <h2 className="section-title">V2 Feature Flags</h2>
        <p className="section-description">
          Toggle features ON/OFF within V2. Turn features on as each phase is completed.
          {isV1Active && <span className="text-warning"> (These only apply when V2 is active)</span>}
        </p>
        <div className="feature-flags-grid">
          {V2_FEATURE_FLAGS.map(flag => (
            <label key={flag.key} className="feature-flag-row">
              <input
                type="checkbox"
                checked={config[flag.key] || false}
                onChange={(e) => updateConfig(flag.key, e.target.checked)}
                disabled={isV1Active}
              />
              <span className="feature-label">{flag.label}</span>
              <span className="feature-phase">{flag.phase}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Model Configuration */}
      <div className="chatbot-section">
        <h2 className="section-title">Model Configuration</h2>
        <div className="model-config-grid">
          {/* V1 Model */}
          <div className="model-field">
            <label>V1 Model</label>
            <select
              value={config.v1_model || 'google/gemini-2.5-flash'}
              onChange={(e) => updateConfig('v1_model', e.target.value)}
            >
              {V1_MODELS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* V2 Intent Model */}
          <div className="model-field">
            <label>V2 Intent Model <span className="model-hint">(fast/cheap — picks the tool)</span></label>
            <select
              value={config.v2_intent_model || 'claude-haiku-4-5-20251001'}
              onChange={(e) => updateConfig('v2_intent_model', e.target.value)}
            >
              {V2_INTENT_MODELS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* V2 Format Model */}
          <div className="model-field">
            <label>V2 Format Model <span className="model-hint">(quality — formats the response)</span></label>
            <select
              value={config.v2_format_model || 'claude-sonnet-4-6'}
              onChange={(e) => updateConfig('v2_format_model', e.target.value)}
            >
              {V2_FORMAT_MODELS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Local Classifier Toggle */}
          <div className="model-field">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.v2_local_classifier_enabled !== false}
                onChange={(e) => updateConfig('v2_local_classifier_enabled', e.target.checked)}
              />
              Local Classifier (regex fast-path, saves tokens)
            </label>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="chatbot-actions">
        <button
          className="save-btn"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
