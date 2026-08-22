import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, Loader2, Printer } from 'lucide-react';
import { useEbitdaValuation } from '@/hooks/useEbitdaValuation';
import { useOrganization } from '@/hooks/useOrganization';
import { useLocations } from '@/hooks/useLocations';
import { useFilters, FilterContext, type FilterContextType } from '@/contexts/FilterContext';
import { useAllProvidersNetProduction } from '@/hooks/useAllProvidersNetProduction';
import { useTreatmentInsights } from '@/hooks/useTreatmentInsights';
import { useCostImpactData } from '@/hooks/useCostImpactData';
import { SITE_LOGOS } from '@/lib/integrationLogos';

// ─── Design tokens (MODERN FINTECH / premium SaaS data-report) ───
// Light UI, big bold numbers, KPI cards, colourful data-viz, rounded cards
// with soft shadows, vibrant indigo/orange accents. One token object reused
// everywhere. `T` is kept as an alias of FT so any lingering reference still
// resolves to a sensible value during the restyle.
const FT = {
  // Page + surfaces
  page: '#f4f6fb',
  surface: '#ffffff',
  surfaceAlt: '#f7f8fd',
  cardBorder: '#eef1f7',
  border: '#eef1f7',
  borderStrong: '#e3e8f2',
  // Ink
  ink: '#0f1a3d',
  body: '#3a4258',
  muted: '#7a8499',
  // Brand
  brand: '#4f5bff',
  brandDeep: '#3a3bff',
  orange: '#f57c4d',
  // Semantic
  pos: '#10b981',
  neg: '#f43f5e',
  warn: '#f59e0b',
  info: '#38bdf8',
  // Kept aliases (legacy names used across the file)
  navy: '#0f1a3d',
  amber: '#f59e0b',
  index: '#aab2c2',
  // Shape & depth
  radius: '16px',
  radiusInner: '10px',
  pill: '999px',
  cardShadow: '0 4px 20px rgba(16,26,61,0.06)',
  // Data-viz palette — cycle through for chart series / category bars / accents
  viz: ['#4f5bff', '#8b5cf6', '#14b8a6', '#10b981', '#f59e0b', '#f57c4d', '#f43f5e', '#38bdf8'],
};
// Backwards-compatible alias so any remaining `T.*` reference resolves.
const T = FT;

