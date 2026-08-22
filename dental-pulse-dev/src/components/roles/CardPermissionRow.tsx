import { Switch } from '@/components/ui/switch';
import { type ActionType, ALL_ACTION_TYPES } from '@/lib/permissionRegistry';

interface CardPermissionRowProps {
  cardKey: string;
  cardLabel: string;
  availableActions: ActionType[];
  grantedActions: Set<string>;  // Set of action_type strings
  onToggle: (cardKey: string, action: ActionType, granted: boolean) => void;
  disabled?: boolean;
}

export function CardPermissionRow({
  cardKey,
  cardLabel,
  availableActions,
  grantedActions,
  onToggle,
  disabled = false,
}: CardPermissionRowProps) {
  return (
    <div className="grid grid-cols-[1fr_repeat(8,48px)] items-center gap-1 py-1.5 px-2 hover:bg-muted/50 rounded-sm">
      <span className="text-sm text-muted-foreground truncate pl-4" title={cardLabel}>
        {cardLabel}
      </span>
      {ALL_ACTION_TYPES.map((action) => {
        const isAvailable = availableActions.includes(action);
        if (!isAvailable) {
          return <div key={action} className="flex justify-center"><span className="text-muted-foreground/30">—</span></div>;
        }
        const isGranted = grantedActions.has(action);
        return (
          <div key={action} className="flex justify-center">
            <Switch
              checked={isGranted}
              onCheckedChange={(checked) => onToggle(cardKey, action, checked)}
              disabled={disabled}
              className="scale-75"
            />
          </div>
        );
      })}
    </div>
  );
}
