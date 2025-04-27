import path from 'node:path';
import { DIRECTORIES } from '../config';
import type { EnrichedNote } from '../types';
import type { CheckpointManager } from '../utils/checkpoint';
import { ProcessingStage } from '../utils/checkpoint';
import { ensureDirectory } from '../utils/directory';
import { readJSON, writeJSON } from '../utils/json';
import { fileExists } from '../utils/paths';
import { log } from './logging';

interface TagStats {
  count: number;
  notes: string[]; // Array of note IDs where this tag appears
  relatedTags: { [tag: string]: number }; // Map of related tags and their co-occurrence count
}

interface TagMetadata {
  tags: {
    [tag: string]: TagStats;
  };
  totalNotes: number;
  uniqueTags: number;
  averageTagsPerNote: number;
  mostCommonTags: Array<{ tag: string; count: number }>;
  suggestedMerges: Array<{
    tags: string[];
    confidence: number;
    reason: string;
  }>;
  generatedAt: string;
}

export class TagAggregationService {
  private checkpointManager: CheckpointManager;

  constructor(checkpointManager: CheckpointManager) {
    this.checkpointManager = checkpointManager;
  }

  /**
   * Calculate similarity between two tags based on their co-occurrence and usage patterns
   */
  private calculateTagSimilarity(
    tag1: string,
    tag2: string,
    tagStats: { [tag: string]: TagStats }
  ): number {
    const stats1 = tagStats[tag1];
    const stats2 = tagStats[tag2];

    if (!stats1 || !stats2) return 0;

    // Calculate Jaccard similarity of note sets
    const intersection = stats1.notes.filter((id) => stats2.notes.includes(id)).length;
    const union = new Set([...stats1.notes, ...stats2.notes]).size;
    const jaccardSimilarity = intersection / union;

    // Calculate co-occurrence ratio
    const coOccurrence = (stats1.relatedTags[tag2] || 0) / Math.min(stats1.count, stats2.count);

    // Combine metrics (weighted average)
    return jaccardSimilarity * 0.6 + coOccurrence * 0.4;
  }

  /**
   * Find potential tag merges based on similarity
   */
  private findTagMerges(tagStats: { [tag: string]: TagStats }): Array<{
    tags: string[];
    confidence: number;
    reason: string;
  }> {
    const merges: Array<{ tags: string[]; confidence: number; reason: string }> = [];
    const processedPairs = new Set<string>();

    // Get all tags sorted by usage count (most used first)
    const sortedTags = Object.entries(tagStats)
      .sort(([, a], [, b]) => b.count - a.count)
      .map(([tag]) => tag);

    for (let i = 0; i < sortedTags.length; i++) {
      const tag1 = sortedTags[i];

      for (let j = i + 1; j < sortedTags.length; j++) {
        const tag2 = sortedTags[j];

        // Skip if we've already processed this pair
        const pairKey = [tag1, tag2].sort().join('|');
        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);

        const similarity = this.calculateTagSimilarity(tag1, tag2, tagStats);

        // If tags are similar enough, suggest a merge
        if (similarity >= 0.7) {
          const stats1 = tagStats[tag1];
          const stats2 = tagStats[tag2];

          merges.push({
            tags: [tag1, tag2],
            confidence: similarity,
            reason:
              `Tags co-occur in ${stats1.relatedTags[tag2] || 0} notes and have similar usage patterns. ` +
              `"${tag1}" appears in ${stats1.count} notes, "${tag2}" in ${stats2.count} notes.`,
          });
        }
      }
    }

    // Sort by confidence (highest first) and return top 10
    return merges.sort((a, b) => b.confidence - a.confidence).slice(0, 10);
  }

  /**
   * Process all enriched notes to generate tag metadata
   */
  async aggregateTags(): Promise<void> {
    try {
      // Ensure clusters directory exists
      await ensureDirectory(DIRECTORIES.CLUSTERS);

      // Initialize or resume checkpoint
      await this.checkpointManager.startStage(ProcessingStage.CLUSTERING);

      const tagStats: { [tag: string]: TagStats } = {};
      let totalNotes = 0;

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
          totalNotes++;

          // Process tags for this note
          for (const tag of note.tags) {
            // Initialize tag stats if needed
            if (!tagStats[tag]) {
              tagStats[tag] = {
                count: 0,
                notes: [],
                relatedTags: {},
              };
            }

            // Update tag stats
            tagStats[tag].count++;
            tagStats[tag].notes.push(note.id);

            // Update related tags
            for (const relatedTag of note.tags) {
              if (relatedTag !== tag) {
                tagStats[tag].relatedTags[relatedTag] =
                  (tagStats[tag].relatedTags[relatedTag] || 0) + 1;
              }
            }
          }

          // Update checkpoint progress
          await this.checkpointManager.updateNoteProgress(
            ProcessingStage.CLUSTERING,
            nextNoteId,
            true
          );
        } catch (error) {
          // Log error and mark note as failed in checkpoint
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          log('tagAggregation.failed', {
            message: `Failed to process note ${nextNoteId}: ${errorMessage}`,
          });
          await this.checkpointManager.updateNoteProgress(
            ProcessingStage.CLUSTERING,
            nextNoteId,
            false
          );
        }
      }

      // Calculate aggregate statistics
      const uniqueTags = Object.keys(tagStats).length;
      const totalTagUsages = Object.values(tagStats).reduce((sum, stats) => sum + stats.count, 0);

      // Get most common tags (top 20)
      const mostCommonTags = Object.entries(tagStats)
        .sort(([, a], [, b]) => b.count - a.count)
        .slice(0, 20)
        .map(([tag, stats]) => ({
          tag,
          count: stats.count,
        }));

      // Find potential tag merges
      const suggestedMerges = this.findTagMerges(tagStats);

      // Create final metadata
      const metadata: TagMetadata = {
        tags: tagStats,
        totalNotes,
        uniqueTags,
        averageTagsPerNote: totalTagUsages / totalNotes,
        mostCommonTags,
        suggestedMerges,
        generatedAt: new Date().toISOString(),
      };

      // Save metadata
      const outputPath = path.join(DIRECTORIES.CLUSTERS, 'tags_aggregated.json');
      await writeJSON(metadata, outputPath);

      // Complete the clustering stage
      await this.checkpointManager.completeStage(ProcessingStage.CLUSTERING);

      log('tagAggregation.completed', {
        totalNotes,
        uniqueTags,
        averageTagsPerNote: metadata.averageTagsPerNote,
        suggestedMerges: suggestedMerges.length,
      });
    } catch (error) {
      // Handle fatal errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.checkpointManager.failStage(ProcessingStage.CLUSTERING, errorMessage);
      throw new Error(`Tag aggregation failed: ${errorMessage}`);
    }
  }
}
