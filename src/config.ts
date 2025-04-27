import os from 'node:os';
import path from 'node:path';

// todo later
// Environment variable validation schema
// const EnvSchema = z.object({
//   OPENAI_API_KEY: z.string().min(1, 'OpenAI API key is required'),
//   OPENAI_SUMMARY_MODEL: z.string().optional().nullable().default('gpt-3.5-turbo'),
//   OPENAI_EMBEDDING_MODEL: z.string().optional().nullable().default('text-embedding-ada-002'),
//   DEBUG: z
//     .string()
//     .transform((val) => val === 'true')
//     .default('false'),
//   LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional().nullable().default('info'),
//   BATCH_SIZE: z.string().optional().nullable().transform(Number).default('5'),
//   PARALLEL_LIMIT: z.string().optional().nullable().transform(Number).default('3'),
// });

const env = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_SUMMARY_MODEL: 'gpt-3.5-turbo',
  OPENAI_EMBEDDING_MODEL: 'text-embedding-ada-002',
  DEBUG: 'false',
  LOG_LEVEL: 'info',
  BATCH_SIZE: '5',
  PARALLEL_LIMIT: '3',
}

// Base directory for all data
const BASE_DIR = path.join(os.homedir(), '.mcp-apple-notes');

// Directory structure
export const DIRECTORIES = {
  BASE: BASE_DIR,
  DATA: path.join(BASE_DIR, 'data'),
  RAW: path.join(BASE_DIR, 'data', 'raw'),
  ENRICHED: path.join(BASE_DIR, 'data', 'enriched'),
  CLUSTERS: path.join(BASE_DIR, 'data', 'clusters'),
  FINAL: path.join(BASE_DIR, 'data', 'final'),
  CHECKPOINTS: path.join(BASE_DIR, 'data', 'checkpoints'),
} as const;

// Checkpoint configuration
export const CHECKPOINT_CONFIG = {
  SAVE_INTERVAL: 5 * 60 * 1000, // 5 minutes
  FILE: path.join(DIRECTORIES.CHECKPOINTS, 'checkpoint.json'),
} as const;

// OpenAI configuration
export const OPENAI_CONFIG = {
  API_KEY: env.OPENAI_API_KEY,
  SUMMARY_MODEL: env.OPENAI_SUMMARY_MODEL,
  EMBEDDING_MODEL: env.OPENAI_EMBEDDING_MODEL,
  RATE_LIMITS: {
    COMPLETIONS: {
      REQUESTS_PER_MINUTE: 60,
      TOKENS_PER_MINUTE: 90000,
    },
    EMBEDDINGS: {
      REQUESTS_PER_MINUTE: 1000,
      TOKENS_PER_MINUTE: 150000,
    },
  },
  RETRY_CONFIG: {
    MAX_RETRIES: 3,
    INITIAL_RETRY_DELAY: 1000,
    MAX_RETRY_DELAY: 8000,
    BACKOFF_FACTOR: 2,
  },
} as const;

// Processing configuration
export const PROCESSING_CONFIG = {
  BATCH_SIZE: env.BATCH_SIZE,
  PARALLEL_LIMIT: env.PARALLEL_LIMIT,
} as const;

// Logging configuration
export const LOGGING_CONFIG = {
  LEVEL: env.LOG_LEVEL,
  DEBUG: env.DEBUG,
} as const;

// File configuration
export const FILE_CONFIG = {
  JSON_INDENT: 2,
  DEFAULT_FILE_EXTENSION: '.json',
  MAX_FILENAME_LENGTH: 255, // Maximum filename length for most filesystems
  ALLOWED_EXTENSIONS: ['.json', '.txt', '.md'] as const,
  ENCODING: 'utf-8' as const,
  TEMP_FILE_PREFIX: 'temp_',
  BACKUP_EXTENSION: '.bak',
  // Size limits in bytes
  SIZE_LIMITS: {
    MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB
    WARNING_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  },
} as const;

export const config = {
  DIRECTORIES,
  CHECKPOINT_CONFIG,
  OPENAI_CONFIG,
  PROCESSING_CONFIG,
  LOGGING_CONFIG,
  FILE_CONFIG,
} as const;
