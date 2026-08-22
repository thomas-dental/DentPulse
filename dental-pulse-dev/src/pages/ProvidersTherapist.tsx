import { Helmet } from 'react-helmet-async';
import { ProvidersManagement } from '@/components/providers/ProvidersManagement';

export default function ProvidersTherapist() {
  return (
    <>
      <Helmet>
        <title>Therapist Providers</title>
        <meta name="description" content="View and manage therapist providers with performance tracking and production metrics." />
      </Helmet>
      <ProvidersManagement providerType="Therapist" />
    </>
  );
}
