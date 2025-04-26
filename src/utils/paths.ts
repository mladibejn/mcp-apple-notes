import { constants } from 'node:fs';
import { access, readdir, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { DIRECTORIES, FILE_CONFIG } from '../config';

/**
 * Custom error class for path operations
 */
export class PathError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'PathError';
  }
}

/**
 * Get the absolute path for a file in a specific directory
 * @param directory - Key of the directory from DIRECTORIES config
 * @param filename - Name of the file
 * @returns Absolute path to the file
 */
export function getFilePath(directory: keyof typeof DIRECTORIES, filename: string): string {
  return join(DIRECTORIES[directory], filename);
}

/**
 * Check if a file exists
 * @param filePath - Path to the file
 * @returns Promise<boolean> - True if file exists and is accessible
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * List files in a directory with optional pattern matching
 * @param directory - Key of the directory from DIRECTORIES config
 * @param pattern - Optional regex pattern to filter files
 * @returns Promise<string[]> - Array of matching file paths
 * @throws PathError if directory is not accessible
 */
export async function listFiles(
  directory: keyof typeof DIRECTORIES,
  pattern?: RegExp
): Promise<string[]> {
  try {
    const dirPath = DIRECTORIES[directory];
    const files = await readdir(dirPath);

    if (pattern) {
      return files.filter((file) => pattern.test(file)).map((file) => join(dirPath, file));
    }

    return files.map((file) => join(dirPath, file));
  } catch (error) {
    if (error instanceof Error) {
      throw new PathError(`Error listing files in directory ${directory}: ${error.message}`, error);
    }
    throw new PathError(`Unknown error listing files in directory ${directory}`);
  }
}

/**
 * Generate a timestamped filename
 * @param baseName - Base name for the file (without extension)
 * @param extension - File extension (default: from FILE_CONFIG)
 * @returns Filename with timestamp
 */
export function generateTimestampedFilename(
  baseName: string,
  extension = FILE_CONFIG.DEFAULT_FILE_EXTENSION
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  return `${baseName}_${timestamp}${ext}`;
}

/**
 * Sanitize a filename by removing invalid characters
 * @param filename - Original filename
 * @returns Sanitized filename
 */
export function sanitizeFilename(filename: string): string {
  // Remove invalid characters and replace spaces with underscores
  return filename
    .replace(/[<>:"\/\\|?*]/g, '') // Remove common invalid filename characters
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remove control characters using hex escapes
    .replace(/\s+/g, '_')
    .trim();
}

/**
 * Get a unique filename in a directory by appending a number if needed
 * @param directory - Key of the directory from DIRECTORIES config
 * @param filename - Desired filename
 * @returns Promise<string> - Unique filename
 */
export async function getUniqueFilename(
  directory: keyof typeof DIRECTORIES,
  filename: string
): Promise<string> {
  const dir = DIRECTORIES[directory];
  const ext = extname(filename);
  const base = basename(filename, ext);
  let counter = 0;
  let uniqueName = filename;

  while (await fileExists(join(dir, uniqueName))) {
    counter++;
    uniqueName = `${base}_${counter}${ext}`;
  }

  return uniqueName;
}

/**
 * Resolve a path relative to a directory from DIRECTORIES config
 * @param directory - Key of the directory from DIRECTORIES config
 * @param relativePath - Path relative to the directory
 * @returns Absolute path
 */
export function resolvePathInDirectory(
  directory: keyof typeof DIRECTORIES,
  relativePath: string
): string {
  return resolve(DIRECTORIES[directory], relativePath);
}

/**
 * Check if a path is within a specified directory
 * @param directory - Key of the directory from DIRECTORIES config
 * @param path - Path to check
 * @returns boolean - True if path is within the directory
 */
export function isPathInDirectory(directory: keyof typeof DIRECTORIES, path: string): boolean {
  const dirPath = resolve(DIRECTORIES[directory]);
  const resolvedPath = resolve(path);
  return resolvedPath.startsWith(dirPath);
}

/**
 * Ensure a directory exists, creating it if necessary
 * @param dirPath - Path to the directory
 * @returns Promise<void>
 * @throws PathError if directory cannot be created
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await access(dirPath, constants.F_OK);
  } catch {
    try {
      await mkdir(dirPath, { recursive: true });
    } catch (error) {
      if (error instanceof Error) {
        throw new PathError(`Failed to create directory ${dirPath}: ${error.message}`, error);
      }
      throw new PathError(`Unknown error creating directory ${dirPath}`);
    }
  }
}
