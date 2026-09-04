/**
 * Dentally Integration Configuration
 * Centralized configuration for all Dentally sync entities
 * Add new entities here as they become available
 */

export interface DentallySyncEntity {
  alias: string; // Unique identifier for matching (e.g., "practitioners", "treatments", "locations")
  label: string; // Display label for UI
  description: string;
  is_sync: number; // 1 = enabled, 0 = disabled
  isAvailable?: boolean; // true = implemented, false = coming soon (optional for backwards compatibility)
  last_synced_at?: string | null; // ISO timestamp of last successful sync (for incremental sync)
}


/**
 * Default Dentally sync entities
 * Ordered by priority: small datasets first, large datasets last
 * This is the single source of truth for all Dentally sync options
 */
export const DENTALLY_SYNC_ENTITIES: DentallySyncEntity[] = [
  // Priority 1: Small reference data (fast sync)
  {
    alias: 'locations',
    label: 'Locations',
    description: 'Sync practice sites/locations from Dentally',
    is_sync: 1, // Enabled by default
    isAvailable: true,
  },
  {
    alias: 'treatment_category',
    label: 'Treatment Categories',
    description: 'Sync treatment categories from Dentally',
    is_sync: 1, // Enabled by default
    isAvailable: true,
  },
  {
    alias: 'payment_plans',
    label: 'Payment Plans',
    description: 'Sync payment plans from Dentally',
    is_sync: 1,
    isAvailable: true,
  },
  {
    alias: 'appointment_cancellation_reasons',
    label: 'Cancellation Reasons',
    description: 'Sync appointment cancellation reasons from Dentally',
    is_sync: 1,
    isAvailable: true,
  },
  // Priority 2: Medium datasets
  {
    alias: 'treatments',
    label: 'Treatments',
    description: 'Sync treatment codes from Dentally',
    is_sync: 1, // Enabled by default
    isAvailable: true,
  },
  {
    alias: 'practitioners',
    label: 'Practitioners',
    description: 'Sync dentists, hygienists, and therapists from Dentally',
    is_sync: 1, // Enabled by default
    isAvailable: true,
  },
  {
    alias: 'patients',
    label: 'Patients',
    description: 'Sync patient records from Dentally',
    is_sync: 1, // Enabled by default
    isAvailable: true, // Implemented
  },
  // Priority 3: Large datasets (slower sync - process last)
  {
    alias: 'treatment_plans',
    label: 'Treatment Plans',
    description: 'Sync treatment plans from Dentally',
    is_sync: 1, // Enabled by default
    isAvailable: true, // Implemented
  },
  {
    alias: 'treatment_plan_items',
    label: 'Treatment Plan Items',
    description: 'Sync treatment plan items from Dentally',
    is_sync: 1, // Enabled by default
    isAvailable: true, // Implemented
  },
  {
    alias: 'treatment_appointments',
    label: 'Treatment Appointments',
    description: 'Sync treatment appointments from Dentally',
    is_sync: 1, // Enabled by default
    isAvailable: true, // Implemented
  },
  {
    alias: 'appointments',
    label: 'Appointments',
    description: 'Sync appointment records from Dentally',
    is_sync: 1, // Enabled by default
    isAvailable: true, // Implemented
  },
  {
    alias: 'invoices',
    label: 'Invoices',
    description: 'Sync invoices and billing data from Dentally',
    is_sync: 1, // Enabled by default (includes invoice line items)
    isAvailable: true, // Implemented
  },
  {
    alias: 'nhs_claims',
    label: 'NHS Claims',
    description: 'Sync NHS claim records from Dentally',
    is_sync: 1, // Enabled by default
    isAvailable: true, // Implemented
  },
  {
    alias: 'payments',
    label: 'Payments',
    description: 'Sync payment transactions from Dentally',
    is_sync: 1, // Enabled by default
    isAvailable: true,
  },
  {
    alias: 'sundries',
    label: 'Sundries',
    description: 'Sync sundries transactions from Dentally',
    is_sync: 1, // Enabled by default
    isAvailable: true, // Implemented
  },
  {
    alias: 'accounts',
    label: 'Accounts',
    description: 'Sync billing accounts (account holders) from Dentally',
    is_sync: 1,
    isAvailable: true,
  },
  {
    alias: 'users',
    label: 'Users',
    description: 'Sync staff and user accounts from Dentally',
    is_sync: 0, // Disabled by default (coming soon)
    isAvailable: false, // Not yet implemented
  },
];

/**
 * Get default data_sync_json for a new Dentally integration
 * Only includes available entities
 */
export function getDefaultDentallySyncJson(): DentallySyncEntity[] {
  return DENTALLY_SYNC_ENTITIES.map(entity => ({
    alias: entity.alias,
    label: entity.label,
    description: entity.description,
    is_sync: entity.isAvailable ? entity.is_sync : 0, // Only enable if available
    last_synced_at: null, // Initialize as null for new integrations
  }));
}

/**
 * Get only enabled sync entities
 */
