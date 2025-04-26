import path from 'node:path';
import { DIRECTORIES } from '../config';
import type { OpenAIService } from './openai';
import { readJSON, writeJSON } from '../utils/json';
import { ensureDirectory } from '../utils/directory';
import type { CheckpointManager } from '../utils/checkpoint';
import { ProcessingStage } from '../utils/checkpoint';
import { fileExists } from '../utils/paths';
import pLimit from 'p-limit';
import type { Note, EnrichedNote } from '../types';
import type { Logger } from '../utils/logger';

const BATCH_SIZE = 5; // Process 5 notes at a time
const PARALLEL_LIMIT = 3; // Maximum parallel API calls

export class EnrichmentService {
    private openai: OpenAIService;
    private checkpointManager: CheckpointManager;
    private logger: Logger;
    private limit: ReturnType<typeof pLimit>;

    constructor(openai: OpenAIService, checkpointManager: CheckpointManager, logger: Logger) {
        this.openai = openai;
        this.checkpointManager = checkpointManager;
        this.logger = logger;
        this.limit = pLimit(PARALLEL_LIMIT);
    }

    /**
     * Process a single note through the enrichment pipeline
     */
    private async enrichNote(note: Note): Promise<EnrichedNote> {
        try {
            // Get summary and tags in a single API call
            const { summary, tags } = await this.openai.generateSummaryAndTags(note.content);

            // Generate embedding for the summary (more cost-effective than full content)
            const [embedding] = await this.openai.generateBatchEmbeddings([summary]);

            return {
                ...note,
                summary,
                tags,
                embedding,
                enrichedAt: new Date().toISOString()
            };
        } catch (error) {
            this.logger.error(`Error enriching note ${note.id}:`, error);
            throw error;
        }
    }

    /**
     * Process all raw notes through the enrichment pipeline
     */
    async processNotes(totalNotes: number): Promise<void> {
        try {
            // Ensure enriched directory exists
            await ensureDirectory(DIRECTORIES.ENRICHED);

            // Initialize or resume checkpoint
            await this.checkpointManager.initialize(totalNotes);
            await this.checkpointManager.startStage(ProcessingStage.ENRICHMENT);

            // Process notes until none remain
            while (true) {
                // Get next note to process
                const nextNoteId = this.checkpointManager.getNextNoteForStage(ProcessingStage.ENRICHMENT);
                if (!nextNoteId) {
                    break; // No more notes to process
                }

                try {
                    // Read raw note
                    const rawNotePath = path.join(DIRECTORIES.RAW, `note-${nextNoteId}.json`);
                    if (!await fileExists(rawNotePath)) {
                        throw new Error(`Raw note file not found: ${rawNotePath}`);
                    }
                    const rawNote = await readJSON<RawNote>(rawNotePath);

                    // Process through enrichment pipeline
                    const enrichedNote = await this.enrichNote(rawNote);

                    // Save enriched note
                    const enrichedPath = path.join(DIRECTORIES.ENRICHED, `note-${nextNoteId}.json`);
                    await writeJSON(enrichedNote, enrichedPath);

                    // Update checkpoint progress
                    await this.checkpointManager.updateNoteProgress(
                        ProcessingStage.ENRICHMENT,
                        nextNoteId,
                        true
                    );

                } catch (error) {
                    // Log error and mark note as failed in checkpoint
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    console.error(`Failed to process note ${nextNoteId}:`, errorMessage);
                    await this.checkpointManager.updateNoteProgress(
                        ProcessingStage.ENRICHMENT,
                        nextNoteId,
                        false
                    );
                }
            }

            // Complete the enrichment stage
            await this.checkpointManager.completeStage(ProcessingStage.ENRICHMENT);

        } catch (error) {
            // Handle fatal errors
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await this.checkpointManager.failStage(ProcessingStage.ENRICHMENT, errorMessage);
            throw new Error(`Enrichment pipeline failed: ${errorMessage}`);
        }
    }

    async enrichNotes(notes: Note[]): Promise<EnrichedNote[]> {
        const enrichedNotes: EnrichedNote[] = [];

        // Process notes in batches
        for (let i = 0; i < notes.length; i += BATCH_SIZE) {
            const batch = notes.slice(i, i + BATCH_SIZE);
            this.logger.info(`Processing batch ${i / BATCH_SIZE + 1} of ${Math.ceil(notes.length / BATCH_SIZE)}`);

            try {
                // Process each note in the batch in parallel with rate limiting
                const batchResults = await Promise.all(
                    batch.map(note => this.limit(() => this.enrichNote(note)))
                );

                enrichedNotes.push(...batchResults);
            } catch (error) {
                this.logger.error(`Error processing batch starting at index ${i}:`, error);
                // Continue with next batch even if one fails
            }
        }

        return enrichedNotes;
    }
} 