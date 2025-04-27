/**
 * Feature flag configuration for controlling pipeline stages and features
 */

/**
 * Enum defining all available feature flag names
 */
export enum FeatureFlagName {
  RawExport = 'rawExport',
  Enrichment = 'enrichment',
  Clustering = 'clustering',
  TagAggregation = 'tagAggregation',
  Checkpointing = 'checkpointing',
  ParallelProcessing = 'parallelProcessing',
  DetailedLogging = 'detailedLogging',
}

/**
 * Interface defining the structure of a feature flag
 */
export interface FeatureFlag {
  enabled: boolean;
  description: string;
  defaultValue: boolean;
}

/**
 * Type defining the complete feature flags configuration
 */
export type FeatureFlagsConfig = {
  [key in FeatureFlagName]: FeatureFlag;
};

/**
 * Default configuration for all feature flags
 */
export const DEFAULT_FEATURE_FLAGS: FeatureFlagsConfig = {
  [FeatureFlagName.RawExport]: {
    enabled: true,
    description: 'Export and save raw notes to JSON files',
    defaultValue: true,
  },
  [FeatureFlagName.Enrichment]: {
    enabled: true,
    description: 'Process notes through the enrichment pipeline (summaries, tags, embeddings)',
    defaultValue: true,
  },
  [FeatureFlagName.Clustering]: {
    enabled: true,
    description: 'Perform note clustering based on embeddings',
    defaultValue: true,
  },
  [FeatureFlagName.TagAggregation]: {
    enabled: true,
    description: 'Aggregate and analyze tags across notes',
    defaultValue: true,
  },
  [FeatureFlagName.Checkpointing]: {
    enabled: true,
    description: 'Enable progress tracking and resume capabilities',
    defaultValue: true,
  },
  [FeatureFlagName.ParallelProcessing]: {
    enabled: true,
    description: 'Enable parallel processing of notes where possible',
    defaultValue: true,
  },
  [FeatureFlagName.DetailedLogging]: {
    enabled: true,
    description: 'Enable detailed logging of pipeline operations',
    defaultValue: true,
  },
};

/**
 * Type guard to check if a string is a valid feature flag name
 */
export function isFeatureFlagName(name: string): name is FeatureFlagName {
  return Object.values(FeatureFlagName).includes(name as FeatureFlagName);
}

/**
 * Type guard to check if an object is a valid feature flag configuration
 */
export function isValidFeatureFlag(flag: unknown): flag is FeatureFlag {
  if (typeof flag !== 'object' || flag === null) return false;

  const f = flag as Record<string, unknown>;
  return (
    typeof f.enabled === 'boolean' &&
    typeof f.description === 'string' &&
    typeof f.defaultValue === 'boolean'
  );
}

/**
 * Validates a complete feature flags configuration
 */
export function isValidFeatureFlagsConfig(config: unknown): config is FeatureFlagsConfig {
  if (typeof config !== 'object' || config === null) return false;

  const c = config as Record<string, unknown>;
  return Object.values(FeatureFlagName).every((name) => isValidFeatureFlag(c[name]));
}
