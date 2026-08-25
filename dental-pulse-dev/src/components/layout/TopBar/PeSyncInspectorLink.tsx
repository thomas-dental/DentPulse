/**
 * DEV-only TopBar link to the Patient Economics sync inspector.
 */

import { useNavigate } from 'react-router-dom';
import { Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUserRole } from '@/hooks/useUserRole';

export function PeSyncInspectorLink() {
  const navigate = useNavigate();
  const { isOwner, isAdmin, loading } = useUserRole();

  if (loading) return null;
  if (!isOwner() && !isAdmin()) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => navigate('/dev/pe-sync-inspector')}
      className="gap-2 h-9 px-3 text-muted-foreground hover:text-foreground"
      title="Patient Economics sync inspector (dev)"
    >
      <Database className="h-4 w-4" />
      <span className="text-sm">PE Sync</span>
    </Button>
  );
}
