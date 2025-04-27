import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
// Usage: npx tsx index.test.ts
import { describe, test } from 'node:test';
import { pipeline } from '@huggingface/transformers';
import * as lancedb from '@lancedb/lancedb';
import { NotesService, createNotesTableSchema } from './services/notes';
import { OnDeviceEmbeddingFunction } from './services/onDeviceEmbeddingFunction';
import { CheckpointManager } from './utils/checkpoint';

describe('Apple Notes Indexing', async () => {
  const db = await lancedb.connect(path.join(os.homedir(), '.mcp-apple-notes', 'data'));
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  const func = new OnDeviceEmbeddingFunction(extractor);
  const notesTableSchema = createNotesTableSchema(func);
  const checkpointManager = new CheckpointManager();

  // Initialize NotesService
  const notesService = new NotesService({
    db,
    checkpointManager,
    notesTableSchema,
  });

  test('should create notes table', async () => {
    const { notesTable } = await notesService.createNotesTable('test-notes');

    assert.ok(notesTable, 'Notes table should be created');
    const count = await notesTable.countRows();
    assert.ok(typeof count === 'number', 'Should be able to count rows');
  });

  test.skip('should index all notes correctly', async () => {
    const result = await notesService.indexNotes(true); // testMode = true

    assert.ok(result.chunks > 0, 'Should have indexed some notes');
    assert.ok(result.time > 0, 'Should have taken some time');
    assert.ok(result.allNotes > 0, 'Should have found some notes');
  });

  test('should perform vector search', async () => {
    const start = performance.now();
    const { notesTable } = await notesService.createNotesTable('test-notes');
    const end = performance.now();
    console.log(`Creating table took ${Math.round(end - start)}ms`);

    await notesTable.add([
      {
        id: '1',
        title: 'Test Note',
        content: 'This is a test note content',
        creation_date: new Date().toISOString(),
        modification_date: new Date().toISOString(),
      },
    ]);

    const addEnd = performance.now();
    console.log(`Adding notes took ${Math.round(addEnd - end)}ms`);

    const results = await notesService.searchNotes('test note');

    const searchEnd = performance.now();
    console.log(`Searching notes took ${Math.round(searchEnd - addEnd)}ms`);

    assert.ok(results.length > 0, 'Should return search results');
    assert.equal(results[0].title, 'Test Note', 'Should find the test note');
  });

  test('should perform vector search on real indexed data', async () => {
    const results = await notesService.searchNotes('15/12');

    assert.ok(results.length > 0, 'Should return search results');
    assert.equal(results[0].title, 'Test Note', 'Should find the test note');
  });
});
