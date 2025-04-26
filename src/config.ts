import path from 'node:path';
import os from 'node:os';

// Database directory in home
export const DB_DIR = path.join(os.homedir(), '.mcp-apple-notes', 'data');

// Base directory for all other data (in project directory)
export const BASE_DIR = './data';

// Directory structure constants
export const DIRECTORIES = {
  RAW: path.join(BASE_DIR, 'raw'),
  ENRICHED: path.join(BASE_DIR, 'enriched'),
  CLUSTERS: path.join(BASE_DIR, 'clusters'),
  FINAL: path.join(BASE_DIR, 'final'),
} as const;

// File configuration constants
export const FILE_CONFIG = {
  DEFAULT_FILE_EXTENSION: '.json',
  ENCODING: 'utf-8',
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
  DB_DIR,
  BASE_DIR,
  DIRECTORIES,
  FILE_CONFIG,
  CHECKPOINT_CONFIG,
} as const;
