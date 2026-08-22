import { useState, useEffect, useMemo, Fragment } from 'react';
import { Trash2, Loader2, ChevronRight, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [expanded, setExpanded] = useState(() => new Set());

  const fetchUsers = () => {
    setLoading(true);
    api.getUsers()
      .then((data) => setUsers(data))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleDelete = (id, name) => {
    toast(`Delete "${name}"? This action cannot be undone.`, {
      action: {
        label: 'Yes, delete',
        onClick: async () => {
          setDeletingId(id);
          try {
            await api.deleteUser(id);
            toast.success(`${name} has been deleted.`);
            fetchUsers();
          } catch (err) {
            toast.error('Failed to delete user: ' + err.message);
          } finally {
            setDeletingId(null);
          }
        },
      },
      cancel: { label: 'Cancel' },
    });
  };

  const toggleExpand = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const matchesTerm = (u, term) =>
    (u.full_name || '').toLowerCase().includes(term) ||
    (u.email || '').toLowerCase().includes(term) ||
    (u.organization_name || '').toLowerCase().includes(term) ||
    (u.role || '').toLowerCase().includes(term);

  // Group into owner-led rows: each OWNER is a top-level row and the other users
  // in that owner's organization are nested members. Users whose org has no
  // owner (or who have no org) surface as their own top-level row so none are
  // hidden.
  const groups = useMemo(() => {
    const owners = users.filter((u) => u.role === 'owner');
    const others = users.filter((u) => u.role !== 'owner');

    const membersByOrg = new Map();
    for (const u of others) {
      const oid = u.current_organization_id;
      if (!oid) continue;
      if (!membersByOrg.has(oid)) membersByOrg.set(oid, []);
      membersByOrg.get(oid).push(u);
    }

    const claimed = new Set();
    const top = [];
    for (const owner of owners) {
      const oid = owner.current_organization_id;
      let members = [];
      if (oid && !claimed.has(oid)) {
        members = membersByOrg.get(oid) || [];
        claimed.add(oid);
      }
      top.push({ head: owner, members });
    }
    // Non-owners whose org exists but has no owner in the list still surface at
    // the top level so real-org members aren't hidden. Users with NO
    // organization are not displayed — there is no owner to nest them under.
    for (const u of others) {
      const oid = u.current_organization_id;
      if (!oid) continue;              // no organization → not shown
      if (claimed.has(oid)) continue;  // already nested under its owner
      top.push({ head: u, members: [] });
    }
    return top;
  }, [users]);

  // A group shows if its head matches the search, or any of its members match
  // (in which case it is force-expanded so the match is visible).
  const filteredGroups = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return groups;
    const out = [];
    for (const g of groups) {
      if (matchesTerm(g.head, term)) { out.push(g); continue; }
      const mm = g.members.filter((m) => matchesTerm(m, term));
      if (mm.length) out.push({ ...g, members: mm, forceOpen: true });
    }
    return out;
  }, [groups, search]);

  // Sort the top-level rows by the head user's field.
  const sortedGroups = useMemo(() => {
    const arr = [...filteredGroups];
    arr.sort((a, b) => {
      let va = a.head[sortKey] || '';
      let vb = b.head[sortKey] || '';
      if (sortKey === 'created_at') {
        va = new Date(va).getTime();
        vb = new Date(vb).getTime();
      } else {
        va = String(va).toLowerCase();
        vb = String(vb).toLowerCase();
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filteredGroups, sortKey, sortDir]);

  const totalGroups = sortedGroups.length;
  const totalPages = Math.max(1, Math.ceil(totalGroups / perPage));
  const paginatedGroups = sortedGroups.slice((page - 1) * perPage, page * perPage);

  // Reset page when search/perPage changes
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

  // ---- shared cell renderers (owner + member rows share every column but the first) ----
  const rowActions = (u) => (
    <div className="action-buttons">
      <button
        className="btn-icon btn-icon-danger"
        title="Delete user"
        onClick={() => handleDelete(u.id, u.full_name || u.email)}
        disabled={deletingId === u.id}
      >
        {deletingId === u.id ? <Loader2 size={16} className="ig-spin" /> : <Trash2 size={16} />}
      </button>
    </div>
  );

  const avatar = (u) => (
    <div className="user-cell-avatar">
      {u.avatar_url ? <img src={u.avatar_url} alt="" /> : (u.full_name || u.email || '?').charAt(0).toUpperCase()}
    </div>
  );

  const trailingCells = (u) => (
    <>
      <td>{u.email}</td>
      <td>{u.organization_name || <span className="text-muted">None</span>}</td>
      <td><span className={`role-badge role-${u.role}`}>{u.role}</span></td>
      <td className="date-cell">
        {new Date(u.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
      </td>
      <td>{rowActions(u)}</td>
    </>
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Users</h1>
          <p>Owners are listed here — expand an owner to see their organization's members</p>
        </div>
      </div>

      <div className="table-toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="search"
            name="user-search"
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore="true"
            placeholder="Search by name, email, organization, role..."
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
          <p>Loading users...</p>
        </div>
      ) : (
        <>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="sortable-th" onClick={() => handleSort('full_name')}>
                    User{getSortIcon('full_name')}
                  </th>
                  <th className="sortable-th" onClick={() => handleSort('email')}>
                    Email{getSortIcon('email')}
                  </th>
                  <th className="sortable-th" onClick={() => handleSort('organization_name')}>
                    Organization{getSortIcon('organization_name')}
                  </th>
                  <th className="sortable-th" onClick={() => handleSort('role')}>
                    Role{getSortIcon('role')}
                  </th>
                  <th className="sortable-th" onClick={() => handleSort('created_at')}>
                    Created{getSortIcon('created_at')}
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedGroups.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="empty-state">
                      {search ? 'No users match your search' : 'No users found'}
                    </td>
                  </tr>
                ) : (
                  paginatedGroups.map((g) => {
                    const hasMembers = g.members.length > 0;
                    const open = g.forceOpen || expanded.has(g.head.id);
                    return (
                      <Fragment key={g.head.id}>
                        <tr className={hasMembers ? 'owner-row' : ''}>
                          <td>
                            <div className="user-cell">
                              {hasMembers ? (
                                <button
                                  className="accordion-toggle"
                                  onClick={() => toggleExpand(g.head.id)}
                                  title={open ? 'Collapse members' : 'Expand members'}
                                >
                                  {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                </button>
                              ) : (
                                <span className="accordion-spacer" />
                              )}
                              {avatar(g.head)}
                              <span className="user-cell-name">
                                {g.head.full_name || '—'}
                                {hasMembers && (
                                  <span className="member-count">
                                    {g.members.length} member{g.members.length > 1 ? 's' : ''}
                                  </span>
                                )}
                              </span>
                            </div>
                          </td>
                          {trailingCells(g.head)}
                        </tr>

                        {open && g.members.map((m) => (
                          <tr key={m.id} className="member-row">
                            <td>
                              <div className="user-cell member-indent">
                                {avatar(m)}
                                <span className="user-cell-name">{m.full_name || '—'}</span>
                              </div>
                            </td>
                            {trailingCells(m)}
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination — paginates top-level (owner) rows */}
          {totalGroups > 0 && (
            <div className="table-footer">
              <div className="table-info">
                Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, totalGroups)} of {totalGroups} owners
                {search && ` (filtered from ${users.length} users)`}
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
    </div>
  );
}
