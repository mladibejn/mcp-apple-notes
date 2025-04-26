import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileExists, loadJsonFile, saveJsonFile } from '../../utils/file';

const TEST_DIR = join(process.cwd(), 'test-data');
const TEST_FILE = join(TEST_DIR, 'test.json');
const TEST_DATA = {
    id: 1,
    name: 'test',
    nested: {
        value: true
    }
};

describe('File Utilities', () => {
    beforeAll(async () => {
        await mkdir(TEST_DIR, { recursive: true });
    });

    afterAll(async () => {
        await rm(TEST_DIR, { recursive: true, force: true });
    });

    describe('fileExists', () => {
        test('should return true for existing file', async () => {
            await Bun.write(TEST_FILE, JSON.stringify(TEST_DATA));
            expect(await fileExists(TEST_FILE)).toBe(true);
        });

        test('should return false for non-existent file', async () => {
            expect(await fileExists(join(TEST_DIR, 'nonexistent.json'))).toBe(false);
        });

        test('should handle permission errors gracefully', async () => {
            // Create a file with read-only permissions
            const restrictedFile = join(TEST_DIR, 'restricted.json');
            await Bun.write(restrictedFile, JSON.stringify(TEST_DATA));
            await Bun.write(restrictedFile, { mode: 0o444 }); // read-only
            expect(await fileExists(restrictedFile)).toBe(true);
        });
    });

    describe('loadJsonFile', () => {
        test('should load and parse JSON file correctly', async () => {
            await Bun.write(TEST_FILE, JSON.stringify(TEST_DATA));
            const data = await loadJsonFile(TEST_FILE);
            expect(data).toEqual(TEST_DATA);
        });

        test('should return null for non-existent file', async () => {
            const data = await loadJsonFile(join(TEST_DIR, 'nonexistent.json'));
            expect(data).toBeNull();
        });

        test('should handle invalid JSON gracefully', async () => {
            await Bun.write(TEST_FILE, 'invalid json');
            const data = await loadJsonFile(TEST_FILE);
            expect(data).toBeNull();
        });
    });

    describe('saveJsonFile', () => {
        test('should save JSON file correctly', async () => {
            await saveJsonFile(TEST_DATA, TEST_FILE);
            const content = await Bun.file(TEST_FILE).text();
            expect(JSON.parse(content)).toEqual(TEST_DATA);
        });

        test('should create parent directories if they don\'t exist', async () => {
            const nestedFile = join(TEST_DIR, 'nested', 'deep', 'test.json');
            await saveJsonFile(TEST_DATA, nestedFile);
            expect(await fileExists(nestedFile)).toBe(true);
        });

        test('should handle pretty printing', async () => {
            await saveJsonFile(TEST_DATA, TEST_FILE, true);
            const content = await Bun.file(TEST_FILE).text();
            expect(content).toContain('\n'); // Should be formatted
            expect(JSON.parse(content)).toEqual(TEST_DATA);
        });

        test('should handle write errors gracefully', async () => {
            // Create a read-only directory
            const readOnlyDir = join(TEST_DIR, 'readonly');
            await mkdir(readOnlyDir, { mode: 0o444 });
            const result = await saveJsonFile(TEST_DATA, join(readOnlyDir, 'test.json'));
            expect(result).toBe(false);
        });
    });
}); 