import { Helmet } from 'react-helmet-async';
import { ProvidersManagement } from '@/components/providers/ProvidersManagement';

export default function ProvidersOther() {
  return (
    <>
      <Helmet>
        <title>Other Providers</title>
        <meta name="description" content="View and manage other healthcare provider types with performance tracking." />
      </Helmet>
      <ProvidersManagement providerType="Other" />
    </>
  );
}
