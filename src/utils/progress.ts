import type { CheckpointManager, ProcessingStage, StageStatus } from './checkpoint';

/**
 * Format a duration in milliseconds to a human-readable string
 */
function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
}

/**
 * Progress information for a stage
 */
export interface StageProgressInfo {
    stage: ProcessingStage;
    status: StageStatus;
    processedCount: number;
    failedCount: number;
    totalNotes: number;
    percentComplete: number;
    timeElapsed?: string;
    estimatedTimeRemaining?: string;
    error?: string;
}

/**
 * Overall progress report
 */
export interface ProgressReport {
    stages: StageProgressInfo[];
    overallProgress: number;
    startTime?: string;
    lastUpdateTime: string;
}

/**
 * Generate a detailed progress report
 */
export function generateProgressReport(checkpointManager: CheckpointManager): ProgressReport {
    const metadata = checkpointManager.getMetadata();
    const stages: StageProgressInfo[] = [];
    let totalProgress = 0;

    // Calculate progress for each stage
    for (const stage of Object.values(ProcessingStage)) {
        const progress = checkpointManager.getStageProgress(stage);
        const processedCount = progress.processedNoteIds.length;
        const failedCount = progress.failedNoteIds.length;
        const percentComplete = checkpointManager.getStageProgressPercentage(stage);

        let timeElapsed: string | undefined;
        let estimatedTimeRemaining: string | undefined;

        if (progress.startTime) {
            const startTime = new Date(progress.startTime).getTime();
            const now = Date.now();
            const elapsed = now - startTime;
            timeElapsed = formatDuration(elapsed);

            // Calculate estimated time remaining if in progress
            if (progress.status === StageStatus.IN_PROGRESS && processedCount > 0) {
                const timePerNote = elapsed / processedCount;
                const remainingNotes = metadata.totalNotes - processedCount;
                const estimatedRemaining = timePerNote * remainingNotes;
                estimatedTimeRemaining = formatDuration(estimatedRemaining);
            }
        }

        stages.push({
            stage,
            status: progress.status,
            processedCount,
            failedCount,
            totalNotes: metadata.totalNotes,
            percentComplete,
            timeElapsed,
            estimatedTimeRemaining,
            error: progress.error
        });

        // Add to overall progress (each stage contributes equally)
        totalProgress += percentComplete;
    }

    // Calculate overall progress as average of all stages
    const overallProgress = totalProgress / Object.keys(ProcessingStage).length;

    return {
        stages,
        overallProgress,
        startTime: metadata.createdAt,
        lastUpdateTime: metadata.lastUpdated
    };
}

/**
 * Generate a simple one-line progress string for a stage
 */
export function getStageProgressString(checkpointManager: CheckpointManager, stage: ProcessingStage): string {
    const progress = checkpointManager.getStageProgress(stage);
    const percent = checkpointManager.getStageProgressPercentage(stage);
    const processed = progress.processedNoteIds.length;
    const failed = progress.failedNoteIds.length;
    const total = checkpointManager.getMetadata().totalNotes;

    let status = '';
    switch (progress.status) {
        case StageStatus.NOT_STARTED:
            status = 'Not Started';
            break;
        case StageStatus.IN_PROGRESS:
            status = 'In Progress';
            break;
        case StageStatus.COMPLETED:
            status = 'Completed';
            break;
        case StageStatus.FAILED:
            status = 'Failed';
            break;
    }

    return `${stage}: ${status} - ${processed}/${total} processed (${percent.toFixed(1)}%) ${failed > 0 ? `[${failed} failed]` : ''}`;
} 