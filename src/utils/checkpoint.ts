import { CHECKPOINT_CONFIG } from '../config';
import { readJSON, writeJSON, JSONFileError } from './json';
import { fileExists } from './paths';
import { ensureDirectory } from './directory';

/**
 * Processing stages in the pipeline
 */
export enum ProcessingStage {
    RAW_EXPORT = 'raw_export',
    ENRICHMENT = 'enrichment',
    CLUSTERING = 'clustering',
    FINAL_MERGE = 'final_merge'
}

/**
 * Status of a processing stage
 */
export enum StageStatus {
    NOT_STARTED = 'not_started',
    IN_PROGRESS = 'in_progress',
    COMPLETED = 'completed',
    FAILED = 'failed'
}

/**
 * Structure for tracking progress of a specific stage
 */
export interface StageProgress {
    status: StageStatus;
    processedNoteIds: string[];
    failedNoteIds: string[];
    startTime?: string;
    completionTime?: string;
    lastProcessedTime?: string;
    error?: string;
}

/**
 * Main checkpoint metadata structure
 */
export interface CheckpointMetadata {
    version: string;
    totalNotes: number;
    stages: {
        [key in ProcessingStage]: StageProgress;
    };
    createdAt: string;
    lastUpdated: string;
}

/**
 * Class to manage checkpoints and processing progress
 */
export class CheckpointManager {
    private metadata: CheckpointMetadata | null = null;

    /**
     * Initialize checkpoint manager and load or create metadata
     */
    async initialize(totalNotes: number): Promise<void> {
        try {
            // Ensure checkpoint directory exists
            await ensureDirectory(CHECKPOINT_CONFIG.DIRECTORY);

            if (await fileExists(CHECKPOINT_CONFIG.FULL_PATH)) {
                this.metadata = await readJSON<CheckpointMetadata>(CHECKPOINT_CONFIG.FULL_PATH);
                // Update total notes if it has changed
                if (this.metadata.totalNotes !== totalNotes) {
                    this.metadata.totalNotes = totalNotes;
                    await this.saveMetadata();
                }
            } else {
                // Create new metadata file
                this.metadata = {
                    version: '1.0.0',
                    totalNotes: totalNotes,
                    stages: {
                        [ProcessingStage.RAW_EXPORT]: {
                            status: StageStatus.NOT_STARTED,
                            processedNoteIds: [],
                            failedNoteIds: []
                        },
                        [ProcessingStage.ENRICHMENT]: {
                            status: StageStatus.NOT_STARTED,
                            processedNoteIds: [],
                            failedNoteIds: []
                        },
                        [ProcessingStage.CLUSTERING]: {
                            status: StageStatus.NOT_STARTED,
                            processedNoteIds: [],
                            failedNoteIds: []
                        },
                        [ProcessingStage.FINAL_MERGE]: {
                            status: StageStatus.NOT_STARTED,
                            processedNoteIds: [],
                            failedNoteIds: []
                        }
                    },
                    createdAt: new Date().toISOString(),
                    lastUpdated: new Date().toISOString()
                };
                await this.saveMetadata();
            }
        } catch (error) {
            if (error instanceof JSONFileError) {
                throw new Error(`Failed to initialize checkpoint: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Save current metadata to file
     */
    private async saveMetadata(): Promise<void> {
        if (!this.metadata) {
            throw new Error('Checkpoint metadata not initialized');
        }
        this.metadata.lastUpdated = new Date().toISOString();
        await writeJSON(CHECKPOINT_CONFIG.FULL_PATH, JSON.parse(JSON.stringify(this.metadata)));
    }

    /**
     * Start processing for a stage
     */
    async startStage(stage: ProcessingStage): Promise<void> {
        if (!this.metadata) {
            throw new Error('Checkpoint metadata not initialized');
        }

        const stageProgress = this.metadata.stages[stage];
        if (stageProgress.status === StageStatus.IN_PROGRESS) {
            return; // Stage already in progress
        }

        stageProgress.status = StageStatus.IN_PROGRESS;
        stageProgress.startTime = new Date().toISOString();
        stageProgress.error = undefined;
        await this.saveMetadata();
    }

    /**
     * Update progress for a specific note in a stage
     */
    async updateNoteProgress(stage: ProcessingStage, noteId: string, success: boolean): Promise<void> {
        if (!this.metadata) {
            throw new Error('Checkpoint metadata not initialized');
        }

        const stageProgress = this.metadata.stages[stage];
        if (success) {
            if (!stageProgress.processedNoteIds.includes(noteId)) {
                stageProgress.processedNoteIds.push(noteId);
            }
        } else {
            if (!stageProgress.failedNoteIds.includes(noteId)) {
                stageProgress.failedNoteIds.push(noteId);
            }
        }

        stageProgress.lastProcessedTime = new Date().toISOString();
        await this.saveMetadata();
    }

    /**
     * Complete a processing stage
     */
    async completeStage(stage: ProcessingStage): Promise<void> {
        if (!this.metadata) {
            throw new Error('Checkpoint metadata not initialized');
        }

        const stageProgress = this.metadata.stages[stage];
        stageProgress.status = StageStatus.COMPLETED;
        stageProgress.completionTime = new Date().toISOString();
        await this.saveMetadata();
    }

    /**
     * Mark a stage as failed with an error message
     */
    async failStage(stage: ProcessingStage, error: string): Promise<void> {
        if (!this.metadata) {
            throw new Error('Checkpoint metadata not initialized');
        }

        const stageProgress = this.metadata.stages[stage];
        stageProgress.status = StageStatus.FAILED;
        stageProgress.error = error;
        await this.saveMetadata();
    }

    /**
     * Get progress information for a stage
     */
    getStageProgress(stage: ProcessingStage): StageProgress {
        if (!this.metadata) {
            throw new Error('Checkpoint metadata not initialized');
        }
        return this.metadata.stages[stage];
    }

    /**
     * Calculate progress percentage for a stage
     */
    getStageProgressPercentage(stage: ProcessingStage): number {
        if (!this.metadata) {
            throw new Error('Checkpoint metadata not initialized');
        }

        const stageProgress = this.metadata.stages[stage];
        const processed = stageProgress.processedNoteIds.length;
        return (processed / this.metadata.totalNotes) * 100;
    }

    /**
     * Get the next note ID that needs processing for a stage
     */
    getNextNoteForStage(stage: ProcessingStage): string | null {
        if (!this.metadata) {
            throw new Error('Checkpoint metadata not initialized');
        }

        const stageProgress = this.metadata.stages[stage];
        // Find a note that hasn't been processed or failed
        for (let i = 0; i < this.metadata.totalNotes; i++) {
            const noteId = i.toString();
            if (!stageProgress.processedNoteIds.includes(noteId) &&
                !stageProgress.failedNoteIds.includes(noteId)) {
                return noteId;
            }
        }
        return null;
    }

    /**
     * Check if a stage is complete
     */
    isStageComplete(stage: ProcessingStage): boolean {
        if (!this.metadata) {
            throw new Error('Checkpoint metadata not initialized');
        }
        return this.metadata.stages[stage].status === StageStatus.COMPLETED;
    }

    /**
     * Get all metadata
     */
    getMetadata(): CheckpointMetadata {
        if (!this.metadata) {
            throw new Error('Checkpoint metadata not initialized');
        }
        return { ...this.metadata };
    }
} 