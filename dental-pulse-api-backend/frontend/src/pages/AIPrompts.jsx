import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Pencil, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

// Registry of every editable AI prompt. Adding a new one is one entry here
// + a matching backend route + a registry entry in AIPromptEdit.jsx.
const PROMPTS = [
  {
    id: 'ai-pricing',
    name: 'AI Suggested Pricing',
    description:
      "Powers the AI Suggested Pricing panel on the Treatment edit screen in the org-facing app. Edit the prompt, change the Claude model, set how often suggestions regenerate, and toggle the web_search tool.",
    fetcher: () => api.getAIPricingSettings(),
  },
];

function formatRelative(iso) {
  if (!iso) return 'Never edited';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Never edited';
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function AIPrompts() {
  const navigate = useNavigate();
  const [meta, setMeta] = useState({}); // { [id]: { updated_at, model_name, regenerate_after_seconds } }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      PROMPTS.map(async (p) => {
        try {
          const data = await p.fetcher();
          return [
            p.id,
            {
              updated_at: data?.updated_at ?? null,
              model_name: data?.model_name ?? null,
              regenerate_after_seconds:
                typeof data?.regenerate_after_seconds === 'number'
                  ? data.regenerate_after_seconds
                  : null,
              web_search_enabled: !!data?.web_search_enabled,
            },
          ];
        } catch {
          return [p.id, {}];
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setMeta(Object.fromEntries(entries));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={20} />
          AI Prompts
        </h1>
        <p>
          System-wide AI prompts. Edit the system prompt, model, and regenerate
          duration for each. Per-org overrides (when present) win over these
          defaults in the org-facing app.
        </p>
      </div>

      {loading ? (
        <div className="settings-loading" style={{ marginTop: 16 }}>
          <Loader2 size={20} className="ig-spin" /> Loading prompts...
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            marginTop: 16,
          }}
        >
          {PROMPTS.map((p) => {
            const m = meta[p.id] || {};
            return (
              <div
                key={p.id}
                className="settings-card"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 16,
                  padding: 16,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3
                    style={{
                      margin: 0,
                      fontSize: 16,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Sparkles size={16} />
                    {p.name}
                  </h3>
                  <p
                    style={{
                      fontSize: 13,
                      color: '#4b5563',
                      marginTop: 6,
                      marginBottom: 10,
                    }}
                  >
                    {p.description}
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      gap: 12,
                      flexWrap: 'wrap',
                      fontSize: 12,
                      color: '#6b7280',
                    }}
                  >
                    {m.model_name && (
                      <span>
                        <strong>Model:</strong> {m.model_name}
                      </span>
                    )}
                    {typeof m.regenerate_after_seconds === 'number' && (
                      <span>
                        <strong>Regenerate after:</strong>{' '}
                        {m.regenerate_after_seconds === 0
                          ? 'always'
                          : `${m.regenerate_after_seconds.toLocaleString()}s`}
                      </span>
                    )}
                    <span>
                      <strong>Web search:</strong>{' '}
                      {m.web_search_enabled ? 'on' : 'off'}
                    </span>
                    <span>
                      <strong>Last edited:</strong> {formatRelative(m.updated_at)}
                    </span>
                  </div>
                </div>
                <button
                  className="settings-btn settings-btn-primary"
                  onClick={() => navigate(`/ai-prompts/${p.id}`)}
                  style={{ flexShrink: 0 }}
                >
                  <Pencil size={14} /> Edit
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
