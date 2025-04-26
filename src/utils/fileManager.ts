import { DIRECTORIES, FILE_CONFIG } from '../config';
import { ensureDirectory, ensureDirectoryStructure } from './directory';
import { readJSON, writeJSON, writeJSONSafe, updateJSON, JSONFileError } from './json';
import {
    getFilePath,
    fileExists,
    listFiles,
    generateTimestampedFilename,
    sanitizeFilename,
    getUniqueFilename,
    resolvePathInDirectory,
    isPathInDirectory,
    PathError
} from './paths';

/**
 * Initialize the file manager and ensure directory structure exists
 */
export async function initialize(): Promise<void> {
    await ensureDirectoryStructure();
}

/**
 * Read JSON data from a file in a specific directory
 * @param directory - Target directory from DIRECTORIES config
 * @param filename - Name of the file to read
 * @returns Parsed JSON data
 */
export async function readJSONFromDirectory<T>(
    directory: keyof typeof DIRECTORIES,
    filename: string
): Promise<T> {
    const filePath = getFilePath(directory, filename);
    return readJSON<T>(filePath);
}

/**
 * Write JSON data to a file in a specific directory
 * @param data - Data to write
 * @param directory - Target directory from DIRECTORIES config
 * @param filename - Name of the file to write
 * @param safe - Whether to use atomic write operation
 */
export async function writeJSONToDirectory<T>(
    data: T,
    directory: keyof typeof DIRECTORIES,
    filename: string,
    safe = false
): Promise<void> {
    const filePath = getFilePath(directory, filename);
    if (safe) {
        await writeJSONSafe(data, filePath);
    } else {
        await writeJSON(data, filePath);
    }
}

/**
 * Update JSON data in a file using a transform function
 * @param directory - Target directory from DIRECTORIES config
 * @param filename - Name of the file to update
 * @param updateFn - Function to transform the data
 * @returns Updated data
 */
export async function updateJSONInDirectory<T>(
    directory: keyof typeof DIRECTORIES,
    filename: string,
    updateFn: (data: T) => T | Promise<T>
): Promise<T> {
    const filePath = getFilePath(directory, filename);
    return updateJSON<T>(filePath, updateFn);
}

/**
 * Generate a unique timestamped filename in a directory
 * @param directory - Target directory from DIRECTORIES config
 * @param baseName - Base name for the file
 * @param extension - File extension (optional)
 * @returns Unique filename
 */
export async function generateUniqueFilename(
    directory: keyof typeof DIRECTORIES,
    baseName: string,
    extension = FILE_CONFIG.DEFAULT_FILE_EXTENSION
): Promise<string> {
    const timestampedName = generateTimestampedFilename(
        sanitizeFilename(baseName),
        extension
    );
    return getUniqueFilename(directory, timestampedName);
}

/**
 * List all files in a directory matching a pattern
 * @param directory - Target directory from DIRECTORIES config
 * @param pattern - Optional regex pattern to filter files
 * @returns Array of file paths
 */
export async function listFilesInDirectory(
    directory: keyof typeof DIRECTORIES,
    pattern?: RegExp
): Promise<string[]> {
    return listFiles(directory, pattern);
}

/**
 * Check if a file exists in a specific directory
 * @param directory - Target directory from DIRECTORIES config
 * @param filename - Name of the file to check
 * @returns True if file exists
 */
export async function checkFileExists(
    directory: keyof typeof DIRECTORIES,
    filename: string
): Promise<boolean> {
    const filePath = getFilePath(directory, filename);
    return fileExists(filePath);
}

/**
 * Ensure a specific directory exists
 * @param directory - Target directory from DIRECTORIES config
 */
export async function ensureDirectoryExists(
    directory: keyof typeof DIRECTORIES
): Promise<void> {
    await ensureDirectory(DIRECTORIES[directory]);
}

/**
 * Validate if a path is within a specific directory
 * @param directory - Target directory from DIRECTORIES config
 * @param path - Path to validate
 * @returns True if path is within the directory
 */
export function validatePathInDirectory(
    directory: keyof typeof DIRECTORIES,
    path: string
): boolean {
    return isPathInDirectory(directory, path);
}

// Export error types for error handling
export { JSONFileError, PathError }; 