# Feature Flag System Documentation

The feature flag system provides a type-safe way to control various aspects of the note processing pipeline. It allows enabling/disabling specific features at runtime while maintaining type safety and configuration persistence.

## Available Feature Flags

| Flag Name | Description | Default Value |
|-----------|-------------|---------------|
| `rawExport` | Export and save raw notes to JSON files | Enabled |
| `enrichment` | Process notes through the enrichment pipeline (summaries, tags, embeddings) | Enabled |
| `clustering` | Perform note clustering based on embeddings | Enabled |
| `tagAggregation` | Aggregate and analyze tags across notes | Enabled |
| `checkpointing` | Enable progress tracking and resume capabilities | Enabled |
| `parallelProcessing` | Enable parallel processing of notes where possible | Enabled |
| `detailedLogging` | Enable detailed logging of pipeline operations | Enabled |

## Usage

### Initialization

```typescript
import { FeatureFlagManager } from '../services/featureFlagManager';
import { Logger } from '../utils/logger';

// Initialize the manager
const logger = new Logger();
const flagManager = FeatureFlagManager.getInstance('./config/flags.json', logger);
await flagManager.initialize();
```

### Checking Feature Status

```typescript
import { FeatureFlagName } from '../config/featureFlags';

// Check if a feature is enabled
if (flagManager.isEnabled(FeatureFlagName.Clustering)) {
    // Perform clustering
}
```

### Modifying Features

```typescript
// Enable a single feature
await flagManager.enableFlag(FeatureFlagName.ParallelProcessing);

// Disable a single feature
await flagManager.disableFlag(FeatureFlagName.DetailedLogging);

// Update multiple features at once
await flagManager.updateFlags({
    [FeatureFlagName.Clustering]: false,
    [FeatureFlagName.TagAggregation]: false
});

// Reset all features to defaults
await flagManager.resetToDefaults();
```

### Getting Feature Information

```typescript
// Get all feature flags
const allFlags = flagManager.getAllFlags();

// Get a specific feature's configuration
const clusteringFlag = flagManager.getFlag(FeatureFlagName.Clustering);
console.log(clusteringFlag.description); // Prints the feature description
```

## Configuration File

The feature flags are persisted in a JSON configuration file with the following structure:

```json
{
    "rawExport": {
        "enabled": true,
        "description": "Export and save raw notes to JSON files",
        "defaultValue": true
    },
    "enrichment": {
        "enabled": true,
        "description": "Process notes through the enrichment pipeline",
        "defaultValue": true
    },
    // ... other flags
}
```

## Type Safety

The feature flag system is built with TypeScript and provides type safety through:

1. Enum-based flag names (`FeatureFlagName`)
2. Type guards for runtime validation
3. Strongly typed configuration interfaces
4. Compile-time checks for flag existence and types

## Best Practices

1. **Configuration Changes**: Always use the provided methods to modify flags rather than editing the JSON file directly.
2. **Error Handling**: The system will fall back to default values if the configuration file is invalid or missing.
3. **Runtime Updates**: Changes to flags are immediately persisted to the configuration file.
4. **Type Safety**: Use the `FeatureFlagName` enum instead of string literals when referencing flags.
5. **Validation**: Use the provided type guards when working with external data or configuration files.

## Extending the System

To add new feature flags:

1. Add the flag name to the `FeatureFlagName` enum in `featureFlags.ts`
2. Add the default configuration to `DEFAULT_FEATURE_FLAGS`
3. Update the documentation to reflect the new flag
4. Use the flag in your code with proper type checking

Example:

```typescript
// In featureFlags.ts
export enum FeatureFlagName {
    // ... existing flags ...
    NewFeature = 'newFeature'
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlagsConfig = {
    // ... existing flags ...
    [FeatureFlagName.NewFeature]: {
        enabled: true,
        description: 'Description of the new feature',
        defaultValue: true
    }
};
``` 