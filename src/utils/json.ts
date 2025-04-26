import { readFile, writeFile } from 'node:fs/promises';
import { FILE_CONFIG } from '../config';

/**
 * Custom error class for JSON file operations
 */
export class JSONFileError extends Error {
    constructor(message: string, public readonly cause?: Error) {
        super(message);
        this.name = 'JSONFileError';
    }
}

/**
 * Read and parse a JSON file
 * @param filePath - Path to the JSON file
 * @returns Promise<T> - Parsed JSON data with type T
 * @throws JSONFileError if file reading or parsing fails
 */
export async function readJSON<T>(filePath: string): Promise<T> {
    try {
        const content = await readFile(filePath, {
            encoding: FILE_CONFIG.ENCODING,
        });

        return JSON.parse(content) as T;
    } catch (error) {
        if (error instanceof Error) {
            // Handle specific error types
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                throw new JSONFileError(`File not found: ${filePath}`);
            }
            if (error instanceof SyntaxError) {
                throw new JSONFileError(`Invalid JSON in file: ${filePath}`, error);
            }
            throw new JSONFileError(`Error reading JSON file ${filePath}: ${error.message}`, error);
        }
        throw new JSONFileError(`Unknown error reading JSON file ${filePath}`);
    }
}

/**
 * Write data to a JSON file
 * @param data - Data to write
 * @param filePath - Path to the JSON file
 * @param pretty - Whether to format the JSON with indentation (default: true)
 * @throws JSONFileError if file writing fails
 */
export async function writeJSON<T>(
    data: T,
    filePath: string,
    pretty = true
): Promise<void> {
    try {
        const jsonString = pretty
            ? JSON.stringify(data, null, FILE_CONFIG.JSON_INDENT)
            : JSON.stringify(data);

        await writeFile(filePath, jsonString, {
            encoding: FILE_CONFIG.ENCODING,
        });
    } catch (error) {
        if (error instanceof Error) {
            throw new JSONFileError(
                `Error writing JSON to file ${filePath}: ${error.message}`,
                error
            );
        }
        throw new JSONFileError(`Unknown error writing JSON to file ${filePath}`);
    }
}

/**
 * Update a JSON file by reading, modifying, and writing back
 * @param filePath - Path to the JSON file
 * @param updateFn - Function to update the data
 * @returns Promise<T> - Updated data
 * @throws JSONFileError if any operation fails
 */
export async function updateJSON<T>(
    filePath: string,
    updateFn: (data: T) => T | Promise<T>
): Promise<T> {
    try {
        // Read existing data
        const data = await readJSON<T>(filePath);

        // Apply update
        const updatedData = await Promise.resolve(updateFn(data));

        // Write back to file
        await writeJSON(updatedData, filePath);

        return updatedData;
    } catch (error) {
        if (error instanceof Error) {
            throw new JSONFileError(
                `Error updating JSON file ${filePath}: ${error.message}`,
                error
            );
        }
        throw new JSONFileError(`Unknown error updating JSON file ${filePath}`);
    }
}

/**
 * Safely write JSON to a file with atomic operation
 * Creates a temporary file and renames it to the target file to ensure atomic write
 * @param data - Data to write
 * @param filePath - Path to the JSON file
 * @throws JSONFileError if the operation fails
 */
export async function writeJSONSafe<T>(data: T, filePath: string): Promise<void> {
    const tempPath = `${filePath}.tmp`;
    try {
        // Write to temporary file first
        await writeJSON(data, tempPath, true);

        // Rename temp file to target file (atomic operation)
        await import('node:fs/promises').then(({ rename }) =>
            rename(tempPath, filePath)
        );
    } catch (error) {
        // Clean up temp file if it exists
        try {
            await import('node:fs/promises').then(({ unlink }) =>
                unlink(tempPath)
            );
        } catch {
            // Ignore cleanup errors
        }

        if (error instanceof Error) {
            throw new JSONFileError(
                `Error in safe JSON write to ${filePath}: ${error.message}`,
                error
            );
        }
        throw new JSONFileError(`Unknown error in safe JSON write to ${filePath}`);
    }
} 