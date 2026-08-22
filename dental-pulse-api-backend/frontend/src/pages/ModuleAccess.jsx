import { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { Select } from 'antd';
import {
  LayoutDashboard, BarChart3, Banknote, TrendingUp, Calculator, ClipboardList,
  MapPin, Users, Stethoscope, HeartPulse, Armchair, UserCheck, Zap, Layers,
  Megaphone, FileSpreadsheet, Briefcase, Settings, Target, RefreshCw, ShieldCheck, Boxes,
} from 'lucide-react';
import { api } from '../lib/api';

// Map the registry's lucide icon names to components.
const ICONS = {
  LayoutDashboard, BarChart3, Banknote, TrendingUp, Calculator, ClipboardList,
  MapPin, Users, Stethoscope, HeartPulse, Armchair, UserCheck, Zap, Layers,
  Megaphone, FileSpreadsheet, Briefcase, Settings, Target, RefreshCw, ShieldCheck,
};

export default function ModuleAccess() {
  const [modules, setModules] = useState([]);          // registry: [{ key, name, description, icon }]
  const [organizations, setOrganizations] = useState([]);

  const [accessType, setAccessType] = useState('default'); // 'default' | 'custom'
  const [organizationId, setOrganizationId] = useState('');

  const [accessMap, setAccessMap] = useState({});      // { key: bool }
  const [originalMap, setOriginalMap] = useState({});
  const [inherited, setInherited] = useState(false);

  const [loading, setLoading] = useState(true);        // initial registry + orgs
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load module registry + organizations once.
  useEffect(() => {
    Promise.all([api.getModules(), api.getOrganizations()])
      .then(([modRes, orgs]) => {
        setModules(modRes.modules || []);
        setOrganizations(Array.isArray(orgs) ? orgs : []);
      })
      .catch((err) => toast.error('Failed to load modules: ' + err.message))
      .finally(() => setLoading(false));
  }, []);

  // The org id we should actually query for (null = default scope).
  const scopeOrgId = accessType === 'custom' ? organizationId : null;
  const needsOrg = accessType === 'custom' && !organizationId;

  const loadAccess = useCallback(() => {
    if (needsOrg) {
      setAccessMap({});
      setOriginalMap({});
      setInherited(false);
      return;
    }
    setLoadingAccess(true);
    api.getModuleAccess(scopeOrgId)
      .then((res) => {
        const map = res.modules || {};
        setAccessMap(map);
        setOriginalMap(map);
        setInherited(!!res.inherited);
      })
      .catch((err) => toast.error('Failed to load access: ' + err.message))
      .finally(() => setLoadingAccess(false));
  }, [scopeOrgId, needsOrg]);

  useEffect(() => { loadAccess(); }, [loadAccess]);

  // Owner → admin → first user, matching the Organizations page.
  const getOrgUserName = (org) => {
    const u = org.users?.find((x) => x.role === 'owner')
      || org.users?.find((x) => x.role === 'admin')
      || org.users?.[0];
    return u?.full_name || u?.email || null;
  };

  const orgOptionLabel = (org) => {
    const base = org.name || org.email || org.id;
    const user = getOrgUserName(org);
    return user ? `${base} (${user})` : base;
  };

  const toggle = (key) => {
    setAccessMap((prev) => ({ ...prev, [key]: !prev[key] }));
    setInherited(false);
  };

  const dirty = useMemo(
    () => modules.some((m) => (accessMap[m.key] ?? true) !== (originalMap[m.key] ?? true)),
    [modules, accessMap, originalMap],
  );

  const enabledCount = useMemo(
    () => modules.filter((m) => accessMap[m.key] !== false).length,
    [modules, accessMap],
  );

  const setAll = (value) => {
    setAccessMap(() => {
      const next = {};
      modules.forEach((m) => { next[m.key] = value; });
      return next;
    });
    setInherited(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.saveModuleAccess(scopeOrgId, accessMap);
      const map = res.modules || accessMap;
      setAccessMap(map);
      setOriginalMap(map);
      setInherited(false);
      const label = accessType === 'custom'
        ? organizations.find((o) => o.id === organizationId)?.name || 'organization'
        : 'default access';
      toast.success(`Module access saved for ${label}`);
    } catch (err) {
      toast.error('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setAccessMap(originalMap);
    setInherited(!!inherited);
  };

  if (loading) {
    return (
      <div className="page">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading modules...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Module Access</h1>
        <p>Enable or disable DentPulse modules for the default configuration or a specific organization</p>
      </div>

      {/* Two dropdowns */}
      <div className="module-toolbar">
        <div className="module-field">
          <label>Access Type</label>
          <select
            value={accessType}
            onChange={(e) => {
              setAccessType(e.target.value);
              if (e.target.value === 'default') setOrganizationId('');
            }}
          >
            <option value="default">Default Access</option>
            <option value="custom">Custom Access</option>
          </select>
        </div>

        <div className="module-field module-field-org">
          <label>Organization</label>
          <Select
            showSearch
            size="large"
            value={organizationId || undefined}
            onChange={(val) => setOrganizationId(val || '')}
            disabled={accessType !== 'custom'}
            placeholder={accessType === 'custom' ? 'Search organization…' : 'All (default)'}
            optionFilterProp="label"
            allowClear
            style={{ width: '100%' }}
            options={organizations.map((org) => ({ value: org.id, label: orgOptionLabel(org) }))}
          />
        </div>
      </div>

      {/* Context banner */}
      {accessType === 'default' ? (
        <div className="module-banner module-banner-info">
          Changes here set the <strong>default access</strong> inherited by every organization that has no custom override.
        </div>
      ) : inherited && organizationId ? (
        <div className="module-banner module-banner-info">
          This organization currently <strong>inherits the default access</strong>. Toggling any module and saving will create a custom override.
        </div>
      ) : null}

      {needsOrg ? (
        <div className="empty-state" style={{ padding: '48px', textAlign: 'center' }}>
          Select an organization above to manage its module access.
        </div>
      ) : loadingAccess ? (
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading access...</p>
        </div>
      ) : (
        <>
          <div className="module-list-header">
            <span className="module-count-badge">{enabledCount} of {modules.length} enabled</span>
            <div className="module-bulk-actions">
              <button className="btn-link" onClick={() => setAll(true)}>Enable all</button>
              <span className="module-sep">·</span>
              <button className="btn-link" onClick={() => setAll(false)}>Disable all</button>
            </div>
          </div>

          <div className="module-list">
            {modules.map((mod) => {
              const Icon = ICONS[mod.icon] || Boxes;
              const enabled = accessMap[mod.key] !== false;
              return (
                <div key={mod.key} className={`module-row ${enabled ? 'is-enabled' : ''}`}>
                  <div className={`module-icon ${enabled ? 'is-enabled' : ''}`}>
                    <Icon size={20} />
                  </div>
                  <div className="module-meta">
                    <div className="module-name">{mod.name}</div>
                    <div className="module-desc">{mod.description}</div>
                  </div>
                  <label className="toggle-switch" title={enabled ? 'Enabled' : 'Disabled'}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => toggle(mod.key)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              );
            })}
          </div>

          <div className="module-actions">
            {dirty && <span className="module-dirty">Unsaved changes</span>}
            <button className="btn-secondary" onClick={handleReset} disabled={!dirty || saving}>
              Reset
            </button>
            <button className="save-btn" onClick={handleSave} disabled={!dirty || saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
