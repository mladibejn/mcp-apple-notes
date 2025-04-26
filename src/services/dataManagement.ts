import fs from 'node:fs';
import path from 'node:path';
import type { EnrichedNote, ClusterAssignments } from '../types';
import { ensureDirectory } from '../utils/fileUtils';

/**
 * Load enriched notes from the processed data directory
 * @returns Promise<EnrichedNote[]> Array of enriched notes
 * @throws Error if file not found or invalid format
 */
export async function loadEnrichedNotes(): Promise<EnrichedNote[]> {
    try {
        const filePath = path.join(process.cwd(), 'data', 'processed', 'notes_enriched.json');
        const fileContent = await fs.promises.readFile(filePath, 'utf-8');
        const notes = JSON.parse(fileContent) as EnrichedNote[];

        // Validate the data structure
        if (!Array.isArray(notes)) {
            throw new Error('Enriched notes data is not in the expected array format');
        }

        // Basic validation of each note
        notes.forEach((note, index) => {
            if (!note.id || !note.content) {
                throw new Error(`Invalid note structure at index ${index}: missing required fields`);
            }
        });

        return notes;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error('Enriched notes file not found. Please ensure the enrichment process has been completed.');
        }
        throw error;
    }
}

/**
 * Load cluster assignments from the processed data directory
 * @returns Promise<ClusterAssignments> Map of note IDs to cluster IDs
 * @throws Error if file not found or invalid format
 */
export async function loadClusterAssignments(): Promise<ClusterAssignments> {
    try {
        const filePath = path.join(process.cwd(), 'data', 'processed', 'cluster_assignments.json');
        const fileContent = await fs.promises.readFile(filePath, 'utf-8');
        const assignments = JSON.parse(fileContent) as ClusterAssignments;

        // Validate the data structure
        if (typeof assignments !== 'object' || assignments === null) {
            throw new Error('Cluster assignments data is not in the expected object format');
        }

        // Basic validation of the assignments structure
        Object.entries(assignments).forEach(([noteId, clusterId]) => {
            if (typeof clusterId !== 'number') {
                throw new Error(`Invalid cluster ID for note ${noteId}: expected number, got ${typeof clusterId}`);
            }
        });

        return assignments;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error('Cluster assignments file not found. Please ensure the clustering process has been completed.');
        }
        throw error;
    }
}

export interface NoteWithCluster extends EnrichedNote {
    cluster_id: number;
}

/**
 * Merge enriched notes with their cluster assignments
 * @param notes Array of enriched notes
 * @param clusterAssignments Map of note IDs to cluster IDs
 * @returns Array of notes with cluster assignments
 */
export function mergeNotesWithClusters(
    notes: EnrichedNote[],
    clusterAssignments: ClusterAssignments
): NoteWithCluster[] {
    const defaultClusterId = -1; // Use -1 to indicate no cluster assignment

    return notes.map(note => {
        const clusterId = clusterAssignments[note.id];
        if (clusterId === undefined) {
            console.warn(`No cluster assignment found for note ${note.id}, using default cluster ID ${defaultClusterId}`);
        }

        return {
            ...note,
            cluster_id: clusterId ?? defaultClusterId
        };
    });
}

export interface FinalNote {
    id: string;
    content: string;
    cluster_id: number;
    metadata: {
        title?: string;
        created_at?: string;
        updated_at?: string;
        tags?: string[];
        [key: string]: any;
    };
    enrichments: {
        embedding?: number[];
        summary?: string;
        keywords?: string[];
        sentiment?: {
            score: number;
            label: string;
        };
        [key: string]: any;
    };
}

/**
 * Format notes according to the final note structure
 * @param notes Array of notes with cluster assignments
 * @returns Array of notes in final format
 * @throws Error if a note is missing required fields
 */
export function formatFinalNotes(notes: NoteWithCluster[]): FinalNote[] {
    return notes.map((note, index) => {
        // Validate required fields
        if (!note.id || !note.content) {
            throw new Error(`Note at index ${index} is missing required fields (id, content)`);
        }

        // Create the final note structure
        const finalNote: FinalNote = {
            id: note.id,
            content: note.content,
            cluster_id: note.cluster_id,
            metadata: {
                ...note.metadata,
                created_at: note.metadata?.created_at || new Date().toISOString(),
                updated_at: note.metadata?.updated_at || new Date().toISOString(),
            },
            enrichments: {
                ...note.enrichments,
                embedding: note.enrichments?.embedding || [],
                keywords: note.enrichments?.keywords || [],
                sentiment: note.enrichments?.sentiment || {
                    score: 0,
                    label: 'neutral'
                }
            }
        };

        // Ensure all required fields have default values if missing
        if (!finalNote.metadata.tags) {
            finalNote.metadata.tags = [];
        }

        return finalNote;
    });
}

export interface DatasetStatistics {
    total_notes: number;
    notes_per_cluster: Record<number, number>;
    average_note_length: number;
    metadata_stats: {
        notes_with_title: number;
        notes_with_tags: number;
        total_tags: number;
        unique_tags: number;
        average_tags_per_note: number;
    };
    enrichment_stats: {
        notes_with_embeddings: number;
        notes_with_keywords: number;
        notes_with_sentiment: number;
        sentiment_distribution: Record<string, number>;
        average_keywords_per_note: number;
    };
    cluster_stats: {
        total_clusters: number;
        average_notes_per_cluster: number;
        largest_cluster_size: number;
        smallest_cluster_size: number;
    };
}

