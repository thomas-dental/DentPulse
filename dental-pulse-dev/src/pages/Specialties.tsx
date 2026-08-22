import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Construction } from 'lucide-react';

export default function Specialties() {
  return (
    <MainLayout userRole="admin">
      <Helmet>
        <title>Specialties</title>
      </Helmet>
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-6">
        <div className="flex items-center justify-center w-20 h-20 rounded-2xl bg-amber-100 text-amber-500">
          <Construction className="w-10 h-10" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">Under Construction</h1>
          <p className="text-muted-foreground max-w-sm">
            The Specialties page is currently being built. Check back soon.
          </p>
        </div>
      </div>
    </MainLayout>
  );
}
