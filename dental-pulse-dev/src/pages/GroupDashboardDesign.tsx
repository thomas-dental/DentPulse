import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';

/**
 * Group Dashboard — full design.
 *
 * Renders the complete, self-contained dashboard design (every zone, chart and
 * interaction) exactly as specified, served from public/group-dashboard-design.html
 * and embedded in an isolated frame so its CSS/JS/theme can't collide with the app.
 * Kept inside MainLayout so the app sidebar/top bar stay available.
 *
 * This is the pixel-faithful DESIGN (mockup sample data). The native, real-data
 * version lives at /group-dashboard-live.
 */
export default function GroupDashboardDesign() {
  return (
    <MainLayout>
      <Helmet><title>Group Dashboard</title></Helmet>
      <iframe
        src="/group-dashboard-design.html"
        title="DentPulse Group Dashboard design"
        style={{
          width: '100%',
          height: 'calc(100vh - 72px)',
          border: 'none',
          display: 'block',
          borderRadius: 12,
        }}
      />
    </MainLayout>
  );
}
