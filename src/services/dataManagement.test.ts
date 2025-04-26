import fs from 'node:fs';
import path from 'node:path';
import { loadEnrichedNotes, loadClusterAssignments, mergeNotesWithClusters, formatFinalNotes, generateSummaryStatistics, generateFinalDataset } from './dataManagement';
import type { EnrichedNote, ClusterAssignments } from '../types';

jest.mock('node:fs');
jest.mock('node:path');

describe('dataManagement', () => {
    const mockCwd = '/mock/cwd';
    const mockEnrichedNotes: EnrichedNote[] = [
        { id: '1', content: 'Note 1', metadata: {}, enrichments: {} },
        { id: '2', content: 'Note 2', metadata: {}, enrichments: {} },
    ];
    const mockClusterAssignments: ClusterAssignments = {
        '1': 0,
        '2': 1,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (path.join as jest.Mock).mockImplementation((...args) => args.join('/'));
        (process.cwd as jest.Mock).mockReturnValue(mockCwd);
    });

    describe('loadEnrichedNotes', () => {
        it('should load and validate enriched notes successfully', async () => {
            const mockReadFile = fs.promises.readFile as jest.Mock;
            mockReadFile.mockResolvedValueOnce(JSON.stringify(mockEnrichedNotes));

            const result = await loadEnrichedNotes();
            expect(result).toEqual(mockEnrichedNotes);
            expect(mockReadFile).toHaveBeenCalledWith(
                `${mockCwd}/data/processed/notes_enriched.json`,
                'utf-8'
            );
        });

        it('should throw error if file not found', async () => {
            const mockError = new Error('File not found');
            (mockError as NodeJS.ErrnoException).code = 'ENOENT';
            const mockReadFile = fs.promises.readFile as jest.Mock;
            mockReadFile.mockRejectedValueOnce(mockError);

            await expect(loadEnrichedNotes()).rejects.toThrow(
                'Enriched notes file not found'
            );
        });

        it('should throw error if notes are not in array format', async () => {
            const mockReadFile = fs.promises.readFile as jest.Mock;
            mockReadFile.mockResolvedValueOnce(JSON.stringify({ notAnArray: true }));

            await expect(loadEnrichedNotes()).rejects.toThrow(
                'Enriched notes data is not in the expected array format'
            );
        });

        it('should throw error if note is missing required fields', async () => {
            const mockReadFile = fs.promises.readFile as jest.Mock;
            mockReadFile.mockResolvedValueOnce(
                JSON.stringify([{ id: '1' /* missing content */ }])
            );

            await expect(loadEnrichedNotes()).rejects.toThrow(
                'Invalid note structure at index 0: missing required fields'
            );
        });
    });

    describe('loadClusterAssignments', () => {
        it('should load and validate cluster assignments successfully', async () => {
            const mockReadFile = fs.promises.readFile as jest.Mock;
            mockReadFile.mockResolvedValueOnce(JSON.stringify(mockClusterAssignments));

            const result = await loadClusterAssignments();
            expect(result).toEqual(mockClusterAssignments);
            expect(mockReadFile).toHaveBeenCalledWith(
                `${mockCwd}/data/processed/cluster_assignments.json`,
                'utf-8'
            );
        });

        it('should throw error if file not found', async () => {
            const mockError = new Error('File not found');
            (mockError as NodeJS.ErrnoException).code = 'ENOENT';
            const mockReadFile = fs.promises.readFile as jest.Mock;
            mockReadFile.mockRejectedValueOnce(mockError);

            await expect(loadClusterAssignments()).rejects.toThrow(
                'Cluster assignments file not found'
            );
        });

        it('should throw error if assignments are not in object format', async () => {
            const mockReadFile = fs.promises.readFile as jest.Mock;
            mockReadFile.mockResolvedValueOnce(JSON.stringify([1, 2, 3]));

            await expect(loadClusterAssignments()).rejects.toThrow(
                'Cluster assignments data is not in the expected object format'
            );
        });

        it('should throw error if cluster ID is not a number', async () => {
            const mockReadFile = fs.promises.readFile as jest.Mock;
            mockReadFile.mockResolvedValueOnce(
                JSON.stringify({ '1': '0' /* string instead of number */ })
            );

            await expect(loadClusterAssignments()).rejects.toThrow(
                'Invalid cluster ID for note 1: expected number, got string'
            );
        });
    });

    describe('mergeNotesWithClusters', () => {
        const mockNotes: EnrichedNote[] = [
            { id: '1', content: 'Note 1', metadata: {}, enrichments: {} },
            { id: '2', content: 'Note 2', metadata: {}, enrichments: {} },
            { id: '3', content: 'Note 3', metadata: {}, enrichments: {} }, // No cluster assignment
        ];

        const mockAssignments: ClusterAssignments = {
            '1': 0,
            '2': 1,
        };

        beforeEach(() => {
            jest.spyOn(console, 'warn').mockImplementation(() => { });
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        it('should merge notes with cluster assignments correctly', () => {
            const result = mergeNotesWithClusters(mockNotes, mockAssignments);

            expect(result).toHaveLength(3);
            expect(result[0]).toEqual({
                ...mockNotes[0],
                cluster_id: 0,
            });
            expect(result[1]).toEqual({
                ...mockNotes[1],
                cluster_id: 1,
            });
        });

        it('should use default cluster ID (-1) for notes without assignments', () => {
            const result = mergeNotesWithClusters(mockNotes, mockAssignments);

            expect(result[2]).toEqual({
                ...mockNotes[2],
                cluster_id: -1,
            });
        });

        it('should log warning for notes without cluster assignments', () => {
            mergeNotesWithClusters(mockNotes, mockAssignments);

            expect(console.warn).toHaveBeenCalledWith(
                'No cluster assignment found for note 3, using default cluster ID -1'
            );
        });

        it('should handle empty notes array', () => {
            const result = mergeNotesWithClusters([], mockAssignments);
            expect(result).toEqual([]);
        });

        it('should handle empty assignments object', () => {
            const result = mergeNotesWithClusters(mockNotes, {});

            expect(result).toHaveLength(3);
            result.forEach(note => {
                expect(note.cluster_id).toBe(-1);
            });
            expect(console.warn).toHaveBeenCalledTimes(3);
        });
    });

    describe('formatFinalNotes', () => {
        const mockDate = '2024-04-26T12:00:00.000Z';
        const mockNoteWithCluster = {
            id: '1',
            content: 'Test note',
            cluster_id: 0,
            metadata: {
                title: 'Test Title',
                created_at: '2024-04-25T12:00:00.000Z',
                updated_at: '2024-04-25T13:00:00.000Z',
                tags: ['test', 'note']
            },
            enrichments: {
                embedding: [0.1, 0.2, 0.3],
                keywords: ['test', 'example'],
                sentiment: {
                    score: 0.8,
                    label: 'positive'
                }
            }
        };

        beforeEach(() => {
            jest.useFakeTimers();
            jest.setSystemTime(new Date(mockDate));
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('should format notes correctly with all fields present', () => {
            const result = formatFinalNotes([mockNoteWithCluster]);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual(mockNoteWithCluster);
        });

        it('should add default values for missing optional fields', () => {
            const minimalNote = {
                id: '1',
                content: 'Minimal note',
                cluster_id: 0,
                metadata: {},
                enrichments: {}
            };

            const result = formatFinalNotes([minimalNote]);

            expect(result[0]).toEqual({
                id: '1',
                content: 'Minimal note',
                cluster_id: 0,
                metadata: {
                    created_at: mockDate,
                    updated_at: mockDate,
                    tags: []
                },
                enrichments: {
                    embedding: [],
                    keywords: [],
                    sentiment: {
                        score: 0,
                        label: 'neutral'
                    }
                }
            });
        });

        it('should throw error if note is missing required fields', () => {
            const invalidNote = {
                cluster_id: 0,
                metadata: {},
                enrichments: {}
            } as any;

            expect(() => formatFinalNotes([invalidNote])).toThrow(
                'Note at index 0 is missing required fields (id, content)'
            );
        });

        it('should preserve additional metadata and enrichment fields', () => {
            const noteWithExtra = {
                ...mockNoteWithCluster,
                metadata: {
                    ...mockNoteWithCluster.metadata,
                    customField: 'custom value'
                },
                enrichments: {
                    ...mockNoteWithCluster.enrichments,
                    extraEnrichment: {
                        data: 'extra data'
                    }
                }
            };

            const result = formatFinalNotes([noteWithExtra]);

            expect(result[0].metadata.customField).toBe('custom value');
            expect(result[0].enrichments.extraEnrichment).toEqual({
                data: 'extra data'
            });
        });

        it('should handle empty arrays', () => {
            const result = formatFinalNotes([]);
            expect(result).toEqual([]);
        });

        it('should process multiple notes correctly', () => {
            const notes = [
                mockNoteWithCluster,
                {
                    id: '2',
                    content: 'Another note',
                    cluster_id: 1,
                    metadata: {},
                    enrichments: {}
                }
            ];

            const result = formatFinalNotes(notes);

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual(mockNoteWithCluster);
            expect(result[1].metadata.tags).toEqual([]);
            expect(result[1].enrichments.keywords).toEqual([]);
        });
    });

    describe('generateSummaryStatistics', () => {
        const mockNotes = [
            {
                id: '1',
                content: 'Test note 1',
                cluster_id: 0,
                metadata: {
                    title: 'Note 1',
                    tags: ['test', 'first']
                },
                enrichments: {
                    embedding: [0.1, 0.2],
                    keywords: ['test', 'note'],
                    sentiment: {
                        score: 0.8,
                        label: 'positive'
                    }
                }
            },
            {
                id: '2',
                content: 'Test note 2',
                cluster_id: 0,
                metadata: {
                    title: 'Note 2',
                    tags: ['test', 'second']
                },
                enrichments: {
                    embedding: [0.3, 0.4],
                    keywords: ['another', 'note'],
                    sentiment: {
                        score: 0.2,
                        label: 'negative'
                    }
                }
            },
            {
                id: '3',
                content: 'Test note 3',
                cluster_id: 1,
                metadata: {
                    tags: ['test']
                },
                enrichments: {
                    keywords: ['third', 'note'],
                    sentiment: {
                        score: 0.5,
                        label: 'neutral'
                    }
                }
            }
        ];

        it('should calculate basic statistics correctly', () => {
            const stats = generateSummaryStatistics(mockNotes);

            expect(stats.total_notes).toBe(3);
            expect(stats.average_note_length).toBe(
                (mockNotes[0].content.length + mockNotes[1].content.length + mockNotes[2].content.length) / 3
            );
        });

        it('should calculate cluster statistics correctly', () => {
            const stats = generateSummaryStatistics(mockNotes);

            expect(stats.notes_per_cluster).toEqual({ 0: 2, 1: 1 });
            expect(stats.cluster_stats).toEqual({
                total_clusters: 2,
                average_notes_per_cluster: 1.5,
                largest_cluster_size: 2,
                smallest_cluster_size: 1
            });
        });

        it('should calculate metadata statistics correctly', () => {
            const stats = generateSummaryStatistics(mockNotes);

            expect(stats.metadata_stats).toEqual({
                notes_with_title: 2,
                notes_with_tags: 3,
                total_tags: 5,
                unique_tags: 3, // test, first, second
                average_tags_per_note: 5 / 3
            });
        });

        it('should calculate enrichment statistics correctly', () => {
            const stats = generateSummaryStatistics(mockNotes);

            expect(stats.enrichment_stats).toEqual({
                notes_with_embeddings: 2,
                notes_with_keywords: 3,
                notes_with_sentiment: 3,
                sentiment_distribution: {
                    positive: 1,
                    negative: 1,
                    neutral: 1
                },
                average_keywords_per_note: 2
            });
        });

        it('should handle empty dataset', () => {
            const stats = generateSummaryStatistics([]);

            expect(stats).toEqual({
                total_notes: 0,
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
                    smallest_cluster_size: 0
                }
            });
        });

        it('should handle notes with missing optional fields', () => {
            const minimalNotes = [
                {
                    id: '1',
                    content: 'Test',
                    cluster_id: 0,
                    metadata: {},
                    enrichments: {}
                }
            ];

            const stats = generateSummaryStatistics(minimalNotes);

            expect(stats.metadata_stats.notes_with_title).toBe(0);
            expect(stats.metadata_stats.notes_with_tags).toBe(0);
            expect(stats.enrichment_stats.notes_with_embeddings).toBe(0);
            expect(stats.enrichment_stats.notes_with_keywords).toBe(0);
            expect(stats.enrichment_stats.notes_with_sentiment).toBe(0);
        });
    });

    describe('generateFinalDataset', () => {
        const mockEnrichedNotes = [
            {
                id: '1',
                content: 'Note 1',
                metadata: { title: 'First Note' },
                enrichments: { keywords: ['test'] }
            }
        ];

        const mockClusterAssignments = {
            '1': 0
        };

        beforeEach(() => {
            jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
            jest.spyOn(path, 'join').mockImplementation((...args) => args.join('/'));
            jest.spyOn(process, 'cwd').mockReturnValue('/mock/cwd');
            jest.spyOn(console, 'log').mockImplementation(() => { });
            jest.spyOn(console, 'error').mockImplementation(() => { });
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        it('should orchestrate the entire process successfully', async () => {
            // Mock all the component functions
            const mockLoadEnrichedNotes = jest.spyOn(
                { loadEnrichedNotes },
                'loadEnrichedNotes'
            ).mockResolvedValue(mockEnrichedNotes);

            const mockLoadClusterAssignments = jest.spyOn(
                { loadClusterAssignments },
                'loadClusterAssignments'
            ).mockResolvedValue(mockClusterAssignments);

            const result = await generateFinalDataset();

            // Verify all steps were called
            expect(mockLoadEnrichedNotes).toHaveBeenCalled();
            expect(mockLoadClusterAssignments).toHaveBeenCalled();

            // Verify output files were written
            expect(fs.promises.writeFile).toHaveBeenCalledTimes(2);
            expect(fs.promises.writeFile).toHaveBeenCalledWith(
                '/mock/cwd/data/final/notes_final.json',
                expect.any(String),
                'utf-8'
            );
            expect(fs.promises.writeFile).toHaveBeenCalledWith(
                '/mock/cwd/data/final/dataset_statistics.json',
                expect.any(String),
                'utf-8'
            );

            // Verify return value structure
            expect(result).toEqual({
                notesPath: '/mock/cwd/data/final/notes_final.json',
                statisticsPath: '/mock/cwd/data/final/dataset_statistics.json',
                statistics: expect.any(Object)
            });
        });

        it('should handle errors during the process', async () => {
            const mockError = new Error('Failed to load notes');
            jest.spyOn(
                { loadEnrichedNotes },
                'loadEnrichedNotes'
            ).mockRejectedValue(mockError);

            await expect(generateFinalDataset()).rejects.toThrow('Failed to load notes');
            expect(console.error).toHaveBeenCalledWith(
                'Error generating final dataset:',
                mockError
            );
        });

        it('should create output directory if it does not exist', async () => {
            const mockEnsureDirectory = jest.fn();
            jest.mock('../utils/fileUtils', () => ({
                ensureDirectory: mockEnsureDirectory
            }));

            await generateFinalDataset();

            expect(mockEnsureDirectory).toHaveBeenCalledWith('/mock/cwd/data/final');
        });

        it('should log progress messages', async () => {
            jest.spyOn(
                { loadEnrichedNotes },
                'loadEnrichedNotes'
            ).mockResolvedValue(mockEnrichedNotes);
            jest.spyOn(
                { loadClusterAssignments },
                'loadClusterAssignments'
            ).mockResolvedValue(mockClusterAssignments);

            await generateFinalDataset();

            expect(console.log).toHaveBeenCalledWith('Loading enriched notes...');
            expect(console.log).toHaveBeenCalledWith('Loading cluster assignments...');
            expect(console.log).toHaveBeenCalledWith('Merging notes with cluster assignments...');
            expect(console.log).toHaveBeenCalledWith('Formatting notes into final structure...');
            expect(console.log).toHaveBeenCalledWith('Generating dataset statistics...');
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Saved final notes to'));
            expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Saved statistics to'));
        });
    });
}); 