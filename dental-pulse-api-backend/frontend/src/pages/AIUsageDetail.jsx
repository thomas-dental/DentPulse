import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { api } from '../lib/api';

function formatNumber(n) {
  if (n == null) return '0';
  return Number(n).toLocaleString('en-GB');
}

function formatCurrency(n) {
  const v = Number(n) || 0;
  if (v < 0.01 && v > 0) return `£${v.toFixed(6)}`;
  return `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatRelative(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

export default function AIUsageDetail() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialRange = searchParams.get('range') || '30d';
  const initialOrg = searchParams.get('org_id') || '';
  const [range, setRange] = useState(initialRange);
  const [orgFilter, setOrgFilter] = useState(initialOrg);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.getAIUsageForUser(userId, range, orgFilter || null)
      .then((res) => setData(res))
      .catch((err) => setError(err.message || 'Failed to load usage detail'))
      .finally(() => setLoading(false));
    // Keep URL in sync so the page can be bookmarked / shared.
    const params = new URLSearchParams();
    if (range) params.set('range', range);
    if (orgFilter) params.set('org_id', orgFilter);
    setSearchParams(params, { replace: true });
  }, [userId, range, orgFilter]);

  const organizations = useMemo(() => {
    return (data?.by_organization || []).map((o) => ({ id: o.id, name: o.name }));
  }, [data]);

  const maxDailyCost = useMemo(() => {
    const days = data?.by_day || [];
    return days.reduce((m, d) => Math.max(m, Number(d.cost) || 0), 0);
  }, [data]);

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <button
            onClick={() => navigate('/ai-usage')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
              color: '#6366f1', padding: 0, marginBottom: 6, fontSize: 13,
            }}
          >
            <ArrowLeft size={14} /> Back to AI Usage
          </button>
          <h1><Sparkles size={20} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Usage history</h1>
          <p>{data?.user?.full_name || 'Loading…'} {data?.user?.email && data.user.email !== '—' ? `· ${data.user.email}` : ''}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="table-toolbar" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="per-page-select">
          <label>Period</label>
          <select value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">All time</option>
          </select>
        </div>
        {organizations.length > 1 && (
          <div className="per-page-select">
            <label>Organization</label>
            <select value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
              <option value="">All organizations</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading usage…</p>
        </div>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : (
        <>
          {/* Headline stats */}
          <div className="stats-grid" style={{ marginTop: 12 }}>
            <div className="stat-card">
              <div className="stat-icon">⚡</div>
              <div className="stat-info">
                <h3>{formatNumber(data.totals.requests)}</h3>
                <p>Requests</p>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">✨</div>
              <div className="stat-info">
                <h3>{formatNumber(data.totals.tokens)}</h3>
                <p>Total tokens · {formatNumber(data.totals.input_tokens)} in / {formatNumber(data.totals.output_tokens)} out</p>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">💷</div>
              <div className="stat-info">
                <h3>{formatCurrency(data.totals.cost)}</h3>
                <p>Estimated cost</p>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">⏱️</div>
              <div className="stat-info">
                <h3>{formatNumber(data.totals.avg_latency_ms)} ms</h3>
                <p>Avg latency · last used {formatRelative(data.totals.last_used)}</p>
              </div>
            </div>
          </div>

          {/* Daily history */}
          {(data.by_day || []).length > 0 && (
            <section style={{ marginTop: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Daily history</h2>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th style={{ textAlign: 'right' }}>Requests</th>
                      <th style={{ textAlign: 'right' }}>Tokens</th>
                      <th style={{ textAlign: 'right' }}>Cost</th>
                      <th style={{ width: '40%' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_day.slice().reverse().map((d) => {
                      const pct = maxDailyCost > 0 ? Math.max(2, Math.round((d.cost / maxDailyCost) * 100)) : 0;
                      return (
                        <tr key={d.day}>
                          <td>{formatDate(d.day)}</td>
                          <td style={{ textAlign: 'right' }}>{formatNumber(d.requests)}</td>
                          <td style={{ textAlign: 'right' }}>{formatNumber(d.tokens)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(d.cost)}</td>
                          <td>
                            <div style={{ background: '#e0e7ff', height: 8, borderRadius: 4, overflow: 'hidden' }}>
                              <div style={{ background: '#6366f1', height: '100%', width: `${pct}%` }} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Breakdowns */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 24 }}>
            <BreakdownTable title="By model" rows={data.by_model || []} />
            <BreakdownTable title="By feature" rows={data.by_feature || []} />
          </div>

          {(data.by_organization || []).length > 1 && (
            <section style={{ marginTop: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>By organization</h2>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Organization</th>
                      <th style={{ textAlign: 'right' }}>Requests</th>
                      <th style={{ textAlign: 'right' }}>Tokens</th>
                      <th style={{ textAlign: 'right' }}>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_organization.map((o) => (
                      <tr key={o.id}>
                        <td>{o.name}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(o.requests)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(o.tokens)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(o.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Recent log */}
          <section style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Recent requests {data.recent?.length === 100 ? '(latest 100)' : ''}</h2>
            {(!data.recent || data.recent.length === 0) ? (
              <div className="empty-state">No requests in this period.</div>
            ) : (
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Organization</th>
                      <th>Feature</th>
                      <th>Model</th>
                      <th style={{ textAlign: 'right' }}>Input</th>
                      <th style={{ textAlign: 'right' }}>Output</th>
                      <th style={{ textAlign: 'right' }}>Cost</th>
                      <th style={{ textAlign: 'right' }}>Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((r) => (
                      <tr key={r.id}>
                        <td className="date-cell" title={formatDateTime(r.created_at)}>{formatRelative(r.created_at)}</td>
                        <td>{r.organization_name}</td>
                        <td><code style={{ fontSize: 11, background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>{r.feature}</code></td>
                        <td><code style={{ fontSize: 11, background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>{r.model}</code></td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(r.input_tokens)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(r.output_tokens)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(r.cost)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(r.latency_ms)} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function BreakdownTable({ title, rows }) {
  const maxCost = rows.reduce((m, r) => Math.max(m, Number(r.cost) || 0), 0);
  return (
    <section>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{title}</h2>
      {rows.length === 0 ? (
        <div className="empty-state">No data.</div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>{title.replace('By ', '')}</th>
                <th style={{ textAlign: 'right' }}>Requests</th>
                <th style={{ textAlign: 'right' }}>Tokens</th>
                <th style={{ textAlign: 'right' }}>Cost</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct = maxCost > 0 ? Math.max(2, Math.round((r.cost / maxCost) * 100)) : 0;
                return (
                  <tr key={r.name}>
                    <td><code style={{ fontSize: 11, background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>{r.name}</code></td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(r.requests)}</td>
                    <td style={{ textAlign: 'right' }}>{formatNumber(r.tokens)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(r.cost)}</td>
                    <td>
                      <div style={{ background: '#e0e7ff', height: 6, borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ background: '#6366f1', height: '100%', width: `${pct}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
