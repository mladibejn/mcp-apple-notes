import path from 'node:path';
import { DIRECTORIES } from '../config';
import type { EnrichedNote } from '../types';
import type { CheckpointManager } from '../utils/checkpoint';
import { ProcessingStage } from '../utils/checkpoint';
import { readJSON, writeJSON } from '../utils/json';
import type { Logger } from '../utils/logger';
import { fileExists } from '../utils/paths';
import { ensureDirectory } from '../utils/paths';
import { kmeans as kmeansCluster } from 'ml-kmeans';
import { DBSCAN } from 'density-clustering';

interface PreparedData {
  embeddings: number[][];
  noteIds: string[];
  notes: EnrichedNote[];
}

interface ClusteringResult {
  clusterIds: number[];
  centroids?: number[][];
  silhouetteScore?: number;
}

interface ClusteringOptions {
  algorithm: 'kmeans' | 'hdbscan';
  numClusters?: number; // Required for KMeans
  minClusterSize?: number; // Optional for HDBSCAN
  minSamples?: number; // Optional for HDBSCAN
}

interface ClusterMetadata {
  id: string;
  size: number;
  centralThemes: string[];
  representativeNotes: Array<{
    id: string;
    title: string;
    summary: string;
  }>;
  averageDistance?: number; // Only for KMeans
}

interface ClusteringOutput {
  clusters: {
    [clusterId: string]: ClusterMetadata;
  };
  noteAssignments: {
    [noteId: string]: string; // Maps note ID to cluster ID
  };
  algorithm: string;
  parameters: Record<string, unknown>; // Replace any with unknown
  timestamp: string;
  totalNotes: number;
  totalClusters: number;
}

export class ClusteringService {
  private checkpointManager: CheckpointManager;
  private logger: Logger;

  constructor(checkpointManager: CheckpointManager, logger: Logger) {
    this.checkpointManager = checkpointManager;
    this.logger = logger;
  }

  /**
   * Load all enriched notes and prepare their embeddings for clustering
   */
  async loadNotesForClustering(): Promise<PreparedData> {
    const embeddings: number[][] = [];
    const noteIds: string[] = [];
    const notes: EnrichedNote[] = [];
    let skippedNotes = 0;

    try {
      // Start clustering stage if not already started
      await this.checkpointManager.startStage(ProcessingStage.CLUSTERING);

      // Process all enriched notes
      while (true) {
        const nextNoteId = this.checkpointManager.getNextNoteForStage(ProcessingStage.CLUSTERING);
        if (!nextNoteId) break;

        try {
          // Read enriched note
          const notePath = path.join(DIRECTORIES.ENRICHED, `note-${nextNoteId}.json`);
          if (!(await fileExists(notePath))) {
            throw new Error(`Enriched note file not found: ${notePath}`);
          }

          const note = await readJSON<EnrichedNote>(notePath);

          // Validate embedding
          if (!note.embedding || !Array.isArray(note.embedding) || note.embedding.length === 0) {
            this.logger.warn(`Note ${nextNoteId} has invalid embedding, skipping`);
            skippedNotes++;
            continue;
          }

          // Store data for clustering
          embeddings.push(note.embedding);
          noteIds.push(note.id);
          notes.push(note);

          // Update checkpoint progress
          await this.checkpointManager.updateNoteProgress(
            ProcessingStage.CLUSTERING,
            nextNoteId,
            true
          );
        } catch (error) {
          // Log error and mark note as failed in checkpoint
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(`Failed to process note ${nextNoteId}:`, errorMessage);
          await this.checkpointManager.updateNoteProgress(
            ProcessingStage.CLUSTERING,
            nextNoteId,
            false
          );
        }
      }

      if (skippedNotes > 0) {
        this.logger.warn(`Skipped ${skippedNotes} notes due to invalid embeddings`);
      }

      if (embeddings.length === 0) {
        throw new Error('No valid notes found for clustering');
      }

      // Validate all embeddings have the same dimensionality
      const embeddingSize = embeddings[0].length;
      const invalidEmbeddings = embeddings.filter((e) => e.length !== embeddingSize);
      if (invalidEmbeddings.length > 0) {
        throw new Error(
          `Found ${invalidEmbeddings.length} embeddings with inconsistent dimensionality`
        );
      }

      this.logger.info(`Successfully loaded ${embeddings.length} notes for clustering`);
      return { embeddings, noteIds, notes };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to load notes for clustering:', errorMessage);
      throw error;
    }
  }

