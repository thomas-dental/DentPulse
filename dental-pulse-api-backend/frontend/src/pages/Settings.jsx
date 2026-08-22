import { useState, useEffect } from 'react';
import { Calendar, Save, RotateCcw, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { DatePicker } from 'antd';
import dayjs from 'dayjs';
import { toast } from 'sonner';
import { api } from '../lib/api';

const { RangePicker } = DatePicker;

export default function Settings() {
  // Dentally sync date range
  const [syncStartDate, setSyncStartDate] = useState('');
  const [syncEndDate, setSyncEndDate] = useState('');
  const [syncMode, setSyncMode] = useState('current');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Iplicit sync date range
  const [iplicitStartDate, setIplicitStartDate] = useState('');
  const [iplicitEndDate, setIplicitEndDate] = useState('');
  const [iplicitLoading, setIplicitLoading] = useState(true);
  const [iplicitSaving, setIplicitSaving] = useState(false);
  const [iplicitSaved, setIplicitSaved] = useState(false);
  const [iplicitError, setIplicitError] = useState('');

  // Xero sync date range
  const [xeroStartDate, setXeroStartDate] = useState('');
  const [xeroEndDate, setXeroEndDate] = useState('');
  const [xeroLoading, setXeroLoading] = useState(true);
  const [xeroSaving, setXeroSaving] = useState(false);
  const [xeroSaved, setXeroSaved] = useState(false);
  const [xeroError, setXeroError] = useState('');

  // QuickBooks sync date range
  const [qbStartDate, setQbStartDate] = useState('');
  const [qbEndDate, setQbEndDate] = useState('');
  const [qbLoading, setQbLoading] = useState(true);
  const [qbSaving, setQbSaving] = useState(false);
  const [qbSaved, setQbSaved] = useState(false);
  const [qbError, setQbError] = useState('');

  // AI Insights regeneration schedule
  const [aiInsightsMode, setAiInsightsMode] = useState('session');
  const [aiInsightsWeekday, setAiInsightsWeekday] = useState(1);
  const [aiInsightsMonthDay, setAiInsightsMonthDay] = useState(1);
  const [aiInsightsLoading, setAiInsightsLoading] = useState(true);
  const [aiInsightsSaving, setAiInsightsSaving] = useState(false);
  const [aiInsightsSaved, setAiInsightsSaved] = useState(false);
  const [aiInsightsError, setAiInsightsError] = useState('');

  useEffect(() => {
    api.getAiInsightsSettings()
      .then((data) => {
        setAiInsightsMode(data.mode || 'session');
        setAiInsightsWeekday(Number.isInteger(data.weekday) ? data.weekday : 1);
        setAiInsightsMonthDay(Number.isInteger(data.month_day) ? data.month_day : 1);
      })
      .catch(() => {})
      .finally(() => setAiInsightsLoading(false));

    api.getSyncDateRange()
      .then((data) => {
        setSyncStartDate(data.sync_start_date || '');
        setSyncEndDate(data.sync_end_date || '');
        setSyncMode(data.sync_mode || 'current');
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    api.getIplicitSyncDateRange()
      .then((data) => {
        if (data.iplicit_start_date && data.iplicit_end_date) {
          setIplicitStartDate(data.iplicit_start_date);
          setIplicitEndDate(data.iplicit_end_date);
        } else {
          // Pre-fill with default: last 13 months from today
          const now = new Date();
          const from    = new Date(now.getFullYear(), now.getMonth() - 12, 1);
          const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
          const pad = n => String(n).padStart(2, '0');
          setIplicitStartDate(`${from.getFullYear()}-${pad(from.getMonth() + 1)}-01`);
          setIplicitEndDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(lastDay)}`);
        }
      })
      .catch(() => {})
      .finally(() => setIplicitLoading(false));

    api.getXeroSyncDateRange()
      .then((data) => {
        if (data.xero_start_date && data.xero_end_date) {
          setXeroStartDate(data.xero_start_date);
          setXeroEndDate(data.xero_end_date);
        } else {
          // Pre-fill with default: last 13 months from today
          const now = new Date();
          const from    = new Date(now.getFullYear(), now.getMonth() - 12, 1);
          const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
          const pad = n => String(n).padStart(2, '0');
          setXeroStartDate(`${from.getFullYear()}-${pad(from.getMonth() + 1)}-01`);
          setXeroEndDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(lastDay)}`);
        }
      })
      .catch(() => {})
      .finally(() => setXeroLoading(false));

    api.getQuickBooksSyncDateRange()
      .then((data) => {
        if (data.quickbooks_start_date && data.quickbooks_end_date) {
          setQbStartDate(data.quickbooks_start_date);
          setQbEndDate(data.quickbooks_end_date);
        } else {
          // Pre-fill with default: last 13 months from today
          const now = new Date();
          const from    = new Date(now.getFullYear(), now.getMonth() - 12, 1);
          const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
          const pad = n => String(n).padStart(2, '0');
          setQbStartDate(`${from.getFullYear()}-${pad(from.getMonth() + 1)}-01`);
          setQbEndDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(lastDay)}`);
        }
      })
      .catch(() => {})
      .finally(() => setQbLoading(false));

  }, []);

  const handleSave = async () => {
    setError('');
    setSaved(false);

    if (syncStartDate && syncEndDate && syncStartDate > syncEndDate) {
      setError('Start date must be before end date');
      return;
    }

    setSaving(true);
    try {
      await api.saveSyncDateRange(syncStartDate || null, syncEndDate || null, syncMode);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      toast.success('Dentally sync date range updated successfully.');
    } catch (err) {
      setError(err.message);
      toast.error('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    toast('Reset Dentally date range to default (last 365 days)?', {
      action: {
        label: 'Yes, reset',
        onClick: async () => {
          setError('');
          setSaving(true);
          try {
            await api.saveSyncDateRange(null, null);
            setSyncStartDate('');
            setSyncEndDate('');
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
            toast.success('Date range reset to default (365 days).');
          } catch (err) {
            setError(err.message);
            toast.error('Failed to reset: ' + err.message);
          } finally {
            setSaving(false);
          }
        },
      },
      cancel: { label: 'Cancel' },
    });
  };

  const handleIplicitSave = async () => {
    setIplicitError('');
    setIplicitSaved(false);

    if (iplicitStartDate && iplicitEndDate && iplicitStartDate > iplicitEndDate) {
      setIplicitError('Start date must be before end date');
      return;
    }

    setIplicitSaving(true);
    try {
      await api.saveIplicitSyncDateRange(iplicitStartDate || null, iplicitEndDate || null);
      setIplicitSaved(true);
      setTimeout(() => setIplicitSaved(false), 3000);
      toast.success('Iplicit sync date range updated successfully.');
    } catch (err) {
      setIplicitError(err.message);
      toast.error('Failed to save: ' + err.message);
    } finally {
      setIplicitSaving(false);
    }
  };

  const handleIplicitReset = async () => {
    toast('Reset Iplicit date range to default (last 13 months)?', {
      action: {
        label: 'Yes, reset',
        onClick: async () => {
          setIplicitError('');
          setIplicitSaving(true);
          try {
            await api.saveIplicitSyncDateRange(null, null);
            setIplicitStartDate('');
            setIplicitEndDate('');
            setIplicitSaved(true);
            setTimeout(() => setIplicitSaved(false), 3000);
            toast.success('Iplicit date range reset to default (last 13 months).');
          } catch (err) {
            setIplicitError(err.message);
            toast.error('Failed to reset: ' + err.message);
          } finally {
            setIplicitSaving(false);
          }
        },
      },
      cancel: { label: 'Cancel' },
    });
  };

  const handleXeroSave = async () => {
    setXeroError('');
    setXeroSaved(false);

    if (xeroStartDate && xeroEndDate && xeroStartDate > xeroEndDate) {
      setXeroError('Start date must be before end date');
      return;
    }

    setXeroSaving(true);
    try {
      await api.saveXeroSyncDateRange(xeroStartDate || null, xeroEndDate || null);
      setXeroSaved(true);
      setTimeout(() => setXeroSaved(false), 3000);
      toast.success('Xero sync date range updated successfully.');
    } catch (err) {
      setXeroError(err.message);
      toast.error('Failed to save: ' + err.message);
    } finally {
      setXeroSaving(false);
    }
  };

  const handleXeroReset = async () => {
    toast('Reset Xero date range to default (last 13 months)?', {
      action: {
        label: 'Yes, reset',
        onClick: async () => {
          setXeroError('');
          setXeroSaving(true);
          try {
            await api.saveXeroSyncDateRange(null, null);
            setXeroStartDate('');
            setXeroEndDate('');
            setXeroSaved(true);
            setTimeout(() => setXeroSaved(false), 3000);
            toast.success('Xero date range reset to default (last 13 months).');
          } catch (err) {
            setXeroError(err.message);
            toast.error('Failed to reset: ' + err.message);
          } finally {
            setXeroSaving(false);
          }
        },
      },
      cancel: { label: 'Cancel' },
    });
  };

  const handleQbSave = async () => {
    setQbError('');
    setQbSaved(false);

    if (qbStartDate && qbEndDate && qbStartDate > qbEndDate) {
      setQbError('Start date must be before end date');
      return;
    }

    setQbSaving(true);
    try {
      await api.saveQuickBooksSyncDateRange(qbStartDate || null, qbEndDate || null);
      setQbSaved(true);
      setTimeout(() => setQbSaved(false), 3000);
      toast.success('QuickBooks sync date range updated successfully.');
    } catch (err) {
      setQbError(err.message);
      toast.error('Failed to save: ' + err.message);
    } finally {
      setQbSaving(false);
    }
  };

  const handleQbReset = async () => {
    toast('Reset QuickBooks date range to default (last 13 months)?', {
      action: {
        label: 'Yes, reset',
        onClick: async () => {
          setQbError('');
          setQbSaving(true);
          try {
            await api.saveQuickBooksSyncDateRange(null, null);
            setQbStartDate('');
            setQbEndDate('');
            setQbSaved(true);
            setTimeout(() => setQbSaved(false), 3000);
            toast.success('QuickBooks date range reset to default (last 13 months).');
          } catch (err) {
            setQbError(err.message);
            toast.error('Failed to reset: ' + err.message);
          } finally {
            setQbSaving(false);
          }
        },
      },
      cancel: { label: 'Cancel' },
    });
  };

  const handleAiInsightsSave = async () => {
    setAiInsightsSaving(true);
    setAiInsightsError('');
    try {
      await api.saveAiInsightsSettings({
        mode: aiInsightsMode,
        weekday: aiInsightsWeekday,
        monthDay: aiInsightsMonthDay,
      });
      setAiInsightsSaved(true);
      toast.success('AI Insights schedule saved');
      setTimeout(() => setAiInsightsSaved(false), 2500);
    } catch (err) {
      setAiInsightsError(err.message || 'Failed to save');
      toast.error('Failed to save: ' + err.message);
    } finally {
      setAiInsightsSaving(false);
    }
  };

  const AI_INSIGHTS_MODES = [
    { value: 'session', label: 'Every visit (new browser session)' },
    { value: 'daily', label: 'Once a day' },
    { value: 'weekly', label: 'Every week — on a selected weekday' },
    { value: 'monthly', label: 'Every month — on a selected date' },
  ];
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const aiSelectStyle = {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    background: '#fff',
    cursor: 'pointer',
  };
  const aiInsightsHint = aiInsightsMode === 'session'
    ? 'Summaries regenerate once per browser session (and whenever the page figures change).'
    : aiInsightsMode === 'daily'
      ? 'The first visit each day generates a fresh summary; the rest of the day reuses it.'
      : aiInsightsMode === 'weekly'
        ? `A fresh summary is generated on the first visit on or after ${WEEKDAYS[aiInsightsWeekday]} each week, then reused until the next ${WEEKDAYS[aiInsightsWeekday]}.`
        : `A fresh summary is generated on the first visit on or after day ${aiInsightsMonthDay} each month, then reused until the same date next month.`;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Settings</h1>
        <p>System configuration</p>
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '24px' }}>
        <div className="settings-card" style={{ flex: 1, minWidth: '280px', maxWidth: '520px' }}>
          <div className="settings-card-header">
            <Sparkles size={20} />
            <div>
              <h3>AI Insights Generation Timeframe</h3>
              <p>How often the per-page “AI Insights” cards in the main app regenerate their summary. Longer timeframes reuse the cached summary and cut token spend; users can always force a refresh with the card’s refresh button.</p>
            </div>
          </div>

          {aiInsightsLoading ? (
            <div className="settings-loading">
              <Loader2 size={20} className="ig-spin" /> Loading settings...
            </div>
          ) : (
            <div className="settings-form">
              <select
                value={aiInsightsMode}
                onChange={(e) => setAiInsightsMode(e.target.value)}
                style={aiSelectStyle}
              >
                {AI_INSIGHTS_MODES.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>

              {aiInsightsMode === 'weekly' && (
                <div style={{ marginTop: '12px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: '#374151' }}>
                    Regenerate on
                  </label>
                  <select
                    value={aiInsightsWeekday}
                    onChange={(e) => setAiInsightsWeekday(Number(e.target.value))}
                    style={aiSelectStyle}
                  >
                    {WEEKDAYS.map((d, i) => (
                      <option key={d} value={i}>{d}</option>
                    ))}
                  </select>
                </div>
              )}

              {aiInsightsMode === 'monthly' && (
                <div style={{ marginTop: '12px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: '#374151' }}>
                    Regenerate on day of month (1–28)
                  </label>
                  <select
                    value={aiInsightsMonthDay}
                    onChange={(e) => setAiInsightsMonthDay(Number(e.target.value))}
                    style={aiSelectStyle}
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              )}

              <p className="settings-hint">{aiInsightsHint}</p>

              {aiInsightsError && <p className="settings-error">{aiInsightsError}</p>}

              <div className="settings-actions">
                <button className="settings-btn settings-btn-primary" onClick={handleAiInsightsSave} disabled={aiInsightsSaving}>
                  {aiInsightsSaving ? (
                    <><Loader2 size={14} className="ig-spin" /> Saving...</>
                  ) : aiInsightsSaved ? (
                    <><CheckCircle2 size={14} /> Saved</>
                  ) : (
                    <><Save size={14} /> Save</>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div className="settings-card" style={{ flex: 1, minWidth: '280px' }}>
        <div className="settings-card-header">
          <Calendar size={20} />
          <div>
            <h3>Dentally Sync Date Range</h3>
            <p>Set the global date range for Dentally data sync. Applies to all organizations when sync is triggered (including auto-sync on new registration).</p>
          </div>
        </div>

        {loading ? (
          <div className="settings-loading">
            <Loader2 size={20} className="ig-spin" /> Loading settings...
          </div>
        ) : (
          <div className="settings-form">
            <div className="settings-date-row">
              <RangePicker
                value={[
                  syncStartDate ? dayjs(syncStartDate) : null,
                  syncEndDate   ? dayjs(syncEndDate)   : null,
                ]}
                onChange={(dates) => {
                  setSyncStartDate(dates ? dates[0].format('YYYY-MM-DD') : '');
                  setSyncEndDate(dates   ? dates[1].format('YYYY-MM-DD') : '');
                }}
                format="DD-MM-YYYY"
                style={{ width: '100%' }}
                size="large"
              />
            </div>

            <div style={{ marginTop: '12px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: '#374151' }}>
                Appointment Filter Mode
              </label>
              <select
                value={syncMode}
                onChange={(e) => setSyncMode(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  background: '#fff',
                  cursor: 'pointer',
                }}
              >
                <option value="current">Current — filter by updated_after / updated_before</option>
                <option value="historical">Historical — filter by after / before (start_time)</option>
              </select>
              <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                {syncMode === 'historical'
                  ? '⚠️ Historical: uses start_time filter (after/before). Use this to match Dentally\'s working hours report.'
                  : 'Current: uses updated_at filter. Best for incremental syncs that pick up state changes.'}
              </p>
            </div>

            <p className="settings-hint">
              {syncStartDate && syncEndDate
                ? `Sync will fetch data from ${syncStartDate} to ${syncEndDate} for all organizations.`
                : 'No date range set. Default: last 365 days from today.'}
            </p>

            {error && <p className="settings-error">{error}</p>}

            <div className="settings-actions">
              <button className="settings-btn settings-btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <><Loader2 size={14} className="ig-spin" /> Saving...</>
                ) : saved ? (
                  <><CheckCircle2 size={14} /> Saved</>
                ) : (
                  <><Save size={14} /> Save</>
                )}
              </button>
              <button className="settings-btn settings-btn-secondary" onClick={handleReset} disabled={saving}>
                <RotateCcw size={14} /> Reset to Default
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Iplicit Sync Date Range */}
      <div className="settings-card" style={{ flex: 1, minWidth: '280px' }}>
        <div className="settings-card-header">
          <Calendar size={20} />
          <div>
            <h3>Iplicit Sync Date Range</h3>
            <p>Set the global date range for Iplicit data sync (Balance Sheet &amp; Profit &amp; Loss). Default is the last 13 months from today.</p>
          </div>
        </div>

        {iplicitLoading ? (
          <div className="settings-loading">
            <Loader2 size={20} className="ig-spin" /> Loading settings...
          </div>
        ) : (
          <div className="settings-form">
            <div className="settings-date-row">
              <RangePicker
                value={[
                  iplicitStartDate ? dayjs(iplicitStartDate) : null,
                  iplicitEndDate   ? dayjs(iplicitEndDate)   : null,
                ]}
                onChange={(dates) => {
                  setIplicitStartDate(dates ? dates[0].format('YYYY-MM-DD') : '');
                  setIplicitEndDate(dates   ? dates[1].format('YYYY-MM-DD') : '');
                }}
                format="DD-MM-YYYY"
                style={{ width: '100%' }}
                size="large"
              />
            </div>

            <p className="settings-hint">
              {iplicitStartDate && iplicitEndDate
                ? `Iplicit sync will fetch data from ${iplicitStartDate} to ${iplicitEndDate} for all organizations.`
                : 'No date range set. Default: last 13 months from today.'}
            </p>

            {iplicitError && <p className="settings-error">{iplicitError}</p>}

            <div className="settings-actions">
              <button className="settings-btn settings-btn-primary" onClick={handleIplicitSave} disabled={iplicitSaving}>
                {iplicitSaving ? (
                  <><Loader2 size={14} className="ig-spin" /> Saving...</>
                ) : iplicitSaved ? (
                  <><CheckCircle2 size={14} /> Saved</>
                ) : (
                  <><Save size={14} /> Save</>
                )}
              </button>
              <button className="settings-btn settings-btn-secondary" onClick={handleIplicitReset} disabled={iplicitSaving}>
                <RotateCcw size={14} /> Reset to Default
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Xero Sync Date Range */}
      <div className="settings-card" style={{ flex: 1, minWidth: '280px' }}>
        <div className="settings-card-header">
          <Calendar size={20} />
          <div>
            <h3>Xero Sync Date Range</h3>
            <p>Set the global date range for Xero invoice sync. Applies to all organizations. Default is the last 13 months from today.</p>
          </div>
        </div>

        {xeroLoading ? (
          <div className="settings-loading">
            <Loader2 size={20} className="ig-spin" /> Loading settings...
          </div>
        ) : (
          <div className="settings-form">
            <div className="settings-date-row">
              <RangePicker
                value={[
                  xeroStartDate ? dayjs(xeroStartDate) : null,
                  xeroEndDate   ? dayjs(xeroEndDate)   : null,
                ]}
                onChange={(dates) => {
                  setXeroStartDate(dates ? dates[0].format('YYYY-MM-DD') : '');
                  setXeroEndDate(dates   ? dates[1].format('YYYY-MM-DD') : '');
                }}
                format="DD-MM-YYYY"
                style={{ width: '100%' }}
                size="large"
              />
            </div>

            <p className="settings-hint">
              {xeroStartDate && xeroEndDate
                ? `Xero sync will fetch invoices from ${xeroStartDate} to ${xeroEndDate} for all organizations.`
                : 'No date range set. Default: last 13 months from today.'}
            </p>

            {xeroError && <p className="settings-error">{xeroError}</p>}

            <div className="settings-actions">
              <button className="settings-btn settings-btn-primary" onClick={handleXeroSave} disabled={xeroSaving}>
                {xeroSaving ? (
                  <><Loader2 size={14} className="ig-spin" /> Saving...</>
                ) : xeroSaved ? (
                  <><CheckCircle2 size={14} /> Saved</>
                ) : (
                  <><Save size={14} /> Save</>
                )}
              </button>
              <button className="settings-btn settings-btn-secondary" onClick={handleXeroReset} disabled={xeroSaving}>
                <RotateCcw size={14} /> Reset to Default
              </button>
            </div>
          </div>
        )}
      </div>

      {/* QuickBooks Sync Date Range */}
      <div className="settings-card" style={{ flex: 1, minWidth: '280px' }}>
        <div className="settings-card-header">
          <Calendar size={20} />
          <div>
            <h3>QuickBooks Sync Date Range</h3>
            <p>Set the global date range for QuickBooks data sync. Applies to all organizations. Default is the last 13 months from today.</p>
          </div>
        </div>

        {qbLoading ? (
          <div className="settings-loading">
            <Loader2 size={20} className="ig-spin" /> Loading settings...
          </div>
        ) : (
          <div className="settings-form">
            <div className="settings-date-row">
              <RangePicker
                value={[
                  qbStartDate ? dayjs(qbStartDate) : null,
                  qbEndDate   ? dayjs(qbEndDate)   : null,
                ]}
                onChange={(dates) => {
                  setQbStartDate(dates ? dates[0].format('YYYY-MM-DD') : '');
                  setQbEndDate(dates   ? dates[1].format('YYYY-MM-DD') : '');
                }}
                format="DD-MM-YYYY"
                style={{ width: '100%' }}
                size="large"
              />
            </div>

            <p className="settings-hint">
              {qbStartDate && qbEndDate
                ? `QuickBooks sync will fetch data from ${qbStartDate} to ${qbEndDate} for all organizations.`
                : 'No date range set. Default: last 13 months from today.'}
            </p>

            {qbError && <p className="settings-error">{qbError}</p>}

            <div className="settings-actions">
              <button className="settings-btn settings-btn-primary" onClick={handleQbSave} disabled={qbSaving}>
                {qbSaving ? (
                  <><Loader2 size={14} className="ig-spin" /> Saving...</>
                ) : qbSaved ? (
                  <><CheckCircle2 size={14} /> Saved</>
                ) : (
                  <><Save size={14} /> Save</>
                )}
              </button>
              <button className="settings-btn settings-btn-secondary" onClick={handleQbReset} disabled={qbSaving}>
                <RotateCcw size={14} /> Reset to Default
              </button>
            </div>
          </div>
        )}
      </div>

      </div>{/* end flex row */}
    </div>
  );
}
