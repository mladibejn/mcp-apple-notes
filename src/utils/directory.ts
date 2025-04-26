import { mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { DIRECTORIES } from '../config';

/**
 * Check if a directory exists
 * @param dirPath - Path to the directory to check
 * @returns Promise<boolean> - True if directory exists, false otherwise
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
    try {
        await access(dirPath, constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Create a directory if it doesn't exist
 * @param dirPath - Path to the directory to create
 * @param recursive - Whether to create parent directories if they don't exist
 * @throws Error if directory creation fails
 */
export async function ensureDirectory(dirPath: string, recursive = true): Promise<void> {
    try {
        const exists = await directoryExists(dirPath);
        if (!exists) {
            await mkdir(dirPath, { recursive });
            console.log(`Created directory: ${dirPath}`);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to create directory ${dirPath}: ${errorMessage}`);
    }
}

/**
 * Ensure all required directories exist
 * Creates any missing directories in the application's directory structure
 * @throws Error if any directory creation fails
 */
export async function ensureDirectoryStructure(): Promise<void> {
    try {
        // Create each directory in the DIRECTORIES config
        const directories = Object.values(DIRECTORIES);

        for (const dir of directories) {
            await ensureDirectory(dir);
        }

        console.log('Directory structure verified and created if needed');
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to create directory structure: ${errorMessage}`);
    }
}

/**
 * Initialize the application's directory structure
 * This is the main function that should be called to set up directories
 */
export async function initializeDirectories(): Promise<void> {
    try {
        await ensureDirectoryStructure();
        console.log('Directory initialization completed successfully');
    } catch (error) {
        console.error('Directory initialization failed:', error);
        throw error; // Re-throw to let caller handle the error
    }
} 