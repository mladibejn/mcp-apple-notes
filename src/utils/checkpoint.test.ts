import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { rm } from 'node:fs/promises';
import { CheckpointManager, ProcessingStage, StageStatus } from './checkpoint';
import { CHECKPOINT_CONFIG } from '../config';
import { fileExists } from './paths';

describe('CheckpointManager', () => {
    let checkpointManager: CheckpointManager;

    beforeEach(async () => {
        // Clean up any existing checkpoint file
        try {
            await rm(CHECKPOINT_CONFIG.FULL_PATH);
        } catch {
            // Ignore if file doesn't exist
        }
        checkpointManager = new CheckpointManager();
    });

    afterEach(async () => {
        // Clean up after tests
        try {
            await rm(CHECKPOINT_CONFIG.FULL_PATH);
        } catch {
            // Ignore if file doesn't exist
        }
    });

    test('should initialize with new metadata file', async () => {
        await checkpointManager.initialize(10);
        const metadata = checkpointManager.getMetadata();

        expect(metadata.version).toBe('1.0.0');
        expect(metadata.totalNotes).toBe(10);
        expect(Object.keys(metadata.stages)).toHaveLength(4);
        expect(metadata.stages[ProcessingStage.RAW_EXPORT].status).toBe(StageStatus.NOT_STARTED);
    });

    test('should update existing metadata file', async () => {
        // Initialize with 10 notes
        await checkpointManager.initialize(10);

        // Create new instance and initialize with different number
        const newManager = new CheckpointManager();
        await newManager.initialize(15);

        const metadata = newManager.getMetadata();
        expect(metadata.totalNotes).toBe(15);
    });

    test('should track stage progress correctly', async () => {
        await checkpointManager.initialize(3);

        // Start RAW_EXPORT stage
        await checkpointManager.startStage(ProcessingStage.RAW_EXPORT);
        expect(checkpointManager.getStageProgress(ProcessingStage.RAW_EXPORT).status)
            .toBe(StageStatus.IN_PROGRESS);

        // Process notes
        await checkpointManager.updateNoteProgress(ProcessingStage.RAW_EXPORT, '0', true);
        await checkpointManager.updateNoteProgress(ProcessingStage.RAW_EXPORT, '1', true);
        await checkpointManager.updateNoteProgress(ProcessingStage.RAW_EXPORT, '2', false);

        const progress = checkpointManager.getStageProgress(ProcessingStage.RAW_EXPORT);
        expect(progress.processedNoteIds).toEqual(['0', '1']);
        expect(progress.failedNoteIds).toEqual(['2']);
        expect(checkpointManager.getStageProgressPercentage(ProcessingStage.RAW_EXPORT))
            .toBe((2 / 3) * 100);
    });

    test('should handle stage completion', async () => {
        await checkpointManager.initialize(2);
        await checkpointManager.startStage(ProcessingStage.RAW_EXPORT);
        await checkpointManager.updateNoteProgress(ProcessingStage.RAW_EXPORT, '0', true);
        await checkpointManager.updateNoteProgress(ProcessingStage.RAW_EXPORT, '1', true);
        await checkpointManager.completeStage(ProcessingStage.RAW_EXPORT);

        expect(checkpointManager.isStageComplete(ProcessingStage.RAW_EXPORT)).toBe(true);
        expect(checkpointManager.getStageProgress(ProcessingStage.RAW_EXPORT).completionTime)
            .toBeDefined();
    });

    test('should handle stage failure', async () => {
        await checkpointManager.initialize(2);
        await checkpointManager.startStage(ProcessingStage.RAW_EXPORT);
        await checkpointManager.failStage(ProcessingStage.RAW_EXPORT, 'Test error');

        const progress = checkpointManager.getStageProgress(ProcessingStage.RAW_EXPORT);
        expect(progress.status).toBe(StageStatus.FAILED);
        expect(progress.error).toBe('Test error');
    });

    test('should get next note for processing', async () => {
        await checkpointManager.initialize(3);
        await checkpointManager.startStage(ProcessingStage.RAW_EXPORT);

        // First note should be '0'
        expect(checkpointManager.getNextNoteForStage(ProcessingStage.RAW_EXPORT)).toBe('0');

        // Process first note
        await checkpointManager.updateNoteProgress(ProcessingStage.RAW_EXPORT, '0', true);
        expect(checkpointManager.getNextNoteForStage(ProcessingStage.RAW_EXPORT)).toBe('1');

        // Process second note with failure
        await checkpointManager.updateNoteProgress(ProcessingStage.RAW_EXPORT, '1', false);
        expect(checkpointManager.getNextNoteForStage(ProcessingStage.RAW_EXPORT)).toBe('2');

        // Process last note
        await checkpointManager.updateNoteProgress(ProcessingStage.RAW_EXPORT, '2', true);
        expect(checkpointManager.getNextNoteForStage(ProcessingStage.RAW_EXPORT)).toBeNull();
    });

    test('should persist metadata between instances', async () => {
        // First instance
        await checkpointManager.initialize(2);
        await checkpointManager.startStage(ProcessingStage.RAW_EXPORT);
        await checkpointManager.updateNoteProgress(ProcessingStage.RAW_EXPORT, '0', true);

        // Create new instance
        const newManager = new CheckpointManager();
        await newManager.initialize(2);

        const progress = newManager.getStageProgress(ProcessingStage.RAW_EXPORT);
        expect(progress.status).toBe(StageStatus.IN_PROGRESS);
        expect(progress.processedNoteIds).toEqual(['0']);
    });

    test('should handle file operations correctly', async () => {
        await checkpointManager.initialize(1);
        expect(await fileExists(CHECKPOINT_CONFIG.FULL_PATH)).toBe(true);

        // Modify and check if file is updated
        await checkpointManager.startStage(ProcessingStage.RAW_EXPORT);
        const newManager = new CheckpointManager();
        await newManager.initialize(1);
        expect(newManager.getStageProgress(ProcessingStage.RAW_EXPORT).status)
            .toBe(StageStatus.IN_PROGRESS);
    });
}); 