export function getEnabledDentallySyncEntities(dataSyncJson: DentallySyncEntity[]): string[] {
  return dataSyncJson
    .filter(entity => entity.is_sync === 1)
    .map(entity => entity.label);
}

/**
 * Check if a specific entity is enabled for sync
 * Simple alias matching: finds entity by alias and checks if is_sync === 1
 */
export function isEntityEnabled(dataSyncJson: DentallySyncEntity[], entityAlias: string): boolean {
  const normalizedAlias = entityAlias.toLowerCase();

  console.log(`[dentallyConfig] ================================`);
  console.log(`[dentallyConfig] Checking if alias "${entityAlias}" is enabled`);
  console.log(`[dentallyConfig] Available entities in data_sync_json:`);
  dataSyncJson.forEach(e => {
    console.log(`[dentallyConfig]   - alias: "${e.alias || 'MISSING'}", label: "${e.label}", is_sync: ${e.is_sync}`);
  });

  // Find entity by exact alias match
  const entity = dataSyncJson.find(e => e.alias && e.alias.toLowerCase() === normalizedAlias);

  if (entity) {
    console.log(`[dentallyConfig]   ✓ FOUND: alias="${entity.alias}", is_sync=${entity.is_sync}`);
    const result = entity.is_sync === 1;
    console.log(`[dentallyConfig] RESULT: ${result ? '✓ ENABLED (is_sync === 1)' : '✗ DISABLED (is_sync !== 1)'}`);
    console.log(`[dentallyConfig] ================================`);
    return result;
  } else {
    console.log(`[dentallyConfig]   ✗ NOT FOUND: No entity with alias="${entityAlias}"`);
    console.log(`[dentallyConfig] RESULT: ✗ DISABLED (entity not found)`);
    console.log(`[dentallyConfig] ================================`);
    return false;
  }
}

/**
 * Merge existing data_sync_json with new entities (for upgrades)
 * Preserves user's existing settings and adds new entities
 */
export function mergeDataSyncJson(existingJson: DentallySyncEntity[]): DentallySyncEntity[] {
  const defaultEntities = getDefaultDentallySyncJson();
  const existingMap = new Map(existingJson.map(e => [e.label, e]));

  return defaultEntities.map(defaultEntity => {
    const existing = existingMap.get(defaultEntity.label);
    return existing || defaultEntity; // Use existing settings if available, otherwise use default
  });
}

/**
 * Migrate old data_sync_json records to include alias field
 * Maps old label-based records to new alias-based records
 */
export function migrateDataSyncJson(oldJson: any[]): DentallySyncEntity[] {
  console.log('[dentallyConfig] Migrating data_sync_json to include alias field...');

  // Label to alias mapping for backwards compatibility
  const labelToAliasMap: { [key: string]: string } = {
    'providers': 'practitioners',
    'provider sync': 'practitioners',
    'practitioner sync': 'practitioners',
    'practitioners': 'practitioners',
    'treatment category record': 'treatment_category',
    'treatment categories': 'treatment_category',
    'categories': 'treatment_category',
    'treatment records': 'treatments',
    'treatment sync': 'treatments',
    'treatments': 'treatments',
    'locations': 'locations',
    'sites': 'locations',
    'location sync': 'locations',
    'practice sites': 'locations',
    'appointments': 'appointments',
    'appointment sync': 'appointments',
    'patients': 'patients',
    'patient sync': 'patients',
    'payment plans': 'payment_plans',
    'payment_plans': 'payment_plans',
    'treatment plans': 'treatment_plans',
    'treatment_plans': 'treatment_plans',
    'treatment plan items': 'treatment_plan_items',
    'treatment_plan_items': 'treatment_plan_items',
    'treatment appointments': 'treatment_appointments',
    'treatment_appointments': 'treatment_appointments',
    'invoices': 'invoices',
    'payments': 'payments',
    'accounts': 'accounts',
    'users': 'users',
  };

  const migratedJson = oldJson.map(entity => {
    // If alias already exists, return as-is
    if (entity.alias) {
      console.log(`[dentallyConfig]   ✓ Already has alias: "${entity.alias}"`);
      return entity;
    }

    // Try to map label to alias
    const labelLower = entity.label.toLowerCase();
    let foundAlias: string | null = null;

    for (const [labelPattern, alias] of Object.entries(labelToAliasMap)) {
      if (labelLower.includes(labelPattern)) {
        foundAlias = alias;
        break;
      }
    }

    if (foundAlias) {
      console.log(`[dentallyConfig]   ✓ Mapped "${entity.label}" → alias="${foundAlias}"`);
      return {
        ...entity,
        alias: foundAlias,
      };
    } else {
      console.warn(`[dentallyConfig]   ⚠ Could not map label "${entity.label}" to alias, skipping...`);
      return entity;
    }
  });

  // Filter out any entities without aliases
  const validEntities = migratedJson.filter(e => e.alias);

  console.log(`[dentallyConfig] Migration complete: ${validEntities.length}/${oldJson.length} entities have aliases`);

  return validEntities as DentallySyncEntity[];
}
