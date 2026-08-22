import { useState, useEffect, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Loader2, Sparkles, AlertCircle } from 'lucide-react';
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
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export default function AIUsage() {
  const navigate = useNavigate();
  const [range, setRange] = useState('30d');
  const [orgFilter, setOrgFilter] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.getAIUsage(range, orgFilter || null, includeDeleted)
      .then((res) => setData(res))
      .catch((err) => setError(err.message || 'Failed to load AI usage'))
      .finally(() => setLoading(false));
  }, [range, orgFilter, includeDeleted]);

  // Distinct organization list (drawn from the rows) for the org filter.
  const organizations = useMemo(() => {
    if (!data?.rows) return [];
    const seen = new Map();
    data.rows.forEach((r) => {
      if (r.organization_id && !seen.has(r.organization_id)) {
        seen.set(r.organization_id, r.organization_name || '—');
      }
    });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const filtered = useMemo(() => {
    const rows = data?.rows || [];
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      (r.full_name || '').toLowerCase().includes(term) ||
      (r.email || '').toLowerCase().includes(term) ||
      (r.organization_name || '').toLowerCase().includes(term)
    );
  }, [data, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  useEffect(() => { setPage(1); }, [search, perPage, range, orgFilter]);

  const toggleExpanded = (key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const totals = data?.totals || { requests: 0, tokens: 0, cost: 0, active_users: 0 };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1><Sparkles size={20} style={{ verticalAlign: 'middle', marginRight: 6 }} /> AI Token Usage</h1>
          <p>Per-user consumption of the DentPulse AI chatbot and AI summaries.</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="table-toolbar" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search user, email, organization..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="per-page-select">
          <label>Period</label>
          <select value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">All time</option>
          </select>
        </div>
        <div className="per-page-select">
          <label>Organization</label>
          <select value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
            <option value="">All organizations</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <div className="per-page-select">
          <label>Show</label>
          <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <label>entries</label>
        </div>
        <label className="per-page-select" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(e) => setIncludeDeleted(e.target.checked)}
          />
          <span>Include unattributed usage</span>
        </label>
      </div>

      {/* Headline stats */}
      <div className="stats-grid" style={{ marginTop: 12 }}>
        <div className="stat-card">
          <div className="stat-icon">👥</div>
          <div className="stat-info">
            <h3>{formatNumber(totals.active_users)}</h3>
            <p>Active users</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">⚡</div>
          <div className="stat-info">
            <h3>{formatNumber(totals.requests)}</h3>
            <p>Requests</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">✨</div>
          <div className="stat-info">
            <h3>{formatNumber(totals.tokens)}</h3>
            <p>Total tokens</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">💷</div>
          <div className="stat-info">
            <h3>{formatCurrency(totals.cost)}</h3>
            <p>Estimated cost</p>
          </div>
        </div>
      </div>

      {/* Unattributed-usage banner (rows logged before a user id was recorded) */}
      {!loading && !includeDeleted && data?.orphaned?.requests > 0 && (
        <div style={{
          marginTop: 12,
          padding: '10px 14px',
          background: '#fef3c7',
          border: '1px solid #fcd34d',
          borderRadius: 8,
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          fontSize: 13,
          color: '#78350f',
        }}>
          <AlertCircle size={16} />
          <span style={{ flex: 1 }}>
            Not shown: <strong>{formatNumber(data.orphaned.requests)}</strong> requests / <strong>{formatNumber(data.orphaned.tokens)}</strong> tokens / <strong>{formatCurrency(data.orphaned.cost)}</strong> of unattributed usage — logged before a user id was recorded (not deleted accounts). New usage is attributed correctly.
          </span>
          <button
            onClick={() => setIncludeDeleted(true)}
            style={{
              background: '#92400e',
              color: '#fffbeb',
              border: 'none',
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Show them
          </button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading AI usage...</p>
        </div>
      ) : error ? (
        <div className="empty-state">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">No AI usage recorded for this period.</div>
      ) : (
        <>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th>User</th>
                  <th>Organization</th>
                  <th style={{ textAlign: 'right' }}>Requests</th>
                  <th style={{ textAlign: 'right' }}>Input</th>
                  <th style={{ textAlign: 'right' }}>Output</th>
                  <th style={{ textAlign: 'right' }}>Total tokens</th>
                  <th style={{ textAlign: 'right' }}>Cost</th>
                  <th style={{ textAlign: 'right' }}>Last used</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((row) => {
                  const key = `${row.user_id || '__orphan__'}::${row.organization_id || ''}`;
                  const isOpen = expanded.has(key);
                  const canOpenDetail = !!row.user_id && !row.deleted;
                  return (
                    <Fragment key={key}>
                      <tr
                        style={{ cursor: canOpenDetail ? 'pointer' : 'default' }}
                        onClick={() => {
                          if (canOpenDetail) {
                            navigate(`/ai-usage/${row.user_id}?range=${range}${row.organization_id ? `&org_id=${row.organization_id}` : ''}`);
                          } else {
                            toggleExpanded(key);
                          }
                        }}
                        title={canOpenDetail ? 'View usage history' : ''}
                      >
                        <td onClick={(e) => { e.stopPropagation(); toggleExpanded(key); }} style={{ cursor: 'pointer' }}>
                          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </td>
                        <td>
                          <div className="user-cell">
                            <div className="user-cell-avatar">
                              {(row.full_name || row.email || '?').charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="user-cell-name">
                                {row.full_name}
                                {row.deleted && (
                                  <span style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#fee2e2', color: '#991b1b' }}>
                                    deleted
                                  </span>
                                )}
                                {row.unattributed && (
                                  <span
                                    title="Usage logged before a user id was recorded, with no org owner to attribute it to. New usage is attributed correctly."
                                    style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#f3f4f6', color: '#6b7280' }}
                                  >
                                    unattributed
                                  </span>
                                )}
                                {row.via_owner && (
                                  <span
                                    title="Older unstamped usage for this organization, attributed to its AI key holder (owner)."
                                    style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#eef2ff', color: '#4338ca' }}
                                  >
                                    via owner key
                                  </span>
                                )}
                              </div>
                              <div className="text-muted" style={{ fontSize: '0.8em' }}>{row.email}</div>
                            </div>
                          </div>
                        </td>
                        <td>{row.organization_name}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.requests)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.input_tokens)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(row.output_tokens)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatNumber(row.total_tokens)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(row.cost)}</td>
                        <td style={{ textAlign: 'right' }} className="date-cell">{formatRelative(row.last_used)}</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td></td>
                          <td colSpan={8} style={{ background: 'var(--muted, #f5f5f7)', padding: '12px 16px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                              <BreakdownList title="By model" entries={row.by_model} />
                              <BreakdownList title="By feature" entries={row.by_feature} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="table-footer">
            <div className="table-info">
              Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, filtered.length)} of {filtered.length} entries
              {search && data?.rows && ` (filtered from ${data.rows.length} total)`}
            </div>
            <div className="pagination">
              <button className="pagination-btn" disabled={page === 1} onClick={() => setPage(1)}>«</button>
              <button className="pagination-btn" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹</button>
              <button className="pagination-btn active">{page}</button>
              <button className="pagination-btn" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>›</button>
              <button className="pagination-btn" disabled={page === totalPages} onClick={() => setPage(totalPages)}>»</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function BreakdownList({ title, entries }) {
  const rows = Object.entries(entries || {}).sort((a, b) => b[1].cost - a[1].cost);
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280', marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map(([name, v]) => (
          <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 4, padding: '1px 6px' }}>
                {name}
              </span>
              <span className="text-muted" style={{ fontSize: 11 }}>{formatNumber(v.requests)} req · {formatNumber(v.tokens)} tok</span>
            </div>
            <span style={{ fontWeight: 600 }}>{formatCurrency(v.cost)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
