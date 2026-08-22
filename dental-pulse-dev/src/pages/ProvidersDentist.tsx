import { Helmet } from 'react-helmet-async';
import { ProvidersManagement } from '@/components/providers/ProvidersManagement';

export default function ProvidersDentist() {
  return (
    <>
      <Helmet>
        <title>Dentist Providers</title>
        <meta name="description" content="View and manage dentist providers with performance tracking and production metrics." />
      </Helmet>
      <ProvidersManagement providerType="Dentist" />
    </>
  );
}
