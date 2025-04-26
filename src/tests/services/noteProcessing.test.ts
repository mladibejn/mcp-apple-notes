import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { processNote, extractMetadata, generateEmbeddings } from '../../services/noteProcessing';
import type { Note, ProcessedNote } from '../../types';

const TEST_DIR = join(process.cwd(), 'test-data');

const SAMPLE_NOTE: Note = {
    id: 'test-note-1',
    title: 'Test Note',
    content: `# Meeting Notes
- Discussed project timeline
- Action items:
  1. Review documentation
  2. Update tests
- Next meeting: Tomorrow

#important #meeting #review`,
    createdAt: new Date('2024-01-01'),
    modifiedAt: new Date('2024-01-02')
};

describe('Note Processing', () => {
    beforeAll(async () => {
        await mkdir(TEST_DIR, { recursive: true });
    });

    afterAll(async () => {
        await rm(TEST_DIR, { recursive: true, force: true });
    });

    describe('processNote', () => {
        test('should process note correctly', async () => {
            const processed = await processNote(SAMPLE_NOTE);
            expect(processed).toBeDefined();
            expect(processed.id).toBe(SAMPLE_NOTE.id);
            expect(processed.title).toBe(SAMPLE_NOTE.title);
            expect(processed.metadata).toBeDefined();
            expect(processed.embeddings).toBeDefined();
            expect(processed.tags).toContain('important');
            expect(processed.tags).toContain('meeting');
            expect(processed.tags).toContain('review');
        });

        test('should handle notes without tags', async () => {
            const noteWithoutTags = { ...SAMPLE_NOTE, content: SAMPLE_NOTE.content.replace(/#\w+/g, '') };
            const processed = await processNote(noteWithoutTags);
            expect(processed.tags).toEqual([]);
        });

        test('should handle empty notes', async () => {
            const emptyNote = { ...SAMPLE_NOTE, content: '' };
            const processed = await processNote(emptyNote);
            expect(processed).toBeDefined();
            expect(processed.content).toBe('');
            expect(processed.tags).toEqual([]);
        });

        test('should handle notes with special characters', async () => {
            const noteWithSpecialChars = {
                ...SAMPLE_NOTE,
                content: '# Special Characters: !@#$%^&*()_+ \n#tag1 #tag-2'
            };
            const processed = await processNote(noteWithSpecialChars);
            expect(processed.tags).toContain('tag1');
            expect(processed.tags).toContain('tag-2');
        });
    });

    describe('extractMetadata', () => {
        test('should extract metadata correctly', () => {
            const metadata = extractMetadata(SAMPLE_NOTE);
            expect(metadata).toBeDefined();
            expect(metadata.wordCount).toBeGreaterThan(0);
            expect(metadata.hasActionItems).toBe(true);
            expect(metadata.createdAt).toEqual(SAMPLE_NOTE.createdAt);
            expect(metadata.modifiedAt).toEqual(SAMPLE_NOTE.modifiedAt);
        });

        test('should handle empty content', () => {
            const emptyNote = { ...SAMPLE_NOTE, content: '' };
            const metadata = extractMetadata(emptyNote);
            expect(metadata.wordCount).toBe(0);
            expect(metadata.hasActionItems).toBe(false);
        });

        test('should detect lists and headings', () => {
            const noteWithStructure = {
                ...SAMPLE_NOTE,
                content: `# Heading 1
## Heading 2
- List item 1
- List item 2
1. Numbered item
2. Numbered item`
            };
            const metadata = extractMetadata(noteWithStructure);
            expect(metadata.headingCount).toBe(2);
            expect(metadata.listItemCount).toBe(4);
        });
    });

    describe('generateEmbeddings', () => {
        test('should generate embeddings for note content', async () => {
            const embeddings = await generateEmbeddings(SAMPLE_NOTE.content);
            expect(embeddings).toBeDefined();
            expect(embeddings.length).toBeGreaterThan(0);
            expect(typeof embeddings[0]).toBe('number');
        });

        test('should handle empty content', async () => {
            const embeddings = await generateEmbeddings('');
            expect(embeddings).toBeDefined();
            expect(embeddings.length).toBeGreaterThan(0); // Even empty content should have a valid embedding
        });

        test('should generate consistent embeddings for same content', async () => {
            const embeddings1 = await generateEmbeddings(SAMPLE_NOTE.content);
            const embeddings2 = await generateEmbeddings(SAMPLE_NOTE.content);
            expect(embeddings1).toEqual(embeddings2);
        });

        test('should handle long content', async () => {
            const longContent = 'a'.repeat(10000); // Very long content
            const embeddings = await generateEmbeddings(longContent);
            expect(embeddings).toBeDefined();
            expect(embeddings.length).toBeGreaterThan(0);
        });
    });
}); 