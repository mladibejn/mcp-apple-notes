import {
  DEFAULT_FEATURE_FLAGS,
  type FeatureFlag,
  type FeatureFlagName,
  type FeatureFlagsConfig,
  isFeatureFlagName,
  isValidFeatureFlagsConfig,
} from '../config/featureFlags';
import type { Logger } from '../types';
import { loadJsonFile, saveJsonFile } from '../utils/file';
import { log } from './logging';

/**
 * Manager class for handling feature flags
 * Implements singleton pattern for global access
 */
export class FeatureFlagManager {
  private static instance: FeatureFlagManager;
  private flags: FeatureFlagsConfig;
  private configPath: string;

  private constructor(configPath: string) {
    this.flags = { ...DEFAULT_FEATURE_FLAGS };
    this.configPath = configPath;
  }

  /**
   * Get the singleton instance of FeatureFlagManager
   */
  public static getInstance(configPath: string): FeatureFlagManager {
    if (!FeatureFlagManager.instance) {
      FeatureFlagManager.instance = new FeatureFlagManager(configPath);
    }
    return FeatureFlagManager.instance;
  }

  /**
   * Initialize feature flags from a configuration file
   */
  public async initialize(): Promise<void> {
    try {
      const loadedConfig = await loadJsonFile(this.configPath);

      if (isValidFeatureFlagsConfig(loadedConfig)) {
        this.flags = loadedConfig;
        log('featureFlagManager.success', {
          message: 'Feature flags loaded successfully from configuration',
        });
      } else {
        log('featureFlagManager.warn', {
          message: 'Invalid configuration format, using default feature flags',
        });
        this.flags = { ...DEFAULT_FEATURE_FLAGS };
        await this.saveConfiguration();
      }
    } catch (error) {
      log('featureFlagManager.error', {
        message: 'Failed to load feature flags configuration, using defaults',
      });
      this.flags = { ...DEFAULT_FEATURE_FLAGS };
      await this.saveConfiguration();
    }
  }

  /**
   * Save current feature flags configuration to file
   */
  private async saveConfiguration(): Promise<void> {
    try {
      await saveJsonFile(this.configPath, this.flags, true);
      log('featureFlagManager.info', {
        message: 'Feature flags configuration saved successfully',
      });
    } catch (error) {
      log('featureFlagManager.error', {
        message: 'Failed to save feature flags configuration',
      });
      throw error;
    }
  }

  /**
   * Check if a feature flag is enabled
   */
  public isEnabled(flagName: FeatureFlagName): boolean {
    return this.flags[flagName].enabled;
  }

  /**
   * Get the current state of all feature flags
   */
  public getAllFlags(): FeatureFlagsConfig {
    return { ...this.flags };
  }

  /**
   * Get a specific feature flag configuration
   */
  public getFlag(flagName: FeatureFlagName): FeatureFlag {
    return { ...this.flags[flagName] };
  }

  /**
   * Enable a feature flag
   */
  public async enableFlag(flagName: FeatureFlagName): Promise<void> {
    this.flags[flagName].enabled = true;
    await this.saveConfiguration();
    log('featureFlagManager.success', {
      message: `Feature flag '${flagName}' enabled`,
    });
  }

  /**
   * Disable a feature flag
   */
  public async disableFlag(flagName: FeatureFlagName): Promise<void> {
    this.flags[flagName].enabled = false;
    await this.saveConfiguration();
    log('featureFlagManager.success', {
      message: `Feature flag '${flagName}' disabled`,
    });
  }

  /**
   * Update multiple feature flags at once
   */
  public async updateFlags(updates: Partial<Record<FeatureFlagName, boolean>>): Promise<void> {
    for (const [name, enabled] of Object.entries(updates)) {
      if (isFeatureFlagName(name)) {
        this.flags[name].enabled = enabled;
      }
    }
    await this.saveConfiguration();
    log('featureFlagManager.success', {
      message: 'Feature flags updated successfully',
    });
  }

  /**
   * Reset all feature flags to their default values
   */
  public async resetToDefaults(): Promise<void> {
    this.flags = { ...DEFAULT_FEATURE_FLAGS };
    await this.saveConfiguration();
    log('featureFlagManager.success', {
      message: 'Feature flags reset to default values',
    });
  }
}
