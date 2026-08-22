import { Link, useLocation, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatGbp, formatPercentDisplay } from '@/utils/formatMoney';

type BenchmarkActionState = {
  category?: string;
  benchmarkAmount?: number;
  benchmarkPct?: number;
  actualAmount?: number;
  actualPct?: number;
  variance?: number;
};

function formatCurrency(value: number): string {
  return formatGbp(value);
}

function formatPercent(value: number): string {
  return formatPercentDisplay(Number(value) || 0);
}

export default function ProfitBenchmarkAction() {
  const location = useLocation();
  const params = useParams<{ category: string }>();
  const state = (location.state ?? {}) as BenchmarkActionState;

  const category =
    state.category ||
    (params.category ? decodeURIComponent(params.category) : 'Category');

  const benchmarkAmount = Number(state.benchmarkAmount ?? 0) || 0;
  const benchmarkPct = Number(state.benchmarkPct ?? 0) || 0;
  const actualAmount = Number(state.actualAmount ?? 0) || 0;
  const actualPct = Number(state.actualPct ?? 0) || 0;
  const variance = Number(state.variance ?? 0) || 0;

  const r2 = (n: number) => Math.round((n ?? 0) * 100) / 100;
  const aiContextData = {
    page: 'profit-benchmark-action',
    category,
    row: {
      benchmarkAmount: r2(benchmarkAmount),
      benchmarkPct: r2(benchmarkPct),
      actualAmount: r2(actualAmount),
      actualPct: r2(actualPct),
      variance: r2(variance),
      direction: variance >= 0 ? 'favourable' : 'unfavourable',
    },
  };

  return (
    <MainLayout userRole="admin" aiContext={aiContextData}>
      <Helmet>
        <title>{`Benchmark action – ${category}`}</title>
      </Helmet>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/profitability" aria-label="Back to Profitability">
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold">
            Benchmark action for {category}{' '}
            <span className={variance >= 0 ? 'text-success' : 'text-destructive'}>
              {variance >= 0 ? '+' : ''}
              {variance.toFixed(2)}
            </span>
          </h1>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Expected Amount</TableHead>
                    <TableHead className="text-right">Benchmark</TableHead>
                    <TableHead className="text-right">Actual amount</TableHead>
                    <TableHead className="text-right">Actual %</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">{category}</TableCell>
                    <TableCell className="text-right">{formatCurrency(Math.abs(benchmarkAmount))}</TableCell>
                    <TableCell className="text-right">{formatPercent(benchmarkPct)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(actualAmount)}</TableCell>
                    <TableCell className="text-right">{formatPercent(actualPct)}</TableCell>
                    <TableCell className={`text-right font-medium ${variance >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {variance >= 0 ? '+' : ''}
                      {variance.toFixed(2)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Most common reasons</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">No curated reasons for this category yet.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resources</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">No resources linked yet.</p>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
