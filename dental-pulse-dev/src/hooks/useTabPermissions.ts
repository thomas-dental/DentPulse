import { useMemo } from 'react';
import { usePermissions } from './usePermissions';
import { PERMISSION_REGISTRY } from '@/lib/permissionRegistry';

interface TabPermission {
  key: string;
  label: string;
  visible: boolean;
}

/**
 * Returns tab visibility based on RBAC permissions for a module.
 * Owner sees all tabs. Custom roles only see tabs they have 'view' permission for.
 *
 * Usage:
 *   const { visibleTabs, canViewTab, defaultTab } = useTabPermissions('budget');
 *   // Filter TabsTrigger by visibleTabs
 *   // Use defaultTab as initial active tab
 */
export function useTabPermissions(moduleKey: string) {
  const { can, isOwner, loading } = usePermissions();

  const module = useMemo(
    () => PERMISSION_REGISTRY.find(m => m.key === moduleKey),
    [moduleKey]
  );

  const tabs = useMemo((): TabPermission[] => {
    if (!module?.tabs) return [];

    return module.tabs.map(tab => {
      // Find cards that belong to this tab
      const tabCards = module.cards.filter(c => c.tab === tab.key);

      // Owner sees everything
      if (isOwner) {
        return { key: tab.key, label: tab.label, visible: true };
      }

      // Tab is visible if the user has 'view' on any card within the tab
      const visible = tabCards.some(card => can(moduleKey, 'view', card.key));

      return { key: tab.key, label: tab.label, visible };
    });
  }, [module, moduleKey, can, isOwner]);

  const visibleTabs = useMemo(() => tabs.filter(t => t.visible), [tabs]);

  const canViewTab = (tabKey: string): boolean => {
    const tab = tabs.find(t => t.key === tabKey);
    return tab?.visible ?? false;
  };

  // First visible tab as default
  const defaultTab = visibleTabs.length > 0 ? visibleTabs[0].key : undefined;

  return {
    tabs,
    visibleTabs,
    canViewTab,
    defaultTab,
    loading,
  };
}
