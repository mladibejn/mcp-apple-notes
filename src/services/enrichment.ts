import path from 'node:path';
import pLimit from 'p-limit';
import { config } from '../config';
import type { EnrichedNote, Note } from '../types';
import type { CheckpointManager } from '../utils/checkpoint';
import { ProcessingStage } from '../utils/checkpoint';
import { ensureDirectory } from '../utils/directory';
import { writeJSON } from '../utils/json';
import { log } from './logging';
import { OpenAIService } from './openai';

export interface EnrichmentResult {
  processedCount: number;
  totalTime: number;
  errors: Array<{
    noteId: string;
    error: string;
  }>;
}

export class EnrichmentService {
  private openai: OpenAIService;
  private checkpointManager: CheckpointManager;
  private limit: ReturnType<typeof pLimit>;

  constructor(checkpointManager: CheckpointManager) {
    this.openai = new OpenAIService();
    this.checkpointManager = checkpointManager;
    this.limit = pLimit(config.PROCESSING_CONFIG.PARALLEL_LIMIT);
  }

  /**
   * Process a single note through the enrichment pipeline
   */
  private async enrichNote(note: Note): Promise<EnrichedNote> {
    try {
      // Get summary and tags in a single API call
      const { summary, tags } = await this.openai.generateSummaryAndTags(note.content);

      // Validate summary and tags
      if (!summary || summary.trim().length === 0) {
        throw new Error('Generated summary is empty');
      }
      if (!tags || tags.length === 0) {
        throw new Error('No tags were generated');
      }

      // Generate embedding for the summary (more cost-effective than full content)
      const [embedding] = await this.openai.generateBatchEmbeddings([summary]);

      // Validate embedding
      if (!embedding || embedding.length === 0) {
        throw new Error('Generated embedding is empty');
      }

      const enrichedNote: EnrichedNote = {
        ...note,
        summary,
        tags,
        embedding,
        enrichedAt: new Date().toISOString(),
      };

      // Validate the enriched note structure
      this.validateEnrichedNote(enrichedNote);

      return enrichedNote;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log('enrichment.error', {
        message: `Error enriching note ${note.id}:`,
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Validate the structure of an enriched note
   */
  private validateEnrichedNote(note: EnrichedNote): void {
    if (!note.id) throw new Error('Note ID is missing');
    if (!note.content) throw new Error('Note content is missing');
    if (!note.summary) throw new Error('Note summary is missing');
    if (!Array.isArray(note.tags)) throw new Error('Note tags must be an array');
    if (!Array.isArray(note.embedding)) throw new Error('Note embedding must be an array');
    if (!note.enrichedAt) throw new Error('Note enrichedAt timestamp is missing');
  }

  /**
   * Process notes through the enrichment pipeline with batching and parallel processing
   */
  async processNotes(
    notes: Note[],
    batchSize = config.PROCESSING_CONFIG.BATCH_SIZE,
    parallelLimit = config.PROCESSING_CONFIG.PARALLEL_LIMIT
  ): Promise<EnrichmentResult> {
    const startTime = Date.now();
    const errors: Array<{ noteId: string; error: string }> = [];
    let processedCount = 0;

    try {
      // Validate input
      if (!Array.isArray(notes) || notes.length === 0) {
        throw new Error('No notes provided for processing');
      }

      // Ensure enriched directory exists
      await ensureDirectory(config.DIRECTORIES.ENRICHED);

      // Initialize checkpoint
      await this.checkpointManager.initialize(notes.length);
      await this.checkpointManager.startStage(ProcessingStage.ENRICHMENT);

      // Process notes in batches
      for (let i = 0; i < notes.length; i += batchSize) {
        const batch = notes.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(notes.length / batchSize);

        // Update progress
        log('enrichment.info', {
          message: `Processing batch ${batchNumber} of ${totalBatches}`,
        });

        // Process batch in parallel with limit
        const enrichedNotes = await Promise.all(
          batch.map((note) =>
            this.limit(() =>
              this.enrichNote(note).catch((error) => {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                errors.push({
                  noteId: note.id,
                  error: errorMessage,
                });
                return null;
              })
            )
          )
        );

        // Filter out failed notes and save successful ones
        const successfulNotes = enrichedNotes.filter(
          (note: any): note is EnrichedNote => note !== null
        );

        // Save enriched notes
        await Promise.all(
          successfulNotes.map(async (note: any) => {
            const enrichedPath = path.join(config.DIRECTORIES.ENRICHED, `note-${note.id}.json`);
            await writeJSON(note, enrichedPath);
            await this.checkpointManager.updateNoteProgress(
              ProcessingStage.ENRICHMENT,
              note.id,
              true
            );
          })
        );

        // Update progress for failed notes in this batch
        await Promise.all(
          batch
            .filter((note, idx) => !successfulNotes[idx])
            .map((note) =>
              this.checkpointManager.updateNoteProgress(ProcessingStage.ENRICHMENT, note.id, false)
            )
        );

        processedCount += successfulNotes.length;

        // Log batch completion
        log('enrichment.info', {
          message: `Completed batch ${batchNumber}/${totalBatches}. Success: ${successfulNotes.length}, Errors: ${batch.length - successfulNotes.length}`,
        });
      }

      // Complete the enrichment stage
      await this.checkpointManager.completeStage(ProcessingStage.ENRICHMENT);

      const totalTime = Date.now() - startTime;
      log('enrichment.success', {
        message: `Enrichment complete. Processed ${processedCount}/${notes.length} notes in ${totalTime}ms`,
      });
      if (errors.length > 0) {
        log('enrichment.error', {
          message: `Failed to process ${errors.length} notes:`,
          errors,
        });
      }

      return {
        processedCount,
        totalTime,
        errors,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.checkpointManager.failStage(ProcessingStage.ENRICHMENT, errorMessage);
      log('enrichment.error', {
        message: `Enrichment pipeline failed: ${errorMessage}`,
      });
      throw new Error(`Enrichment pipeline failed: ${errorMessage}`);
    }
  }

  async enrichNotes(notes: Note[]): Promise<EnrichedNote[]> {
    const enrichedNotes: EnrichedNote[] = [];

    // Process notes in batches
    for (let i = 0; i < notes.length; i += config.PROCESSING_CONFIG.BATCH_SIZE) {
      const batch = notes.slice(i, i + config.PROCESSING_CONFIG.BATCH_SIZE);
      log('enrichment.info', {
        message: `Processing batch ${i / config.PROCESSING_CONFIG.BATCH_SIZE + 1} of ${Math.ceil(notes.length / config.PROCESSING_CONFIG.BATCH_SIZE)}`,
      });

      try {
        // Process each note in the batch in parallel with rate limiting
        const batchResults = await Promise.all(
          batch.map((note) => this.limit(() => this.enrichNote(note)))
        );

        enrichedNotes.push(...batchResults);
      } catch (error) {
        log('enrichment.error', {
          message: `Error processing batch starting at index ${i}:`,
          error,
        });
        // Continue with next batch even if one fails
      }
    }

    return enrichedNotes;
  }
}
