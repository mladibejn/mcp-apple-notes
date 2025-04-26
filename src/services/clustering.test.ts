import { describe, expect, test } from 'bun:test';
import { ClusteringService } from './clustering';
import type { CheckpointManager } from '../utils/checkpoint';
import type { Logger } from '../utils/logger';
import { mock } from 'bun:test';

describe('ClusteringService', () => {
    const mockLogger = {
        info: mock(() => { }),
        warn: mock(() => { }),
        error: mock(() => { }),
    } as unknown as Logger;

    const mockCheckpointManager = {
        startStage: mock(async () => { }),
        getNextNoteForStage: mock(() => null),
        updateNoteProgress: mock(async () => { }),
    } as unknown as CheckpointManager;

    const service = new ClusteringService(mockCheckpointManager, mockLogger);

    describe('clusterNotes', () => {
        test('should perform k-means clustering', async () => {
            const embeddings = [
                [1, 1],
                [2, 1],
                [1, 2],
                [10, 10],
                [11, 10],
                [10, 11],
            ];

            const result = await service.clusterNotes(embeddings, {
                algorithm: 'kmeans',
                numClusters: 2,
            });

            expect(result.clusterIds).toBeDefined();
            expect(result.clusterIds.length).toBe(embeddings.length);
            expect(result.centroids).toBeDefined();
            expect(result.centroids?.length).toBe(2);
            expect(result.silhouetteScore).toBeDefined();
            expect(result.silhouetteScore).toBeGreaterThan(0);

            // Points should be clustered into two groups
            const cluster0Points = result.clusterIds.filter(id => id === 0).length;
            const cluster1Points = result.clusterIds.filter(id => id === 1).length;
            expect(cluster0Points + cluster1Points).toBe(embeddings.length);
        });

        test('should perform DBSCAN clustering', async () => {
            const embeddings = [
                [1, 1],
                [2, 1],
                [1, 2],
                [10, 10],
                [11, 10],
                [10, 11],
            ];

            const result = await service.clusterNotes(embeddings, {
                algorithm: 'hdbscan',
                minSamples: 2,
            });

            expect(result.clusterIds).toBeDefined();
            expect(result.clusterIds.length).toBe(embeddings.length);
            expect(result.centroids).toBeUndefined();
            expect(result.silhouetteScore).toBeUndefined();

            // Points should be clustered into groups
            const uniqueClusters = new Set(result.clusterIds);
            expect(uniqueClusters.size).toBeGreaterThan(0);
        });

        test('should throw error for unsupported algorithm', async () => {
            const embeddings = [[1, 1]];
            await expect(
                service.clusterNotes(embeddings, {
                    algorithm: 'invalid' as any,
                })
            ).rejects.toThrow('Unsupported clustering algorithm: invalid');
        });
    });

    describe('findOptimalClusters', () => {
        test('should find optimal number of clusters', async () => {
            const embeddings = [
                [1, 1],
                [2, 1],
                [1, 2],
                [10, 10],
                [11, 10],
                [10, 11],
            ];

            const result = await service.clusterNotes(embeddings, {
                algorithm: 'kmeans',
            });

            expect(result.clusterIds).toBeDefined();
            expect(result.clusterIds.length).toBe(embeddings.length);
            expect(result.centroids).toBeDefined();
            expect(result.silhouetteScore).toBeDefined();
            expect(result.silhouetteScore).toBeGreaterThan(0);
        });
    });
}); 