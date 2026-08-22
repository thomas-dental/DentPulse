import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { type ModuleDefinition, type ActionType, ALL_ACTION_TYPES, permissionKey } from '@/lib/permissionRegistry';
import { CardPermissionRow } from './CardPermissionRow';

interface ModulePermissionRowProps {
  module: ModuleDefinition;
  grantedPermissions: Set<string>;  // Set of "card:action" keys
  onToggle: (moduleKey: string, cardKey: string, action: ActionType, granted: boolean) => void;
  onToggleModuleAction: (moduleKey: string, action: ActionType, granted: boolean) => void;
  onBatchToggle: (items: Array<{ module: string; card: string; action_type: string; granted: boolean }>) => void;
  disabled?: boolean;
}

export function ModulePermissionRow({
  module,
  grantedPermissions,
  onToggle,
  onToggleModuleAction,
  onBatchToggle,
  disabled = false,
}: ModulePermissionRowProps) {
  const [expanded, setExpanded] = useState(false);

  // Calculate module-level checked state per action column
  const getModuleActionState = (action: ActionType): 'none' | 'some' | 'all' => {
    const cardsWithAction = module.cards.filter(c => c.actions.includes(action));
    if (cardsWithAction.length === 0) return 'none';
    const grantedCount = cardsWithAction.filter(c =>
      grantedPermissions.has(permissionKey(module.key, c.key, action))
    ).length;
    if (grantedCount === 0) return 'none';
    if (grantedCount === cardsWithAction.length) return 'all';
    return 'some';
  };

  // Build granted actions set per card
  const getCardGrantedActions = (cardKey: string): Set<string> => {
    const set = new Set<string>();
    ALL_ACTION_TYPES.forEach(action => {
      if (grantedPermissions.has(permissionKey(module.key, cardKey, action))) {
        set.add(action);
      }
    });
    return set;
  };

  // Group cards: top-level (no tab) + by tab
  const hasTabs = module.tabs && module.tabs.length > 0;
  const topLevelCards = module.cards.filter(c => !c.tab);
  const cardsByTab = hasTabs
    ? module.tabs!.map(tab => ({
        tab,
        cards: module.cards.filter(c => c.tab === tab.key),
      }))
    : [];

  // Single-card modules: render as a flat row (no accordion)
  const isSingleCard = module.cards.length === 1 && !hasTabs;

  if (isSingleCard) {
    const card = module.cards[0];
    return (
      <div className={`border rounded-lg mb-2 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="grid grid-cols-[1fr_repeat(8,48px)] items-center gap-1 py-2 px-2">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 flex-shrink-0" /> {/* spacer to align with expandable rows */}
            <span className="font-medium text-sm">{module.label}</span>
          </div>
          {ALL_ACTION_TYPES.map((action) => {
            if (!card.actions.includes(action)) {
              return <div key={action} className="flex justify-center"><span className="text-muted-foreground/30">—</span></div>;
            }
            const isGranted = grantedPermissions.has(permissionKey(module.key, card.key, action));
            return (
              <div key={action} className="flex justify-center">
                <Switch
                  checked={isGranted}
                  onCheckedChange={(checked) => {
                    onToggle(module.key, card.key, action, checked);
                  }}
                  disabled={disabled}
                  className="scale-75"
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={`border rounded-lg mb-2 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* Module header */}
      <div
        className={`grid grid-cols-[1fr_repeat(8,48px)] items-center gap-1 py-2 px-2 ${disabled ? '' : 'cursor-pointer hover:bg-muted/30'}`}
        onClick={() => !disabled && setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          )}
          <span className="font-medium text-sm">{module.label}</span>
          <span className="text-xs text-muted-foreground">({module.cards.length} cards)</span>
        </div>
        {ALL_ACTION_TYPES.map((action) => {
          const hasAnyCard = module.cards.some(c => c.actions.includes(action));
          if (!hasAnyCard) {
            return <div key={action} className="flex justify-center"><span className="text-muted-foreground/30">—</span></div>;
          }
          const state = getModuleActionState(action);
          return (
            <div
              key={action}
              className="flex justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              <Switch
                checked={state === 'all'}
                onCheckedChange={(checked) => {
                  onToggleModuleAction(module.key, action, checked);
                }}
                disabled={disabled}
                className="scale-75"
              />
            </div>
          );
        })}
      </div>

      {/* Expanded cards */}
      {expanded && (
        <div className="border-t bg-muted/10 py-1">
          {/* Top-level cards (no tab) — only for modules with tabs */}
          {hasTabs && topLevelCards.map((card) => (
            <CardPermissionRow
              key={card.key}
              cardKey={card.key}
              cardLabel={card.label}
              availableActions={card.actions}
              grantedActions={getCardGrantedActions(card.key)}
              onToggle={(cardKey, action, granted) => onToggle(module.key, cardKey, action, granted)}
              disabled={disabled}
            />
          ))}

          {/* Tab-grouped cards */}
          {hasTabs && cardsByTab.map(({ tab, cards }) => (
            <TabGroupRow
              key={tab.key}
              tabLabel={tab.label}
              cards={cards}
              moduleKey={module.key}
              grantedPermissions={grantedPermissions}
              getCardGrantedActions={getCardGrantedActions}
              onToggle={onToggle}
              onToggleTabAction={onBatchToggle}
              disabled={disabled}
            />
          ))}

          {/* Flat cards (modules without tabs) */}
          {!hasTabs && module.cards.map((card) => (
            <CardPermissionRow
              key={card.key}
              cardKey={card.key}
              cardLabel={card.label}
              availableActions={card.actions}
              grantedActions={getCardGrantedActions(card.key)}
              onToggle={(cardKey, action, granted) => onToggle(module.key, cardKey, action, granted)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Sub-component for a collapsible tab group within a module
function TabGroupRow({
  tabLabel,
  cards,
  moduleKey,
  grantedPermissions,
  getCardGrantedActions,
  onToggle,
  onToggleTabAction,
  disabled,
}: {
  tabLabel: string;
  cards: ModuleDefinition['cards'];
  moduleKey: string;
  grantedPermissions: Set<string>;
  getCardGrantedActions: (cardKey: string) => Set<string>;
  onToggle: (moduleKey: string, cardKey: string, action: ActionType, granted: boolean) => void;
  onToggleTabAction: (items: Array<{ module: string; card: string; action_type: string; granted: boolean }>) => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (cards.length === 0) return null;

  // Single-card tab: render as flat row (no expand needed)
  const isSingleCardTab = cards.length === 1;

  if (isSingleCardTab) {
    const card = cards[0];
    const cardGranted = getCardGrantedActions(card.key);
    return (
      <div className="ml-4 border-l-2 border-primary/20">
        <div className="grid grid-cols-[1fr_repeat(8,48px)] items-center gap-1 py-1.5 px-2">
          <div className="flex items-center gap-2 pl-2">
            <div className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="text-sm font-medium text-primary/80">{tabLabel}</span>
          </div>
          {ALL_ACTION_TYPES.map((action) => {
            if (!card.actions.includes(action)) {
              return <div key={action} className="flex justify-center"><span className="text-muted-foreground/30">—</span></div>;
            }
            const isGranted = cardGranted.has(action);
            return (
              <div key={action} className="flex justify-center">
                <Switch
                  checked={isGranted}
                  onCheckedChange={(checked) => onToggle(moduleKey, card.key, action, checked)}
                  disabled={disabled}
                  className="scale-75"
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Calculate tab-level checked state per action column
  const getTabActionState = (action: ActionType): 'none' | 'some' | 'all' => {
    const cardsWithAction = cards.filter(c => c.actions.includes(action));
    if (cardsWithAction.length === 0) return 'none';
    const grantedCount = cardsWithAction.filter(c =>
      grantedPermissions.has(permissionKey(moduleKey, c.key, action))
    ).length;
    if (grantedCount === 0) return 'none';
    if (grantedCount === cardsWithAction.length) return 'all';
    return 'some';
  };

  const handleToggleTabAction = (action: ActionType, granted: boolean) => {
    const items = cards
      .filter(c => c.actions.includes(action))
      .map(c => ({ module: moduleKey, card: c.key, action_type: action, granted }));
    onToggleTabAction(items);
  };

  return (
    <div className="ml-4 border-l-2 border-primary/20">
      {/* Tab header */}
      <div
        className="grid grid-cols-[1fr_repeat(8,48px)] items-center gap-1 py-1.5 px-2 cursor-pointer hover:bg-muted/30"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 pl-2">
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-primary/60 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-primary/60 flex-shrink-0" />
          )}
          <span className="text-sm font-medium text-primary/80">{tabLabel}</span>
          <span className="text-xs text-muted-foreground">({cards.length})</span>
        </div>
        {ALL_ACTION_TYPES.map((action) => {
          const hasAnyCard = cards.some(c => c.actions.includes(action));
          if (!hasAnyCard) {
            return <div key={action} className="flex justify-center"><span className="text-muted-foreground/30">—</span></div>;
          }
          const state = getTabActionState(action);
          return (
            <div
              key={action}
              className="flex justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              <Switch
                checked={state === 'all'}
                onCheckedChange={(checked) => {
                  handleToggleTabAction(action, checked);
                }}
                disabled={disabled}
                className="scale-75"
              />
            </div>
          );
        })}
      </div>

      {/* Cards within this tab */}
      {expanded && cards.map((card) => (
        <CardPermissionRow
          key={card.key}
          cardKey={card.key}
          cardLabel={card.label}
          availableActions={card.actions}
          grantedActions={getCardGrantedActions(card.key)}
          onToggle={(cardKey, action, granted) => onToggle(moduleKey, cardKey, action, granted)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
