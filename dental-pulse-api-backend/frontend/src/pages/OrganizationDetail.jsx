import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Users, Shield, Crown, UserCheck, Mail, Phone, MapPin,
  Calendar, Building2, Link2, CheckCircle2, XCircle, Clock, Globe,
  Key, RefreshCw, ExternalLink, Info, Square, Play, Loader2, ChevronDown, Filter,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { INTEGRATION_LOGOS } from '../lib/integrationLogos';
import UserAiKeyModal from './UserAiKeyModal';

export default function OrganizationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('users');
  const [syncStatus, setSyncStatus] = useState(null);
  const [keyModalOwner, setKeyModalOwner] = useState(null);

  // AI Usage tab — per-user AI consumption for this org.
  const [aiUsageRange, setAiUsageRange] = useState('30d');
  const [aiUsageData, setAiUsageData] = useState(null);
  const [aiUsageLoading, setAiUsageLoading] = useState(false);
  const [aiUsageError, setAiUsageError] = useState(null);
  const [syncAction, setSyncAction] = useState(null); // 'stopping' | 'triggering' | null
  const [iplicitSyncAction, setIplicitSyncAction] = useState(null); // 'triggering' | null
  const [selectedEntities, setSelectedEntities] = useState([]);
  const [entityDropdownOpen, setEntityDropdownOpen] = useState(false);
  const [selectedDentallyAccountId, setSelectedDentallyAccountId] = useState('');
  // Live practice names per Dentally integration id, fetched from /v1/sites.
  const [dentallyAccountNames, setDentallyAccountNames] = useState({});

  const DENTALLY_ENTITIES = [
    { alias: 'locations', label: 'Locations' },
    { alias: 'treatment_category', label: 'Treatment Categories' },
    { alias: 'payment_plans', label: 'Payment Plans' },
    { alias: 'appointment_cancellation_reasons', label: 'Cancellation Reasons' },
    { alias: 'treatments', label: 'Treatments' },
    { alias: 'practitioners', label: 'Practitioners' },
    { alias: 'patients', label: 'Patients' },
    { alias: 'treatment_plans', label: 'Treatment Plans' },
    { alias: 'treatment_plan_items', label: 'Treatment Plan Items' },
    { alias: 'treatment_appointments', label: 'Treatment Appoin tments' },
    { alias: 'appointments', label: 'Appointments' },
    { alias: 'invoices', label: 'Invoices' },
    { alias: 'nhs_claims', label: 'NHS Claims' },
    { alias: 'payments', label: 'Payment' },
    { alias: 'accounts', label: 'Accounts' }
  ];

  const entityDropdownRef = useRef(null);

  const toggleEntity = (alias) => {
    setSelectedEntities(prev =>
      prev.includes(alias) ? prev.filter(e => e !== alias) : [...prev, alias]
    );
  };

  // Close dropdown on outside click
  useEffect(() => {
    if (!entityDropdownOpen) return;
    const handleClickOutside = (e) => {
      if (entityDropdownRef.current && !entityDropdownRef.current.contains(e.target)) {
        setEntityDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [entityDropdownOpen]);

  // Status is scoped to the selected Dentally account so each connected account
  // can be monitored/started/stopped independently while they sync in parallel.
  const fetchSyncStatus = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.getSyncStatus(id, selectedDentallyAccountId || undefined);
      setSyncStatus(data);
    } catch {
      // Silently fail - sync status is supplementary
    }
  }, [id, selectedDentallyAccountId]);

  // Poll sync status when on integrations tab
  useEffect(() => {
    if (activeTab !== 'integrations' || !id) return;
    fetchSyncStatus();
    const interval = setInterval(fetchSyncStatus, 5000);
    return () => clearInterval(interval);
  }, [activeTab, id, fetchSyncStatus]);

  // Load AI usage when the tab is opened or the range/org changes.
  useEffect(() => {
    if (activeTab !== 'ai-usage' || !id) return;
    setAiUsageLoading(true);
    setAiUsageError(null);
    api.getAIUsage(aiUsageRange, id, false) // include_deleted=true so deleted users still surface
      .then((res) => setAiUsageData(res))
      .catch((err) => setAiUsageError(err.message || 'Failed to load AI usage'))
      .finally(() => setAiUsageLoading(false));
  }, [activeTab, id, aiUsageRange]);

  const handleStopSync = () => {
    const accountLabel = selectedDentallyAccount?.label || 'this account';
    toast(`Stop active sync jobs for "${accountLabel}"?`, {
      action: {
        label: 'Yes, stop',
        onClick: async () => {
          setSyncAction('stopping');
          try {
            await api.stopSync(id, selectedDentallyAccountId || undefined);
            await fetchSyncStatus();
            toast.success('Sync jobs have been stopped for this account.');
          } catch (err) {
            toast.error('Failed to stop sync: ' + err.message);
          } finally {
            setSyncAction(null);
          }
        },
      },
      cancel: { label: 'Cancel' },
    });
  };

  const handleTriggerSync = (force = false) => {
    if (!selectedDentallyAccountId) {
      toast.error('Please select a Dentally account first.');
      return;
    }
    const entityNames = selectedEntities.length > 0
      ? selectedEntities.map(a => DENTALLY_ENTITIES.find(e => e.alias === a)?.label).join(', ')
      : 'all entities';
    const accountLabel = selectedDentallyAccount?.label || 'Dentally';
    const message = force
      ? `Re-sync ${entityNames} for "${accountLabel}" (including already completed ones)?`
      : selectedEntities.length > 0
        ? `Re-sync ${entityNames} for "${accountLabel}"?`
        : `Sync failed/incomplete for ${entityNames} on "${accountLabel}" (skips already completed)?`;
    toast(message, {
      action: {
        label: force ? 'Yes, full sync' : 'Yes, resume',
        onClick: async () => {
          setSyncAction('triggering');
          try {
            const res = await api.triggerSync(id, force, {
              entities: selectedEntities.length > 0 ? selectedEntities : undefined,
              integration_id: selectedDentallyAccountId,
            });
            if (res.jobCount === 0) {
              toast.info('All sync jobs already completed. Use "Force Full Sync" to re-sync everything.');
            } else {
              toast.success(`Created ${res.jobCount} sync jobs for "${accountLabel}". Runs in parallel with your other Dentally accounts.`);
            }
            await fetchSyncStatus();
          } catch (err) {
            toast.error('Failed to trigger sync: ' + err.message);
          } finally {
            setSyncAction(null);
          }
        },
      },
      cancel: { label: 'Cancel' },
    });
  };

  const handleTriggerIplicitSync = (force = false) => {
    const message = force
      ? 'Re-sync ALL Iplicit entities (including already completed ones)?'
      : 'Sync Iplicit Legal Entities, Chart of Accounts, COA Groups, Balance Sheet, P&L, Suppliers, Products, Sales Invoices, Sales Receipts, Purchase Invoices & Purchase Invoice Payments?';
    toast(message, {
      action: {
        label: force ? 'Yes, force sync' : 'Yes, start',
        onClick: async () => {
          setIplicitSyncAction('triggering');
          try {
            const res = await api.triggerIplicitSync(id, force);
            if (res.jobCount === 0) {
              toast.info('All Iplicit sync jobs already completed. Use "Force Sync" to re-sync.');
            } else {
              toast.success(`Created ${res.jobCount} Iplicit sync jobs.`);
            }
          } catch (err) {
            toast.error('Failed to start Iplicit sync: ' + err.message);
          } finally {
            setIplicitSyncAction(null);
          }
        },
      },
      cancel: { label: 'Cancel' },
    });
  };

  const fetchOrg = useCallback(() => {
    return api.getOrganization(id)
      .then((data) => setOrg(data))
      .catch((err) => setError(err.message || 'Failed to load organization'));
  }, [id]);

  useEffect(() => {
    fetchOrg().finally(() => setLoading(false));
  }, [fetchOrg]);

  // The org's AI key lives on its owner's user_ai_keys row (getOwnerKey() in
  // apiKeyService.js resolves it the same way) — so "the organization's AI
  // key" means "the owner's AI key" here.
  const owner = (org?.users || []).find((u) => u.role === 'owner') || null;

  // Fetch live Dentally practice names so the account dropdown can label each
  // key by its practice instead of just the key prefix. Best-effort: on failure
  // the dropdown falls back to showing the key prefix.
  useEffect(() => {
    if (!id) return;
    api.getDentallyAccounts(id)
      .then((data) => {
        const map = {};
        for (const acc of data.accounts || []) {
          map[acc.id] = { name: acc.name, keyPrefix: acc.keyPrefix };
        }
        setDentallyAccountNames(map);
      })
      .catch(() => {
        // Non-fatal — labels just fall back to the key prefix.
      });
  }, [id]);

  const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  };

  const getRoleCounts = () => {
    if (!org?.users) return { owners: 0, admins: 0, members: 0 };
    const owners = org.users.filter((u) => u.role === 'owner').length;
    const admins = org.users.filter((u) => u.role === 'admin').length;
    const members = org.users.length - owners - admins;
    return { owners, admins, members };
  };

  // Build list of all Dentally accounts for this org
  const dentallyAccounts = (org?.integrations || [])
    .filter((i) => i.integration_name?.toLowerCase() === 'dentally')
    .map((i) => {
      // Prefer the live practice name (from /v1/sites); fall back to the key
      // prefix so each account is still distinguishable if the name is missing.
      const fetched = dentallyAccountNames[i.id];
      const keyPrefix = i.api_key ? `${i.api_key.substring(0, 8)}...` : null;
      const label = fetched?.name
        ? `${fetched.name} (${keyPrefix || 'no key'})`
        : keyPrefix || 'Dentally';
      return {
      id: i.id,
      label,
      connected: !!i.is_connected || !!i.api_key,
      hasApiKey: !!i.api_key,
      endpoint: i.api_endpoints || null,
      syncFrequency: i.sync_frequency || null,
      lastSync: i.sync_at || null,
      createdAt: i.created_at || null,
      };
    });

  // Auto-select first account if none selected
  useEffect(() => {
    if (dentallyAccounts.length > 0 && !selectedDentallyAccountId) {
      setSelectedDentallyAccountId(dentallyAccounts[0].id);
    }
  }, [org]);

  const selectedDentallyAccount = dentallyAccounts.find(a => a.id === selectedDentallyAccountId) || dentallyAccounts[0] || null;

  const getIntegrationStatus = () => {
    const xero = org?.platform_integrations?.find((i) => i.platform_name?.toLowerCase() === 'xero');

    // Iplicit: prefer accounting_connections (built from platform_integrations by the API),
    // fall back to reading platform_integrations directly.
    const iplicit =
      org?.accounting_connections?.find((i) => i.platform === 'iplicit') ||
      (org?.platform_integrations?.find((i) => i.platform_name === 'iplicit')
        ? {
          platform: 'iplicit',
          status: org.platform_integrations.find((i) => i.platform_name === 'iplicit').is_connected
            ? 'connected' : 'disconnected',
          iplicit_domain: org.platform_integrations.find((i) => i.platform_name === 'iplicit').client_id || null,
          last_sync: org.platform_integrations.find((i) => i.platform_name === 'iplicit').last_synced_at || null,
          created_at: org.platform_integrations.find((i) => i.platform_name === 'iplicit').created_at || null,
        }
        : null);

    return {
      dentally: {
        connected: selectedDentallyAccount?.connected || false,
        hasApiKey: selectedDentallyAccount?.hasApiKey || false,
        endpoint: selectedDentallyAccount?.endpoint || null,
        syncFrequency: selectedDentallyAccount?.syncFrequency || null,
        lastSync: selectedDentallyAccount?.lastSync || null,
        createdAt: selectedDentallyAccount?.createdAt || null,
      },
      xero: {
        connected: !!xero?.is_connected,
        lastSync: xero?.last_synced_at || null,
        createdAt: xero?.created_at || null,
      },
      iplicit: {
        connected: iplicit?.status === 'connected',
        status: iplicit?.status || null,
        domain: iplicit?.iplicit_domain || null,
        lastSync: iplicit?.last_sync || null,
        createdAt: iplicit?.created_at || null,
      },
    };
  };

  const connectedCount = () => {
    const ig = getIntegrationStatus();
    const dentallyCount = dentallyAccounts.filter(a => a.connected).length;
    return [dentallyCount > 0, ig.xero.connected, ig.iplicit.connected].filter(Boolean).length;
  };

  if (loading) {
    return (
      <div className="page">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading organization...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="detail-error">
          <h2>Organization not found</h2>
          <p>{error}</p>
          <button className="btn-back" onClick={() => navigate('/organizations')}>
            Back to Organizations
          </button>
        </div>
      </div>
    );
  }

  const roleCounts = getRoleCounts();
  const integrations = getIntegrationStatus();

  return (
    <div className="page org-detail-page">
      {/* Back Button */}
      <button className="back-btn" onClick={() => navigate('/organizations')}>
        <ArrowLeft size={16} />
        <span>Back to Organizations</span>
      </button>

      {/* Hero Header */}
      <div className="org-hero">
        <div className="org-hero-banner" />
        <div className="org-hero-content">
          <div className="org-hero-avatar">
            {org.logo_url ? (
              <img src={org.logo_url} alt="" />
            ) : (
              getInitials(org.name)
            )}
          </div>
          <div className="org-hero-info">
            <h1>{org.name || '—'}</h1>
            <div className="org-hero-meta">
              {org.email && (
                <span className="org-hero-meta-item">
                  <Mail size={14} /> {org.email}
                </span>
              )}
              {org.phone && (
                <span className="org-hero-meta-item">
                  <Phone size={14} /> {org.phone}
                </span>
              )}
              {org.address && (
                <span className="org-hero-meta-item">
                  <MapPin size={14} /> {org.address}
                </span>
              )}
              <span className="org-hero-meta-item">
                <Calendar size={14} /> {new Date(org.created_at).toLocaleDateString('en-GB', {
                  day: '2-digit', month: 'long', year: 'numeric',
                })}
              </span>
            </div>
          </div>
        </div>

        {/* Inline Stats */}
        <div className="org-hero-stats">
          <div className="org-hero-stat">
            <div className="org-hero-stat-icon purple"><Users size={18} /></div>
            <div className="org-hero-stat-data">
              <span className="org-hero-stat-num">{org.users?.length || 0}</span>
              <span className="org-hero-stat-lbl">Total Users</span>
            </div>
          </div>
          <div className="org-hero-stat-divider" />
          <div className="org-hero-stat">
            <div className="org-hero-stat-icon amber"><Crown size={18} /></div>
            <div className="org-hero-stat-data">
              <span className="org-hero-stat-num">{roleCounts.owners}</span>
              <span className="org-hero-stat-lbl">Owners</span>
            </div>
          </div>
          <div className="org-hero-stat-divider" />
          <div className="org-hero-stat">
            <div className="org-hero-stat-icon green"><Shield size={18} /></div>
            <div className="org-hero-stat-data">
              <span className="org-hero-stat-num">{roleCounts.admins}</span>
              <span className="org-hero-stat-lbl">Admins</span>
            </div>
          </div>
          <div className="org-hero-stat-divider" />
          <div className="org-hero-stat">
            <div className="org-hero-stat-icon blue"><UserCheck size={18} /></div>
            <div className="org-hero-stat-data">
              <span className="org-hero-stat-num">{roleCounts.members}</span>
              <span className="org-hero-stat-lbl">Members</span>
            </div>
          </div>
          <div className="org-hero-stat-divider" />
          <div className="org-hero-stat">
            <div className="org-hero-stat-icon teal"><Link2 size={18} /></div>
            <div className="org-hero-stat-data">
              <span className="org-hero-stat-num">{connectedCount()}/3</span>
              <span className="org-hero-stat-lbl">Integrations</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="od-tabs">
        <button className={`od-tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
          <Users size={16} /> Users <span className="od-tab-count">{org.users?.length || 0}</span>
        </button>
        <button className={`od-tab ${activeTab === 'integrations' ? 'active' : ''}`} onClick={() => setActiveTab('integrations')}>
          <Link2 size={16} /> Integrations <span className="od-tab-count">{connectedCount()}/3</span>
        </button>
        <button className={`od-tab ${activeTab === 'info' ? 'active' : ''}`} onClick={() => setActiveTab('info')}>
          <Info size={16} /> Details
        </button>
        <button className={`od-tab ${activeTab === 'ai-usage' ? 'active' : ''}`} onClick={() => setActiveTab('ai-usage')}>
          <Sparkles size={16} /> AI Usage
        </button>
      </div>

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {(!org.users || org.users.length === 0) ? (
                <tr>
                  <td colSpan="4" className="empty-state">No users in this organization</td>
                </tr>
              ) : (
                org.users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="user-cell">
                        <div className="user-cell-avatar">
                          {user.avatar_url ? (
                            <img src={user.avatar_url} alt="" />
                          ) : (
                            getInitials(user.full_name || user.email)
                          )}
                        </div>
                        <span className="user-cell-name">{user.full_name || '—'}</span>
                      </div>
                    </td>
                    <td>{user.email}</td>
                    <td>
                      <span className={`role-badge role-${user.role}`}>{user.role}</span>
                    </td>
                    <td className="date-cell">
                      {user.created_at
                        ? new Date(user.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                        : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Integrations Tab */}
      {activeTab === 'integrations' && (
        <div className="ig-grid">
          {/* Dentally */}
          <div className={`ig-card ${integrations.dentally.connected ? 'ig-connected' : ''}`}>
            <div className="ig-card-top">
              <div className="ig-logo" style={{ background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>🦷</div>
              <div className="ig-card-title">
                <h3>Dentally</h3>
                <span>Dental practice management</span>
              </div>
              <span className={`ig-badge ${integrations.dentally.connected ? 'ig-badge-on' : 'ig-badge-off'}`}>
                {integrations.dentally.connected
                  ? <><CheckCircle2 size={13} /> Connected</>
                  : <><XCircle size={13} /> Not Connected</>}
              </span>
            </div>
            {/* Account selector for multiple Dentally accounts */}
            {dentallyAccounts.length > 1 && (
              <div className="ig-row" style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--muted-bg, #f8f9fa)' }}>
                <span className="ig-row-label"><Building2 size={13} /> Account</span>
                <select
                  className="ig-account-select"
                  value={selectedDentallyAccountId}
                  onChange={(e) => setSelectedDentallyAccountId(e.target.value)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: '1px solid #ddd',
                    fontSize: '13px',
                    fontWeight: 500,
                    maxWidth: '260px',
                    background: 'white',
                  }}
                >
                  {dentallyAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id} title={acc.label}>{acc.label}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="ig-card-rows">
              <div className="ig-row">
                <span className="ig-row-label"><Key size={13} /> API Key</span>
                <span className={`ig-row-val ${integrations.dentally.hasApiKey ? '' : 'ig-row-empty'}`}>
                  {integrations.dentally.hasApiKey ? <><CheckCircle2 size={13} /> Configured</> : 'Not configured'}
                </span>
              </div>
              {integrations.dentally.endpoint && (
                <div className="ig-row">
                  <span className="ig-row-label"><Globe size={13} /> Endpoint</span>
                  <span className="ig-row-val ig-row-mono">{integrations.dentally.endpoint}</span>
                </div>
              )}
              {integrations.dentally.syncFrequency && (
                <div className="ig-row">
                  <span className="ig-row-label"><RefreshCw size={13} /> Sync Frequency</span>
                  <span className="ig-row-val">{integrations.dentally.syncFrequency}</span>
                </div>
              )}
              <div className="ig-row">
                <span className="ig-row-label"><Clock size={13} /> Last Sync</span>
                <span className={`ig-row-val ${integrations.dentally.lastSync ? '' : 'ig-row-empty'}`}>
                  {integrations.dentally.lastSync
                    ? new Date(integrations.dentally.lastSync).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : 'Never synced'}
                </span>
              </div>
              {/* Sync Status & Controls */}
              {syncStatus && (
                <div className="ig-row">
                  <span className="ig-row-label"><RefreshCw size={13} /> Sync Status</span>
                  <span className="ig-row-val">
                    {syncStatus.isSyncing ? (
                      <span className="ig-sync-active">
                        <Loader2 size={13} className="ig-spin" />
                        {syncStatus.summary.running} running, {syncStatus.summary.queued} queued
                        {syncStatus.summary.totalRecords > 0 && ` (${syncStatus.summary.totalRecords.toLocaleString()} records)`}
                      </span>
                    ) : syncStatus.summary.total > 0 ? (
                      <span className="ig-sync-idle">
                        {syncStatus.summary.completed} completed, {syncStatus.summary.failed} failed
                        {syncStatus.summary.totalRecords > 0 && ` (${syncStatus.summary.totalRecords.toLocaleString()} records)`}
                      </span>
                    ) : (
                      <span className="ig-row-empty">No recent sync jobs</span>
                    )}
                  </span>
                </div>
              )}
              {/* Entity Filter Dropdown */}
              {!syncStatus?.isSyncing && integrations.dentally.connected && (
                <div className="ig-row" style={{ borderBottom: 'none', paddingBottom: 0 }}>
                  <span className="ig-row-label"><Filter size={13} /> Sync Entities</span>
                  <div className="ig-entity-dropdown-wrap" ref={entityDropdownRef}>
                    <button
                      className="ig-entity-dropdown-trigger"
                      onClick={() => setEntityDropdownOpen(prev => !prev)}
                    >
                      <span>
                        {selectedEntities.length === 0
                          ? 'All Entities'
                          : `${selectedEntities.length} selected`}
                      </span>
                      <ChevronDown size={14} className={entityDropdownOpen ? 'ig-chevron-open' : ''} />
                    </button>
                    {entityDropdownOpen && (
                      <div className="ig-entity-dropdown">
                        <label className="ig-entity-option ig-entity-option-all" onClick={() => setSelectedEntities([])}>
                          <input type="radio" checked={selectedEntities.length === 0} readOnly />
                          <span>All Entities (default)</span>
                        </label>
                        <div className="ig-entity-divider" />
                        {DENTALLY_ENTITIES.map(entity => (
                          <label key={entity.alias} className="ig-entity-option" onClick={(e) => { e.preventDefault(); toggleEntity(entity.alias); }}>
                            <input type="checkbox" checked={selectedEntities.includes(entity.alias)} readOnly />
                            <span>{entity.label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="ig-row ig-row-actions">
                {syncStatus?.isSyncing ? (
                  <button
                    className="ig-btn ig-btn-danger"
                    onClick={handleStopSync}
                    disabled={syncAction === 'stopping'}
                  >
                    {syncAction === 'stopping'
                      ? <><Loader2 size={13} className="ig-spin" /> Stopping...</>
                      : <><Square size={13} /> Stop Sync</>}
                  </button>
                ) : (
                  <>
                    <button
                      className="ig-btn ig-btn-primary"
                      onClick={() => handleTriggerSync(false)}
                      disabled={syncAction === 'triggering' || !integrations.dentally.connected}
                    >
                      {syncAction === 'triggering'
                        ? <><Loader2 size={13} className="ig-spin" /> Starting...</>
                        : <><Play size={13} /> Resume Sync</>}
                    </button>
                    <button
                      className="ig-btn ig-btn-secondary"
                      onClick={() => handleTriggerSync(true)}
                      disabled={syncAction === 'triggering' || !integrations.dentally.connected}
                    >
                      <RefreshCw size={13} /> Force Full Sync
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Xero */}
          <div className={`ig-card ${integrations.xero.connected ? 'ig-connected' : ''}`}>
            <div className="ig-card-top">
              <div className="ig-logo" style={{ background: '#fff', border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px' }}>
                <img src={INTEGRATION_LOGOS.xero} alt="Xero" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              </div>
              <div className="ig-card-title">
                <h3>Xero</h3>
                <span>Cloud accounting software</span>
              </div>
              <span className={`ig-badge ${integrations.xero.connected ? 'ig-badge-on' : 'ig-badge-off'}`}>
                {integrations.xero.connected
                  ? <><CheckCircle2 size={13} /> Connected</>
                  : <><XCircle size={13} /> Not Connected</>}
              </span>
            </div>
            <div className="ig-card-rows">
              <div className="ig-row">
                <span className="ig-row-label"><ExternalLink size={13} /> OAuth Status</span>
                <span className={`ig-row-val ${integrations.xero.connected ? '' : 'ig-row-empty'}`}>
                  {integrations.xero.connected ? <><CheckCircle2 size={13} /> Authenticated</> : 'Not linked'}
                </span>
              </div>
              <div className="ig-row">
                <span className="ig-row-label"><Clock size={13} /> Last Sync</span>
                <span className={`ig-row-val ${integrations.xero.lastSync ? '' : 'ig-row-empty'}`}>
                  {integrations.xero.lastSync
                    ? new Date(integrations.xero.lastSync).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : 'Never synced'}
                </span>
              </div>
              <div className="ig-row">
                <span className="ig-row-label"><Calendar size={13} /> Connected Since</span>
                <span className={`ig-row-val ${integrations.xero.createdAt ? '' : 'ig-row-empty'}`}>
                  {integrations.xero.createdAt
                    ? new Date(integrations.xero.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                    : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Iplicit */}
          <div className={`ig-card ${integrations.iplicit.connected ? 'ig-connected' : ''}`}>
            <div className="ig-card-top">
              <div className="ig-logo" style={{ background: '#fff', border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px' }}>
                <img src={INTEGRATION_LOGOS.iplicit} alt="Iplicit" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              </div>
              <div className="ig-card-title">
                <h3>Iplicit</h3>
                <span>Financial management platform</span>
              </div>
              <span className={`ig-badge ${integrations.iplicit.connected ? 'ig-badge-on' : 'ig-badge-off'}`}>
                {integrations.iplicit.connected
                  ? <><CheckCircle2 size={13} /> Connected</>
                  : <><XCircle size={13} /> Not Connected</>}
              </span>
            </div>
            <div className="ig-card-rows">
              <div className="ig-row">
                <span className="ig-row-label"><Key size={13} /> Status</span>
                <span className={`ig-row-val ${integrations.iplicit.connected ? '' : 'ig-row-empty'}`}>
                  {integrations.iplicit.status ? (
                    <span className={`ig-status-pill ${integrations.iplicit.status}`}>{integrations.iplicit.status}</span>
                  ) : 'Not configured'}
                </span>
              </div>
              {integrations.iplicit.entityName && (
                <div className="ig-row">
                  <span className="ig-row-label"><Building2 size={13} /> Entity</span>
                  <span className="ig-row-val">{integrations.iplicit.entityName}</span>
                </div>
              )}
              {integrations.iplicit.domain && (
                <div className="ig-row">
                  <span className="ig-row-label"><Globe size={13} /> Domain</span>
                  <span className="ig-row-val ig-row-mono">{integrations.iplicit.domain}</span>
                </div>
              )}
              <div className="ig-row">
                <span className="ig-row-label"><Clock size={13} /> Last Sync</span>
                <span className={`ig-row-val ${integrations.iplicit.lastSync ? '' : 'ig-row-empty'}`}>
                  {integrations.iplicit.lastSync
                    ? new Date(integrations.iplicit.lastSync).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : 'Never synced'}
                </span>
              </div>
              {integrations.iplicit.connected && (
                <div className="ig-row ig-row-actions">
                  <button
                    className="ig-btn ig-btn-primary"
                    onClick={() => handleTriggerIplicitSync(false)}
                    disabled={iplicitSyncAction === 'triggering'}
                  >
                    {iplicitSyncAction === 'triggering'
                      ? <><Loader2 size={13} className="ig-spin" /> Starting...</>
                      : <><Play size={13} /> Start Sync</>}
                  </button>
                  <button
                    className="ig-btn ig-btn-secondary"
                    onClick={() => handleTriggerIplicitSync(true)}
                    disabled={iplicitSyncAction === 'triggering'}
                  >
                    <RefreshCw size={13} /> Force Sync
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Info Tab */}
      {activeTab === 'info' && (
        <div className="detail-info-grid">
          <div className="detail-info-card">
            <h3><Building2 size={16} /> Organization Details</h3>
            <div className="info-row">
              <span className="info-label">Name</span>
              <span className="info-value">{org.name || '—'}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Email</span>
              <span className="info-value">{org.email || '—'}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Phone</span>
              <span className="info-value">{org.phone || '—'}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Address</span>
              <span className="info-value">{org.address || '—'}</span>
            </div>
            <div className="info-row">
              <span className="info-label">ID</span>
              <span className="info-value info-mono">{org.id}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Created</span>
              <span className="info-value">
                {new Date(org.created_at).toLocaleString('en-GB', {
                  day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>
            {org.updated_at && (
              <div className="info-row">
                <span className="info-label">Last Updated</span>
                <span className="info-value">
                  {new Date(org.updated_at).toLocaleString('en-GB', {
                    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
            )}
          </div>
          <div className="detail-info-card">
            <h3><Users size={16} /> User Breakdown</h3>
            <div className="info-row">
              <span className="info-label">Owners</span>
              <span className="info-value">{roleCounts.owners}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Admins</span>
              <span className="info-value">{roleCounts.admins}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Members</span>
              <span className="info-value">{roleCounts.members}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Total</span>
              <span className="info-value" style={{ fontWeight: 700, color: 'var(--blue-600)' }}>{org.users?.length || 0}</span>
            </div>
          </div>

          <div className="detail-info-card">
            <h3><Key size={16} /> AI API Key</h3>
            {owner ? (
              <>
                <div className="info-row">
                  <span className="info-label">Organization owner</span>
                  <span className="info-value">{owner.full_name || owner.email || '—'}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Status</span>
                  <span className="info-value">
                    {!owner.has_ai_key
                      ? <span className="ai-badge none" title="No API key — AI features are blocked for this organization">—</span>
                      : owner.ai_enabled
                        ? <span className="ai-badge on" title="Key set and AI turned on">Enabled</span>
                        : <span className="ai-badge off" title="Key set but AI turned off">Disabled</span>}
                  </span>
                </div>
                <div className="info-row" style={{ borderBottom: 'none', paddingTop: 14, justifyContent: 'flex-end' }}>
                  <button className="ig-btn ig-btn-primary" onClick={() => setKeyModalOwner(owner)}>
                    <Key size={13} /> {owner.has_ai_key ? 'Manage AI API Key' : 'Add AI API Key'}
                  </button>
                </div>
              </>
            ) : (
              <p style={{ color: 'var(--gray-500, #6b7280)', fontSize: '0.85rem', margin: 0 }}>
                No owner found for this organization — assign an owner before setting an AI key.
              </p>
            )}
          </div>
        </div>
      )}

      {/* AI Usage Tab */}
      {activeTab === 'ai-usage' && (
        <AIUsageOrgTab
          orgId={id}
          range={aiUsageRange}
          setRange={setAiUsageRange}
          data={aiUsageData}
          loading={aiUsageLoading}
          error={aiUsageError}
          onUserClick={(userId) => navigate(`/ai-usage/${userId}?range=${aiUsageRange}&org_id=${id}`)}
          onClaimed={() => {
            // Re-fetch to reflect the merge.
            setAiUsageLoading(true);
            api.getAIUsage(aiUsageRange, id, false)
              .then(setAiUsageData)
              .catch((e) => setAiUsageError(e.message))
              .finally(() => setAiUsageLoading(false));
          }}
        />
      )}

      {keyModalOwner && (
        <UserAiKeyModal
          user={keyModalOwner}
          onClose={() => setKeyModalOwner(null)}
          onSaved={(opts) => { if (!opts?.keepOpen) setKeyModalOwner(null); fetchOrg(); }}
        />
      )}
    </div>
  );
}

// ── AI Usage tab content ─────────────────────────────────────────────
// Per-user AI consumption for this org. Reuses the global /api/ai-usage
// endpoint with org_id filter. Click a row to drill into the per-user
// detail page.

function fmtNum(n) {
  if (n == null) return '0';
  return Number(n).toLocaleString('en-GB');
}

function fmtCurrency(n) {
  const v = Number(n) || 0;
  if (v < 0.01 && v > 0) return `£${v.toFixed(6)}`;
  return `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtRelative(iso) {
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
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function AIUsageOrgTab({ orgId, range, setRange, data, loading, error, onUserClick, onClaimed }) {
  // Deleted-account rows are filtered out here too (in addition to the
  // include_deleted=false API param) as a defence-in-depth so they never
  // surface in this tab — admins only see live users.
  const rows = (data?.rows || []).filter((r) => !r.deleted);
  const totals = data?.totals || { requests: 0, tokens: 0, cost: 0, active_users: 0 };

  // Real users in this org (have a user_id, not deleted) — used as the
  // claim-target dropdown when reassigning orphan logs.
  const claimCandidates = rows.filter((r) => r.user_id && !r.deleted);
  const [claimingFor, setClaimingFor] = useState(null);   // row being claimed onto a user
  const [claimTarget, setClaimTarget] = useState('');
  const [overrideEmail, setOverrideEmail] = useState('');
  const [claiming, setClaiming] = useState(false);

  const claimTargetEmail = claimCandidates.find((c) => c.user_id === claimTarget)?.email || '';

  const submitClaim = async () => {
    if (!claimTarget) return;
    setClaiming(true);
    try {
      const newEmail = overrideEmail.trim();
      const res = await api.claimAIUsageOrphans(orgId, claimTarget, newEmail || null);
      const msg = res.email_updated
        ? `Reassigned ${res.claimed} log rows and changed email to ${res.email}.`
        : `Reassigned ${res.claimed} log rows to ${res.email || 'user'}.`;
      toast.success(msg);
      setClaimingFor(null);
      setClaimTarget('');
      setOverrideEmail('');
      onClaimed?.();
    } catch (err) {
      toast.error('Claim failed: ' + err.message);
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div>
      {/* Toolbar */}
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
      </div>

      {/* Stat cards */}
      <div className="stats-grid" style={{ marginTop: 12 }}>
        <div className="stat-card">
          <div className="stat-icon">👥</div>
          <div className="stat-info">
            <h3>{fmtNum(totals.active_users)}</h3>
            <p>Active users</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">⚡</div>
          <div className="stat-info">
            <h3>{fmtNum(totals.requests)}</h3>
            <p>Requests</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">✨</div>
          <div className="stat-info">
            <h3>{fmtNum(totals.tokens)}</h3>
            <p>Total tokens</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">💷</div>
          <div className="stat-info">
            <h3>{fmtCurrency(totals.cost)}</h3>
            <p>Estimated cost</p>
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="loading-spinner" style={{ marginTop: 16 }}>
          <Loader2 size={20} className="ig-spin" /> Loading AI usage…
        </div>
      ) : error ? (
        <div className="empty-state" style={{ marginTop: 16 }}>{error}</div>
      ) : rows.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 16 }}>
          No users found in this organization.
        </div>
      ) : (
        <div className="table-container" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th style={{ textAlign: 'right' }}>Requests</th>
                <th style={{ textAlign: 'right' }}>Input</th>
                <th style={{ textAlign: 'right' }}>Output</th>
                <th style={{ textAlign: 'right' }}>Total tokens</th>
                <th style={{ textAlign: 'right' }}>Cost</th>
                <th style={{ textAlign: 'right' }}>Last used</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const canDrill = !!row.user_id && !row.deleted;
                return (
                  <tr
                    key={`${row.user_id || '__orphan__'}::${row.email || ''}`}
                    style={{ cursor: canDrill ? 'pointer' : 'default', opacity: row.requests === 0 ? 0.55 : 1 }}
                    onClick={() => canDrill && onUserClick(row.user_id)}
                    title={canDrill ? 'View usage history' : ''}
                  >
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
                          </div>
                          <div className="text-muted" style={{ fontSize: '0.8em' }}>{row.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>{fmtNum(row.requests)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtNum(row.input_tokens)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtNum(row.output_tokens)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtNum(row.total_tokens)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(row.cost)}</td>
                    <td style={{ textAlign: 'right' }} className="date-cell">{fmtRelative(row.last_used)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {row.deleted && claimCandidates.length > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setClaimingFor(row); setClaimTarget(claimCandidates[0]?.user_id || ''); }}
                          style={{
                            background: '#6366f1', color: 'white', border: 'none',
                            padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                            cursor: 'pointer', whiteSpace: 'nowrap',
                          }}
                          title="Reassign these orphan log rows to a real user"
                        >
                          Claim →
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Claim modal — reassign orphan logs to a real user */}
      {claimingFor && (
        <div
          onClick={() => !claiming && setClaimingFor(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white', borderRadius: 12, padding: 24, width: 480, maxWidth: '90vw',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
            }}
          >
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Reassign deleted-account logs</h3>
            <p style={{ marginTop: 8, marginBottom: 16, fontSize: 13, color: '#4b5563' }}>
              All <strong>{fmtNum(claimingFor.requests)}</strong> orphan log rows in this org will be moved onto the user you pick. Use this when an account was effectively re-created (e.g. email change replaced the auth user).
            </p>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Assign to user
            </label>
            <select
              value={claimTarget}
              onChange={(e) => setClaimTarget(e.target.value)}
              disabled={claiming}
              style={{
                width: '100%', marginTop: 6, padding: '8px 12px',
                border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14,
              }}
            >
              {claimCandidates.map((c) => (
                <option key={c.user_id} value={c.user_id}>
                  {c.full_name} · {c.email}
                </option>
              ))}
            </select>

            <label style={{ display: 'block', marginTop: 16, fontSize: 12, fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Override email <span style={{ color: '#9ca3af', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
            </label>
            <input
              type="email"
              placeholder={claimTargetEmail || 'leave blank to keep current'}
              value={overrideEmail}
              onChange={(e) => setOverrideEmail(e.target.value)}
              disabled={claiming}
              style={{
                width: '100%', marginTop: 6, padding: '8px 12px',
                border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box',
              }}
            />
            <p style={{ marginTop: 6, marginBottom: 0, fontSize: 12, color: '#6b7280' }}>
              Updates <code>profiles.email</code> and stamps the new email on every log row. <code>auth.users.email</code> (used for login) is not changed.
            </p>
            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setClaimingFor(null)}
                disabled={claiming}
                style={{
                  background: 'white', color: '#374151', border: '1px solid #d1d5db',
                  padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={submitClaim}
                disabled={claiming || !claimTarget}
                style={{
                  background: '#6366f1', color: 'white', border: 'none',
                  padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  cursor: claiming ? 'wait' : 'pointer',
                  opacity: claiming || !claimTarget ? 0.6 : 1,
                }}
              >
                {claiming ? 'Reassigning…' : 'Reassign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
