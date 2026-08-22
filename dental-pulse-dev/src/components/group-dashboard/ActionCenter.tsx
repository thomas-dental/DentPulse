import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFilters } from '@/contexts/FilterContext';
import {
  useActionCenter,
  groupByLocation,
  type ActionItem,
  type ActionSeverity,
  type ActionCenterInput,
} from '@/hooks/useActionCenter';

/**
 * Exceptions & Action Center (dashboard Zone 0).
 *
 * Same two cards as the original design — the exceptions card and the Monday
 * digest beside it. Rows are grouped Category → Site, and each row is badged
 * with its PRIORITY (critical / moderate / low) and the ROLE that owns it, so
 * it's obvious at a glance who does what, where, and in what order.
 */

/** Severity → the existing .exsev colour-bar classes. */
const SEV_CLASS: Record<ActionSeverity, 'r' | 'a' | 'g'> = {
  critical: 'r',
  moderate: 'a',
  low: 'g',
};
const SEV_BADGE: Record<ActionSeverity, string> = {
  critical: 'crit',
  moderate: 'mod',
  low: 'low',
};
const SEV_EMOJI: Record<ActionSeverity, string> = {
  critical: '🔴',
  moderate: '🟠',
  low: '🟢',
};
const SEV_LABEL: Record<ActionSeverity, string> = {
  critical: 'Critical',
  moderate: 'Moderate',
  low: 'Low',
};
const AUDIENCE_LABEL = {
  owner: 'Owner',
  manager: 'Practice Manager',
  both: 'Owner · Practice Manager',
} as const;

const fmtMoneyShort = (v: number) => `£${Math.round(Math.abs(v) / 1000).toLocaleString('en-GB')}k`;

function Row({ item }: { item: ActionItem }) {
  const sev = SEV_CLASS[item.severity];
  return (
    <div className="exrow">
      <div className={`exsev ${sev}`} />
      <div className="extxt">
        <b>{item.title}</b>
        <div className="exbadges">
          <span className={`exbadge ${SEV_BADGE[item.severity]}`}>
            {SEV_EMOJI[item.severity]} {SEV_LABEL[item.severity]}
          </span>
          <span className="exbadge">{AUDIENCE_LABEL[item.audience]}</span>
        </div>
        <div className="exwhy">
          {item.detail}
          {item.to && item.cta && (
            <> <Link to={item.to}>{item.cta} →</Link></>
          )}
        </div>
      </div>
      {item.value && (
        <div className="exval"><span className={`aval ${sev}`}>{item.value}</span></div>
      )}
    </div>
  );
}

/** One category block: heading, then the rows separated by site. */
function CategoryBlock({ title, items }: { title: string; items: ActionItem[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <div className="excat">{title}</div>
      {groupByLocation(items).map(([location, rows]) => (
        <div key={location}>
          <div className="exloc">{location}</div>
          {rows.map((i) => <Row key={i.id} item={i} />)}
        </div>
      ))}
    </>
  );
}

export function ActionCenter({
  vm,
  siteExceptions,
  onPlan,
  periodShort,
}: ActionCenterInput & {
  onPlan: Array<{ locationId: string; name: string }>;
  periodShort: string;
}) {
  const { byCategory, counts, viewerAudience, isLoading } = useActionCenter({ vm, siteExceptions });
  const { selectedLocationId } = useFilters();
  const [copied, setCopied] = useState(false);

  const nothing = counts.total === 0;

  /* The "on plan" summary follows the location filter: every site when All is
     selected, otherwise just the chosen one. */
  const scopedSites = useMemo(
    () => (selectedLocationId ? vm.sites.filter((s) => s.locationId === selectedLocationId) : vm.sites),
    [vm.sites, selectedLocationId],
  );
  const scopedOnPlan = useMemo(
    () => (selectedLocationId ? onPlan.filter((s) => s.locationId === selectedLocationId) : onPlan),
    [onPlan, selectedLocationId],
  );

  /* Monday digest — built from exactly the rows rendered beside it. */
  const digest = useMemo(() => {
    const today = new Date().toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
    const lines: string[] = [];
    lines.push(`*DentPulse · ${today}*`);
    const marginBit = vm.margin != null ? ` (${vm.margin.toFixed(1)}% margin)` : '';
    lines.push(`Profit ${fmtMoneyShort(vm.profit)} ${periodShort}${marginBit}. ${scopedOnPlan.length} of ${scopedSites.length} sites on plan.`);

    const urgent = byCategory.urgent.filter((i) => i.severity !== 'low').slice(0, 4);
    if (urgent.length) {
      lines.push('');
      lines.push('*Needs action*');
      urgent.forEach((i) =>
        lines.push(`${SEV_EMOJI[i.severity]} ${i.location} — ${i.title}${i.value ? ` (${i.value})` : ''}`));
    }
    if (byCategory.missing.length) {
      lines.push('');
      lines.push('*Missing data*');
      byCategory.missing.slice(0, 3).forEach((i) => lines.push(`• ${i.title}`));
    }
    if (byCategory.recommendation.length) {
      const top = byCategory.recommendation[0];
      lines.push('');
      lines.push('*Top opportunity*');
      lines.push(`💡 ${top.title}${top.value ? ` — ${top.value}` : ''}`);
    }
    if (!urgent.length && !byCategory.missing.length) {
      lines.push('');
      lines.push('✅ Nothing critical this week.');
    }
    return lines.join('\n');
  }, [byCategory, vm.profit, vm.margin, scopedSites.length, scopedOnPlan.length, periodShort]);

  const copyDigest = async () => {
    try {
      await navigator.clipboard.writeText(digest);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section>
      <div className="sec-head">
        <h2>Exceptions</h2>
        <span className="sub">What needs you this week - everything else is on plan</span>
        <span className="pill ind" style={{ marginLeft: 'auto' }}>
          {viewerAudience === 'owner' ? 'Owner' : 'Practice Manager'}
        </span>
      </div>
      <div className="exwrap">

        <div className="card" style={{ padding: '14px 16px' }}>
          <div className="exsummary">
            <b>{scopedOnPlan.length} of {scopedSites.length} site{scopedSites.length === 1 ? '' : 's'} on plan</b>
            {scopedOnPlan.map((s) => <span className="okchip" key={s.locationId}>✓ {s.name}</span>)}
          </div>

          {nothing && (
            <div className="exrow">
              <div className="exsev g" />
              <div className="extxt">
                <b>{isLoading ? 'Checking connections…' : 'No exceptions this period'}</b>
                <div className="exwhy">Every active site is within the group thresholds, and all data sources are connected.</div>
              </div>
            </div>
          )}

          <CategoryBlock title="Urgent actions" items={byCategory.urgent} />
          <CategoryBlock title="Missing data" items={byCategory.missing} />
          <CategoryBlock title="Recommendations" items={byCategory.recommendation} />
        </div>

        <div className="card wacard">
          <div className="walab">
            Monday digest · preview
            <button className="excopy" onClick={copyDigest} type="button">
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div className="wabubble">
            {vm.isCostsLoading
              ? 'Building this period’s figures…'
              : digest.split('\n').map((l, i) => (
                  <span key={i}>{l.replace(/\*/g, '')}<br /></span>
                ))}
          </div>
          <div className="wanote">
            Built from this page's live figures — a scheduled WhatsApp/email digest isn't connected yet.
          </div>
        </div>

      </div>
    </section>
  );
}
