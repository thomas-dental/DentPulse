import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, KeyRound } from 'lucide-react';
import { Select } from 'antd';
import { toast } from 'sonner';
import { api } from '../lib/api';
import UserAiKeyModal from './UserAiKeyModal';

// Mirrors dental-pulse-dev's PLAN_LABELS/PLAN_TIERS (src/lib/planRegistry.ts).
// This admin app is now the only place plan_tier can be changed from.
const PLAN_TIER_OPTIONS = [
  { value: 'basic', label: 'Basic' },
  { value: 'essential', label: 'Essential' },
  { value: 'growth', label: 'Growth' },
  { value: 'accelerate', label: 'Accelerate' },
];
const PLAN_TIER_LABELS = Object.fromEntries(PLAN_TIER_OPTIONS.map((o) => [o.value, o.label]));

export default function Organizations() {
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [keyModalOwner, setKeyModalOwner] = useState(null);
  const [updatingPlanId, setUpdatingPlanId] = useState(null);
  const navigate = useNavigate();

  const fetchOrganizations = useCallback(() => {
    return api.getOrganizations()
      .then((data) => setOrganizations(data))
      .catch(() => setOrganizations([]));
  }, []);

  const handlePlanChange = async (org, planTier) => {
    if (planTier === org.plan_tier) return;
    setUpdatingPlanId(org.id);
    try {
      await api.updateOrganizationPlan(org.id, planTier);
      setOrganizations((prev) => prev.map((o) => (o.id === org.id ? { ...o, plan_tier: planTier } : o)));
      toast.success(`${org.name || 'Organization'} switched to ${PLAN_TIER_LABELS[planTier]}.`);
    } catch (err) {
      toast.error('Failed to update plan: ' + err.message);
    } finally {
      setUpdatingPlanId(null);
    }
  };

  useEffect(() => {
    fetchOrganizations().finally(() => setLoading(false));
  }, [fetchOrganizations]);

  const getAdmin = (org) => {
    return org.users?.find((u) => u.role === 'owner') || org.users?.find((u) => u.role === 'admin') || org.users?.[0] || null;
  };

  // The org's AI key lives on its owner's user_ai_keys row (getOwnerKey() in
  // apiKeyService.js resolves it the same way, and every member of the org
  // falls back to it) — so managing "the organization's AI key" means
  // managing the owner's key specifically, not just any admin/first user.
  const getOwner = (org) => org.users?.find((u) => u.role === 'owner') || null;

  const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  };

  // Filter
  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    if (!term) return organizations;
    return organizations.filter((org) => {
      const name = (org.name || '').toLowerCase();
      const email = (org.email || '').toLowerCase();
      const admin = getAdmin(org);
      const adminName = (admin?.full_name || admin?.email || '').toLowerCase();
      return name.includes(term) || email.includes(term) || adminName.includes(term);
    });
  }, [organizations, search]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let valA, valB;
      if (sortKey === 'created_at') {
        valA = new Date(a.created_at || 0).getTime();
        valB = new Date(b.created_at || 0).getTime();
      } else if (sortKey === 'users_count') {
        valA = a.users?.length || 0;
        valB = b.users?.length || 0;
      } else if (sortKey === 'admin') {
        const adminA = getAdmin(a);
        const adminB = getAdmin(b);
        valA = (adminA?.full_name || adminA?.email || '').toLowerCase();
        valB = (adminB?.full_name || adminB?.email || '').toLowerCase();
      } else {
        valA = String(a[sortKey] || '').toLowerCase();
        valB = String(b[sortKey] || '').toLowerCase();
      }
      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const paginated = sorted.slice((page - 1) * perPage, page * perPage);

  useEffect(() => { setPage(1); }, [search, perPage]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const getSortIcon = (key) => {
    if (sortKey !== key) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;
    let start = Math.max(1, page - Math.floor(maxVisible / 2));
    let end = Math.min(totalPages, start + maxVisible - 1);
    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Organizations</h1>
          <p>Manage all registered organizations</p>
        </div>
      </div>

      <div className="table-toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search by name, email, admin..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
      </div>

      {loading ? (
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading organizations...</p>
        </div>
      ) : (
        <>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="sortable-th" onClick={() => handleSort('name')}>
                    Organization{getSortIcon('name')}
                  </th>
                  <th className="sortable-th" onClick={() => handleSort('admin')}>
                    Owner / Admin{getSortIcon('admin')}
                  </th>
                  <th className="sortable-th" onClick={() => handleSort('email')}>
                    Email{getSortIcon('email')}
                  </th>
                  <th className="sortable-th" onClick={() => handleSort('users_count')}>
                    Users{getSortIcon('users_count')}
                  </th>
                  <th className="sortable-th" onClick={() => handleSort('created_at')}>
                    Created{getSortIcon('created_at')}
                  </th>
                  <th>Plan</th>
                  <th>AI API Key</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="empty-state">
                      {search ? 'No organizations match your search' : 'No organizations found'}
                    </td>
                  </tr>
                ) : (
                  paginated.map((org) => {
                    const admin = getAdmin(org);
                    const owner = getOwner(org);
                    return (
                      <tr key={org.id}>
                        <td>
                          <div className="org-name-cell">
                            <div className="org-avatar">
                              {getInitials(org.name)}
                            </div>
                            <div>
                              <div className="org-name">{org.name || '—'}</div>
                              <div className="org-id">ID: {org.id?.slice(0, 8)}...</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          {admin ? (
                            <div className="admin-cell">
                              <span className="admin-name">{admin.full_name || admin.email}</span>
                              <span className="admin-email">{admin.email}</span>
                            </div>
                          ) : (
                            <span className="text-muted">No users yet</span>
                          )}
                        </td>
                        <td>
                          <span className="org-email-cell">{org.email || '—'}</span>
                        </td>
                        <td>
                          <span className="user-count-badge">
                            {org.users?.length || 0} {org.users?.length === 1 ? 'user' : 'users'}
                          </span>
                        </td>
                        <td className="date-cell">
                          {new Date(org.created_at).toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td>
                          <Select
                            size="small"
                            style={{ width: 116 }}
                            value={org.plan_tier || 'basic'}
                            loading={updatingPlanId === org.id}
                            disabled={updatingPlanId === org.id}
                            onChange={(value) => handlePlanChange(org, value)}
                            options={PLAN_TIER_OPTIONS}
                          />
                        </td>
                        <td>
                          {!owner
                            ? <span className="ai-badge none" title="No owner on this organization — add one before setting an AI key">—</span>
                            : !owner.has_ai_key
                              ? <span className="ai-badge none" title="No API key — AI features are blocked for everyone in this organization">—</span>
                              : owner.ai_enabled
                                ? <span className="ai-badge on" title="Key set and AI turned on for this organization">Enabled</span>
                                : <span className="ai-badge off" title="Key set but AI turned off">Disabled</span>}
                        </td>
                        <td>
                          <div className="action-buttons">
                            <button
                              className="btn-icon"
                              title={!owner ? 'No owner to assign a key to' : owner.has_ai_key ? 'Edit AI API key' : 'Add AI API key'}
                              onClick={() => owner && setKeyModalOwner(owner)}
                              disabled={!owner}
                            >
                              <KeyRound size={16} />
                            </button>
                            <button
                              className="btn-icon btn-icon-view"
                              title="View organization"
                              onClick={() => navigate(`/organizations/${org.id}`)}
                            >
                              <Eye size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {sorted.length > 0 && (
            <div className="table-footer">
              <div className="table-info">
                Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, sorted.length)} of {sorted.length} entries
                {search && ` (filtered from ${organizations.length} total)`}
              </div>
              <div className="pagination">
                <button className="pagination-btn" disabled={page === 1} onClick={() => setPage(1)}>«</button>
                <button className="pagination-btn" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹</button>
                {getPageNumbers().map((p) => (
                  <button
                    key={p}
                    className={`pagination-btn ${p === page ? 'active' : ''}`}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </button>
                ))}
                <button className="pagination-btn" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>›</button>
                <button className="pagination-btn" disabled={page === totalPages} onClick={() => setPage(totalPages)}>»</button>
              </div>
            </div>
          )}
        </>
      )}

      {keyModalOwner && (
        <UserAiKeyModal
          user={keyModalOwner}
          onClose={() => setKeyModalOwner(null)}
          onSaved={(opts) => { if (!opts?.keepOpen) setKeyModalOwner(null); fetchOrganizations(); }}
        />
      )}
    </div>
  );
}
