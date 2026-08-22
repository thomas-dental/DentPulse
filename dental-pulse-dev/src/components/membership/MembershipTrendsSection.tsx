import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Banknote, UserMinus, UserPlus, UserX } from 'lucide-react';
import { useMembershipTrends } from '@/hooks/useMembershipTrends';

/**
 * Supportal-style trend charts for the Membership page: monthly income this
 * year vs last year (with a dentist filter), joiners and leavers over the
 * last 12 months, and cancellations by plan for the shown month. The window
 * ends at the page's display month. Renders nothing until data is uploaded.
 *
 * Cancellations are broken down BY PLAN — the statement PDF (unlike the
 * provider's own portal) carries no cancellation reason.
 */

const ALL_DENTISTS = '__all__';

// Series colors follow the page idiom: navy = revenue (matches the Revenue
// vs Cost chart), slate = comparison period, emerald/amber echo the
// Statement Health card's collected/failed semantics.
const INCOME_CURRENT = '#1e3a5f';
const INCOME_LAST_YEAR = '#94a3b8';
const JOINERS_COLOR = '#059669';
const LEAVERS_COLOR = '#d97706';
// Categorical palette for the cancellations donut — validated (dataviz six
// checks, light surface); >7 plans fold into a gray "Other".
const DONUT_COLORS = ['#4f46e5', '#0284c7', '#059669', '#d97706', '#e11d48', '#7c3aed', '#0d9488', '#a16207'];
const OTHER_COLOR = '#94a3b8';
const MAX_DONUT_SLICES = 7;

// Pence-exact tooltips (client rule 2026-08-19: never round £ off in the
// membership module); the axis ticks stay compact — they label the scale.
const fmtGBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const axisGBP = (v: number) => (Math.abs(v) >= 1000 ? `£${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `£${v}`);

function CountTrendCard({ title, icon, total, color, gradientId, data }: {
  title: string;
  icon: React.ReactNode;
  total: number;
  color: string;
  gradientId: string;
  data: Array<{ month: string; fullLabel: string; value: number | null }>;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          {icon}
          {title}
          <span className="text-muted-foreground font-normal text-sm">— {total} in the last 12 months</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
            <RechartsTooltip
              formatter={(v: number) => [v, title]}
              labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ''}
            />
            <Area
              type="monotone"
              dataKey="value"
              name={title}
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={{ r: 3, fill: color, strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function MembershipTrendsSection({ month, year }: { month: number; year: number }) {
  const [dentist, setDentist] = useState<string>(ALL_DENTISTS);
  const { trends, isLoading } = useMembershipTrends(month, year, dentist === ALL_DENTISTS ? null : dentist);

  if (isLoading || !trends.hasData) return null;

  const donutData = trends.cancellations.byPlan.length > MAX_DONUT_SLICES + 1
    ? [
        ...trends.cancellations.byPlan.slice(0, MAX_DONUT_SLICES),
        {
          name: 'Other',
          value: trends.cancellations.byPlan.slice(MAX_DONUT_SLICES).reduce((s, p) => s + p.value, 0),
        },
      ]
    : trends.cancellations.byPlan;

  const hasDonut = donutData.length > 0;

  return (
    <>
      {/* Income (2/3) + Cancellations donut (1/3) share one row; income
          takes the full row when the month has no cancellations. */}
      <div className={hasDonut ? 'grid grid-cols-1 lg:grid-cols-3 gap-6' : undefined}>
      <Card className={hasDonut ? 'lg:col-span-2' : undefined}>
        <CardHeader className="pb-2 flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Banknote className="w-5 h-5" />
              Membership Income
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Monthly collected membership revenue vs the same month last year
            </p>
          </div>
          {trends.dentists.length > 0 && (
            <Select value={dentist} onValueChange={setDentist}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All dentists" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_DENTISTS}>All dentists</SelectItem>
                {trends.dentists.map(d => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={trends.income} margin={{ top: 6, right: 8, left: -6, bottom: 0 }} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={axisGBP} width={52} />
              <RechartsTooltip
                formatter={(v: number, name: string) => [fmtGBP.format(v), name]}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ''}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="current" name="This year" fill={INCOME_CURRENT} radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Bar dataKey="lastYear" name="Last year" fill={INCOME_LAST_YEAR} radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Cancellations by plan (anchor month) */}
      {hasDonut && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <UserX className="w-4 h-4 text-red-500" />
              Cancellations — {trends.cancellations.monthLabel}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {trends.cancellations.total} patient{trends.cancellations.total === 1 ? '' : 's'}, by plan
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={donutData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="55%"
                  outerRadius="85%"
                  paddingAngle={1}
                  stroke="hsl(var(--card))"
                  strokeWidth={2}
                >
                  {donutData.map((entry, i) => (
                    <Cell
                      key={entry.name}
                      fill={entry.name === 'Other' ? OTHER_COLOR : DONUT_COLORS[i % DONUT_COLORS.length]}
                    />
                  ))}
                </Pie>
                <RechartsTooltip formatter={(v: number, name: string) => [`${v} patient${v === 1 ? '' : 's'}`, name]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
      </div>

      {/* Joiners / Leavers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CountTrendCard
          title="Joiners"
          icon={<UserPlus className="w-4 h-4 text-emerald-600" />}
          total={trends.joinersTotal}
          color={JOINERS_COLOR}
          gradientId="membership-joiners-fill"
          data={trends.joiners}
        />
        <CountTrendCard
          title="Leavers"
          icon={<UserMinus className="w-4 h-4 text-amber-600" />}
          total={trends.leaversTotal}
          color={LEAVERS_COLOR}
          gradientId="membership-leavers-fill"
          data={trends.leavers}
        />
      </div>
    </>
  );
}