/**
 * Generate summary statistics for the final dataset
 * @param notes Array of notes in final format
 * @returns Object containing various statistics about the dataset
 */
export function generateSummaryStatistics(notes: FinalNote[]): DatasetStatistics {
    // Initialize statistics object
    const stats: DatasetStatistics = {
        total_notes: notes.length,
        notes_per_cluster: {},
        average_note_length: 0,
        metadata_stats: {
            notes_with_title: 0,
            notes_with_tags: 0,
            total_tags: 0,
            unique_tags: 0,
            average_tags_per_note: 0
        },
        enrichment_stats: {
            notes_with_embeddings: 0,
            notes_with_keywords: 0,
            notes_with_sentiment: 0,
            sentiment_distribution: {},
            average_keywords_per_note: 0
        },
        cluster_stats: {
            total_clusters: 0,
            average_notes_per_cluster: 0,
            largest_cluster_size: 0,
            smallest_cluster_size: Number.MAX_SAFE_INTEGER
        }
    };

    if (notes.length === 0) {
        stats.cluster_stats.smallest_cluster_size = 0;
        return stats;
    }

    // Calculate basic statistics
    let totalLength = 0;
    const uniqueTags = new Set<string>();
    let totalKeywords = 0;

    // Process each note
    notes.forEach(note => {
        // Note length
        totalLength += note.content.length;

        // Cluster statistics
        if (!(note.cluster_id in stats.notes_per_cluster)) {
            stats.notes_per_cluster[note.cluster_id] = 0;
        }
        stats.notes_per_cluster[note.cluster_id]++;

        // Metadata statistics
        if (note.metadata?.title) {
            stats.metadata_stats.notes_with_title++;
        }
        if (note.metadata?.tags?.length) {
            stats.metadata_stats.notes_with_tags++;
            stats.metadata_stats.total_tags += note.metadata.tags.length;
            note.metadata.tags.forEach(tag => uniqueTags.add(tag));
        }

        // Enrichment statistics
        if (note.enrichments?.embedding?.length) {
            stats.enrichment_stats.notes_with_embeddings++;
        }
        if (note.enrichments?.keywords?.length) {
            stats.enrichment_stats.notes_with_keywords++;
            totalKeywords += note.enrichments.keywords.length;
        }
        if (note.enrichments?.sentiment) {
            stats.enrichment_stats.notes_with_sentiment++;
            const label = note.enrichments.sentiment.label;
            stats.enrichment_stats.sentiment_distribution[label] =
                (stats.enrichment_stats.sentiment_distribution[label] || 0) + 1;
        }
    });

    // Calculate averages and final statistics
    stats.average_note_length = totalLength / notes.length;
    stats.metadata_stats.unique_tags = uniqueTags.size;
    stats.metadata_stats.average_tags_per_note =
        stats.metadata_stats.total_tags / notes.length;
    stats.enrichment_stats.average_keywords_per_note =
        totalKeywords / notes.length;

    // Calculate cluster statistics
    const clusterSizes = Object.values(stats.notes_per_cluster);
    stats.cluster_stats.total_clusters = clusterSizes.length;
    stats.cluster_stats.average_notes_per_cluster =
        notes.length / stats.cluster_stats.total_clusters;
    stats.cluster_stats.largest_cluster_size = Math.max(...clusterSizes);
    stats.cluster_stats.smallest_cluster_size = Math.min(...clusterSizes);

    return stats;
}

export interface GenerationResult {
    notesPath: string;
    statisticsPath: string;
    statistics: DatasetStatistics;
}

/**
 * Generate the final dataset by orchestrating the entire process
 * @returns Promise containing paths to generated files and statistics
 * @throws Error if any step fails
 */
export async function generateFinalDataset(): Promise<GenerationResult> {
    try {
        // Create output directory
        const finalDir = path.join(process.cwd(), 'data', 'final');
        await ensureDirectory(finalDir);

        // Load data
        console.log('Loading enriched notes...');
        const enrichedNotes = await loadEnrichedNotes();
        console.log(`Loaded ${enrichedNotes.length} enriched notes`);

        console.log('Loading cluster assignments...');
        const clusterAssignments = await loadClusterAssignments();
        console.log('Loaded cluster assignments');

        // Merge notes with cluster assignments
        console.log('Merging notes with cluster assignments...');
        const notesWithClusters = mergeNotesWithClusters(enrichedNotes, clusterAssignments);
        console.log('Merged notes with cluster assignments');

        // Format notes into final structure
        console.log('Formatting notes into final structure...');
        const finalNotes = formatFinalNotes(notesWithClusters);
        console.log('Formatted notes');

        // Generate statistics
        console.log('Generating dataset statistics...');
        const statistics = generateSummaryStatistics(finalNotes);
        console.log('Generated statistics');

        // Save results
        const notesPath = path.join(finalDir, 'notes_final.json');
        const statisticsPath = path.join(finalDir, 'dataset_statistics.json');

        console.log('Saving final dataset...');
        await fs.promises.writeFile(
            notesPath,
            JSON.stringify(finalNotes, null, 2),
            'utf-8'
        );
        console.log(`Saved final notes to ${notesPath}`);

        console.log('Saving statistics...');
        await fs.promises.writeFile(
            statisticsPath,
            JSON.stringify(statistics, null, 2),
            'utf-8'
        );
        console.log(`Saved statistics to ${statisticsPath}`);

        return {
            notesPath,
            statisticsPath,
            statistics
        };
    } catch (error) {
        console.error('Error generating final dataset:', error);
        throw error;
    }
} 