// ─── Card: white rounded surface, hairline border, soft shadow ───
function Card({
  children,
  style,
  className,
  pad = '20px',
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  pad?: string;
}) {
  return (
    <div
      className={className}
      style={{
        background: FT.surface,
        border: `1px solid ${FT.cardBorder}`,
        borderRadius: FT.radius,
        boxShadow: FT.cardShadow,
        padding: pad,
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── Pill: rounded-full tinted status chip ───
type PillTone = 'positive' | 'negative' | 'warning' | 'neutral' | 'brand' | 'info';
const PILL_TONES: Record<PillTone, { bg: string; text: string }> = {
  positive: { bg: '#ecfdf5', text: '#059669' },
  negative: { bg: '#fef2f2', text: '#e11d48' },
  warning: { bg: '#fffbeb', text: '#d97706' },
  neutral: { bg: '#eef1f7', text: '#4a5568' },
  brand: { bg: '#eef0ff', text: '#4f5bff' },
  info: { bg: '#eff8ff', text: '#0284c7' },
};
function Pill({ tone = 'neutral', children, style }: { tone?: PillTone; children: React.ReactNode; style?: React.CSSProperties }) {
  const t = PILL_TONES[tone];
  return (
    <span
      className="inline-flex items-center"
      style={{
        background: t.bg,
        color: t.text,
        borderRadius: FT.pill,
        fontSize: '10px',
        fontWeight: 600,
        padding: '4px 10px',
        letterSpacing: '0.01em',
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// ─── KpiCard: small uppercase label, BIG bold value, coloured accent top-bar ───
function KpiCard({
  label,
  value,
  accent = FT.brand,
  delta,
  deltaTone = 'neutral',
  sub,
  valueSize = '32px',
}: {
  label: string;
  value: React.ReactNode;
  accent?: string;
  delta?: React.ReactNode;
  deltaTone?: PillTone;
  sub?: React.ReactNode;
  valueSize?: string;
}) {
  return (
    <div
      style={{
        background: FT.surface,
        border: `1px solid ${FT.cardBorder}`,
        borderRadius: FT.radius,
        boxShadow: FT.cardShadow,
        overflow: 'hidden',
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
      }}
    >
      <div style={{ height: '3px', background: accent, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
      <div style={{ padding: '14px 16px 16px' }}>
        <div className="flex items-center justify-between">
          <p className="uppercase" style={{ color: FT.muted, fontSize: '10px', fontWeight: 600, letterSpacing: '0.12em' }}>
            {label}
          </p>
          {delta ? <Pill tone={deltaTone}>{delta}</Pill> : null}
        </div>
        <p
          className="tabular-nums leading-none"
          style={{ color: FT.ink, fontSize: valueSize, fontWeight: 800, letterSpacing: '-0.6px', marginTop: '10px' }}
        >
          {value}
        </p>
        {sub ? <p style={{ color: FT.muted, fontSize: '10px', marginTop: '7px', lineHeight: 1.4 }}>{sub}</p> : null}
      </div>
    </div>
  );
}

// ─── SectionHeader / PageHeader (modern fintech) ───
// Brand-colour UPPERCASE eyebrow → bold ink page title → a short 40px coloured
// underline. Optional muted page-index pill top-right ("06"). Kept named
// `PageHeader` (and `size`/`right`/`index` props) so all existing call-sites work.
function PageHeader({
  eyebrow,
  title,
  index,
  size = 'lg',
  right,
}: {
  eyebrow: string;
  title: string;
  index?: string;
  size?: 'lg' | 'md';
  right?: React.ReactNode;
}) {
  const titleSize = size === 'lg' ? '30px' : '26px';
  // Index may be passed as "06 / 17" — show just the leading page number as a pill.
  const idxNum = index ? index.split('/')[0].trim() : undefined;
  return (
    <div style={{ marginBottom: size === 'lg' ? '22px' : '16px' }}>
      <div className="flex items-start justify-between">
        <div>
          <p
            className="uppercase"
            style={{ color: FT.brand, fontSize: '10.5px', letterSpacing: '0.12em', fontWeight: 700, marginBottom: '7px' }}
          >
            {eyebrow}
          </p>
          <h2
            className="leading-none"
            style={{ color: FT.ink, fontSize: titleSize, fontWeight: 700, letterSpacing: '-0.6px' }}
          >
            {title}
          </h2>
          <div style={{ marginTop: '10px', height: '3px', width: '40px', borderRadius: '999px', background: FT.brand, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
        </div>
        {right ? (
          right
        ) : idxNum ? (
          <span
            className="tabular-nums inline-flex items-center"
            style={{ color: FT.muted, fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', background: FT.surfaceAlt, border: `1px solid ${FT.cardBorder}`, borderRadius: FT.pill, padding: '4px 12px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
          >
            {idxNum}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ─── Hero-stat card (a single key figure rendered big & bold) ───
// Brand eyebrow → huge bold ink number with a gradient accent ring → caption.
function HeroStat({
  eyebrow,
  value,
  suffix,
  caption,
  accent = FT.brand,
}: {
  eyebrow: string;
  value: React.ReactNode;
  suffix?: React.ReactNode;
  caption: string;
  accent?: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{
        background: FT.surface,
        border: `1px solid ${FT.cardBorder}`,
        borderRadius: FT.radius,
        boxShadow: FT.cardShadow,
        padding: '30px 26px',
        position: 'relative',
        overflow: 'hidden',
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: `linear-gradient(90deg, ${accent}, ${FT.orange})`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
      <p className="uppercase" style={{ color: FT.brand, fontSize: '10px', letterSpacing: '0.12em', fontWeight: 700, marginBottom: '14px' }}>
        {eyebrow}
      </p>
      <p className="tabular-nums leading-none" style={{ color: FT.ink, fontSize: '58px', fontWeight: 800, letterSpacing: '-2px' }}>
        {value}
        {suffix}
      </p>
      <p style={{ color: FT.muted, fontSize: '11px', lineHeight: 1.5, marginTop: '16px', maxWidth: '260px' }}>
        {caption}
      </p>
    </div>
  );
}

// Card title row: bold ink text + short brand underline.
function CardTitle({ title }: { title: string }) {
  return (
    <div style={{ padding: '14px 18px 11px', borderBottom: `1px solid ${FT.cardBorder}` }}>
      <span style={{ fontSize: '12px', fontWeight: 700, color: FT.ink, letterSpacing: '0.01em' }}>{title}</span>
      <div style={{ height: '3px', width: '32px', borderRadius: '999px', background: FT.brand, marginTop: '6px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
    </div>
  );
}

// ─── Formatters ───
const formatCurrency = (value: number | null | undefined): string => {
  const n = value ?? 0;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
};

const formatPct = (value: number | null | undefined, digits = 1): string =>
  `${(value ?? 0).toFixed(digits)}%`;

// UK postcode pattern (e.g. NP26 4AA, IV30 1LE, LU2 9XG).
const UK_POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
// Normalise the displayed country. These are UK dental practices; some location
// records carry bad seed data ("USA") against clearly-UK addresses, so a valid
// UK postcode is treated as authoritative and obvious US placeholders are
// corrected to United Kingdom.
const normaliseCountry = (country?: string | null, postcode?: string | null): string => {
  if (postcode && UK_POSTCODE_RE.test(postcode)) return 'United Kingdom';
  const c = (country || '').trim();
  if (!c || /^(usa|u\.?s\.?a?\.?|united states)$/i.test(c)) return 'United Kingdom';
  return c;
};

const DAYS: Array<{ key: string; label: string }> = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
];

function formatHours(oh: Record<string, any> | null | undefined, day: string): string {
  if (!oh) return '—';
  const entry = oh[day];
  if (!entry) return 'Closed';
  if (typeof entry === 'string') return entry;
  if (entry.closed) return 'Closed';
  if (entry.open && entry.close) return `${entry.open} – ${entry.close}`;
  return '—';
}

// ─── Page Wrapper ───
function PdfPage({ children, footer }: { children: React.ReactNode; footer?: string }) {
  return (
    <section className="pdf-page pdf-page-content bg-white w-full max-w-[210mm] mx-auto shadow-lg" style={{ minHeight: '297mm' }}>
      <div className="px-12 py-10 h-full flex flex-col">
        <div className="flex-1">{children}</div>
        {footer && (
          <div className="pt-6 mt-6 border-t border-[#d4d4d4] text-[10px] text-[#666] text-center tracking-wider">
            {footer}
          </div>
        )}
      </div>
    </section>
  );
}

// When true, every lazy page is forced to mount so a print/PDF export captures
// the whole document regardless of scroll position. Provided by GeneratePdf
// around the preview subtree.
const PrintModeContext = createContext(false);

// ─── Auto-scale wrapper: shrinks an A4-sized element to fit any viewport ───
// In print mode the transform is reset so the saved PDF uses real A4 dimensions.
//
// `lazy` (default true) defers building this page's children until it scrolls
// near the viewport — the document is 17+ A4 pages (× every location in
// multi-location mode), so eagerly constructing every page's DOM up-front is
// the main initial-render cost. Once a page has been seen it stays mounted (we
// never unmount) to avoid scroll thrash and keep the export stable. Pages whose
// children fetch their own data — or that must never flash empty (the cover) —
// opt out with `lazy={false}`. Print mode (PrintModeContext) force-mounts every
// lazy page; since lazy pages are purely presentational their content renders
// synchronously, so the captured PDF is always complete.
function AutoScalePage({
  widthMm,
  heightMm,
  children,
  pageClass,
  lazy = true,
}: {
  widthMm: number;
  heightMm: number;
  children: React.ReactNode;
  pageClass: string;
  lazy?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const printing = useContext(PrintModeContext);
  const [seen, setSeen] = useState(!lazy);

  useEffect(() => {
    if (!lazy || seen) return;
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some(e => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      // Mount ~1.5 screens ahead of the scroll so a page is ready before it's
      // visible — the user never sees a blank page while scrolling.
      { rootMargin: '1500px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [lazy, seen]);

  const renderChildren = seen || printing;

  useLayoutEffect(() => {
    const MM_PX = 96 / 25.4; // 1mm at 96dpi
    const targetWidthPx = widthMm * MM_PX;
    const update = () => {
      const w = wrapRef.current?.offsetWidth ?? targetWidthPx;
      setScale(Math.min(1, w / targetWidthPx));
    };
    update();
    const ro = new ResizeObserver(update);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [widthMm]);

  return (
    <div
      ref={wrapRef}
      className="pdf-scale-wrap relative w-full"
      style={{
        // Reserve only as much vertical space as the scaled page actually occupies.
        maxWidth: `${widthMm}mm`,
        height: `calc(${heightMm}mm * ${scale})`,
        overflow: 'hidden',
      }}
    >
      <div
        className={pageClass}
        style={{
          width: `${widthMm}mm`,
          height: `${heightMm}mm`,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        {renderChildren ? children : null}
      </div>
    </div>
  );
}

// ─── IM Landscape footer (navy bar + DentPulse logo + orange swoosh) ───
function IMLandscapeFooter() {
  return (
    <div className="absolute bottom-0 left-0 right-0" style={{ height: '54px', zIndex: 2 }}>
      {/* Hairline top rule with a short brand accent at the left */}
      <div className="absolute left-14 right-14 top-0" style={{ height: '1px', background: FT.cardBorder }} />
      <div className="absolute left-14 top-0" style={{ height: '2px', width: '40px', borderRadius: '999px', background: FT.brand, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
      <div className="relative h-full flex items-center justify-between px-14">
        <div className="flex items-center gap-3">
          <img
            src={SITE_LOGOS.logoDark}
            alt="DentPulse"
            className="h-[24px] w-auto object-contain"
            crossOrigin="anonymous"
          />
          <div className="border-l pl-3" style={{ borderColor: T.border }}>
            <p className="text-[10px] font-bold tracking-[0.18em] leading-none" style={{ color: T.navy }}>DENTPULSE</p>
            <p className="text-[8px] tracking-[0.22em] leading-none mt-1" style={{ color: T.muted }}>EBITDA-TO-VALUE™</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Chair Occupancy donut (colourful gradient arc, big centre %) ───
function ChairOccupancyPie({ usedPct }: { usedPct: number }) {
  const used = Math.max(0, Math.min(100, usedPct));
  const size = 230;
  const cx = size / 2;
  const cy = size / 2;
  const r = 88;
  const stroke = 22;
  const circ = 2 * Math.PI * r;
  const dash = (used / 100) * circ;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
      <defs>
        <linearGradient id="ftDonut" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={FT.brand} />
          <stop offset="55%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor={FT.orange} />
        </linearGradient>
      </defs>
      {/* Track */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#eef1f7" strokeWidth={stroke} />
      {/* Used arc — rounded ends, starts at 12 o'clock */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="url(#ftDonut)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeDashoffset={circ * 0.25}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      {/* Centre value */}
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize="40" fontWeight="800" fill={FT.ink} style={{ letterSpacing: '-1px' }}>
        {used.toFixed(1)}%
      </text>
      <text x={cx} y={cy + 22} textAnchor="middle" fontSize="11" fontWeight="600" fill={FT.muted} style={{ letterSpacing: '0.12em' }}>
        UTILISED
      </text>
    </svg>
  );
}

// ─── IM table block (minimal card: navy title + orange underline, hairline rows) ───
function IMTable({
  title,
  rows,
  labelWidth = '45%',
}: {
  title: string;
  rows: Array<[label: string, value: React.ReactNode]>;
  labelWidth?: string;
}) {
  return (
    <div style={{ background: FT.surface, border: `1px solid ${FT.cardBorder}`, borderRadius: FT.radius, overflow: 'hidden', boxShadow: FT.cardShadow, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
      <CardTitle title={title} />
      <table className="w-full" style={{ fontSize: '12px' }}>
        <tbody>
          {rows.map(([label, value], i) => (
            <tr key={i} style={{ borderBottom: i < rows.length - 1 ? `1px solid ${FT.cardBorder}` : 'none' }}>
              <td
                className="px-[18px] py-2.5 align-middle"
                style={{ width: labelWidth, color: FT.muted, fontSize: '11px' }}
              >
                {label}
              </td>
              <td className="px-[18px] py-2.5 text-right align-middle tabular-nums" style={{ color: FT.ink, fontWeight: 600 }}>
                {value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Minimal table header cell + table-title helpers ───
// Used by the multi-column data tables to keep a consistent thin look.
function TableTitle({ title }: { title: string }) {
  return (
    <div style={{ marginBottom: '10px' }}>
      <span style={{ fontSize: '12px', fontWeight: 700, color: FT.ink, letterSpacing: '0.01em' }}>{title}</span>
      <div style={{ height: '3px', width: '32px', borderRadius: '999px', background: FT.brand, marginTop: '6px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
    </div>
  );
}

// ─── Wireframe Plant SVG (cover illustration) ───
function WireframePlant() {
  return (
    <svg viewBox="0 0 400 500" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="glow" cx="50%" cy="55%" r="50%">
          <stop offset="0%" stopColor="#5b8cff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#0a1640" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="200" cy="270" r="180" fill="url(#glow)" />

      {/* Main stem */}
      <line x1="200" y1="180" x2="200" y2="470" stroke="white" strokeWidth="1.2" opacity="0.85" />
      <line x1="200" y1="470" x2="160" y2="490" stroke="white" strokeWidth="0.8" opacity="0.6" />
      <line x1="200" y1="470" x2="240" y2="490" stroke="white" strokeWidth="0.8" opacity="0.6" />

      {/* Right large leaf */}
      <g stroke="white" strokeWidth="1" fill="none" opacity="0.9">
        <polygon points="200,250 280,200 360,180 380,220 340,260 270,270" />
        <line x1="200" y1="250" x2="360" y2="180" />
        <line x1="200" y1="250" x2="340" y2="260" />
        <line x1="280" y1="200" x2="340" y2="260" />
        <line x1="280" y1="200" x2="380" y2="220" />
        <line x1="360" y1="180" x2="270" y2="270" />
      </g>

      {/* Left large leaf */}
      <g stroke="white" strokeWidth="1" fill="none" opacity="0.85">
        <polygon points="200,290 120,270 40,290 30,330 90,360 170,330" />
        <line x1="200" y1="290" x2="40" y2="290" />
        <line x1="200" y1="290" x2="90" y2="360" />
        <line x1="120" y1="270" x2="90" y2="360" />
        <line x1="40" y1="290" x2="170" y2="330" />
        <line x1="30" y1="330" x2="120" y2="270" />
      </g>

      {/* Top right small leaf */}
      <g stroke="white" strokeWidth="0.9" fill="none" opacity="0.85">
        <polygon points="200,200 245,160 295,140 305,170 270,195 230,205" />
        <line x1="200" y1="200" x2="295" y2="140" />
        <line x1="245" y1="160" x2="305" y2="170" />
        <line x1="200" y1="200" x2="270" y2="195" />
      </g>

      {/* Top left small leaf */}
      <g stroke="white" strokeWidth="0.9" fill="none" opacity="0.8">
        <polygon points="200,210 155,170 105,160 95,195 135,215 180,215" />
        <line x1="200" y1="210" x2="105" y2="160" />
        <line x1="155" y1="170" x2="95" y2="195" />
        <line x1="200" y1="210" x2="135" y2="215" />
      </g>

      {/* Top tip */}
      <g stroke="white" strokeWidth="0.9" fill="none" opacity="0.9">
        <polygon points="200,180 185,140 200,110 215,140" />
        <line x1="200" y1="180" x2="200" y2="110" />
      </g>

      {/* Nodes / dots */}
      {[
        [200, 110], [200, 180], [200, 250], [200, 290], [200, 350], [200, 410],
        [105, 160], [305, 170], [40, 290], [360, 180], [90, 360], [340, 260],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="2.2" fill="white" opacity="0.9" />
      ))}

      {/* Ground glow */}
      <ellipse cx="200" cy="490" rx="80" ry="6" fill="white" opacity="0.15" />
    </svg>
  );
}

// ─── Per-location revenue row (multi-location overview page) ───
// Each row is its own React component so it can legally call the
// useAllProvidersNetProduction hook scoped to ONE location_id. Rendering N
// rows fires N parallel React-Query fetches via React Query's normal cache,
// avoiding the "hooks in a loop" anti-pattern.
function LocationRevenueRow({
  loc,
  startDate,
  endDate,
  regionName,
  showRegion,
  index,
}: {
  loc: any;
  startDate: Date;
  endDate: Date;
  regionName: string | null;
  showRegion: boolean;
  index: number;
}) {
  const { data } = useAllProvidersNetProduction(null, startDate, endDate, loc.id);
  const providers = data?.providers ?? [];
  const totalRevenue = providers.reduce((s, p) => s + p.total, 0);
  const totalPrivate = providers.reduce((s, p) => s + p.totalPrivate, 0);
  const totalNhs = providers.reduce((s, p) => s + p.totalNhs, 0);
  const totalMembership = providers.reduce((s, p) => s + p.totalMembership, 0);
  const privatePct = totalRevenue > 0 ? (totalPrivate / totalRevenue) * 100 : 0;

  const fmt = (n: number) =>
    n > 0 ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n) : '—';

  return (
    <tr className={index % 2 === 0 ? 'bg-white' : 'bg-[#f7f8fd]'}>
      <td className="px-3 py-2.5 text-[#1a2557] font-medium border border-[#eef1f7]">
        <div className="flex items-center gap-1.5">
          {loc.is_primary && (
            <span className="inline-block px-2 py-0.5 text-[8.5px] font-bold text-white tracking-wide" style={{ background: '#4f5bff', borderRadius: '999px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>PRIMARY</span>
          )}
          <span>{loc.location_name || '—'}</span>
        </div>
        {loc.location_code && (
          <span className="text-[#666]" style={{ fontSize: '10px' }}>{loc.location_code}</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-[#2a2a2a] border border-[#eef1f7]" style={{ fontSize: '11px' }}>
        {loc.city || '—'}
      </td>
      {showRegion && (
        <td className="px-3 py-2.5 text-center text-[#2a2a2a] border border-[#eef1f7]" style={{ fontSize: '11px' }}>
          {regionName || '—'}
        </td>
      )}
      <td className="px-3 py-2.5 text-center tabular-nums text-[#1a2557] font-semibold border border-[#eef1f7]">
        {loc.chairs_count ?? '—'}
      </td>
      <td className="px-3 py-2.5 text-center tabular-nums text-[#1a2557] font-semibold border border-[#eef1f7]">
        {providers.length}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums border border-[#eef1f7]">
        {fmt(totalPrivate)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums border border-[#eef1f7]">
        {fmt(totalNhs + totalMembership)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#1a2557] border border-[#eef1f7]">
        {fmt(totalRevenue)}
      </td>
      <td className="px-3 py-2.5 text-center border border-[#eef1f7]" style={{ fontSize: '11px' }}>
        {totalRevenue > 0 ? (
          <Pill tone={privatePct >= 60 ? 'positive' : privatePct >= 35 ? 'warning' : 'negative'}>{privatePct.toFixed(1)}%</Pill>
        ) : '—'}
      </td>
    </tr>
  );
}

// ─── Section Header (green underline like IM) ───
function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-[22px] font-bold text-[#1f4e3d] tracking-tight">{title}</h2>
      <div className="h-[3px] w-full bg-[#3b8d6e] mt-1" />
    </div>
  );
}

// ─── Per-practice section (the 12 location-scoped pages) ───
// All hooks here read the (possibly OVERRIDDEN) FilterContext via useFilters().
// When the parent renders this inside a <FilterContext.Provider> with a
// selectedLocationId override, every data hook (and react-query key) is scoped
// to that single location. The `location` prop is informational only — the
// authoritative scope is the overridden filter context; we still resolve a
// `location` record from the scoped location list for display.
function PracticeSection({ onReady, readyKey }: { onReady?: (key: string, ready: boolean) => void; readyKey: string }) {
  const { valuation: d, isLoading } = useEbitdaValuation();
  const { organization } = useOrganization();
  const { allAvailableLocations, regions } = useLocations();
  const { selectedLocationId, selectedRegionId, dateRange } = useFilters();

  // Region scope for providers — mirrors useEbitdaValuation so Clinicians and
  // Principal Turnover % respect a region filter when no specific location set.
  const regionLocationIds = useMemo(() => {
    if (!selectedRegionId || selectedLocationId) return null;
    return (allAvailableLocations ?? [])
      .filter(l => l.region_id === selectedRegionId)
      .map(l => l.id);
  }, [allAvailableLocations, selectedRegionId, selectedLocationId]);

  const { data: providerData } = useAllProvidersNetProduction(
    null,
    dateRange.startDate,
    dateRange.endDate,
    selectedLocationId,
    regionLocationIds,
  );
  const { revenueByCategory } = useTreatmentInsights();

  // Prior-period range = same window shifted back one year.
  const priorDateRange = useMemo(() => ({
    startDate: new Date(dateRange.startDate.getFullYear() - 1, dateRange.startDate.getMonth(), dateRange.startDate.getDate()),
    endDate: new Date(dateRange.endDate.getFullYear() - 1, dateRange.endDate.getMonth(), dateRange.endDate.getDate()),
  }), [dateRange]);

  const { data: priorCostImpact } = useCostImpactData({ dateRangeOverride: priorDateRange });

  const periodEnd = useMemo(
    () => dateRange.endDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    [dateRange.endDate],
  );

  // Scoped locations: filter by region if a region is selected.
  const scopedLocations = useMemo(() => {
    const list = allAvailableLocations ?? [];
    if (!selectedRegionId) return list;
    return list.filter(l => l.region_id === selectedRegionId);
  }, [allAvailableLocations, selectedRegionId]);

  // Primary location for display — honours both region and location filters.
  const location = useMemo(() => {
    if (selectedLocationId) {
      return scopedLocations.find(l => l.id === selectedLocationId)
        ?? allAvailableLocations?.find(l => l.id === selectedLocationId)
        ?? scopedLocations[0]
        ?? allAvailableLocations?.[0];
    }
    return scopedLocations.find(l => l.is_primary) ?? scopedLocations[0] ?? allAvailableLocations?.[0];
  }, [allAvailableLocations, scopedLocations, selectedLocationId]);

  const practiceName = location?.location_name || organization?.name || 'Dental Practice';

  // ── Clinicians rows (page 11) — above the early return so hook order stays stable.
  const clinicianRows = useMemo(() => {
    const provs = (providerData?.providers ?? [])
      .slice()
      .sort((a, b) => b.total - a.total);
    const totalRevForPct = provs.reduce((s, p) => s + p.total, 0);
    return provs.slice(0, 8).map((p, i) => {
      const isPrincipal = i === 0;
      const isVisiting = p.totalNhs === 0 && p.totalMembership > 0 && p.totalPrivate < (totalRevForPct * 0.1);
      return {
        name: isPrincipal ? 'Principal' : isVisiting ? 'Visiting Implantologist' : (i === 1 ? 'Associate' : p.providerName),
        weeklyHours: isPrincipal ? '—' : '—',
        privateIncome: p.totalPrivate > 0 ? formatCurrency(p.totalPrivate) : '-',
        specialistIncome: (p.totalNhs + p.totalMembership) > 0 ? formatCurrency(p.totalNhs + p.totalMembership) : '-',
        payRate: '—',
        totalIncome: formatCurrency(p.total),
        commentary: isPrincipal
          ? 'Currently owner-occupied, supported by part-time associate'
          : '',
      };
    });
  }, [providerData]);

  // ── Income Breakdown rows (page 4) — above the early return to keep hook order stable.
  const incomeBreakdown = useMemo(() => {
    const live = (revenueByCategory ?? [])
      .filter(c => c.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);
    const totalCat = live.reduce((s, c) => s + c.revenue, 0) || 1;
    const liveRows = live.slice(0, 7).map(c => ({
      label: c.category,
      pct: (c.revenue / totalCat) * 100,
      amount: c.revenue,
    }));
    const placeholders = ['NHS', 'NHS Ortho', 'Private', 'Capitation', 'Specialist', 'Hygiene', 'Sundries'];
    const existingLabels = new Set(liveRows.map(r => r.label.toLowerCase()));
    placeholders.forEach(p => {
      if (liveRows.length < 7 && !existingLabels.has(p.toLowerCase())) {
        liveRows.push({ label: p, pct: 0, amount: 0 });
      }
    });
    return liveRows.slice(0, 7);
  }, [revenueByCategory]);

  // Report this section's data-readiness up to GeneratePdf so it can block the
  // "Generate PDF" action until EVERY per-location section is past its loading
  // guard (i.e. rendering real content, not a skeleton). This prevents capturing
  // a half-loaded page where a practice's valuation is still resolving. We gate
  // on the same condition as the render guard below so a failed secondary query
  // can never permanently block export.
  // Practice team roster for the Employees page — live from team_members for
  // this location (falls back to generic roles below when none are added).
  const { data: teamMembers } = useQuery({
    queryKey: ['pdf-team-members', location?.id],
    queryFn: async () => {
      if (!location?.id) return [];
      const { data, error } = await (supabase as any)
        .from('team_members')
        .select('name, role_type, email, status')
        .eq('location_id', location.id)
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;
      return (data ?? []) as Array<{ name?: string; role_type?: string; email?: string; status?: string }>;
    },
    enabled: !!location?.id,
  });

  const sectionReady = !isLoading && !!d;
  useEffect(() => {
    onReady?.(readyKey, sectionReady);
  }, [sectionReady, onReady, readyKey]);

  if (isLoading || !d) {
    return (
      <AutoScalePage widthMm={297} heightMm={210} pageClass="pdf-page pdf-page-cover relative overflow-hidden ft-page shadow-lg">
        <div className="relative h-full px-14 pt-12 pb-[80px] flex flex-col gap-4" style={{ zIndex: 1 }}>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="flex-1 w-full" />
        </div>
      </AutoScalePage>
    );
  }

  // ── Derived values ──
  const totalRev = d.totalRevenue || 1;
  const privatePct = d.qualityInputs?.privateRevenuePct ?? 0;
  const privateRevenue = d.totalRevenue * privatePct / 100;
  const nhsRevenue = d.totalRevenue - privateRevenue;
  const principalPct = d.qualityInputs?.topProviderRevenuePct ?? 0;

  // Executive-summary bullets — derived from live practice data
  const chairsCount = location?.chairs_count ?? 1;
  const surgeryWord = chairsCount === 1 ? 'surgery' : 'surgeries';
  const yearsAtSite = (() => {
    if (!organization?.created_at) return null;
    const yrs = (Date.now() - new Date(organization.created_at).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    return yrs >= 1 ? Math.round(yrs) : null;
  })();
  const execBullets: string[] = [
    `${chairsCount} ${surgeryWord} practice${chairsCount <= 2 ? ' with room to add another' : ' with strong growth potential'}`,
    location?.city ? `${location.city} Location` : 'Established Practice Location',
    'Off street carparking',
    privatePct >= 50
      ? `High percentage of patients on plan (${formatPct(privatePct)} private mix)`
      : `Balanced private / NHS mix (${formatPct(privatePct)} private)`,
    'Some specialist treatments offered in-house',
    yearsAtSite ? `Dental practice at this site for ${yearsAtSite} year${yearsAtSite > 1 ? 's' : ''}` : 'Long-established dental practice',
    (d.qualityInputs?.avgUtilisationPct ?? 0) < 80 ? 'Huge opportunity for growth' : 'Strong utilisation and stable earnings',
  ];

  // Prior-period label (1 year before period-end, formatted dd/mm/yyyy)
  const priorPeriodLabel = (() => {
    const prior = new Date(dateRange.endDate);
    prior.setFullYear(prior.getFullYear() - 1);
    return prior.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  })();

  // ── Page-6 Financial Summary P&L rows — derived from live EBITDA data ──
  const priorFmt = (v: number | undefined) =>
    v && v !== 0 ? formatCurrency(v) : '-';
  const priorRevenue = priorCostImpact?.totalRevenue ?? 0;
  const priorReportedEBITDA = priorCostImpact?.ebitda ?? 0;
  // Owner-Occupier EBITDA = adjusted EBITDA with the clinician/associate cost
  // added back (an owner-operator buyer does that clinical work themselves).
  const ownerOccupierEBITDA = d.adjustedEBITDA + (d.clinicianCosts ?? 0);
  const financialRows: Array<{
    label: string;
    prior: string | null;
    current: string | null;
    owner: string | null;
    pct: string | null;
    commentary?: string;
    bold?: boolean;
  }> = [
    {
      label: 'Turnover',
      prior: priorFmt(priorRevenue),
      current: formatCurrency(d.totalRevenue),
      owner: formatCurrency(d.totalRevenue),
      pct: '100.0%',
      commentary: 'Stable income with growth',
    },
    {
      label: 'Clinician Costs',
      prior: priorFmt(priorCostImpact?.clinicianCostCost),
      current: formatCurrency(d.clinicianCosts),
      owner: '-',
      pct: '-',
      commentary: 'Currently owner-occupied',
    },
    {
      label: 'Lab & Material',
      prior: priorFmt((priorCostImpact?.labFeesCost ?? 0) + (priorCostImpact?.materialCostCost ?? 0)),
      current: formatCurrency(d.labFees),
      owner: formatCurrency(d.labFees),
      pct: formatPct(d.totalRevenue > 0 ? (d.labFees / d.totalRevenue) * 100 : 0),
      commentary: 'Benchmarked spend against 2-year average',
    },
    {
      label: 'Staff Wages',
      prior: priorFmt(priorCostImpact?.staffCostsCost),
      current: formatCurrency(d.staffCosts),
      owner: formatCurrency(d.staffCosts),
      pct: formatPct(d.totalRevenue > 0 ? (d.staffCosts / d.totalRevenue) * 100 : 0),
    },
    {
      label: 'Rent',
      prior: priorFmt(priorCostImpact?.operatingLeasesCost),
      current: formatCurrency(d.overheads),
      owner: formatCurrency(d.overheads),
      pct: formatPct(d.totalRevenue > 0 ? (d.overheads / d.totalRevenue) * 100 : 0),
      commentary: 'Leasehold premises',
    },
    {
      label: 'Establishment Costs',
      prior: priorFmt(priorCostImpact?.overheadCostCost),
      current: formatCurrency(d.overheadCosts),
      owner: formatCurrency(d.overheadCosts),
      pct: formatPct(d.totalRevenue > 0 ? (d.overheadCosts / d.totalRevenue) * 100 : 0),
    },
    {
      label: 'Other Income',
      prior: '-',
      current: '-',
      owner: '-',
      pct: '-',
    },
    {
      label: 'EBITDA',
      prior: priorFmt(priorReportedEBITDA),
      current: formatCurrency(d.reportedEBITDA),
      owner: formatCurrency(ownerOccupierEBITDA),
      pct: formatPct(d.totalRevenue > 0 ? (ownerOccupierEBITDA / d.totalRevenue) * 100 : 0),
      bold: true,
    },
    {
      label: 'Reported Net Profit',
      prior: priorFmt(priorReportedEBITDA),
      current: formatCurrency(d.reportedEBITDA),
      owner: '-',
      pct: '-',
      bold: true,
    },
  ];

  // Map address — built from location data; falls back to org address
  const mapAddress = [
    location?.address_line1,
    location?.address_line2,
    location?.city,
    location?.postal_code,
    normaliseCountry(location?.country, location?.postal_code),
  ].filter(Boolean).join(', ').trim();

  // ── Practice Overview rows (page 3) — dynamic from data with sensible fallbacks ──
  const acquiredYear = organization?.created_at ? new Date(organization.created_at).getFullYear() : null;
  const backgroundRows = {
    currentOwnership: acquiredYear
      ? `Acquired as a going concern in ${acquiredYear}`
      : 'Acquired as a going concern',
    ownershipStructure: 'Principal',
    legalEntity: 'Ltd Company',
  };
  const propertyRows = {
    currentTenure: 'Leasehold',
    purchaseTenure: 'Leasehold',
    annualRental: formatCurrency(d.overheads),
  };
  const saleRows = {
    saleType: 'Shares sale (100%)',
    vendorPlans: location?.notes || 'The vendor is looking to move away from the UK',
  };

  // ── Employees rows (page 12) — generic role placeholders since no per-employee hook exists yet.
  // Employees (page 12) — live from the location's team_members. When no team
  // has been added yet, fall back to generic support roles so the memorandum
  // page is never empty.
  const employeeRows = (teamMembers && teamMembers.length > 0)
    ? teamMembers.map((m) => ({
        role: m.role_type || m.name || 'Team Member',
        weeklyHours: '—',
        hourlyRate: '—',
        commentary: [m.name, m.email].filter(Boolean).join(' · '),
      }))
    : [
        { role: 'Receptionist / Admin', weeklyHours: '—', hourlyRate: '—', commentary: '' },
        { role: 'Nurse', weeklyHours: '—', hourlyRate: '—', commentary: '' },
        { role: 'Practice Manager', weeklyHours: '—', hourlyRate: '—', commentary: '' },
      ];

  // Purchase opportunities — derived from data flags + standard IM language
  const opportunities: string[] = [];
  if ((location?.chairs_count ?? 0) <= 2) opportunities.push('Room for additional surgery capacity');
  if ((d.qualityInputs?.avgUtilisationPct ?? 0) < 70) opportunities.push('Opportunity to increase chair utilisation hours');
  opportunities.push('Advertising activities could be initiated to attract new patients');
  opportunities.push('Further specialist treatments could be introduced, if desired');
  opportunities.push('Hygiene treatments could be introduced to augment practice income');
  if (privatePct >= 60) opportunities.push('Strong private mix with a large plan base that could be expanded to secure stable practice income');

  return (
    <>
      {/* ╔══ EXECUTIVE SUMMARY (LANDSCAPE, responsive) ══╗ */}
      <AutoScalePage widthMm={297} heightMm={210} pageClass="pdf-page pdf-page-cover relative overflow-hidden ft-page-exec shadow-lg">
        <div className="relative h-full px-14 pt-12 pb-[80px] flex flex-col" style={{ zIndex: 1 }}>
          <PageHeader eyebrow="Opportunity Overview" title="Executive Summary" index="02 / 17" />

          {/* KPI row */}
          <div className="grid grid-cols-4 gap-4 mb-5">
            <KpiCard label="Turnover" value={formatCurrency(d.totalRevenue)} accent={FT.viz[0]} valueSize="24px" />
            <KpiCard label="EBITDA" value={formatCurrency(d.reportedEBITDA)} accent={FT.viz[2]} valueSize="24px" />
            <KpiCard label="Enterprise Value" value={formatCurrency(d.enterpriseValue)} accent={FT.orange} valueSize="24px" />
            <KpiCard label="Private Mix" value={formatPct(privatePct, 1)} accent={FT.viz[1]} valueSize="24px" />
          </div>

          <div className="grid grid-cols-[1.1fr_1fr] gap-8 flex-1 min-h-0">
          {/* ─── Left column ─── */}
          <div className="flex flex-col min-h-0">
            {/* Bullets */}
            <Card className="mb-4" pad="16px 18px">
              <ul className="space-y-[7px]" style={{ fontSize: '12px', color: FT.body }}>
              {execBullets.map((b, i) => (
                <li key={i} className="flex gap-2.5 items-start">
                  <span className="font-bold mt-[2px]" style={{ fontSize: '9px', color: FT.viz[i % FT.viz.length] }}>●</span>
                  <span>{b}</span>
                </li>
              ))}
              </ul>
            </Card>

            {/* Headline Financials */}
            <div className="mt-auto" style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: FT.radius, overflow: 'hidden', boxShadow: T.cardShadow }}>
              <CardTitle title="Headline Financials" />
              <table className="w-full" style={{ fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: T.surfaceAlt }}>
                    <th className="text-left px-3 py-2.5 border-b" style={{ width: '34%', borderColor: T.border }}></th>
                    <th className="text-right px-3 py-2.5 font-semibold uppercase border-b" style={{ color: T.muted, fontSize: '10px', letterSpacing: '0.06em', borderColor: T.border }}>
                      <div className="leading-tight">{priorPeriodLabel}</div>
                      <div className="font-normal" style={{ fontSize: '9px' }}>£</div>
                    </th>
                    <th className="text-right px-3 py-2.5 font-semibold uppercase border-b" style={{ color: T.muted, fontSize: '10px', letterSpacing: '0.06em', borderColor: T.border }}>
                      <div className="leading-tight">{periodEnd}</div>
                      <div className="font-normal" style={{ fontSize: '9px' }}>£</div>
                    </th>
                    <th className="text-right px-3 py-2.5 font-semibold uppercase border-b" style={{ color: FT.brand, fontSize: '10px', letterSpacing: '0.06em', borderColor: T.border }}>
                      <div className="leading-tight">Valuation</div>
                      <div className="leading-tight">Projection</div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-3 py-2 text-[#2a2a2a] border-b border-[#e5e5e5]">Turnover</td>
                    <td className="text-right px-3 py-2 tabular-nums border-b border-[#e5e5e5] text-[#666]">{priorRevenue ? formatCurrency(priorRevenue) : '—'}</td>
                    <td className="text-right px-3 py-2 tabular-nums border-b border-[#e5e5e5]">{formatCurrency(d.totalRevenue)}</td>
                    <td className="text-right px-3 py-2 tabular-nums border-b border-[#e5e5e5] font-semibold">{formatCurrency(d.totalRevenue)}</td>
                  </tr>
                  <tr className="bg-[#fafbfc]">
                    <td className="px-3 py-2 text-[#2a2a2a] border-b border-[#e5e5e5]">Reported Net Profit</td>
                    <td className="text-right px-3 py-2 tabular-nums border-b border-[#e5e5e5] text-[#666]">{priorReportedEBITDA ? formatCurrency(priorReportedEBITDA) : '—'}</td>
                    <td className="text-right px-3 py-2 tabular-nums border-b border-[#e5e5e5]">{formatCurrency(d.reportedEBITDA)}</td>
                    <td className="text-right px-3 py-2 tabular-nums border-b border-[#e5e5e5] text-[#666]">—</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-[#2a2a2a] font-semibold">EBITDA</td>
                    <td className="text-right px-3 py-2 tabular-nums text-[#666]">{priorReportedEBITDA ? formatCurrency(priorReportedEBITDA) : '—'}</td>
                    <td className="text-right px-3 py-2 tabular-nums font-semibold">{formatCurrency(d.reportedEBITDA)}</td>
                    <td className="text-right px-3 py-2 tabular-nums font-bold" style={{ color: FT.brand }}>{formatCurrency(d.sustainableEBITDA)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ─── Right column — Lightweight map card (no third-party iframe) ─── */}
          <div className="overflow-hidden relative" style={{ borderRadius: FT.radius, border: `1px solid ${FT.cardBorder}`, boxShadow: FT.cardShadow, background: '#dfe7f0', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
            {/* Decorative SVG "map" background — abstract roads + plots */}
            <svg
              className="absolute inset-0 w-full h-full"
              viewBox="0 0 400 300"
              preserveAspectRatio="xMidYMid slice"
              aria-hidden
            >
              {/* Land tiles */}
              <rect x="0" y="0" width="400" height="300" fill="#e5edf5" />
              <rect x="0" y="0" width="180" height="120" fill="#d8e5f1" />
              <rect x="220" y="0" width="180" height="160" fill="#d2e1ee" />
              <rect x="0" y="160" width="240" height="140" fill="#dce7f2" />
              <rect x="260" y="180" width="140" height="120" fill="#d6e2ed" />

              {/* Park / green patches */}
              <rect x="40" y="40" width="80" height="50" fill="#c8d9ad" opacity="0.85" />
              <rect x="280" y="200" width="70" height="60" fill="#c8d9ad" opacity="0.7" />
              <circle cx="320" cy="60" r="22" fill="#c8d9ad" opacity="0.75" />

              {/* Water */}
              <path d="M 0 250 Q 100 230 200 250 T 400 240 L 400 300 L 0 300 Z" fill="#bcd2e5" />

              {/* Roads */}
              <line x1="0" y1="150" x2="400" y2="150" stroke="white" strokeWidth="6" />
              <line x1="200" y1="0" x2="200" y2="300" stroke="white" strokeWidth="5" />
              <line x1="0" y1="80" x2="400" y2="80" stroke="white" strokeWidth="3" />
              <line x1="100" y1="0" x2="100" y2="300" stroke="white" strokeWidth="3" />
              <line x1="320" y1="0" x2="320" y2="300" stroke="white" strokeWidth="3" />
              <line x1="0" y1="220" x2="400" y2="220" stroke="white" strokeWidth="3" />
              {/* Road labels (subtle) */}
              <line x1="0" y1="150" x2="400" y2="150" stroke="#ffd7a3" strokeWidth="1.2" strokeDasharray="6 6" />
              <line x1="200" y1="0" x2="200" y2="300" stroke="#ffd7a3" strokeWidth="1.2" strokeDasharray="6 6" />
            </svg>

            {/* Pin in center */}
            <div className="relative w-full h-full flex flex-col items-center justify-center" style={{ zIndex: 1 }}>
              <svg width="44" height="56" viewBox="0 0 44 56" className="drop-shadow-lg">
                <path
                  d="M 22 2 C 11 2 3 10 3 21 C 3 35 22 54 22 54 C 22 54 41 35 41 21 C 41 10 33 2 22 2 Z"
                  fill="#f57c4d"
                  stroke="white"
                  strokeWidth="2"
                />
                <circle cx="22" cy="20" r="7" fill="white" />
              </svg>

              {/* Address card */}
              <div className="mt-3 px-4 py-2 bg-white/95 rounded shadow-md border border-[#d4d4d4] max-w-[80%]">
                <p className="text-[11px] font-bold text-[#1a2557] text-center leading-tight">
                  {practiceName}
                </p>
                <p className="text-[10px] text-[#2a2a2a] text-center mt-0.5 leading-tight">
                  {mapAddress || 'Practice address'}
                </p>
              </div>
            </div>
          </div>
          </div>
        </div>

        <IMLandscapeFooter />
      </AutoScalePage>

      {/* ╔══ PRACTICE OVERVIEW (LANDSCAPE, responsive) ══╗ */}
      <AutoScalePage widthMm={297} heightMm={210} pageClass="pdf-page pdf-page-cover relative overflow-hidden ft-page shadow-lg">
        {/* Decorative brand corner glow */}
        <div className="absolute top-0 right-0 pointer-events-none" style={{ width: '260px', height: '160px', background: 'radial-gradient(120px 90px at 100% 0%, rgba(79,91,255,0.10), transparent 70%)', zIndex: 0, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />

        <div className="relative h-full px-16 pt-12 pb-[80px]" style={{ zIndex: 1 }}>
          <PageHeader eyebrow="The Practice" title="Practice Overview" index="03 / 17" />

          {/* 2 × 2 grid of tables */}
          <div className="grid grid-cols-2 gap-x-14 gap-y-7">
            {/* Background */}
            <IMTable
              title="Background"
              rows={[
                ['Current Ownership', backgroundRows.currentOwnership],
                ['Ownership Structure', backgroundRows.ownershipStructure],
                ['Legal Entity', backgroundRows.legalEntity],
              ]}
            />

            {/* Opening Hours */}
            <IMTable
              title="Opening Hours"
              rows={DAYS.map(day => [day.label, formatHours(location?.operating_hours, day.key)])}
              labelWidth="40%"
            />

            {/* Property */}
            <IMTable
              title="Property"
              rows={[
                ['Current Tenure', propertyRows.currentTenure],
                ['Purchase Tenure', propertyRows.purchaseTenure],
                ['Property Value / Annual Rental', propertyRows.annualRental],
              ]}
            />

            {/* Sale Arrangements */}
            <IMTable
              title="Sale Arrangements"
              rows={[
                ['Sale Type', saleRows.saleType],
                ['Vendor Plans', saleRows.vendorPlans],
              ]}
            />
          </div>
        </div>

        <IMLandscapeFooter />
      </AutoScalePage>

      {/* ╔══ INCOME SUMMARY (LANDSCAPE, responsive) ══╗ */}
      <AutoScalePage widthMm={297} heightMm={210} pageClass="pdf-page pdf-page-cover relative overflow-hidden ft-page shadow-lg">
        {/* Decorative brand corner glow */}
        <div className="absolute top-0 right-0 pointer-events-none" style={{ width: '260px', height: '160px', background: 'radial-gradient(120px 90px at 100% 0%, rgba(79,91,255,0.10), transparent 70%)', zIndex: 0, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />

        <div className="relative h-full px-16 pt-12 pb-[80px]" style={{ zIndex: 1 }}>
          <PageHeader eyebrow="Financial Summary" title="Income Summary" index="04 / 17" />

          {/* KPI row — income split */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <KpiCard label="Private Income" value={formatCurrency(privateRevenue)} accent={FT.viz[0]} valueSize="26px" delta={formatPct(privatePct, 0)} deltaTone="brand" />
            <KpiCard label="NHS / Other Income" value={formatCurrency(nhsRevenue)} accent={FT.viz[3]} valueSize="26px" delta={formatPct(100 - privatePct, 0)} deltaTone="positive" />
            <KpiCard label="Total Turnover" value={formatCurrency(d.totalRevenue)} accent={FT.orange} valueSize="26px" />
          </div>

          <div className="grid grid-cols-[1.7fr_1fr] gap-8">
            {/* ── Left: colourful Income Breakdown bars ── */}
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: FT.radius, overflow: 'hidden', boxShadow: T.cardShadow }}>
              <CardTitle title="Income Breakdown by Category" />
              <div className="px-5 py-5 space-y-3">
                {(() => {
                  const maxPct = Math.max(...incomeBreakdown.map(c => c.pct), 0.0001);
                  return incomeBreakdown.map((cat, i) => {
                    const color = FT.viz[i % FT.viz.length];
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <span className="text-right shrink-0" style={{ width: '96px', fontSize: '11px', color: FT.body, fontWeight: 500 }}>
                          {cat.label}
                        </span>
                        <div className="flex-1 h-[22px] relative overflow-hidden" style={{ background: FT.surfaceAlt, borderRadius: '999px' }}>
                          {cat.pct > 0 && (
                            <div
                              className="absolute inset-y-0 left-0 flex items-center justify-end pr-2.5 text-white font-bold"
                              style={{ width: `${Math.max(5, (cat.pct / maxPct) * 100)}%`, fontSize: '10px', background: `linear-gradient(90deg, ${color}, ${color}cc)`, borderRadius: '999px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                            >
                              {cat.pct >= 7 && `${cat.pct.toFixed(1)}%`}
                            </div>
                          )}
                          {cat.pct > 0 && cat.pct < 7 && (
                            <span className="absolute inset-y-0 flex items-center font-semibold" style={{ left: `calc(${Math.max(5, (cat.pct / maxPct) * 100)}% + 7px)`, fontSize: '10px', color: FT.body }}>
                              {cat.pct.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {/* ── Right: Principal Turnover KPI ── */}
            <div className="flex flex-col gap-4">
              <div style={{ background: FT.surface, border: `1px solid ${FT.cardBorder}`, borderRadius: FT.radius, boxShadow: FT.cardShadow, overflow: 'hidden', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                <div style={{ height: '3px', background: FT.viz[1], WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
                <div className="px-6 py-7 text-center">
                  <p className="uppercase" style={{ color: FT.muted, fontSize: '10px', letterSpacing: '0.12em', fontWeight: 600 }}>
                    Principal Turnover
                  </p>
                  <p className="tabular-nums leading-none" style={{ color: FT.ink, fontSize: '46px', fontWeight: 800, letterSpacing: '-2px', marginTop: '12px' }}>
                    {formatPct(principalPct, 1)}
                  </p>
                  <p style={{ color: FT.muted, fontSize: '10.5px', marginTop: '12px', lineHeight: 1.4 }}>Share of total income generated by the principal clinician</p>
                </div>
              </div>
              <Pill tone={principalPct >= 70 ? 'negative' : principalPct >= 50 ? 'warning' : 'positive'} style={{ alignSelf: 'center' }}>
                {principalPct >= 70 ? 'High key-person concentration' : principalPct >= 50 ? 'Moderate concentration' : 'Well diversified'}
              </Pill>
            </div>
          </div>
        </div>

        <IMLandscapeFooter />
      </AutoScalePage>

      {/* ╔══ PURCHASE OPPORTUNITIES (LANDSCAPE, responsive) ══╗ */}
      <AutoScalePage widthMm={297} heightMm={210} pageClass="pdf-page pdf-page-cover relative overflow-hidden ft-page shadow-lg">
        {/* Decorative brand corner glow */}
        <div className="absolute top-0 right-0 pointer-events-none" style={{ width: '260px', height: '160px', background: 'radial-gradient(120px 90px at 100% 0%, rgba(79,91,255,0.10), transparent 70%)', zIndex: 0, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />

        <div className="relative h-full px-16 pt-12 pb-[80px]" style={{ zIndex: 1 }}>
          <PageHeader eyebrow="Growth Levers" title="Purchase Opportunities" index="05 / 17" />

          <div className="grid grid-cols-2 gap-8">
            {/* Left — Opportunity list card */}
            <Card pad="22px 24px">
              <ul className="space-y-3.5">
                {opportunities.map((op, i) => (
                  <li key={i} className="flex gap-3 items-start" style={{ fontSize: '12.5px' }}>
                    <span
                      className="shrink-0 inline-flex items-center justify-center text-white font-bold"
                      style={{ width: '20px', height: '20px', borderRadius: '999px', background: FT.viz[i % FT.viz.length], fontSize: '10px', marginTop: '1px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                    >
                      {i + 1}
                    </span>
                    <span style={{ color: FT.body, lineHeight: 1.5 }}>{op}</span>
                  </li>
                ))}
              </ul>
            </Card>

            {/* Right — Chair Occupancy donut */}
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: FT.radius, overflow: 'hidden', boxShadow: T.cardShadow }}>
              <CardTitle title="Chair Occupancy" />
              <div className="px-4 py-5 flex flex-col items-center">
                <ChairOccupancyPie usedPct={d.qualityInputs?.avgUtilisationPct ?? 0} />
                <div className="flex items-center gap-6 mt-3" style={{ fontSize: '11px' }}>
                  <span className="flex items-center gap-2">
                    <span className="inline-block" style={{ width: '10px', height: '10px', borderRadius: '3px', background: FT.brand, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
                    <span style={{ color: FT.body }}>Utilised</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="inline-block" style={{ width: '10px', height: '10px', borderRadius: '3px', background: '#eef1f7', border: `1px solid ${FT.borderStrong}`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
                    <span style={{ color: FT.body }}>Available headroom</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <IMLandscapeFooter />
      </AutoScalePage>

      {/* ╔══ FINANCIAL SUMMARY (LANDSCAPE, responsive) ══╗ */}
      <AutoScalePage widthMm={297} heightMm={210} pageClass="pdf-page pdf-page-cover relative overflow-hidden ft-page shadow-lg">
        {/* Decorative brand corner glow */}
        <div className="absolute top-0 right-0 pointer-events-none" style={{ width: '260px', height: '160px', background: 'radial-gradient(120px 90px at 100% 0%, rgba(79,91,255,0.10), transparent 70%)', zIndex: 0, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />

        <div className="relative h-full px-14 pt-9 pb-[80px]" style={{ zIndex: 1 }}>
          <PageHeader eyebrow="Valuation" title="Financial Summary" index="06 / 17" size="md" />

          {/* KPI row */}
          <div className="grid grid-cols-3 gap-4 mb-5">
            <KpiCard label="Turnover" value={formatCurrency(d.totalRevenue)} accent={FT.viz[0]} valueSize="24px" />
            <KpiCard label="EBITDA" value={formatCurrency(d.reportedEBITDA)} accent={FT.viz[2]} valueSize="24px" delta={formatPct(d.totalRevenue > 0 ? (d.reportedEBITDA / d.totalRevenue) * 100 : 0, 0) + ' margin'} deltaTone="positive" />
            <KpiCard label="Owner-Occupier EBITDA" value={formatCurrency(ownerOccupierEBITDA)} accent={FT.orange} valueSize="24px" delta={formatPct(d.totalRevenue > 0 ? (ownerOccupierEBITDA / d.totalRevenue) * 100 : 0, 0) + ' margin'} deltaTone="warning" />
          </div>

          <div className="grid grid-cols-[2.05fr_1fr] gap-6">
            {/* ── Left: Valuation P&L Accounts (modern card table) ── */}
            <div>
              <TableTitle title="Valuation Profit & Loss Accounts" />
              <div style={{ border: `1px solid ${FT.cardBorder}`, borderRadius: FT.radius, overflow: 'hidden', boxShadow: FT.cardShadow, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
              <table className="w-full border-collapse" style={{ fontSize: '11px' }}>
                <thead>
                  <tr style={{ background: FT.surfaceAlt }}>
                    <th className="px-3 py-2.5 text-left" style={{ width: '18%', color: FT.muted, fontSize: '9.5px', letterSpacing: '0.06em', fontWeight: 600, textTransform: 'uppercase' }}></th>
                    <th className="px-3 py-2.5 text-right" style={{ color: FT.muted, fontSize: '9.5px', letterSpacing: '0.05em', fontWeight: 600, textTransform: 'uppercase' }}>
                      <div className="leading-tight">{priorPeriodLabel}</div>
                    </th>
                    <th className="px-3 py-2.5 text-right" style={{ color: FT.brand, fontSize: '9.5px', letterSpacing: '0.05em', fontWeight: 600, textTransform: 'uppercase' }}>
                      <div className="leading-tight">{periodEnd}</div>
                    </th>
                    <th className="px-3 py-2.5 text-right" style={{ color: FT.muted, fontSize: '9.5px', letterSpacing: '0.05em', fontWeight: 600, textTransform: 'uppercase' }}>
                      <div className="leading-tight">Owner-Occupier</div>
                    </th>
                    <th className="px-3 py-2.5 text-center" style={{ width: '13%', color: FT.muted, fontSize: '9.5px', letterSpacing: '0.05em', fontWeight: 600, textTransform: 'uppercase' }}>
                      <div className="leading-tight">% Turnover</div>
                    </th>
                    <th className="px-3 py-2.5 text-left" style={{ width: '24%', color: FT.muted, fontSize: '9.5px', letterSpacing: '0.05em', fontWeight: 600, textTransform: 'uppercase' }}>
                      <div className="leading-tight">Commentary</div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {financialRows.map((row, i) => {
                    const isEbitda = row.label === 'EBITDA';
                    return (
                    <tr key={i} style={{ background: isEbitda ? '#eef0ff' : (i % 2 === 0 ? FT.surface : FT.surfaceAlt), borderTop: `1px solid ${FT.cardBorder}`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                      <td className="px-3 py-2" style={{ fontWeight: row.bold ? 700 : 600, color: isEbitda ? FT.brand : FT.ink }}>
                        {row.label}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: FT.muted, fontWeight: row.bold ? 700 : 400 }}>
                        {row.prior ?? '-'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: FT.ink, fontWeight: row.bold ? 700 : 500 }}>
                        {row.current ?? '-'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: FT.body, fontWeight: row.bold ? 700 : 400 }}>
                        {row.owner ?? '-'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.pct && row.pct !== '-' ? (
                          <Pill tone={isEbitda ? 'brand' : 'neutral'}>{row.pct}</Pill>
                        ) : <span style={{ color: FT.muted }}>-</span>}
                      </td>
                      <td className="px-3 py-2" style={{ color: FT.body, fontSize: '10px' }}>
                        {row.commentary || ''}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>

            {/* ── Right: Valuation Add-Backs ── */}
            <div>
              <TableTitle title="Valuation Add-Backs" />
              <div style={{ border: `1px solid ${FT.cardBorder}`, borderRadius: FT.radius, overflow: 'hidden', boxShadow: FT.cardShadow, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
              <table className="w-full border-collapse" style={{ fontSize: '11px' }}>
                <thead>
                  <tr style={{ background: FT.surfaceAlt }}>
                    <th className="px-3 py-2.5 text-left" style={{ color: FT.muted, fontSize: '9.5px', letterSpacing: '0.06em', fontWeight: 600, textTransform: 'uppercase' }}>Item</th>
                    <th className="px-3 py-2.5 text-right" style={{ width: '40%', color: FT.muted, fontSize: '9.5px', letterSpacing: '0.05em', fontWeight: 600, textTransform: 'uppercase' }}>
                      {periodEnd} £
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.normalisationItems.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="px-3 py-3 text-center italic" style={{ color: FT.muted, fontSize: '11px', borderTop: `1px solid ${FT.cardBorder}` }}>
                        No add-backs configured
                      </td>
                    </tr>
                  ) : (
                    d.normalisationItems.map((it, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? FT.surface : FT.surfaceAlt, borderTop: `1px solid ${FT.cardBorder}`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                        <td className="px-3 py-2" style={{ color: FT.ink }}>
                          {it.label}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums" style={{ color: FT.pos, fontWeight: 600 }}>
                          +{formatCurrency(it.value)}
                        </td>
                      </tr>
                    ))
                  )}
                  <tr style={{ background: '#eef0ff', borderTop: `1px solid ${FT.cardBorder}`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                    <td className="px-3 py-2 font-bold" style={{ color: FT.brand }}>Total</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: FT.brand }}>
                      {formatCurrency(d.netAdjustments)}
                    </td>
                  </tr>
                </tbody>
              </table>
              </div>
            </div>
          </div>
        </div>

        <IMLandscapeFooter />
      </AutoScalePage>

      {/* ╔══ EBITDA BRIDGE (LANDSCAPE) ══╗ */}
      <AutoScalePage widthMm={297} heightMm={210} pageClass="pdf-page pdf-page-cover relative overflow-hidden ft-page shadow-lg">
        <div className="absolute top-0 right-0 pointer-events-none" style={{ width: '260px', height: '160px', background: 'radial-gradient(120px 90px at 100% 0%, rgba(79,91,255,0.10), transparent 70%)', zIndex: 0, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />

        <div className="relative h-full px-14 pt-10 pb-[80px]" style={{ zIndex: 1 }}>
          <PageHeader eyebrow="Valuation" title="EBITDA Bridge" index="07 / 17" size="md" />

          {/* Bridge step boxes */}
          {(() => {
            const steps: Array<{ label: string; value: number; tone: 'base' | 'pos' | 'neg' | 'result' }> = [
              { label: 'Reported EBITDA', value: d.reportedEBITDA, tone: 'base' },
              { label: '+ Add-Backs', value: d.netAdjustments, tone: 'pos' },
              { label: 'Adjusted EBITDA', value: d.adjustedEBITDA, tone: 'result' },
              { label: '− Sustainability', value: -Math.abs(d.sustainability.totalImpact || 0), tone: 'neg' },
              { label: 'Sustainable EBITDA', value: d.sustainableEBITDA, tone: 'result' },
            ];
            const toneColor: Record<string, string> = {
              base: FT.brand,
              pos: FT.pos,
              neg: FT.neg,
              result: FT.orange,
            };
            const toneBg: Record<string, string> = {
              base: '#eef0ff',
              pos: '#ecfdf5',
              neg: '#fef2f2',
              result: '#fff5ef',
            };
            return (
              <div className="grid grid-cols-5 gap-3 mb-6">
                {steps.map((s, i) => (
                    <div
                      key={i}
                      className="overflow-hidden"
                      style={{
                        border: `1px solid ${FT.cardBorder}`,
                        borderRadius: FT.radius,
                        background: toneBg[s.tone],
                        boxShadow: FT.cardShadow,
                        WebkitPrintColorAdjust: 'exact',
                        printColorAdjust: 'exact',
                      }}
                    >
                      <div style={{ height: '4px', background: toneColor[s.tone], WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
                      <div className="px-3 pt-3 text-center uppercase" style={{ color: toneColor[s.tone], fontSize: '9px', letterSpacing: '0.1em', fontWeight: 700 }}>
                        {s.label}
                      </div>
                      <div className="px-3 pb-3.5 pt-2 text-center tabular-nums" style={{ color: FT.ink, fontSize: '21px', fontWeight: 800, letterSpacing: '-0.6px' }}>
                        {s.tone === 'neg' ? `−${formatCurrency(Math.abs(s.value))}` : (s.tone === 'pos' ? `+${formatCurrency(s.value)}` : formatCurrency(s.value))}
                      </div>
                    </div>
                ))}
              </div>
            );
          })()}

          {/* Add-backs + sustainability side-by-side */}
          <div className="grid grid-cols-2 gap-5">
            <div>
              <TableTitle title="Add-Backs (Normalisations)" />
              <div style={{ border: `1px solid ${FT.cardBorder}`, borderRadius: FT.radius, overflow: 'hidden', boxShadow: FT.cardShadow, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
              <table className="w-full border-collapse" style={{ fontSize: '11px' }}>
                <thead>
                  <tr style={{ background: FT.surfaceAlt }}>
                    <th className="px-3 py-2.5 text-left" style={{ color: FT.muted, fontSize: '9.5px', letterSpacing: '0.06em', fontWeight: 600, textTransform: 'uppercase' }}>Item</th>
                    <th className="px-3 py-2.5 text-right" style={{ width: '32%', color: FT.muted, fontSize: '9.5px', letterSpacing: '0.06em', fontWeight: 600, textTransform: 'uppercase' }}>£</th>
                  </tr>
                </thead>
                <tbody>
                  {d.normalisationItems.length === 0 ? (
                    <tr><td colSpan={2} className="px-3 py-3 text-center italic" style={{ color: FT.muted, borderTop: `1px solid ${FT.cardBorder}` }}>No add-backs configured</td></tr>
                  ) : (
                    d.normalisationItems.map((it, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? FT.surface : FT.surfaceAlt, borderTop: `1px solid ${FT.cardBorder}`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                        <td className="px-3 py-2" style={{ color: FT.ink }}>{it.label}</td>
                        <td className="px-3 py-2 text-right tabular-nums" style={{ color: FT.pos, fontWeight: 600 }}>+{formatCurrency(it.value)}</td>
                      </tr>
                    ))
                  )}
                  <tr style={{ background: '#eef0ff', borderTop: `1px solid ${FT.cardBorder}`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}><td className="px-3 py-2 font-bold" style={{ color: FT.brand }}>Total</td><td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: FT.brand }}>{formatCurrency(d.netAdjustments)}</td></tr>
                </tbody>
              </table>
              </div>
            </div>

            <div>
              <TableTitle title="Sustainability Haircuts" />
              <div style={{ border: `1px solid ${FT.cardBorder}`, borderRadius: FT.radius, overflow: 'hidden', boxShadow: FT.cardShadow, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
              <table className="w-full border-collapse" style={{ fontSize: '11px' }}>
                <thead>
                  <tr style={{ background: FT.surfaceAlt }}>
                    <th className="px-3 py-2.5 text-left" style={{ color: FT.muted, fontSize: '9.5px', letterSpacing: '0.06em', fontWeight: 600, textTransform: 'uppercase' }}>Driver</th>
                    <th className="px-3 py-2.5 text-right" style={{ width: '32%', color: FT.muted, fontSize: '9.5px', letterSpacing: '0.06em', fontWeight: 600, textTransform: 'uppercase' }}>Impact £</th>
                  </tr>
                </thead>
                <tbody>
                  {d.sustainability.items.length === 0 ? (
                    <tr><td colSpan={2} className="px-3 py-3 text-center italic" style={{ color: FT.muted, borderTop: `1px solid ${FT.cardBorder}` }}>No haircuts applied</td></tr>
                  ) : (
                    d.sustainability.items.map((it, i) => {
                      const positive = it.value >= 0;
                      return (
                        <tr key={i} style={{ background: i % 2 === 0 ? FT.surface : FT.surfaceAlt, borderTop: `1px solid ${FT.cardBorder}`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                          <td className="px-3 py-2" style={{ color: FT.ink, fontSize: '10.5px' }}>{it.label}</td>
                          <td className="px-3 py-2 text-right tabular-nums" style={{ color: positive ? FT.pos : FT.neg, fontWeight: 600 }}>
                            {positive ? '+' : '−'}{formatCurrency(Math.abs(it.value))}
                          </td>
                        </tr>
                      );
                    })
                  )}
                  <tr style={{ background: '#eef0ff', borderTop: `1px solid ${FT.cardBorder}`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                    <td className="px-3 py-2 font-bold" style={{ color: FT.brand }}>Total Impact</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: d.sustainability.totalImpact >= 0 ? FT.pos : FT.neg }}>
                      {d.sustainability.totalImpact >= 0 ? '+' : '−'}{formatCurrency(Math.abs(d.sustainability.totalImpact))}
                    </td>
                  </tr>
                </tbody>
              </table>
              </div>
            </div>
          </div>

          <p className="italic mt-4" style={{ fontSize: '10.5px', color: FT.muted }}>
            Sustainable EBITDA × Multiple = Enterprise Value · <span style={{ color: FT.ink, fontWeight: 600 }}>{formatCurrency(d.sustainableEBITDA)} × {d.multiple.finalMultiple.toFixed(2)}× = {formatCurrency(d.enterpriseValue)}</span>
          </p>
        </div>

        <IMLandscapeFooter />
      </AutoScalePage>

      {/* ╔══ QUALITY SCORE (LANDSCAPE) ══╗ */}
      <AutoScalePage widthMm={297} heightMm={210} pageClass="pdf-page pdf-page-cover relative overflow-hidden ft-page shadow-lg">
        <div className="absolute top-0 right-0 pointer-events-none" style={{ width: '260px', height: '160px', background: 'radial-gradient(120px 90px at 100% 0%, rgba(79,91,255,0.10), transparent 70%)', zIndex: 0, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />

        <div className="relative h-full px-14 pt-10 pb-[80px]" style={{ zIndex: 1 }}>
          <PageHeader eyebrow="Valuation" title="Quality Score" index="08 / 17" size="md" />

          <div className="grid grid-cols-[1fr_1.8fr] gap-8">
            {/* Hero score */}
            <HeroStat
              eyebrow="Final Quality Score"
              value={Math.round(d.quality.finalScore)}
              suffix={<span style={{ color: FT.muted, fontSize: '28px', fontWeight: 700, letterSpacing: '-1px' }}> / 100</span>}
              caption="Composite of practice quality drivers used to set the multiple applied to Sustainable EBITDA."
            />

            {/* Per-dimension bars */}
            <div>
              <TableTitle title="Dimension Breakdown" />
              <Card pad="16px 20px">
                {d.quality.scores.length === 0 ? (
                  <p className="italic text-center py-6" style={{ color: FT.muted }}>No quality dimensions configured</p>
                ) : (
                  <div className="space-y-3">
                    {d.quality.scores.map((s, i) => {
                      const color = FT.viz[i % FT.viz.length];
                      return (
                      <div key={i} className="grid grid-cols-[150px_1fr_70px] items-center gap-3" style={{ fontSize: '11.5px' }}>
                        <span style={{ color: FT.ink, fontWeight: 600 }}>{s.label}</span>
                        <div className="h-[20px] relative overflow-hidden" style={{ background: FT.surfaceAlt, borderRadius: '999px' }}>
                          <div
                            className="absolute inset-y-0 left-0"
                            style={{ width: `${Math.max(3, Math.min(100, s.value))}%`, background: `linear-gradient(90deg, ${color}, ${color}cc)`, borderRadius: '999px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                          />
                          <span className="absolute inset-0 flex items-center justify-end pr-2.5 text-white font-bold" style={{ fontSize: '10.5px' }}>
                            {Math.round(s.value)}
                          </span>
                        </div>
                        <span className="text-right"><Pill tone="neutral">w {(s.weight * 100).toFixed(0)}%</Pill></span>
                      </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>
          </div>
        </div>

        <IMLandscapeFooter />
      </AutoScalePage>

      {/* ╔══ MULTIPLE ENGINE (LANDSCAPE) ══╗ */}
      <AutoScalePage widthMm={297} heightMm={210} pageClass="pdf-page pdf-page-cover relative overflow-hidden ft-page shadow-lg">
        <div className="absolute top-0 right-0 pointer-events-none" style={{ width: '260px', height: '160px', background: 'radial-gradient(120px 90px at 100% 0%, rgba(79,91,255,0.10), transparent 70%)', zIndex: 0, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />

        <div className="relative h-full px-14 pt-10 pb-[80px]" style={{ zIndex: 1 }}>
          <PageHeader eyebrow="Valuation" title="Multiple Engine" index="09 / 17" size="md" />

          <div className="grid grid-cols-[1fr_2fr] gap-8">
            {/* Final multiple hero */}
            <HeroStat
              eyebrow="Applied Multiple"
              value={d.multiple.finalMultiple.toFixed(2)}
              suffix={<span style={{ color: FT.orange, fontSize: '40px', fontWeight: 800, letterSpacing: '-1px' }}>×</span>}
              accent={FT.orange}
              caption={`Applied to Sustainable EBITDA of ${formatCurrency(d.sustainableEBITDA)} to derive Enterprise Value.`}
            />

            {/* Waterfall */}
            <div>
              <TableTitle title="Multiple Waterfall" />
              <div style={{ border: `1px solid ${FT.cardBorder}`, borderRadius: FT.radius, overflow: 'hidden', boxShadow: FT.cardShadow, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
              <table className="w-full border-collapse" style={{ fontSize: '11.5px' }}>
                <thead>
                  <tr style={{ background: FT.surfaceAlt }}>
                    <th className="px-3 py-2.5 text-left" style={{ color: FT.muted, fontSize: '9.5px', letterSpacing: '0.06em', fontWeight: 600, textTransform: 'uppercase' }}>Driver</th>
                    <th className="px-3 py-2.5 text-right" style={{ width: '20%', color: FT.muted, fontSize: '9.5px', letterSpacing: '0.06em', fontWeight: 600, textTransform: 'uppercase' }}>Change</th>
                    <th className="px-3 py-2.5 text-center" style={{ width: '16%', color: FT.muted, fontSize: '9.5px', letterSpacing: '0.06em', fontWeight: 600, textTransform: 'uppercase' }}>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {d.multiple.waterfall.length === 0 ? (
                    <tr><td colSpan={3} className="px-3 py-3 text-center italic" style={{ color: FT.muted, borderTop: `1px solid ${FT.cardBorder}` }}>No multiple adjustments configured</td></tr>
                  ) : (
                    d.multiple.waterfall.map((w, i) => {
                      const color = w.type === 'positive' ? FT.pos : w.type === 'negative' ? FT.neg : FT.brand;
                      const sign = w.type === 'positive' ? '+' : w.type === 'negative' ? '−' : '';
                      const display = w.type === 'base' ? `${w.value.toFixed(2)}×` : `${sign}${Math.abs(w.value).toFixed(2)}×`;
                      const pillTone: PillTone = w.type === 'positive' ? 'positive' : w.type === 'negative' ? 'negative' : 'brand';
                      return (
                        <tr key={i} style={{ background: i % 2 === 0 ? FT.surface : FT.surfaceAlt, borderTop: `1px solid ${FT.cardBorder}`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                          <td className="px-3 py-2" style={{ color: FT.ink }}>{w.label}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color }}>{display}</td>
                          <td className="px-3 py-2 text-center"><Pill tone={pillTone}>{w.type}</Pill></td>
                        </tr>
                      );
                    })
                  )}
                  <tr style={{ background: '#fff5ef', borderTop: `1px solid ${FT.cardBorder}`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                    <td className="px-3 py-2.5 font-bold" style={{ color: FT.orange }}>Applied Multiple</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-bold" style={{ color: FT.orange }} colSpan={2}>{d.multiple.finalMultiple.toFixed(2)}×</td>
                  </tr>
                </tbody>
              </table>
              </div>
            </div>
          </div>
        </div>

        <IMLandscapeFooter />
      </AutoScalePage>

      {/* ╔══ VALUE DRIVERS & PROGRESSION (LANDSCAPE) ══╗ */}
      <AutoScalePage widthMm={297} heightMm={210} pageClass="pdf-page pdf-page-cover relative overflow-hidden ft-page shadow-lg">
        <div className="absolute top-0 right-0 pointer-events-none" style={{ width: '260px', height: '160px', background: 'radial-gradient(120px 90px at 100% 0%, rgba(79,91,255,0.10), transparent 70%)', zIndex: 0, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />

        <div className="relative h-full px-14 pt-9 pb-[80px]" style={{ zIndex: 1 }}>
          <PageHeader eyebrow="Valuation" title="Value Drivers" index="10 / 17" size="md" />

          {/* Driver grid */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            {d.keyDrivers.length === 0 ? (
              <div className="col-span-3 text-center text-[#999] italic py-4" style={{ fontSize: '12px' }}>
                No key drivers calculated
              </div>
            ) : (
              d.keyDrivers.slice(0, 9).map((kd, i) => {
                const tone = kd.color === 'green' ? FT.pos : kd.color === 'amber' ? FT.warn : FT.neg;
                const pillTone: PillTone = kd.color === 'green' ? 'positive' : kd.color === 'amber' ? 'warning' : 'negative';
                return (
                  <div key={i} className="overflow-hidden" style={{ background: FT.surface, border: `1px solid ${FT.cardBorder}`, borderRadius: FT.radius, boxShadow: FT.cardShadow, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                    <div style={{ height: '3px', background: tone, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
                    <div className="flex items-center justify-between px-3 pt-2.5" style={{ fontSize: '10.5px', fontWeight: 600 }}>
                      <span className="truncate" style={{ color: FT.ink }}>{kd.label}</span>
                      <Pill tone={pillTone}>{kd.status}</Pill>
                    </div>
                    <div className="px-3 pb-3 pt-1.5">
                      <p className="tabular-nums" style={{ color: FT.ink, fontSize: '19px', fontWeight: 800, letterSpacing: '-0.5px' }}>{kd.actual}</p>
                      <div className="h-[7px] rounded-full overflow-hidden mt-2 mb-2" style={{ background: FT.surfaceAlt }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, kd.pct))}%`, background: `linear-gradient(90deg, ${tone}, ${tone}cc)`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
                      </div>
                      <p style={{ color: FT.muted, fontSize: '9.5px', lineHeight: 1.3 }}>{kd.thresholds}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Value Progression — 3 KPI cards */}
          <TableTitle title="Value Progression — Baseline vs Optimised" />
          <div className="grid grid-cols-3 gap-4">
            <KpiCard label="Baseline" value={formatCurrency(d.valueProgression.baseline.value)} accent={FT.brand} valueSize="22px" sub={`${formatCurrency(d.valueProgression.baseline.ebitda)} × ${d.valueProgression.baseline.multiple.toFixed(2)}×`} />
            <KpiCard label="Optimised" value={formatCurrency(d.valueProgression.optimised.value)} accent={FT.pos} valueSize="22px" sub={`${formatCurrency(d.valueProgression.optimised.ebitda)} × ${d.valueProgression.optimised.multiple.toFixed(2)}×`} />
            <KpiCard
              label="Opportunity"
              value={<>{d.valueProgression.opportunity < 0 ? '−' : '+'}{formatCurrency(Math.abs(d.valueProgression.opportunity))}</>}
              accent={FT.orange}
              valueSize="22px"
              sub={d.valueProgression.opportunity < 0 ? 'value at risk if drivers slip' : 'uplift if drivers reach target'}
            />
          </div>
        </div>

        <IMLandscapeFooter />
      </AutoScalePage>

      {/* ╔══ CLINICIANS (LANDSCAPE, responsive) ══╗ */}
      <AutoScalePage widthMm={297} heightMm={210} pageClass="pdf-page pdf-page-cover relative overflow-hidden ft-page shadow-lg">
        {/* Decorative brand corner glow */}
        <div className="absolute top-0 right-0 pointer-events-none" style={{ width: '260px', height: '160px', background: 'radial-gradient(120px 90px at 100% 0%, rgba(79,91,255,0.10), transparent 70%)', zIndex: 0, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />

        <div className="relative h-full px-14 pt-10 pb-[80px]" style={{ zIndex: 1 }}>
          <PageHeader eyebrow="The Team" title="Clinicians" index="11 / 17" size="md" />

          {/* Clinicians table — Weekly Hours / Pay Rate columns are omitted
              entirely when every row is empty ('—'/blank) so the table never
              shows dead placeholder columns. */}
          {(() => {
            const showWeeklyHours = clinicianRows.some(c => c.weeklyHours && c.weeklyHours !== '—');
            const showPayRate = clinicianRows.some(c => c.payRate && c.payRate !== '—');
            const colCount = 5 + (showWeeklyHours ? 1 : 0) + (showPayRate ? 1 : 0);
            return (
              <div style={{ border: `1px solid ${FT.cardBorder}`, borderRadius: FT.radius, overflow: 'hidden', boxShadow: FT.cardShadow, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
              <table className="w-full border-collapse" style={{ fontSize: '11.5px' }}>
                <thead>
                  <tr style={{ background: T.surfaceAlt }}>
                    <th className="im-thx px-3 py-2.5 text-left border border-[#eef1f7]" style={{ width: '14%' }}>Name</th>
                    {showWeeklyHours && (
                      <th className="im-thx px-3 py-2.5 text-center border border-[#eef1f7]" style={{ width: '10%' }}>
                        <div className="leading-tight">Weekly</div>
                        <div className="leading-tight">Hours</div>
                      </th>
                    )}
                    <th className="im-thx px-3 py-2.5 text-right border border-[#eef1f7]">
                      <div className="leading-tight">Private</div>
                      <div className="leading-tight">Income £</div>
                    </th>
                    <th className="im-thx px-3 py-2.5 text-right border border-[#eef1f7]">
                      <div className="leading-tight">Specialist</div>
                      <div className="leading-tight">Income £</div>
                    </th>
                    {showPayRate && (
                      <th className="im-thx px-3 py-2.5 text-center border border-[#eef1f7]" style={{ width: '8%' }}>
                        <div className="leading-tight">Pay</div>
                        <div className="leading-tight">Rate</div>
                      </th>
                    )}
                    <th className="im-thx px-3 py-2.5 text-right border border-[#eef1f7]">
                      <div className="leading-tight">Total</div>
                      <div className="leading-tight">Income £</div>
                    </th>
                    <th className="im-thx px-3 py-2.5 text-left border border-[#eef1f7]" style={{ width: '28%' }}>Commentary</th>
                  </tr>
                </thead>
                <tbody>
                  {clinicianRows.length === 0 ? (
                    <tr>
                      <td colSpan={colCount} className="px-3 py-4 text-center text-[#999] italic border border-[#eef1f7]">
                        No provider data available
                      </td>
                    </tr>
                  ) : (
                    clinicianRows.map((c, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-[#f7f8fd]'}>
                        <td className="px-3 py-2.5 text-left font-semibold text-[#1a2557] border border-[#eef1f7]">
                          {c.name}
                        </td>
                        {showWeeklyHours && (
                          <td className="px-3 py-2.5 text-center tabular-nums border border-[#eef1f7]">
                            {c.weeklyHours}
                          </td>
                        )}
                        <td className="px-3 py-2.5 text-right tabular-nums border border-[#eef1f7]">
                          {c.privateIncome}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums border border-[#eef1f7]">
                          {c.specialistIncome}
                        </td>
                        {showPayRate && (
                          <td className="px-3 py-2.5 text-center tabular-nums border border-[#eef1f7]">
                            {c.payRate}
                          </td>
                        )}
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold border border-[#eef1f7]">
                          {c.totalIncome}
                        </td>
                        <td className="px-3 py-2.5 text-left text-[#2a2a2a] border border-[#eef1f7]" style={{ fontSize: '10.5px', lineHeight: 1.4 }}>
                          {c.commentary}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>
            );
          })()}
        </div>

        <IMLandscapeFooter />
      </AutoScalePage>

      {/* ╔══ EMPLOYEES (LANDSCAPE, responsive) ══╗ */}
      <AutoScalePage widthMm={297} heightMm={210} pageClass="pdf-page pdf-page-cover relative overflow-hidden ft-page shadow-lg">
        {/* Decorative brand corner glow */}
        <div className="absolute top-0 right-0 pointer-events-none" style={{ width: '260px', height: '160px', background: 'radial-gradient(120px 90px at 100% 0%, rgba(79,91,255,0.10), transparent 70%)', zIndex: 0, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />

        <div className="relative h-full px-14 pt-10 pb-[80px]" style={{ zIndex: 1 }}>
          <PageHeader eyebrow="The Team" title="Employees" index="12 / 17" size="md" />

          {/* Gradient decorative band */}
          {/* Employees table — Weekly Hours / Hourly Rate columns are omitted
              when every row is empty so the table never shows dead columns. */}
          {(() => {
            const showWeeklyHours = employeeRows.some(r => r.weeklyHours && r.weeklyHours !== '—');
            const showHourlyRate = employeeRows.some(r => r.hourlyRate && r.hourlyRate !== '—');
            return (
              <div style={{ border: `1px solid ${FT.cardBorder}`, borderRadius: FT.radius, overflow: 'hidden', boxShadow: FT.cardShadow, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
              <table className="w-full border-collapse" style={{ fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: T.surfaceAlt }}>
                    <th className="im-thx px-3 py-2.5 text-left border border-[#eef1f7]" style={{ width: '18%' }}>
                      Role
                    </th>
                    {showWeeklyHours && (
                      <th className="im-thx px-3 py-2.5 text-center border border-[#eef1f7]" style={{ width: '14%' }}>
                        Weekly Hours
                      </th>
                    )}
                    {showHourlyRate && (
                      <th className="im-thx px-3 py-2.5 text-right border border-[#eef1f7]" style={{ width: '14%' }}>
                        <div className="leading-tight">Hourly Rate £</div>
                      </th>
                    )}
                    <th className="im-thx px-3 py-2.5 text-left border border-[#eef1f7]">
                      Commentary
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {employeeRows.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-[#f7f8fd]'}>
                      <td className="px-3 py-3 text-left text-[#1a2557] font-medium border border-[#eef1f7]">
                        {row.role}
                      </td>
                      {showWeeklyHours && (
                        <td className="px-3 py-3 text-center tabular-nums border border-[#eef1f7]">
                          {row.weeklyHours}
                        </td>
                      )}
                      {showHourlyRate && (
                        <td className="px-3 py-3 text-right tabular-nums border border-[#eef1f7]">
                          {row.hourlyRate}
                        </td>
                      )}
                      <td className="px-3 py-3 text-left text-[#2a2a2a] border border-[#eef1f7]" style={{ fontSize: '11px', lineHeight: 1.4 }}>
                        {row.commentary}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            );
          })()}

          {/* Live staff cost summary */}
          <p className="italic mt-4" style={{ fontSize: '11px', color: FT.muted }}>
            Total staff wages for the period: <span className="font-semibold" style={{ color: FT.ink }}>{formatCurrency(d.staffCosts)}</span>
            {' '}({formatPct(d.totalRevenue > 0 ? (d.staffCosts / d.totalRevenue) * 100 : 0)} of turnover)
            {' '}· Modelled at the National Minimum Wage of £12.21.
          </p>
        </div>

        <IMLandscapeFooter />
      </AutoScalePage>

      {/* ╔══ DUE DILIGENCE READINESS (LANDSCAPE) ══╗ */}
      <AutoScalePage widthMm={297} heightMm={210} pageClass="pdf-page pdf-page-cover relative overflow-hidden ft-page shadow-lg">
        <div className="absolute top-0 right-0 pointer-events-none" style={{ width: '260px', height: '160px', background: 'radial-gradient(120px 90px at 100% 0%, rgba(79,91,255,0.10), transparent 70%)', zIndex: 0, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />

        <div className="relative h-full px-14 pt-10 pb-[80px]" style={{ zIndex: 1 }}>
          <PageHeader eyebrow="Transaction Readiness" title="Due Diligence Readiness" index="13 / 17" size="md" />

          {(() => {
            type Tone = 'green' | 'amber' | 'red';
            const grade = (n: number, ok: number, warn: number): Tone =>
              n >= ok ? 'green' : n >= warn ? 'amber' : 'red';
            const inv = (n: number, ok: number, warn: number): Tone =>
              n <= ok ? 'green' : n <= warn ? 'amber' : 'red';
            const toneStyle: Record<Tone, { bg: string; label: string; pill: PillTone }> = {
              green: { bg: FT.pos, label: 'Strong', pill: 'positive' },
              amber: { bg: FT.warn, label: 'Watch', pill: 'warning' },
              red:   { bg: FT.neg, label: 'Action', pill: 'negative' },
            };

            const utilisation = d.qualityInputs?.avgUtilisationPct ?? 0;
            const privateMix = d.qualityInputs?.privateRevenuePct ?? 0;
            const principalShare = d.qualityInputs?.topProviderRevenuePct ?? 0;
            const udaDelivery = d.qualityInputs?.udaDeliveryPct ?? 100;
            const netDebtRatio = d.adjustedEBITDA > 0 ? (d.netDebt / d.adjustedEBITDA) : 0;

            const rows: Array<{ category: string; item: string; status: string; tone: Tone; note: string }> = [
              {
                category: 'Financial Data',
                item: 'Accounting Integration',
                status: d.hasGLData ? 'Connected' : 'Not Connected',
                tone: d.hasGLData ? 'green' : 'red',
                note: d.hasGLData ? 'Live P&L feed used in this report.' : 'No GL feed — figures may rely on treatment data only.',
              },
              {
                category: 'Financial Data',
                item: 'Net Debt / EBITDA',
                status: `${netDebtRatio.toFixed(2)}×`,
                tone: d.netDebt === 0 ? 'green' : inv(netDebtRatio, 2, 3),
                note: d.netDebt === 0
                  ? 'Debt-free balance sheet at this period end.'
                  : 'Lower is better — buyers typically target ≤ 2× Adjusted EBITDA.',
              },
              {
                category: 'Income Quality',
                item: 'Private Revenue Mix',
                status: `${privateMix.toFixed(1)}%`,
                tone: grade(privateMix, 60, 35),
                note: 'Higher private mix lifts the multiple and de-risks NHS contract changes.',
              },
              {
                category: 'Income Quality',
                item: 'NHS UDA Delivery',
                status: `${udaDelivery.toFixed(1)}%`,
                tone: udaDelivery >= 96 ? 'green' : udaDelivery >= 90 ? 'amber' : 'red',
                note: 'Delivery near 100% protects against clawback and demonstrates contract performance.',
              },
              {
                category: 'Operations',
                item: 'Chair Utilisation',
                status: `${utilisation.toFixed(1)}%`,
                tone: grade(utilisation, 80, 60),
                note: 'Headroom shows growth runway without capex.',
              },
              {
                category: 'Key-Person Risk',
                item: 'Principal Revenue Share',
                status: `${principalShare.toFixed(1)}%`,
                tone: inv(principalShare, 50, 70),
                note: 'Concentration above 70% is a key-person risk that compresses multiples.',
              },
            ];

            const grouped = rows.reduce<Record<string, typeof rows>>((acc, row) => {
              (acc[row.category] = acc[row.category] || []).push(row);
              return acc;
            }, {});

            return (
              <div className="space-y-3">
                {Object.entries(grouped).map(([cat, items]) => (
                  <div key={cat}>
                    <div style={{ marginBottom: '7px' }}>
                      <span style={{ fontSize: '10.5px', fontWeight: 700, color: FT.brand, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{cat}</span>
                      <div style={{ height: '3px', width: '28px', borderRadius: '999px', background: FT.brand, marginTop: '4px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
                    </div>
                    <div style={{ border: `1px solid ${FT.cardBorder}`, borderRadius: FT.radius, overflow: 'hidden', boxShadow: FT.cardShadow, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                    <table className="w-full border-collapse" style={{ fontSize: '11px' }}>
                      <tbody>
                        {items.map((r, i) => {
                          const ts = toneStyle[r.tone];
                          return (
                            <tr key={i} style={{ background: i % 2 === 0 ? FT.surface : FT.surfaceAlt, borderTop: i > 0 ? `1px solid ${FT.cardBorder}` : 'none', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                              <td className="px-3 py-2.5 font-semibold" style={{ width: '26%', color: FT.ink }}>
                                {r.item}
                              </td>
                              <td className="px-3 py-2.5 text-center tabular-nums font-bold" style={{ width: '14%', color: ts.bg, fontSize: '13px' }}>
                                {r.status}
                              </td>
                              <td className="px-2 py-2.5 text-center" style={{ width: '11%' }}>
                                <Pill tone={ts.pill}>{ts.label}</Pill>
                              </td>
                              <td className="px-3 py-2.5" style={{ color: FT.body, fontSize: '10.5px', lineHeight: 1.4 }}>
                                {r.note}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                  </div>
                ))}

                <p className="italic mt-3" style={{ fontSize: '10px', color: FT.muted }}>
                  Readiness grades are computed live from this PDF's selected period and location scope. A full
                  data room (lease, NHS contract, payroll, fixed assets, compliance certificates) is provided
                  separately on request.
                </p>
              </div>
            );
          })()}
        </div>

        <IMLandscapeFooter />
      </AutoScalePage>
    </>
  );
}

// ─── Main Page ───
// GeneratePdf owns the GROUP-level pages (Cover, Practice Portfolio, Viewings,
// Practice Finance, Back Cover). Its data hooks use the GLOBAL filter context
// (= group aggregate when "All locations" is selected). The location-scoped
// pages live in <PracticeSection>, which is rendered once (single-location) or
// once per location (multi-location, each wrapped in an overridden
// FilterContext.Provider) between the Cover and the Practice Portfolio.
export function GeneratePdfContent() {
  const { valuation: d, isLoading } = useEbitdaValuation();
  const { organization } = useOrganization();
  const { allAvailableLocations, regions } = useLocations();
  const filters = useFilters();
  const { selectedLocationId, selectedRegionId, dateRange } = filters;

  // Period chip — visible on the cover & subsequent pages so a buyer can see
  // at a glance what window the figures cover. dd MMM yyyy format keeps it
  // short enough not to wrap.
  const periodLabel = useMemo(() => {
    const fmt = (dt: Date) =>
      dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    return `${fmt(dateRange.startDate)} – ${fmt(dateRange.endDate)}`;
  }, [dateRange]);

  // Scope chip — reflects the TopBar Region/Location filter. When neither is
  // set, we surface the practice count so the buyer knows this is a group
  // aggregate (and the per-location overview page is included below).
  const scopeLabel = useMemo(() => {
    if (selectedLocationId) {
      const loc = (allAvailableLocations ?? []).find(l => l.id === selectedLocationId);
      return loc?.location_name ? `${loc.location_name}${loc.location_code ? ` (${loc.location_code})` : ''}` : 'Selected location';
    }
    if (selectedRegionId) {
      const r = (regions ?? []).find((r: any) => r.id === selectedRegionId);
      const n = (allAvailableLocations ?? []).filter(l => l.region_id === selectedRegionId).length;
      return r?.name ? `${r.name} · ${n} location${n === 1 ? '' : 's'}` : `${n} location${n === 1 ? '' : 's'}`;
    }
    const n = (allAvailableLocations ?? []).length;
    return `All locations · ${n} practice${n === 1 ? '' : 's'}`;
  }, [selectedLocationId, selectedRegionId, allAvailableLocations, regions]);

  // Multi-location mode flag — drives the Practice Portfolio page (below).
  // Single-location PDFs (a specific location selected) skip the per-location
  // table because the rest of the IM is already scoped to that location.
  const isMultiLocationView = !selectedLocationId && (allAvailableLocations?.length ?? 0) > 1;

  // ── Scoped locations: filter by region if a region is selected.
  // This makes Page 11's office grid and the primary-location pick respect the region filter.
  const scopedLocations = useMemo(() => {
    const list = allAvailableLocations ?? [];
    if (!selectedRegionId) return list;
    return list.filter(l => l.region_id === selectedRegionId);
  }, [allAvailableLocations, selectedRegionId]);

  // Primary location for display — honours both region and location filters.
  const location = useMemo(() => {
    if (selectedLocationId) {
      return scopedLocations.find(l => l.id === selectedLocationId)
        ?? allAvailableLocations?.find(l => l.id === selectedLocationId)
        ?? scopedLocations[0]
        ?? allAvailableLocations?.[0];
    }
    return scopedLocations.find(l => l.is_primary) ?? scopedLocations[0] ?? allAvailableLocations?.[0];
  }, [allAvailableLocations, scopedLocations, selectedLocationId]);

  const practiceName = location?.location_name || organization?.name || 'Dental Practice';
  const practiceCode = location?.location_code || '';

  // ── Cover (page 1) ── When the scope is the whole group ("All locations"),
  // the hero shows the GROUP/org name and lists every practice in scope; for a
  // single selected location it shows that practice's full name. Declared AFTER
  // location/practiceName/practiceCode to avoid a temporal-dead-zone reference.
  const coverLocationNames = useMemo(
    () => Array.from(new Set(
      scopedLocations.map(l => l.location_name).filter(Boolean) as string[],
    )),
    [scopedLocations],
  );
  const coverTitle = isMultiLocationView
    ? (organization?.name || 'Dental Practice Group')
    : `${practiceName}${practiceCode && !practiceName?.toLowerCase().includes(practiceCode.toLowerCase()) ? ` - ${practiceCode}` : ''}`;

  const reportDateLong = useMemo(
    () => dateRange.endDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
    [dateRange.endDate],
  );

  // Generation timestamp — the actual day/time the PDF is produced (shown on the cover).
  const generatedAt = useMemo(
    () => new Date().toLocaleString('en-GB', {
      day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }),
    [],
  );

  const periodEnd = useMemo(
    () => dateRange.endDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    [dateRange.endDate],
  );

  // ── Office locations (page 11) — built from scoped locations (respects region filter).
  const officeLocations = scopedLocations.slice(0, 8).map(loc => ({
    title: loc.city || loc.location_name || 'Office',
    lines: [
      loc.address_line1,
      loc.address_line2,
      loc.city,
      loc.postal_code,
      normaliseCountry(loc.country, loc.postal_code),
    ].filter(Boolean) as string[],
  }));

  // ── Viewing contact (page 9) — pulled from org / primary location with sensible fallbacks.
  const viewingContact = {
    name: organization?.name ? organization.name.toUpperCase() : 'PRACTICE CONTACT',
    phone: organization?.phone || location?.phone || '',
    email: organization?.email || location?.email || '',
  };

  // Track which per-location practice sections have finished loading their data,
  // so we can block "Generate PDF" until every section is ready.
  const [readySections, setReadySections] = useState<Set<string>>(() => new Set());
  const markSection = useCallback((key: string, ready: boolean) => {
    setReadySections(prev => {
      if (ready === prev.has(key)) return prev;
      const next = new Set(prev);
      if (ready) next.add(key); else next.delete(key);
      return next;
    });
  }, []);

  // Lazy pages only mount their DOM near the viewport. Before printing we flip
  // print mode on so every lazy page force-mounts, wait for React to commit the
  // DOM, then print. `afterprint` resets the flag so off-screen pages can unmount
  // their work again. Presentational pages render synchronously, so the captured
  // PDF is always the complete document regardless of scroll position.
  const [printing, setPrinting] = useState(false);
  const handlePrint = useCallback(() => setPrinting(true), []);
  useEffect(() => {
    const reset = () => setPrinting(false);
    window.addEventListener('afterprint', reset);
    return () => window.removeEventListener('afterprint', reset);
  }, []);
  useEffect(() => {
    if (!printing) return;
    // Two rAFs: first lets the force-mounted pages render, second ensures the
    // browser has laid them out before the print dialog snapshots the document.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => window.print());
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [printing]);

  if (isLoading || !d) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[800px] w-full" />
      </div>
    );
  }

  // The scoped locations that the practice sections will render for. When a
  // single location (or region with one location) is selected, this is one
  // location and the output matches the pre-feature single-practice IM.
  const practiceSectionLocations = isMultiLocationView
    ? scopedLocations
    : [location].filter(Boolean);

  // Gate "Generate PDF"/"Print" until EVERY practice section has its data, so the
  // export never captures a still-loading section. Empty scope ⇒ ready (nothing to wait for).
  const expectedSectionKeys = practiceSectionLocations.map((l) => (l as { id: string }).id);
  const readySectionCount = expectedSectionKeys.filter((k) => readySections.has(k)).length;
  const allSectionsReady = expectedSectionKeys.length === 0 || readySectionCount === expectedSectionKeys.length;

  return (
    <>
      {/* ─── Print + screen CSS ─── */}
      <style>{`
        /* On-screen typography defaults */
        .pdf-page { font-family: 'Inter', system-ui, sans-serif; color: #2a2a2a; }
        .pdf-page table { border-collapse: collapse; }
        .pdf-page .im-table th, .pdf-page .im-table td { padding: 6px 8px; border: 1px solid #e6eaf0; font-size: 11px; }
        .pdf-page .im-table th { background: #f8f9fb; color: #1a2557; font-weight: 700; text-align: left; }
        .pdf-page .im-table tr:nth-child(even) td { background: #f8f9fb; }
        /* Premium multi-column table header cell: uppercase muted small-caps. */
        .pdf-page th.im-thx {
          color: #6b7280;
          font-size: 9.5px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .pdf-page th.im-thx div { letter-spacing: 0.06em; }

        /* Cover-page vibrant fintech gradient — applied via class so AutoScalePage
           can own width/height styles. print-color-adjust forced so the gradient
           survives printing. */
        .cover-bg {
          background: linear-gradient(135deg, #1f2a5e 0%, #4f5bff 60%, #6a3bff 100%);
          font-family: 'Inter', system-ui, sans-serif;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        /* Light fintech content-page surface (KPI dashboard look). */
        .ft-page {
          background: #f4f6fb;
          font-family: 'Inter', system-ui, sans-serif;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        /* Executive Summary gets a distinct tinted wash so it stands apart. */
        .ft-page-exec {
          background: linear-gradient(150deg, #eaf0ff 0%, #f3eefb 100%);
          font-family: 'Inter', system-ui, sans-serif;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        /* Screen-only: skip painting off-screen pages for perf */
        @media screen {
          .pdf-page-content { content-visibility: auto; contain-intrinsic-size: 210mm 297mm; }
          .pdf-page-cover { content-visibility: auto; contain-intrinsic-size: 297mm 210mm; }
        }

        /* ─── Print rules ─── */
        @media print {
          /* Every page in the IM is A4 landscape, so make the default page
             landscape too. This stops Chrome inserting a blank portrait sheet
             before the first page and after the last (the wrapper DOM has no
             named-page rule, so it would otherwise default to portrait). */
          @page { size: A4 landscape; margin: 0; }

          /* Make Chrome honour every background colour, gradient and tinted cell */
          *, *::before, *::after {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }

          html, body {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
            width: auto !important;
            height: auto !important;
          }

          /* Hide every layout chrome element so only the PDF preview prints */
          .pdf-no-print { display: none !important; }
          aside, header, nav { display: none !important; }
          /* AIChatWidget, ChatFloatingButton (v2), and ChatDrawer all opt out
             via data-no-print / data-chatbot-root. Tailwind utility classes
             don't expose the component name, so attribute hooks are the only
             reliable join. data-radix-popper-content-wrapper catches portaled
             popovers (mention picker etc.). */
          [data-no-print], [data-chatbot], [data-chatbot-root], [data-radix-popper-content-wrapper] { display: none !important; }

          /* Reset MainLayout's main wrapper so the PDF starts at the page edge */
          main {
            padding: 0 !important;
            margin: 0 !important;
            transform: none !important;
          }

          /* Container around the pages — strip the on-screen background, padding, gap */
          .pdf-print-root {
            display: block !important;
            background: white !important;
            padding: 0 !important;
            margin: 0 !important;
            gap: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            width: auto !important;
          }
          .pdf-print-root > * + * { margin-top: 0 !important; }

          /* Each page paints at real A4 size — drop shadows, borders, max-width caps */
          .pdf-page {
            page-break-after: always !important;
            break-after: page !important;
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
            max-width: none !important;
            border-radius: 0 !important;
            display: block !important;
          }
          .pdf-page-cover {
            width: 297mm !important;
            height: 210mm !important;
            min-height: 210mm !important;
            max-height: 210mm !important;
            overflow: hidden !important;
          }
          /* The portrait PdfPage helper is no longer used by any page (all 11
             are landscape now). Keep the class hook in case it's reintroduced. */
          .pdf-page-content {
            width: 297mm !important;
            height: 210mm !important;
            min-height: 210mm !important;
            max-height: 210mm !important;
            overflow: hidden !important;
          }
          /* Each .pdf-page lives inside its own .pdf-scale-wrap, so target the
             first/last wrap in the document, then its inner .pdf-page, to
             suppress the blank sheets Chrome otherwise inserts before page 1
             and after the last page (caused by 'page-break-after: always' and
             the wrapper DOM defaulting to a fresh page). */
          .pdf-print-root > :first-child .pdf-page {
            page-break-before: auto !important;
            break-before: auto !important;
          }
          .pdf-print-root > :last-child .pdf-page {
            page-break-after: auto !important;
            break-after: auto !important;
          }

          /* Remove the auto-scale transform/clipping so the printer gets the real-size page */
          .pdf-scale-wrap {
            max-width: none !important;
            width: auto !important;
            height: auto !important;
            overflow: visible !important;
            background: transparent !important;
          }
          .pdf-scale-wrap > .pdf-page {
            transform: none !important;
          }
        }
      `}</style>

      <div className="space-y-4">
        {/* Toolbar */}
        <div className="pdf-no-print flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Generate PDF</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Information Memorandum · live data from EBITDA-to-Value
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!allSectionsReady && (
              <span className="text-sm text-muted-foreground flex items-center gap-2 mr-1">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading data… {readySectionCount}/{expectedSectionKeys.length} {expectedSectionKeys.length === 1 ? 'section' : 'practices'}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={handlePrint} disabled={!allSectionsReady}>
              <Printer className="w-4 h-4 mr-2" />
              Print
            </Button>
            <Button size="sm" onClick={handlePrint} disabled={!allSectionsReady}>
              <Download className="w-4 h-4 mr-2" />
              {allSectionsReady ? 'Generate PDF' : 'Preparing…'}
            </Button>
          </div>
        </div>

        {/* ═══ PDF PREVIEW ═══ */}
        <PrintModeContext.Provider value={printing}>
        <div className="pdf-print-root flex flex-col items-center gap-6 bg-[#e8e8e8] p-6 rounded-lg">

          {/* ╔══ PAGE 1 — COVER (LANDSCAPE, auto-scaled to fit any viewport) ══╗ */}
          {/* Cover is always first/visible — render eagerly so it never flashes empty. */}
          <AutoScalePage lazy={false} widthMm={297} heightMm={210} pageClass="pdf-page pdf-page-cover shadow-lg relative overflow-hidden cover-bg">
            {/* Background subtle dots/stars (reduced count for perf) */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
              {Array.from({ length: 18 }).map((_, i) => {
                const cx = (i * 137) % 1100 + 20;
                const cy = (i * 79) % 700 + 20;
                const r = ((i * 13) % 3) * 0.6 + 0.4;
                return <circle key={i} cx={cx} cy={cy} r={r} fill="white" opacity={0.18} />;
              })}
            </svg>

            <div className="relative h-full grid grid-cols-[1.05fr_1fr] gap-8 px-16 py-14" style={{ minHeight: '210mm' }}>
              {/* ── Left content ── */}
              <div className="flex flex-col justify-between h-full">
                {/* Top: brand lockup + confidential tag */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="block" style={{ width: '3px', height: '30px', borderRadius: '999px', background: '#ffffff', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
                    <img
                      src={SITE_LOGOS.logoLight}
                      alt="DentPulse"
                      className="h-[28px] w-auto object-contain"
                      crossOrigin="anonymous"
                    />
                  </div>
                </div>

                {/* Centre: eyebrow + group/practice title + practice list */}
                <div className="flex flex-col gap-8 my-auto">
                  <div>
                    <p className="font-bold uppercase mb-4 text-white" style={{ fontSize: '11px', letterSpacing: '0.2em' }}>
                      Information Memorandum
                    </p>
                    <h1
                      className="text-white font-bold leading-[1.05]"
                      style={{ fontSize: coverTitle.length > 28 ? '40px' : '48px', letterSpacing: '-1.2px' }}
                    >
                      {coverTitle}
                    </h1>
                    {coverLocationNames.length > 1 && (
                      <div className="mt-5 flex flex-wrap items-center gap-2" style={{ maxWidth: '540px' }}>
                        {coverLocationNames.map((name, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center text-white"
                            style={{ fontSize: '11px', fontWeight: 600, background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)', borderRadius: '999px', padding: '4px 12px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom: report meta + brand sub-lockup */}
                <div className="flex items-end justify-between">
                  <div className="border-l border-white/25 pl-3">
                    <p className="text-white font-bold uppercase" style={{ fontSize: '10px', letterSpacing: '0.2em' }}>DentPulse</p>
                    <p className="text-white/55 uppercase" style={{ fontSize: '8.5px', letterSpacing: '0.3em' }}>EBITDA-to-Value™</p>
                  </div>
                  <p className="text-white/45" style={{ fontSize: '9.5px' }}>{generatedAt}</p>
                </div>
              </div>

              {/* ── Right: prominent glass Enterprise Value KPI card ── */}
              <div className="relative flex items-center justify-center">
                <div
                  className="w-full"
                  style={{
                    maxWidth: '420px',
                    background: 'rgba(255,255,255,0.97)',
                    borderRadius: '20px',
                    border: '1px solid rgba(255,255,255,0.6)',
                    boxShadow: '0 24px 60px rgba(8,12,40,0.35)',
                    padding: '34px 34px 30px',
                    WebkitPrintColorAdjust: 'exact',
                    printColorAdjust: 'exact',
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className="uppercase" style={{ color: FT.brand, fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.14em' }}>
                      Indicative Enterprise Value
                    </p>
                    <span style={{ width: '10px', height: '10px', borderRadius: '999px', background: FT.orange, display: 'inline-block', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />
                  </div>
                  <p
                    className="tabular-nums leading-none"
                    style={{ color: FT.ink, fontSize: '52px', fontWeight: 800, letterSpacing: '-2px', marginTop: '12px' }}
                  >
                    {formatCurrency(d.enterpriseValue)}
                  </p>
                  <div style={{ height: '1px', background: FT.cardBorder, margin: '20px 0 18px' }} />
                  {/* Supporting mini KPI row */}
                  <div className="grid grid-cols-2 gap-3 mb-5">
                    <div style={{ background: FT.surfaceAlt, border: `1px solid ${FT.cardBorder}`, borderRadius: '12px', padding: '12px 14px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                      <p className="uppercase" style={{ color: FT.muted, fontSize: '9px', fontWeight: 600, letterSpacing: '0.12em' }}>Sustainable EBITDA</p>
                      <p className="tabular-nums" style={{ color: FT.ink, fontSize: '19px', fontWeight: 800, marginTop: '5px', letterSpacing: '-0.5px' }}>{formatCurrency(d.sustainableEBITDA)}</p>
                    </div>
                    <div style={{ background: FT.surfaceAlt, border: `1px solid ${FT.cardBorder}`, borderRadius: '12px', padding: '12px 14px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                      <p className="uppercase" style={{ color: FT.muted, fontSize: '9px', fontWeight: 600, letterSpacing: '0.12em' }}>Applied Multiple</p>
                      <p className="tabular-nums" style={{ color: FT.ink, fontSize: '19px', fontWeight: 800, marginTop: '5px', letterSpacing: '-0.5px' }}>{d.multiple.finalMultiple.toFixed(2)}×</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1.5" style={{ background: FT.surfaceAlt, border: `1px solid ${FT.cardBorder}`, borderRadius: '999px', padding: '4px 11px', fontSize: '10px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                      <span style={{ color: FT.muted }}>Period</span>
                      <span style={{ color: FT.ink, fontWeight: 600 }}>{periodLabel}</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5" style={{ background: FT.surfaceAlt, border: `1px solid ${FT.cardBorder}`, borderRadius: '999px', padding: '4px 11px', fontSize: '10px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                      <span style={{ color: FT.muted }}>Scope</span>
                      <span style={{ color: FT.ink, fontWeight: 600 }}>{scopeLabel}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom-right gradient swoosh */}
            <svg
              className="absolute bottom-0 right-0 pointer-events-none"
              width="220"
              height="70"
              viewBox="0 0 220 70"
            >
              <defs>
                <linearGradient id="coverSwoosh" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#f57c4d" />
                </linearGradient>
              </defs>
              <path d="M 0 70 Q 80 50 220 0 L 220 70 Z" fill="url(#coverSwoosh)" opacity="0.9" />
            </svg>
          </AutoScalePage>

          {/* ╔══ PER-PRACTICE SECTIONS ══╗
              The 12 location-scoped pages (Executive Summary → Due Diligence).
              · Single-location / single-region scope: rendered ONCE with the
                current GLOBAL filter context — byte-for-byte the same output as
                before this feature.
              · "All locations" (multi-location): rendered ONCE PER LOCATION,
                each wrapped in a FilterContext.Provider that overrides
                selectedLocationId (and clears selectedRegionId) so every data
                hook inside PracticeSection re-fetches scoped to that practice.
                Each PracticeSection calls its hooks at its own top level, so
                the Rules of Hooks are respected (no hooks inside .map()). */}
          {isMultiLocationView
            ? practiceSectionLocations.map((loc) => (
                <FilterContext.Provider
                  key={loc.id}
                  value={{ ...filters, selectedLocationId: loc.id, selectedRegionId: null } as FilterContextType}
                >
                  <PracticeSection onReady={markSection} readyKey={loc.id} />
                </FilterContext.Provider>
              ))
            : <PracticeSection onReady={markSection} readyKey={(location as { id?: string } | undefined)?.id ?? '__single__'} />}

          {/* ╔══ PAGE 6e — PRACTICE PORTFOLIO (multi-location only) ══╗
              Rendered only when the TopBar has no specific location selected
              AND the org has > 1 location. Lists each location with chairs,
              region, provider count, and provider revenue split for the
              same period the rest of the PDF covers. When a specific
              location IS selected, this page is omitted because the rest of
              the IM is already scoped to that single practice. */}
          {isMultiLocationView && (
            // Not lazy: its rows (LocationRevenueRow) fetch their own data, so it
            // must stay mounted to load eagerly and be complete at print time.
            <AutoScalePage lazy={false} widthMm={297} heightMm={210} pageClass="pdf-page pdf-page-cover relative overflow-hidden ft-page shadow-lg">
              <svg className="absolute top-0 right-0 pointer-events-none" width="320" height="220" viewBox="0 0 320 220" style={{ zIndex: 0 }}>
                <path d="M 320 0 Q 200 110 30 200 L 320 220 Z" fill="#4f5bff" opacity="0.10" />
                <path d="M 320 40 Q 220 130 90 210 L 320 210 Z" fill="#8b5cf6" opacity="0.08" />
              </svg>

              <div className="relative h-full px-14 pt-9 pb-[80px]" style={{ zIndex: 1 }}>
                <PageHeader
                  eyebrow="The Group"
                  title="Practice Portfolio"
                  size="md"
                  right={
                    <div className="flex flex-wrap gap-2 mt-1">
                      <span className="inline-flex items-center gap-1.5" style={{ background: FT.surfaceAlt, border: `1px solid ${FT.cardBorder}`, borderRadius: '999px', padding: '4px 11px', fontSize: '10px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                        <span style={{ color: FT.muted }}>Period</span>
                        <span style={{ color: FT.ink, fontWeight: 600 }}>{periodLabel}</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5" style={{ background: FT.surfaceAlt, border: `1px solid ${FT.cardBorder}`, borderRadius: '999px', padding: '4px 11px', fontSize: '10px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                        <span style={{ color: FT.muted }}>Scope</span>
                        <span style={{ color: FT.ink, fontWeight: 600 }}>{scopeLabel}</span>
                      </span>
                    </div>
                  }
                />

                <p className="mb-3" style={{ fontSize: '11px', color: FT.muted }}>
                  Each row reports provider production for the selected period, scoped to that location's TPIs.
                  Chair count and primary-site flag come from the practice configuration.
                </p>

                {(() => {
                  const portfolioLocations = scopedLocations.slice(0, 12);
                  // Region column is omitted entirely when no location in view
                  // resolves to a named region (the column would be all '—').
                  const showRegion = portfolioLocations.some(
                    loc => (regions ?? []).find((r: any) => r.id === loc.region_id)?.name,
                  );
                  return (
                    <div style={{ border: `1px solid ${FT.cardBorder}`, borderRadius: FT.radius, overflow: 'hidden', boxShadow: FT.cardShadow, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                    <table className="w-full border-collapse" style={{ fontSize: '11px' }}>
                      <thead>
                        <tr style={{ background: T.surfaceAlt }}>
                          <th className="im-thx px-3 py-2.5 text-left border border-[#eef1f7]" style={{ width: '18%' }}>Location</th>
                          <th className="im-thx px-3 py-2.5 text-left border border-[#eef1f7]" style={{ width: '11%' }}>City</th>
                          {showRegion && (
                            <th className="im-thx px-3 py-2.5 text-center border border-[#eef1f7]" style={{ width: '10%' }}>Region</th>
                          )}
                          <th className="im-thx px-3 py-2.5 text-center border border-[#eef1f7]" style={{ width: '6%' }}>Chairs</th>
                          <th className="im-thx px-3 py-2.5 text-center border border-[#eef1f7]" style={{ width: '8%' }}>
                            <div className="leading-tight">Active</div>
                            <div className="leading-tight">Providers</div>
                          </th>
                          <th className="im-thx px-3 py-2.5 text-right border border-[#eef1f7]" style={{ width: '11%' }}>Private £</th>
                          <th className="im-thx px-3 py-2.5 text-right border border-[#eef1f7]" style={{ width: '11%' }}>NHS+Plan £</th>
                          <th className="im-thx px-3 py-2.5 text-right border border-[#eef1f7]" style={{ width: '12%' }}>Total £</th>
                          <th className="im-thx px-3 py-2.5 text-center border border-[#eef1f7]" style={{ width: '8%' }}>
                            <div className="leading-tight">Private</div>
                            <div className="leading-tight">Mix</div>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {portfolioLocations.map((loc, i) => {
                          const regionName = (regions ?? []).find((r: any) => r.id === loc.region_id)?.name ?? null;
                          return (
                            <LocationRevenueRow
                              key={loc.id}
                              loc={loc}
                              startDate={dateRange.startDate}
                              endDate={dateRange.endDate}
                              regionName={regionName}
                              showRegion={showRegion}
                              index={i}
                            />
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                  );
                })()}

                {scopedLocations.length > 12 && (
                  <p className="text-[10.5px] text-[#666] italic mt-3">
                    Showing first 12 of {scopedLocations.length} locations · adjust the region filter to focus on a sub-portfolio.
                  </p>
                )}
              </div>

              <IMLandscapeFooter />
            </AutoScalePage>
          )}

          {/* ╔══ PAGE 9 — VIEWINGS & DISCLAIMER (LANDSCAPE, responsive) ══╗ */}
          <AutoScalePage widthMm={297} heightMm={210} pageClass="pdf-page pdf-page-cover relative overflow-hidden ft-page shadow-lg">
            {/* Decorative brand corner glow */}
            <div className="absolute top-0 right-0 pointer-events-none" style={{ width: '260px', height: '160px', background: 'radial-gradient(120px 90px at 100% 0%, rgba(79,91,255,0.10), transparent 70%)', zIndex: 0, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />

            <div className="relative h-full px-14 pt-10 pb-[80px]" style={{ zIndex: 1 }}>
              <PageHeader eyebrow="Next Steps" title="Viewings" index="14 / 17" size="md" />

              {/* Orange subtitle */}
              <p className="text-[#f57c4d] mb-5 -mt-3" style={{ fontSize: '12.5px' }}>
                All sales are confidential; no direct approach to the vendor is to be made
              </p>

              {/* ── Viewing contact block ── */}
              <div className="mb-7" style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: '16px', overflow: 'hidden', boxShadow: T.cardShadow }}>
                <CardTitle title="To book a viewing contact" />
                <div>
                  <div className="grid grid-cols-2 divide-x divide-[#eef1f7]">
                    <div className="px-6 py-4 text-center">
                      <p className="font-bold text-[#1a2557] uppercase tracking-wider" style={{ fontSize: '12px' }}>
                        {viewingContact.name}
                      </p>
                      {viewingContact.phone && (
                        <p className="text-[#2a2a2a] mt-1.5" style={{ fontSize: '12px' }}>
                          {viewingContact.phone}
                        </p>
                      )}
                      {viewingContact.email && (
                        <p className="text-[#2a2a2a] mt-0.5" style={{ fontSize: '12px' }}>
                          {viewingContact.email}
                        </p>
                      )}
                    </div>
                    <div className="px-6 py-4 text-center flex flex-col justify-center">
                      <p className="text-[#1a2557] font-semibold" style={{ fontSize: '12px' }}>
                        Preferred Viewing Times:
                      </p>
                      <p className="text-[#2a2a2a] mt-1" style={{ fontSize: '12px' }}>
                        On request
                      </p>
                    </div>
                  </div>
                  <div className="border-t border-[#eef1f7] px-6 py-3 text-center text-[#2a2a2a]" style={{ fontSize: '11px' }}>
                    To find out more about upgrading your buyer registration to receive first or exclusive access to future practice opportunities, please contact us.
                  </div>
                </div>
              </div>

              {/* ── Disclaimer block ── */}
              <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: '16px', overflow: 'hidden', boxShadow: T.cardShadow }}>
                <CardTitle title="Disclaimer" />
                <div className="px-6 py-4">
                  <ol className="list-decimal pl-5 space-y-1.5 text-[#2a2a2a]" style={{ fontSize: '10.5px', lineHeight: 1.5 }}>
                    <li>The particulars are set out as a general outline only for the guidance of purchasers, and do not constitute an offer or contract.</li>
                    <li>All descriptions, references to condition and other details are given without responsibility and intending purchasers must satisfy themselves by inspection or otherwise.</li>
                    <li>The information contained within this document must not be seen as a representation of fact.</li>
                    <li>No person employed by {practiceName} has any authority to make or give any representation or warranty whatsoever in relation to the property or the business.</li>
                    <li>All information contained within this Information Memorandum is confidential as per the terms of the buyer agreement duly signed, and must not be shared with any third parties.</li>
                  </ol>
                </div>
              </div>
            </div>

            <IMLandscapeFooter />
          </AutoScalePage>

          {/* ╔══ PAGE 10 — PRACTICE FINANCE (LANDSCAPE, responsive) ══╗ */}
          <AutoScalePage widthMm={297} heightMm={210} pageClass="pdf-page pdf-page-cover relative overflow-hidden ft-page shadow-lg">
            {/* Decorative brand corner glow */}
            <div className="absolute top-0 right-0 pointer-events-none" style={{ width: '260px', height: '160px', background: 'radial-gradient(120px 90px at 100% 0%, rgba(79,91,255,0.10), transparent 70%)', zIndex: 0, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />

            <div className="relative h-full px-14 pt-10 pb-[80px]" style={{ zIndex: 1 }}>
              <PageHeader
                eyebrow="Funding Partners"
                title="Practice Finance"
                size="md"
                right={
                  <div className="flex items-center gap-3">
                    <img
                      src={SITE_LOGOS.logoDark}
                      alt="DentPulse"
                      className="h-[36px] w-auto object-contain"
                      crossOrigin="anonymous"
                    />
                    <div className="border-l border-[#1a2557]/20 pl-3">
                      <p className="text-[#1a2557] font-bold tracking-[0.15em]" style={{ fontSize: '13px' }}>DENTPULSE</p>
                      <p className="text-[#1a2557]/70 tracking-[0.2em]" style={{ fontSize: '10px' }}>FINANCIAL SERVICES</p>
                    </div>
                  </div>
                }
              />

              {/* Orange subtitle */}
              <p className="text-[#f57c4d] mb-3 -mt-2" style={{ fontSize: '14px' }}>
                Buying your first practice? Financing another practice?
              </p>

              {/* Intro paragraph */}
              <p className="text-[#2a2a2a] mb-6 leading-relaxed" style={{ fontSize: '11.5px' }}>
                Our practice finance partners specialise in providing services to dental professionals. Sector experience
                allows our team to research and source financial products which best suit the needs of clients, through
                whole-of-market research. Advice is independent and is relevant to the dental healthcare sector. Long
                standing trusted relationships with clients and providers, is of paramount importance, and enables us to
                achieve our goal of giving excellent service, financial advice and guidance.
              </p>

              {/* Two-column body */}
              <div className="grid grid-cols-2 gap-10">
                {/* Left — What we do for you */}
                <div>
                  <h3 className="text-[#f57c4d] font-semibold mb-3" style={{ fontSize: '16px' }}>
                    What we do for you
                  </h3>
                  <p className="text-[#2a2a2a] mb-3 leading-relaxed" style={{ fontSize: '11px' }}>
                    Throughout your search for the &lsquo;right&rsquo; practice, why not use our expertise &amp; support.
                    We will provide you with detailed feedback on: any practice you are looking to purchase, accounts
                    analysis, any issues regarding serviceability &amp; give you an insight into bank &ldquo;stress-testing&rdquo;.
                    Our existing long-term relationships with all banks&rsquo; facilitating investment into the healthcare
                    sector ensure:
                  </p>
                  <ul className="space-y-1.5">
                    {[
                      'Indicative Terms from banks within 3–5 days',
                      '1 point of contact Regional Dental Healthcare Specialist',
                      'Streamlined process, avoiding unnecessary delays',
                      'Preferential interest rates (rather than going direct or to your local branch)',
                      'An exhaustive panel of approved active specialists',
                    ].map((item, i) => (
                      <li key={i} className="flex gap-2.5 items-start" style={{ fontSize: '11px' }}>
                        <span className="text-[#f57c4d] leading-none mt-[4px] shrink-0" style={{ fontSize: '8px' }}>■</span>
                        <span className="text-[#2a2a2a] leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Right — Considerations */}
                <div>
                  <h3 className="text-[#f57c4d] font-semibold mb-3" style={{ fontSize: '16px' }}>
                    Considerations
                  </h3>
                  <p className="text-[#2a2a2a] mb-3 leading-relaxed" style={{ fontSize: '11px' }}>
                    We pride ourselves on service, so rather than just putting you in contact with lenders we will take
                    you through the whole process to ensure your personal and business circumstances are considered in
                    any loan which is attained. There are many considerations when taking out a loan.
                  </p>
                  <ul className="space-y-1.5">
                    {[
                      'Interest Rates',
                      'Deposit Levels',
                      'Property Equity',
                      'Goodwill Repayment Periods',
                      'Repayment Type',
                      'Loan Serviceability',
                    ].map((item, i) => (
                      <li key={i} className="flex gap-2.5 items-start" style={{ fontSize: '11px' }}>
                        <span className="text-[#f57c4d] leading-none mt-[4px] shrink-0" style={{ fontSize: '8px' }}>■</span>
                        <span className="text-[#2a2a2a] leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <IMLandscapeFooter />
          </AutoScalePage>

          {/* ╔══ PAGE 11 — CONTACT / OFFICE LOCATIONS (LANDSCAPE, dark navy) ══╗ */}
          <AutoScalePage widthMm={297} heightMm={210} pageClass="pdf-page pdf-page-cover relative overflow-hidden shadow-lg cover-bg">
            {/* Subtle background dots */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
              {Array.from({ length: 14 }).map((_, i) => {
                const cx = (i * 137) % 1100 + 20;
                const cy = (i * 79) % 700 + 20;
                const r = ((i * 13) % 3) * 0.5 + 0.4;
                return <circle key={i} cx={cx} cy={cy} r={r} fill="white" opacity={0.15} />;
              })}
            </svg>

            <div className="relative h-full grid grid-cols-[1.7fr_1fr] gap-10 px-14 pt-12 pb-[100px]" style={{ zIndex: 1 }}>
              {/* ── Left: Office locations grid ── */}
              <div>
                {officeLocations.length > 0 ? (
                  <div className="grid grid-cols-4 gap-x-6 gap-y-7">
                    {officeLocations.map((loc, i) => (
                      <div key={i}>
                        <h3 className="text-[#f57c4d] font-bold mb-2.5" style={{ fontSize: '17px' }}>
                          {loc.title}
                        </h3>
                        <div className="text-white space-y-0.5" style={{ fontSize: '11px', lineHeight: 1.5 }}>
                          {loc.lines.map((line, li) => (
                            <p key={li}>{line}</p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-white/70 italic text-[12px]">
                    Add locations under Organization → Locations to display office addresses here.
                  </div>
                )}
              </div>

              {/* ── Right: Contact person card ── */}
              <div className="flex flex-col items-end">
                {/* Avatar placeholder — clean silhouette inside a rounded rectangle */}
                <div
                  className="rounded-md overflow-hidden border-2 border-white/15"
                  style={{ width: '180px', height: '220px', background: 'linear-gradient(180deg, #2a3970 0%, #1a2557 100%)' }}
                >
                  <svg viewBox="0 0 180 220" className="w-full h-full">
                    {/* Soft circle behind */}
                    <circle cx="90" cy="92" r="48" fill="white" opacity="0.08" />
                    {/* Head */}
                    <circle cx="90" cy="90" r="32" fill="white" opacity="0.85" />
                    {/* Shoulders */}
                    <path d="M 30 220 Q 30 150 90 150 Q 150 150 150 220 Z" fill="white" opacity="0.85" />
                    {/* Subtle highlight strip */}
                    <rect x="0" y="210" width="180" height="10" fill="#f57c4d" opacity="0.85" />
                  </svg>
                </div>
              </div>
            </div>

            {/* ── Bottom-left: DentPulse logo + website ── */}
            <div className="absolute left-14 pointer-events-none" style={{ bottom: '70px', zIndex: 2 }}>
              <div className="flex items-center gap-3">
                <img
                  src={SITE_LOGOS.logoLight}
                  alt="DentPulse"
                  className="h-[34px] w-auto object-contain"
                  crossOrigin="anonymous"
                />
                <div className="border-l border-white/30 pl-3">
                  <p className="text-white font-bold tracking-[0.2em] leading-none" style={{ fontSize: '11px' }}>DENTPULSE</p>
                  <p className="text-white/70 tracking-[0.25em] leading-none mt-1" style={{ fontSize: '9px' }}>EBITDA-TO-VALUE™</p>
                </div>
              </div>
              {viewingContact.email && (
                <p className="text-white/70 mt-2" style={{ fontSize: '11px' }}>
                  {viewingContact.email}{viewingContact.phone ? `  |  ${viewingContact.phone}` : ''}
                </p>
              )}
            </div>

            {/* ── Bottom-right: contact person details ── */}
            <div className="absolute right-14 text-right pointer-events-none" style={{ bottom: '70px', zIndex: 2 }}>
              <p className="text-[#f57c4d] font-bold leading-tight" style={{ fontSize: '18px' }}>
                {viewingContact.name}
              </p>
              <p className="text-[#f57c4d] mt-1" style={{ fontSize: '13px' }}>
                Practice Transitions Consultant
              </p>
              {viewingContact.phone && (
                <p className="text-white mt-2" style={{ fontSize: '13px' }}>{viewingContact.phone}</p>
              )}
              {viewingContact.email && (
                <p className="text-white mt-0.5" style={{ fontSize: '13px' }}>{viewingContact.email}</p>
              )}
            </div>

            {/* Orange swoosh — bottom-right corner */}
            <svg
              className="absolute bottom-0 right-0 pointer-events-none"
              width="200"
              height="60"
              viewBox="0 0 200 60"
              preserveAspectRatio="none"
            >
              <path d="M 0 60 Q 60 30 200 0 L 200 60 Z" fill="#f57c4d" />
            </svg>
          </AutoScalePage>
        </div>
        </PrintModeContext.Provider>
      </div>
    </>
  );
}

export default function GeneratePdf() {
  return (
    <MainLayout>
      <Helmet>
        <title>Generate PDF | DentPulse</title>
        <meta name="description" content="Information Memorandum PDF generated from live EBITDA-to-Value data" />
      </Helmet>
      <GeneratePdfContent />
    </MainLayout>
  );
}
