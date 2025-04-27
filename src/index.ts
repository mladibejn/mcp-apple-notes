import os from 'node:os';
import path from 'node:path';
import { pipeline } from '@huggingface/transformers';
import * as lancedb from '@lancedb/lancedb';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { config } from './config';
import { sanitizeRawNotes } from './services/dataManagement';
import { EnrichmentService } from './services/enrichment';
import { log } from './services/logging';
import { NotesService, createNotesTableSchema } from './services/notes';
import { OnDeviceEmbeddingFunction } from './services/onDeviceEmbeddingFunction';
import { CheckpointManager } from './utils/checkpoint';

const db = await lancedb.connect(path.join(os.homedir(), '.mcp-apple-notes', 'data'));
const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

const func = new OnDeviceEmbeddingFunction(extractor);
const notesTableSchema = createNotesTableSchema(func);

// Initialize services
const checkpointManager = new CheckpointManager();
const notesService = new NotesService({
  db,
  checkpointManager,
  notesTableSchema,
});

const server = new Server(
  {
    name: 'my-apple-notes-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list-notes',
        description: 'Lists just the titles of all my Apple Notes',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'index-notes',
        description:
          'Index all my Apple Notes for Semantic Search. Please tell the user that the sync takes couple of seconds up to couple of minutes depending on how many notes you have.',
        inputSchema: {
          type: 'object',
          properties: {
            testMode: {
              type: 'boolean',
              description: 'If true, only process the first 100 notes (for testing)',
            },
          },
          required: [],
        },
      },
      {
        name: 'get-note',
        description: 'Get a note full content and details by title',
        inputSchema: {
          type: 'object',
          properties: {
            title: z.string(),
          },
          required: ['title'],
        },
      },
      {
        name: 'search-notes',
        description: 'Search for notes by title or content',
        inputSchema: {
          type: 'object',
          properties: {
            query: z.string(),
          },
          required: ['query'],
        },
      },
      {
        name: 'create-note',
        description:
          'Create a new Apple Note with specified title and content. Must be in HTML format WITHOUT newlines',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['title', 'content'],
        },
      },
      {
        name: 'sanitize-html',
        description:
          'Sanitize all raw notes in data/raw by converting HTML to Markdown. Moves original content to rawContent and saves Markdown as content.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'enrich-notes',
        description:
          'Process notes through the enrichment pipeline to generate summaries, tags, and embeddings.',
        inputSchema: {
          type: 'object',
          properties: {
            batchSize: {
              type: 'number',
              description: 'Number of notes to process in each batch (default: 5, min: 1, max: 20)',
              minimum: 1,
              maximum: 20,
            },
            parallelLimit: {
              type: 'number',
              description: 'Maximum number of parallel API calls (default: 3, min: 1, max: 5)',
              minimum: 1,
              maximum: 5,
            },
          },
          required: [],
        },
      },
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request, _c) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'create-note': {
        const { title, content } = CreateNoteSchema.parse(args);
        await notesService.createNote(title, content);
        return createTextResponse(`Created note "${title}" successfully.`);
      }
      case 'list-notes':
        return createTextResponse(
          `There are ${await notesService.getNotesCount()} notes in your Apple Notes database.`
        );
      case 'get-note': {
        const { title } = GetNoteSchema.parse(args);
        const note = await notesService.getNoteDetailsByTitle(title);
        return createTextResponse(JSON.stringify(note));
      }
      case 'index-notes': {
        const testMode = args?.testMode === true;
        const { time, chunks } = await notesService.indexNotes(testMode);
        return createTextResponse(
          `Indexed ${chunks} notes in ${time}ms${testMode ? ' (test mode - first 100 notes only)' : ''}. You can now search for them using the "search-notes" tool.`
        );
      }
      case 'search-notes': {
        const { query } = QueryNotesSchema.parse(args);
        const results = await notesService.searchNotes(query);
        return createTextResponse(JSON.stringify(results));
      }
      case 'sanitize-html': {
        await sanitizeRawNotes();
        return createTextResponse('Sanitized all raw notes in data/raw.');
      }
      case 'enrich-notes': {
        const {
          batchSize = config.PROCESSING_CONFIG.BATCH_SIZE,
          parallelLimit = config.PROCESSING_CONFIG.PARALLEL_LIMIT,
        } = EnrichNotesSchema.parse(args);
        try {
          // Initialize enrichment service
          const enrichmentService = new EnrichmentService(checkpointManager);

          // Get all notes from raw directory
          const rawNotes = await notesService.getAllRawNotes();
          if (rawNotes.length === 0) {
            throw new Error('No raw notes found to process. Please run index-notes first.');
          }

          log('enrich-notes.info', {
            message: `Starting enrichment process for ${rawNotes.length} notes`,
            batchSize,
            parallelLimit,
          });

          // Process notes through enrichment pipeline
          const result = await enrichmentService.processNotes(rawNotes, batchSize, parallelLimit);

          // Generate detailed response
          const successRate = ((result.processedCount / rawNotes.length) * 100).toFixed(1);
          const errorDetails =
            result.errors.length > 0
              ? `\nFailed notes:\n${result.errors.map((e) => `- ${e.noteId}: ${e.error}`).join('\n')}`
              : '';

          const response = [
            `Enrichment process completed in ${(result.totalTime / 1000).toFixed(1)}s`,
            `Successfully processed ${result.processedCount} out of ${rawNotes.length} notes (${successRate}%)`,
            `Notes are saved in ${config.DIRECTORIES.ENRICHED}`,
            errorDetails,
          ]
            .filter(Boolean)
            .join('\n');

          return createTextResponse(response);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          log('enrich-notes.error', {
            status: 'error',
            message: 'Enrichment process failed',
            error: errorMessage,
          });
          throw new Error(`Failed to enrich notes: ${errorMessage}`);
        }
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid arguments: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
      );
    }
    throw error;
  }
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Local Machine MCP Server running on stdio');

const createTextResponse = (text: string) => ({
  content: [{ type: 'text', text }],
});

// Import schemas at the end to avoid circular dependencies
const { CreateNoteSchema, GetNoteSchema, QueryNotesSchema, EnrichNotesSchema } = await import(
  './services/notes'
);
