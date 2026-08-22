import { useState } from 'react';
import { KeyRound, Loader2, X, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';

/**
 * Assign / replace / remove a user's Anthropic API key, and turn AI on/off for
 * them independently of the key. The full key is never loaded from the server
 * (only whether one is set and whether it's enabled), so the key field is
 * write-only: paste a new key to set/replace it.
 */
export default function UserAiKeyModal({ user, onClose, onSaved }) {
  // Pre-fill with the masked stored key so it's obvious a key is retained
  // (write-only: the real key is never sent to the browser). Cleared on focus
  // so a new key can be typed. Persists across the enable/disable toggle.
  const [apiKey, setApiKey] = useState(user.has_ai_key && user.key_preview ? user.key_preview : '');
  const [showKey, setShowKey] = useState(false);
  const [enabled, setEnabled] = useState(user.ai_enabled !== false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [toggling, setToggling] = useState(false);
  // Start read-only so browser password managers can't autofill a saved
  // credential into this field on mount (which also spills the paired email
  // into the page's search box). Unlocked on first focus, so typing still works.
  const [locked, setLocked] = useState(true);

  const busy = saving || removing || toggling;
  const name = user.full_name || user.email || 'this user';

  const handleSave = async () => {
    const key = apiKey.trim();
    if (!key) {
      toast.error('Paste an Anthropic API key first.');
      return;
    }
    // Still the masked existing key — nothing new to save.
    if (key.includes('•')) {
      toast.error('Enter a new key to replace the existing one.');
      return;
    }
    setSaving(true);
    try {
      await api.setUserAiKey(user.id, key);
      toast.success(`AI enabled for ${name}.`);
      onSaved();
    } catch (err) {
      toast.error('Could not save key: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await api.deleteUserAiKey(user.id);
      toast.success(`AI access removed for ${name}.`);
      onSaved();
    } catch (err) {
      toast.error('Could not remove key: ' + err.message);
    } finally {
      setRemoving(false);
    }
  };

  const handleToggle = async () => {
    const next = !enabled;
    setToggling(true);
    try {
      await api.setUserAiEnabled(user.id, next);
      setEnabled(next);
      toast.success(next ? `AI turned on for ${name}.` : `AI turned off for ${name}.`);
      // Refresh the list badge without closing — admin may still want to edit the key.
      onSaved({ keepOpen: true });
    } catch (err) {
      toast.error('Could not update AI access: ' + err.message);
    } finally {
      setToggling(false);
    }
  };

  const statusBadge = !user.has_ai_key
    ? { text: 'Not set', style: S.badgeOff }
    : enabled
      ? { text: '✓ Enabled', style: S.badgeOn }
      : { text: 'Disabled', style: S.badgeMuted };

  return (
    <div style={S.overlay} onClick={busy ? undefined : onClose}>
      <div style={S.card} onClick={(e) => e.stopPropagation()}>
        <div style={S.header}>
          <div style={S.titleRow}>
            <KeyRound size={18} color="#6c5ce7" />
            <h3 style={S.title}>AI API Key</h3>
          </div>
          <button style={S.iconBtn} onClick={onClose} disabled={busy} title="Close">
            <X size={18} />
          </button>
        </div>

        <p style={S.sub}>
          {name} · <span style={{ color: '#6b7280' }}>{user.email}</span>
        </p>

        <div style={S.statusRow}>
          <span style={{ color: '#6b7280' }}>Current status</span>
          <span style={{ ...S.badge, ...statusBadge.style }}>{statusBadge.text}</span>
        </div>

        {/* Enable / disable — only meaningful once a key exists. */}
        {user.has_ai_key && (
          <div style={S.toggleRow}>
            <div>
              <div style={S.toggleLabel}>AI features</div>
              <div style={S.toggleHint}>{enabled ? 'On — this user can use AI.' : 'Off — key kept, AI blocked.'}</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={handleToggle}
              disabled={busy}
              title={enabled ? 'Turn AI off' : 'Turn AI on'}
              style={{ ...S.switch, ...(enabled ? S.switchOn : S.switchOff), opacity: busy ? 0.6 : 1 }}
            >
              <span style={{ ...S.knob, ...(enabled ? S.knobOn : S.knobOff) }}>
                {toggling && <Loader2 size={11} className="ig-spin" />}
              </span>
            </button>
          </div>
        )}

        <label style={S.label}>{user.has_ai_key ? 'Replace with new key' : 'Anthropic API key'}</label>
        <div style={S.inputWrap}>
          <input
            type={showKey ? 'text' : 'password'}
            name="anthropic-api-key"
            autoComplete="new-password"
            readOnly={locked}
            onFocus={() => { setLocked(false); setApiKey((v) => (v.includes('•') ? '' : v)); }}
            spellCheck={false}
            data-lpignore="true"
            data-1p-ignore="true"
            data-form-type="other"
            placeholder="sk-ant-api03-…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={busy}
            style={S.input}
          />
          <button
            type="button"
            onClick={() => setShowKey((s) => !s)}
            title={showKey ? 'Hide key' : 'Show key'}
            aria-label={showKey ? 'Hide key' : 'Show key'}
            style={S.eyeBtn}
            tabIndex={-1}
          >
            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <p style={S.hint}>
          Stored securely and used only for this user's AI features. The key is verified with Anthropic before saving and is never shown again after you leave.
        </p>

        <div style={S.actions}>
          {user.has_ai_key && (
            <button style={{ ...S.btn, ...S.btnDanger }} onClick={handleRemove} disabled={busy}>
              {removing ? <Loader2 size={15} className="ig-spin" /> : 'Remove key'}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button style={{ ...S.btn, ...S.btnGhost }} onClick={onClose} disabled={busy}>Cancel</button>
          <button style={{ ...S.btn, ...S.btnPrimary }} onClick={handleSave} disabled={busy}>
            {saving ? <Loader2 size={15} className="ig-spin" /> : 'Save key'}
          </button>
        </div>
      </div>
    </div>
  );
}

const S = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.55)',
    display: 'grid', placeItems: 'center', zIndex: 1000, padding: 16,
  },
  card: {
    background: '#fff', borderRadius: 14, width: '100%', maxWidth: 440,
    boxShadow: '0 20px 60px rgba(0,0,0,0.25)', padding: '20px 22px 18px', color: '#111827',
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { display: 'flex', alignItems: 'center', gap: 8 },
  title: { margin: 0, fontSize: '1.05rem', fontWeight: 700 },
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 4, borderRadius: 6 },
  sub: { margin: '10px 0 4px', fontSize: '0.9rem', fontWeight: 600 },
  statusRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    fontSize: '0.85rem', padding: '10px 0', borderBottom: '1px solid #f0f0f0', marginBottom: 4,
  },
  badge: { fontSize: '0.75rem', fontWeight: 700, padding: '2px 9px', borderRadius: 999 },
  badgeOn: { background: '#dcfce7', color: '#15803d' },
  badgeOff: { background: '#f3f4f6', color: '#6b7280' },
  badgeMuted: { background: '#fef3c7', color: '#92400e' },
  toggleRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 0', borderBottom: '1px solid #f0f0f0', marginBottom: 14, gap: 12,
  },
  toggleLabel: { fontSize: '0.85rem', fontWeight: 600 },
  toggleHint: { fontSize: '0.75rem', color: '#9ca3af', marginTop: 2 },
  switch: {
    position: 'relative', width: 44, height: 24, borderRadius: 999, border: 'none',
    cursor: 'pointer', padding: 0, flex: 'none', transition: 'background 0.15s',
  },
  switchOn: { background: '#6c5ce7' },
  switchOff: { background: '#d1d5db' },
  knob: {
    position: 'absolute', top: 2, width: 20, height: 20, borderRadius: '50%', background: '#fff',
    transition: 'left 0.15s', display: 'grid', placeItems: 'center', color: '#6c5ce7',
  },
  knobOn: { left: 22 },
  knobOff: { left: 2 },
  label: { display: 'block', fontSize: '0.8rem', fontWeight: 600, margin: '10px 0 6px', color: '#374151' },
  inputWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  input: {
    width: '100%', boxSizing: 'border-box', padding: '9px 40px 9px 11px', fontSize: '0.9rem',
    border: '1px solid #d1d5db', borderRadius: 8, fontFamily: 'inherit', outline: 'none',
  },
  eyeBtn: {
    position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer',
    color: '#9ca3af', padding: 6, borderRadius: 6, display: 'grid', placeItems: 'center',
  },
  hint: { fontSize: '0.75rem', color: '#9ca3af', margin: '8px 0 0', lineHeight: 1.5 },
  actions: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 18 },
  btn: {
    padding: '9px 16px', fontSize: '0.85rem', fontWeight: 600, borderRadius: 8, cursor: 'pointer',
    border: '1px solid transparent', display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 38,
  },
  btnPrimary: { background: '#6c5ce7', color: '#fff' },
  btnGhost: { background: '#fff', color: '#374151', border: '1px solid #d1d5db' },
  btnDanger: { background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' },
};
