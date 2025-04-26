import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { CHECKPOINT_CONFIG } from '../config';
import { CheckpointManager, ProcessingStage, StageStatus } from './checkpoint';
import { generateProgressReport, getStageProgressString } from './progress';

describe('Progress Reporting', () => {
  let checkpointManager: CheckpointManager;

  beforeEach(async () => {
    // Clean up any existing checkpoint file
    try {
      await rm(CHECKPOINT_CONFIG.FULL_PATH);
    } catch {
      // Ignore if file doesn't exist
    }
    checkpointManager = new CheckpointManager();
    await checkpointManager.initialize(3);
  });

  afterEach(async () => {
    // Clean up after tests
    try {
      await rm(CHECKPOINT_CONFIG.FULL_PATH);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  test('should generate initial progress report', () => {
    const report = generateProgressReport(checkpointManager);

    expect(report.stages).toHaveLength(4);
    expect(report.overallProgress).toBe(0);
    expect(report.lastUpdateTime).toBeDefined();

    // Check each stage
    for (const stageInfo of report.stages) {
      expect(stageInfo.status).toBe(StageStatus.NOT_STARTED);
      expect(stageInfo.processedCount).toBe(0);
      expect(stageInfo.failedCount).toBe(0);
      expect(stageInfo.totalNotes).toBe(3);
      expect(stageInfo.percentComplete).toBe(0);
      expect(stageInfo.timeElapsed).toBeUndefined();
      expect(stageInfo.estimatedTimeRemaining).toBeUndefined();
      expect(stageInfo.error).toBeUndefined();
    }
  });

  test('should generate progress report with active processing', async () => {
    // Start processing and add some progress
    await checkpointManager.startStage(ProcessingStage.RAW_EXPORT);
    await checkpointManager.updateNoteProgress(ProcessingStage.RAW_EXPORT, '0', true);
    await checkpointManager.updateNoteProgress(ProcessingStage.RAW_EXPORT, '1', false);

    const report = generateProgressReport(checkpointManager);
    const rawExportStage = report.stages.find((s) => s.stage === ProcessingStage.RAW_EXPORT);

    expect(rawExportStage).toBeDefined();
    if (rawExportStage) {
      expect(rawExportStage.status).toBe(StageStatus.IN_PROGRESS);
      expect(rawExportStage.processedCount).toBe(1);
      expect(rawExportStage.failedCount).toBe(1);
      expect(rawExportStage.percentComplete).toBe((1 / 3) * 100);
      expect(rawExportStage.timeElapsed).toBeDefined();
      expect(rawExportStage.estimatedTimeRemaining).toBeDefined();
    }

    // Overall progress should be average of all stages
    expect(report.overallProgress).toBe(((1 / 3) * 100) / 4);
  });

  test('should generate progress report with completed stage', async () => {
    // Complete a stage
    await checkpointManager.startStage(ProcessingStage.RAW_EXPORT);
    await checkpointManager.updateNoteProgress(ProcessingStage.RAW_EXPORT, '0', true);
    await checkpointManager.updateNoteProgress(ProcessingStage.RAW_EXPORT, '1', true);
    await checkpointManager.updateNoteProgress(ProcessingStage.RAW_EXPORT, '2', true);
    await checkpointManager.completeStage(ProcessingStage.RAW_EXPORT);

    const report = generateProgressReport(checkpointManager);
    const rawExportStage = report.stages.find((s) => s.stage === ProcessingStage.RAW_EXPORT);

    expect(rawExportStage).toBeDefined();
    if (rawExportStage) {
      expect(rawExportStage.status).toBe(StageStatus.COMPLETED);
      expect(rawExportStage.processedCount).toBe(3);
      expect(rawExportStage.failedCount).toBe(0);
      expect(rawExportStage.percentComplete).toBe(100);
      expect(rawExportStage.timeElapsed).toBeDefined();
      expect(rawExportStage.estimatedTimeRemaining).toBeUndefined();
    }
  });

  test('should generate progress report with failed stage', async () => {
    // Fail a stage
    await checkpointManager.startStage(ProcessingStage.RAW_EXPORT);
    await checkpointManager.failStage(ProcessingStage.RAW_EXPORT, 'Test error');

    const report = generateProgressReport(checkpointManager);
    const rawExportStage = report.stages.find((s) => s.stage === ProcessingStage.RAW_EXPORT);

    expect(rawExportStage).toBeDefined();
    if (rawExportStage) {
      expect(rawExportStage.status).toBe(StageStatus.FAILED);
      expect(rawExportStage.error).toBe('Test error');
    }
  });

  test('should generate progress string for not started stage', () => {
    const progressString = getStageProgressString(checkpointManager, ProcessingStage.RAW_EXPORT);
    expect(progressString).toBe('raw_export: Not Started - 0/3 processed (0.0%)');
  });

  test('should generate progress string for in-progress stage', async () => {
    await checkpointManager.startStage(ProcessingStage.RAW_EXPORT);
    await checkpointManager.updateNoteProgress(ProcessingStage.RAW_EXPORT, '0', true);
    await checkpointManager.updateNoteProgress(ProcessingStage.RAW_EXPORT, '1', false);

    const progressString = getStageProgressString(checkpointManager, ProcessingStage.RAW_EXPORT);
    expect(progressString).toBe('raw_export: In Progress - 1/3 processed (33.3%) [1 failed]');
  });

  test('should generate progress string for completed stage', async () => {
    await checkpointManager.startStage(ProcessingStage.RAW_EXPORT);
    await checkpointManager.updateNoteProgress(ProcessingStage.RAW_EXPORT, '0', true);
    await checkpointManager.updateNoteProgress(ProcessingStage.RAW_EXPORT, '1', true);
    await checkpointManager.updateNoteProgress(ProcessingStage.RAW_EXPORT, '2', true);
    await checkpointManager.completeStage(ProcessingStage.RAW_EXPORT);

    const progressString = getStageProgressString(checkpointManager, ProcessingStage.RAW_EXPORT);
    expect(progressString).toBe('raw_export: Completed - 3/3 processed (100.0%)');
  });
});
