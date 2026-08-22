import { Helmet } from 'react-helmet-async';
import { ProvidersManagement } from '@/components/providers/ProvidersManagement';

export default function ProvidersHygienist() {
  return (
    <>
      <Helmet>
        <title>Hygienist Providers</title>
        <meta name="description" content="View and manage hygienist providers with performance tracking and production metrics." />
      </Helmet>
      <ProvidersManagement providerType="Hygienist" />
    </>
  );
}
