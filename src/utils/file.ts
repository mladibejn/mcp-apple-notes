import { readFile, writeFile } from 'node:fs/promises';
import { FILE_CONFIG } from '../config';

/**
 * Load and parse a JSON file
 * @param filePath Path to the JSON file
 * @returns Parsed JSON data
 */
export async function loadJsonFile<T>(filePath: string): Promise<T> {
  try {
    const content = await readFile(filePath, { encoding: FILE_CONFIG.ENCODING });
    return JSON.parse(content) as T;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load JSON file ${filePath}: ${error.message}`);
    }
    throw new Error(`Unknown error loading JSON file ${filePath}`);
  }
}

/**
 * Save data to a JSON file
 * @param filePath Path to save the file
 * @param data Data to save
 * @param pretty Whether to pretty print the JSON
 */
export async function saveJsonFile<T>(filePath: string, data: T, pretty = false): Promise<void> {
  try {
    const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    await writeFile(filePath, content, { encoding: FILE_CONFIG.ENCODING });
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to save JSON file ${filePath}: ${error.message}`);
    }
    throw new Error(`Unknown error saving JSON file ${filePath}`);
  }
}
