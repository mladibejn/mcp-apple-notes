import path from 'node:path';

// Base directory for all data
export const BASE_DIR = path.join(process.cwd(), 'data');

// Directory structure constants
export const DIRECTORIES = {
    RAW: path.join(BASE_DIR, 'raw'),
    ENRICHED: path.join(BASE_DIR, 'enriched'),
    CLUSTERS: path.join(BASE_DIR, 'clusters'),
    FINAL: path.join(BASE_DIR, 'final'),
} as const;

// File operation constants
export const FILE_CONFIG = {
    ENCODING: 'utf-8',
    JSON_INDENT: 2,
    DEFAULT_FILE_EXTENSION: '.json',
} as const;

// Checkpoint file constants
export const CHECKPOINT_CONFIG = {
    FILENAME: 'checkpoint.json',
    DIRECTORY: BASE_DIR,
    get FULL_PATH() {
        return path.join(this.DIRECTORY, this.FILENAME);
    },
} as const;

// Export all configuration as a single object
export const config = {
    BASE_DIR,
    DIRECTORIES,
    FILE_CONFIG,
    CHECKPOINT_CONFIG,
} as const; 