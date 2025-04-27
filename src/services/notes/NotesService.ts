import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as lancedb from '@lancedb/lancedb';
import type { Table } from '@lancedb/lancedb';
import { runJxa } from 'run-jxa';
import { config } from '../../config';
import { ProcessingStage } from '../../utils/checkpoint';
import type { CheckpointManager } from '../../utils/checkpoint';
import { ensureDirectory } from '../../utils/directory';
import { writeJSON } from '../../utils/json';
import { sanitizeHtmlToMarkdown } from '../../utils/sanitizeHtml';
import { log } from '../logging';
import type { Note, NoteData, NotesServiceConfig } from './types';

export class NotesService {
  private db: lancedb.Connection;
  private checkpointManager: CheckpointManager;
  private notesTableSchema: any;
  private notesTable: Table | null = null;

  constructor(config: NotesServiceConfig) {
    this.db = config.db;
    this.checkpointManager = config.checkpointManager;
    this.notesTableSchema = config.notesTableSchema;
  }

  private async ensureNotesTable() {
    if (!this.notesTable) {
      const { notesTable } = await this.createNotesTable();
      this.notesTable = notesTable;
    }
    return this.notesTable;
  }

  async createNotesTable(overrideName?: string) {
    const start = performance.now();
    const notesTable = await this.db.createEmptyTable(
      overrideName || 'notes',
      this.notesTableSchema,
      {
        mode: 'create',
        existOk: true,
      }
    );

    const indices = await notesTable.listIndices();
    if (!indices.find((index) => index.name === 'content_idx')) {
      await notesTable.createIndex('content', {
        config: lancedb.Index.fts(),
        replace: true,
      });
    }
    return { notesTable, time: performance.now() - start };
  }

  async getNotes(): Promise<string[]> {
    const getNotesChunk = async (offset: number, limit: number) => {
      return await runJxa(`
        const app = Application('Notes');
        app.includeStandardAdditions = true;
        const notes = Array.from(app.notes());
        const chunk = notes.slice(${offset}, ${offset + limit});
        const titles = chunk.map(note => note.name());
        return titles;
      `);
    };

    const CHUNK_SIZE = 500;
    let allNotes: string[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      log('get-notes.progress', {
        status: 'processing',
        message: `Fetching notes chunk starting at offset ${offset}`,
        currentOffset: offset,
      });

      const chunk = await getNotesChunk(offset, CHUNK_SIZE);
      allNotes = [...allNotes, ...(chunk as string[])];

      if ((chunk as string[]).length < CHUNK_SIZE) {
        hasMore = false;
      } else {
        offset += CHUNK_SIZE;
      }
    }

    log('get-notes.progress', {
      status: 'completed',
      message: 'Notes fetched successfully',
      notes: allNotes.length,
    });

    return allNotes;
  }

  async getNoteDetailsByTitle(title: string): Promise<Note> {
    const note = await runJxa(
      `const app = Application('Notes');
      const title = "${title}"
      
      try {
          const note = app.notes.whose({name: title})[0];
          if (!note) {
              return "{}";
          }
          
          const noteInfo = {
              title: note?.name() || "",
              content: note?.body() || "",
              creation_date: note?.creationDate()?.toLocaleString() || "",
              modification_date: note?.modificationDate()?.toLocaleString() || ""
          };
          
          return JSON.stringify(noteInfo);
      } catch (error) {
          return "{}";
      }`
    );

    return JSON.parse(note as string) as Note;
  }