  /**
   * Determine the optimal number of clusters using the elbow method and silhouette score
   */
  private async findOptimalClusters(embeddings: number[][]): Promise<number> {
    const maxClusters = Math.min(20, Math.floor(embeddings.length / 2));
    const minClusters = 2;
    let bestScore = -1;
    let optimalClusters = minClusters;

    for (let k = minClusters; k <= maxClusters; k++) {
      const result = await this.clusterNotes(embeddings, {
        algorithm: 'kmeans',
        numClusters: k,
      });

      if (result.silhouetteScore && result.silhouetteScore > bestScore) {
        bestScore = result.silhouetteScore;
        optimalClusters = k;
      }
    }

    this.logger.info(
      `Determined optimal number of clusters: ${optimalClusters} (silhouette score: ${bestScore.toFixed(3)})`
    );
    return optimalClusters;
  }

  /**
   * Cluster notes using the specified algorithm
   */
  async clusterNotes(
    embeddings: number[][],
    options: ClusteringOptions
  ): Promise<ClusteringResult> {
    try {
      if (options.algorithm === 'kmeans') {
        const numClusters = options.numClusters || (await this.findOptimalClusters(embeddings));

        // Use ml-kmeans
        const result = kmeansCluster(embeddings, numClusters, {
          seed: 42,
          initialization: 'kmeans++',
        });

        // Calculate silhouette score
        const silhouetteScore = await this.calculateSilhouetteScore(embeddings, result.clusters);

        return {
          clusterIds: result.clusters,
          centroids: result.centroids,
          silhouetteScore,
        };
      }

      if (options.algorithm === 'hdbscan') {
        // Use DBSCAN from density-clustering as a replacement for HDBSCAN
        const dbscan = new DBSCAN();
        const minPts = options.minSamples || 3;
        const epsilon = this.calculateEpsilon(embeddings, minPts);

        const clusters = dbscan.run(embeddings, epsilon, minPts);

        // Convert clusters to cluster IDs array
        const clusterIds = new Array(embeddings.length).fill(-1);
        clusters.forEach((cluster, i) => {
          cluster.forEach(pointIndex => {
            clusterIds[pointIndex] = i;
          });
        });

        return {
          clusterIds,
          // DBSCAN doesn't provide centroids or silhouette score
        };
      }

      throw new Error(`Unsupported clustering algorithm: ${options.algorithm}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Clustering failed: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Calculate silhouette score for clustering results
   */
  private async calculateSilhouetteScore(embeddings: number[][], clusterIds: number[]): Promise<number> {
    let totalScore = 0;
    let validPoints = 0;

    for (let i = 0; i < embeddings.length; i++) {
      const clusterId = clusterIds[i];
      const clusterPoints = embeddings.filter((_, idx) => clusterIds[idx] === clusterId);

      if (clusterPoints.length <= 1) continue;

      // Calculate average distance to points in same cluster (a)
      let intraClusterDist = 0;
      for (const point of clusterPoints) {
        intraClusterDist += this.euclideanDistance(embeddings[i], point);
      }
      const a = intraClusterDist / (clusterPoints.length - 1);

      // Find nearest cluster
      let minInterClusterDist = Number.POSITIVE_INFINITY;
      const uniqueClusters = [...new Set(clusterIds)];
      for (const otherClusterId of uniqueClusters) {
        if (otherClusterId === clusterId) continue;

        const otherClusterPoints = embeddings.filter((_, idx) => clusterIds[idx] === otherClusterId);
        if (otherClusterPoints.length === 0) continue;

        let clusterDist = 0;
        for (const point of otherClusterPoints) {
          clusterDist += this.euclideanDistance(embeddings[i], point);
        }
        const avgDist = clusterDist / otherClusterPoints.length;
        minInterClusterDist = Math.min(minInterClusterDist, avgDist);
      }
      const b = minInterClusterDist;

      // Calculate silhouette coefficient
      if (b === Number.POSITIVE_INFINITY) continue;
      const score = (b - a) / Math.max(a, b);
      totalScore += score;
      validPoints++;
    }

    return validPoints > 0 ? totalScore / validPoints : 0;
  }

  /**
   * Calculate Euclidean distance between two points
   */
  private euclideanDistance(a: number[], b: number[]): number {
    return Math.sqrt(a.reduce((sum, val, i) => sum + (val - b[i]) ** 2, 0));
  }

  /**
   * Calculate epsilon parameter for DBSCAN using k-nearest neighbors
   */
  private calculateEpsilon(embeddings: number[][], minPts: number): number {
    // Calculate all pairwise distances
    const distances: number[] = [];
    for (let i = 0; i < embeddings.length; i++) {
      for (let j = i + 1; j < embeddings.length; j++) {
        distances.push(this.euclideanDistance(embeddings[i], embeddings[j]));
      }
    }

    // Sort distances and find the knee point
    distances.sort((a, b) => a - b);
    const kNeighborIndex = Math.floor(embeddings.length * minPts / 100);
    return distances[kNeighborIndex];
  }

  /**
   * Find central themes for a cluster based on note summaries
   */
  private async findCentralThemes(notes: EnrichedNote[]): Promise<string[]> {
    const _allText = notes.map((note) => `${note.summary} ${note.tags.join(' ')}`).join(' ');

    const tagCounts = new Map<string, number>();
    for (const note of notes) {
      for (const tag of note.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    return Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tag]) => tag);
  }

  /**
   * Find representative notes for a cluster
   */
  private findRepresentativeNotes(
    notes: EnrichedNote[],
    embeddings: number[][],
    centroid?: number[],
    limit = 3
  ): EnrichedNote[] {
    if (centroid) {
      // For KMeans, use notes closest to centroid
      const distances = embeddings.map((embedding) =>
        Math.sqrt(embedding.reduce((sum, val, i) => sum + (val - centroid[i]) ** 2, 0))
      );

      return notes
        .map((note, i) => ({ note, distance: distances[i] }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit)
        .map(({ note }) => note);
    }

    // For HDBSCAN, just take the first few notes
    return notes.slice(0, limit);
  }

  /**
   * Save clustering results to disk
   */
  async saveClusterResults(
    notes: EnrichedNote[],
    embeddings: number[][],
    clusterIds: number[],
    options: ClusteringOptions,
    centroids?: number[][]
  ): Promise<void> {
    try {
      await ensureDirectory(DIRECTORIES.CLUSTERS);

      // Group notes by cluster
      const notesByCluster = new Map<number, EnrichedNote[]>();
      const embeddingsByCluster = new Map<number, number[][]>();

      for (let i = 0; i < clusterIds.length; i++) {
        const clusterId = clusterIds[i];
        if (!notesByCluster.has(clusterId)) {
          notesByCluster.set(clusterId, []);
          embeddingsByCluster.set(clusterId, []);
        }
        const clusterNotes = notesByCluster.get(clusterId);
        const clusterEmbeddings = embeddingsByCluster.get(clusterId);
        if (clusterNotes && clusterEmbeddings) {
          clusterNotes.push(notes[i]);
          clusterEmbeddings.push(embeddings[i]);
        }
      }

      const clusters = {};
      const noteAssignments = {};

      for (const [rawClusterId, clusterNotes] of notesByCluster.entries()) {
        const clusterId = rawClusterId.toString();
        const clusterEmbeddings = embeddingsByCluster.get(rawClusterId);
        if (!clusterEmbeddings) continue;

        const centroid = centroids?.[rawClusterId];

        // Calculate average distance to centroid if available
        let averageDistance: number | undefined;
        if (centroid) {
          const distances = clusterEmbeddings.map((embedding) =>
            Math.sqrt(embedding.reduce((sum, val, i) => sum + (val - centroid[i]) ** 2, 0))
          );
          averageDistance = distances.reduce((a, b) => a + b) / distances.length;
        }

        const representativeNotes = this.findRepresentativeNotes(
          clusterNotes,
          clusterEmbeddings,
          centroid
        ).map((note) => ({
          id: note.id,
          title: note.title,
          summary: note.summary,
        }));

        clusters[clusterId] = {
          id: clusterId,
          size: clusterNotes.length,
          centralThemes: await this.findCentralThemes(clusterNotes),
          representativeNotes,
          averageDistance,
        };

        // Record note assignments
        for (const note of clusterNotes) {
          noteAssignments[note.id] = clusterId;
        }
      }

      const output: ClusteringOutput = {
        clusters,
        noteAssignments,
        algorithm: options.algorithm,
        parameters: {
          ...options,
          numClusters: Object.keys(clusters).length,
        },
        timestamp: new Date().toISOString(),
        totalNotes: notes.length,
        totalClusters: Object.keys(clusters).length,
      };

      await writeJSON(output, path.join(DIRECTORIES.CLUSTERS, 'clusters.json'));
      this.logger.info(`Saved clustering results with ${output.totalClusters} clusters`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to save clustering results:', errorMessage);
      throw error;
    }
  }
}