  async createNote(title: string, content: string): Promise<boolean> {
    const escapedTitle = title.replace(/[\\'"]/g, '\\$&');
    const escapedContent = content
      .replace(/[\\'"]/g, '\\$&')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '');

    await runJxa(`
      const app = Application('Notes');
      const note = app.make({new: 'note', withProperties: {
        name: "${escapedTitle}",
        body: "${escapedContent}"
      }});
      
      return true
    `);

    return true;
  }

  async getAllRawNotes(): Promise<Note[]> {
    const rawDir = path.join(config.DIRECTORIES.RAW);
    const files = await fs.readdir(rawDir);
    const notes: Note[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const content = await fs.readFile(path.join(rawDir, file), 'utf-8');
        notes.push(JSON.parse(content));
      }
    }

    return notes;
  }

  async indexNotes(testMode = false) {
    const notesTable = await this.ensureNotesTable();
    const start = performance.now();
    let report = '';
    let allNotes: string[] = [];
    let allChunks: Note[] = [];
    let processedChunks = 0;

    await this.checkpointManager.initialize(allNotes.length);

    try {
      await ensureDirectory(config.DIRECTORIES.RAW);

      allNotes = (await this.getNotes()) || [];
      const CHUNK_SIZE = 100;
      const totalChunks = testMode ? 1 : Math.ceil(allNotes.length / CHUNK_SIZE);

      await this.checkpointManager.startStage(ProcessingStage.RAW_EXPORT);
      const nextNoteId = this.checkpointManager.getNextNoteForStage(ProcessingStage.RAW_EXPORT);
      const startIndex = nextNoteId ? Number.parseInt(nextNoteId) + 1 : 0;

      log('index-notes.progress', {
        status: 'starting',
        message: `Starting to process ${testMode ? CHUNK_SIZE : allNotes.length} notes in ${totalChunks} chunks from index ${startIndex}`,
        total: testMode ? CHUNK_SIZE : allNotes.length,
        chunkSize: CHUNK_SIZE,
        resuming: startIndex > 0,
      });

      const maxIterations = testMode ? 1 : Math.ceil(allNotes.length / CHUNK_SIZE);
      for (
        let i = startIndex;
        i < allNotes.length && processedChunks < maxIterations;
        i += CHUNK_SIZE
      ) {
        try {
          const currentChunk = allNotes.slice(i, i + CHUNK_SIZE);

          log('index-notes.progress', {
            status: 'processing',
            message: `Processing chunk ${processedChunks + 1} of ${totalChunks}`,
            currentChunk: processedChunks + 1,
            totalChunks,
            notesInChunk: currentChunk.length,
          });

          const notesDetails = await Promise.all(
            currentChunk.map((note) => {
              try {
                return this.getNoteDetailsByTitle(note);
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                report += `Error getting note details for ${note}: ${errorMessage}\n`;
                log('index-notes.error', {
                  status: 'error',
                  message: `Failed to get note details for ${note}`,
                  error: errorMessage,
                });
                return null;
              }
            })
          );

          const chunkResults: NoteData[] = notesDetails
            .filter((n): n is NonNullable<typeof n> => n !== null)
            .map((node) => {
              try {
                return {
                  ...node,
                  rawContent: node?.content || '',
                  content: sanitizeHtmlToMarkdown(node?.content || ''),
                };
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                report += `Error processing note ${node?.title}: ${errorMessage}\n`;
                log('index-notes.error', {
                  status: 'error',
                  message: `Failed to process note ${node?.title}`,
                  error: errorMessage,
                  node,
                });
                return {
                  ...node,
                  rawContent: node?.content || '',
                  content: node?.content || '',
                };
              }
            })
            .filter((note) => note !== null)
            .map(
              (note, index) =>
                ({
                  id: `${i + index}`,
                  title: note.title,
                  content: note.content,
                  rawContent: note.rawContent,
                  creation_date: note.creation_date,
                  modification_date: note.modification_date,
                }) as NoteData
            );

          await Promise.all(
            chunkResults.map(async (note) => {
              try {
                const filename = `note-${note.id}.json`;
                await writeJSON(note, path.join(config.DIRECTORIES.RAW, filename));
                await this.checkpointManager.updateNoteProgress(
                  ProcessingStage.RAW_EXPORT,
                  note.id,
                  true
                );
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                report += `Error saving note ${note.id} to file: ${errorMessage}\n`;
                log('index-notes.error', {
                  status: 'error',
                  message: `Failed to save note ${note.id} to file`,
                  error: errorMessage,
                });
              }
            })
          );

          await notesTable.add(chunkResults);
          allChunks = [...allChunks, ...chunkResults];
          processedChunks++;

          const progress = await this.checkpointManager.getStageProgress(
            ProcessingStage.RAW_EXPORT
          );
          log('index-notes.progress', {
            status: 'chunk-complete',
            message: `Completed chunk ${processedChunks} of ${totalChunks}`,
            currentChunk: processedChunks,
            totalChunks,
            notesProcessed: allChunks.length,
            notesSaved: allChunks.length,
            progress,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          report += `Error processing chunk ${processedChunks + 1}: ${errorMessage}\n`;
          log('index-notes.error', {
            status: 'error',
            message: `Failed to process chunk ${processedChunks + 1}`,
            error: errorMessage,
          });
          processedChunks++;
        }
      }

      await this.checkpointManager.completeStage(ProcessingStage.RAW_EXPORT);

      const finalProgress = await this.checkpointManager.getStageProgress(
        ProcessingStage.RAW_EXPORT
      );
      log('index-notes.progress', {
        status: 'completed',
        message: 'All chunks processed and saved successfully',
        totalProcessed: allChunks.length,
        time: performance.now() - start,
        progress: finalProgress,
      });

      return {
        chunks: allChunks.length,
        report,
        allNotes: allNotes.length,
        time: performance.now() - start,
        progress: finalProgress,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.checkpointManager.failStage(ProcessingStage.RAW_EXPORT, errorMessage);

      log('index-notes.error', {
        status: 'fatal',
        message: 'Fatal error during indexing',
        error: errorMessage,
      });
      throw new Error(`Failed to index notes: ${errorMessage}`);
    }
  }

  async searchNotes(query: string, limit = 20) {
    const notesTable = await this.ensureNotesTable();
    const [vectorResults, ftsSearchResults] = await Promise.all([
      (async () => {
        const results = await notesTable.search(query, 'vector').limit(limit).toArray();
        return results;
      })(),
      (async () => {
        const results = await notesTable.search(query, 'fts', 'content').limit(limit).toArray();
        return results;
      })(),
    ]);

    const k = 60;
    const scores = new Map<string, number>();

    const processResults = (results: NoteData[], startRank: number) => {
      results.forEach((result, idx) => {
        const key = `${result.title}::${result.content}`;
        const score = 1 / (k + startRank + idx);
        scores.set(key, (scores.get(key) || 0) + score);
      });
    };

    processResults(vectorResults, 0);
    processResults(ftsSearchResults, 0);

    const results = Array.from(scores.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([key]) => {
        const [title, content] = key.split('::');
        return { title, content };
      });

    return results;
  }

  async getNotesCount(): Promise<number> {
    const notesTable = await this.ensureNotesTable();
    return await notesTable.countRows();
  }
}
