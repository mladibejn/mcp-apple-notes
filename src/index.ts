import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as lancedb from "@lancedb/lancedb";
import { runJxa } from "run-jxa";
import path from "node:path";
import os from "node:os";
import TurndownService from "turndown";
import {
  EmbeddingFunction,
  LanceSchema,
  register,
} from "@lancedb/lancedb/embedding";
import { type Float, Float32, Utf8 } from "apache-arrow";
import { pipeline } from "@huggingface/transformers";
import { ensureDirectory } from "./utils/directory.js";
import { writeJSON } from "./utils/json.js";
import { DIRECTORIES } from "./config.js";
import type { Table, Data, AddDataOptions } from "@lancedb/lancedb";
import { CheckpointManager, ProcessingStage } from './utils/checkpoint';

const { turndown } = new TurndownService();
const db = await lancedb.connect(
  path.join(os.homedir(), ".mcp-apple-notes", "data")
);
const extractor = await pipeline(
  "feature-extraction",
  "Xenova/all-MiniLM-L6-v2"
);

@register("openai")
export class OnDeviceEmbeddingFunction extends EmbeddingFunction<string> {
  toJSON(): object {
    return {};
  }
  ndims() {
    return 384;
  }
  embeddingDataType(): Float {
    return new Float32();
  }
  async computeQueryEmbeddings(data: string) {
    const output = await extractor(data, { pooling: "mean" });
    return output.data as number[];
  }
  async computeSourceEmbeddings(data: string[]) {
    return await Promise.all(
      data.map(async (item) => {
        const output = await extractor(item, { pooling: "mean" });

        return output.data as number[];
      })
    );
  }
}

const log = (method: string, params: Record<string, unknown>) => {
  console.error(JSON.stringify({
    jsonrpc: "2.0",
    method: "progress",
    params: {
      timestamp: new Date().toISOString(),
      method,
      ...params
    }
  }));
};

const func = new OnDeviceEmbeddingFunction();

const notesTableSchema = LanceSchema({
  title: func.sourceField(new Utf8()),
  content: func.sourceField(new Utf8()),
  creation_date: func.sourceField(new Utf8()),
  modification_date: func.sourceField(new Utf8()),
  vector: func.vectorField(),
});

const QueryNotesSchema = z.object({
  query: z.string(),
});

const GetNoteSchema = z.object({
  title: z.string(),
});

const server = new Server(
  {
    name: "my-apple-notes-mcp",
    version: "1.0.0",
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
        name: "list-notes",
        description: "Lists just the titles of all my Apple Notes",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "index-notes",
        description:
          "Index all my Apple Notes for Semantic Search. Please tell the user that the sync takes couple of seconds up to couple of minutes depending on how many notes you have.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "get-note",
        description: "Get a note full content and details by title",
        inputSchema: {
          type: "object",
          properties: {
            title: z.string(),
          },
          required: ["title"],
        },
      },
      {
        name: "search-notes",
        description: "Search for notes by title or content",
        inputSchema: {
          type: "object",
          properties: {
            query: z.string(),
          },
          required: ["query"],
        },
      },
      {
        name: "create-note",
        description:
          "Create a new Apple Note with specified title and content. Must be in HTML format WITHOUT newlines",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            content: { type: "string" },
          },
          required: ["title", "content"],
        },
      },
    ],
  };
});

const getNotes = async () => {
  const getNotesChunk = async (offset: number, limit: number) => {
    return await runJxa(`
      const app = Application('Notes');
      app.includeStandardAdditions = true;
      const notes = Array.from(app.notes());
      const chunk = notes.slice(${offset}, ${offset + limit});
      const titles = chunk.map(note => note.name());
      return titles;
    `);
  };

  const CHUNK_SIZE = 500;
  let allNotes: string[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    log("get-notes.progress", {
      status: "processing",
      message: `Fetching notes chunk starting at offset ${offset}`,
      currentOffset: offset
    });

    const chunk = await getNotesChunk(offset, CHUNK_SIZE);
    allNotes = [...allNotes, ...(chunk as string[])];

    if ((chunk as string[]).length < CHUNK_SIZE) {
      hasMore = false;
    } else {
      offset += CHUNK_SIZE;
    }
  }

  log("get-notes.progress", {
    status: "completed",
    message: "Notes fetched successfully",
    notes: allNotes.length
  });

  return allNotes;
};

const getNoteDetailsByTitle = async (title: string) => {
  const note = await runJxa(
    `const app = Application('Notes');
    const title = "${title}"
    
    try {
        const note = app.notes.whose({name: title})[0];
        if (!note) {
            return "{}";
        }
        
        const noteInfo = {
            title: note?.name() || "",
            content: note?.body() || "",
            creation_date: note?.creationDate()?.toLocaleString() || "",
            modification_date: note?.modificationDate()?.toLocaleString() || ""
        };
        
        return JSON.stringify(noteInfo);
    } catch (error) {
        return "{}";
    }`
  );

  return JSON.parse(note as string) as {
    title: string;
    content: string;
    creation_date: string;
    modification_date: string;
  };
};

interface NoteChunk {
  id: string;
  title: string;
  content: string;
  creation_date: string;
  modification_date: string;
  folder?: string;
  attachments?: string[];
}

// Make NoteChunk compatible with Record<string, unknown>
type NoteData = NoteChunk & Record<string, unknown>;

interface NotesTable extends Table {
  add(data: NoteData[], options?: Partial<AddDataOptions>): Promise<void>;
}

export const indexNotes = async (notesTable: Table) => {
  const start = performance.now();
  let report = "";
  let allNotes: string[] = [];
  let allChunks: NoteChunk[] = [];
  let processedChunks = 0;

  // Initialize checkpoint manager
  const checkpointManager = new CheckpointManager();
  await checkpointManager.initialize(allNotes.length);

  try {
    // Ensure raw directory exists
    await ensureDirectory(DIRECTORIES.RAW);

    // Get all notes
    allNotes = (await getNotes()) || [];
    const CHUNK_SIZE = 100;
    const totalChunks = Math.ceil(allNotes.length / CHUNK_SIZE);

    // Initialize or resume checkpoint
    await checkpointManager.startStage(ProcessingStage.RAW_EXPORT);
    const nextNoteId = checkpointManager.getNextNoteForStage(ProcessingStage.RAW_EXPORT);
    const startIndex = nextNoteId ? Number.parseInt(nextNoteId) + 1 : 0;

    // Send initial progress
    log("index-notes.progress", {
      status: "starting",
      message: `Starting to process ${allNotes.length} notes in ${totalChunks} chunks from index ${startIndex}`,
      total: allNotes.length,
      chunkSize: CHUNK_SIZE,
      resuming: startIndex > 0
    });

    // Process notes in chunks
    for (let i = startIndex; i < allNotes.length; i += CHUNK_SIZE) {
      try {
        const currentChunk = allNotes.slice(i, i + CHUNK_SIZE);

        // Send chunk progress
        log("index-notes.progress", {
          status: "processing",
          message: `Processing chunk ${processedChunks + 1} of ${totalChunks}`,
          currentChunk: processedChunks + 1,
          totalChunks,
          notesInChunk: currentChunk.length
        });

        // Process current chunk
        const notesDetails = await Promise.all(
          currentChunk.map((note) => {
            try {
              return getNoteDetailsByTitle(note);
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              report += `Error getting note details for ${note}: ${errorMessage}\n`;
              log("index-notes.error", {
                status: "error",
                message: `Failed to get note details for ${note}`,
                error: errorMessage
              });
              return null;
            }
          })
        );

        const chunkResults: NoteData[] = notesDetails
          .filter((n): n is NonNullable<typeof n> => n !== null)
          .map((node) => {
            try {
              return {
                ...node,
                content: turndown(node?.content || ""),
              };
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              report += `Error processing note ${node?.title}: ${errorMessage}\n`;
              log("index-notes.error", {
                status: "error",
                message: `Failed to process note ${node?.title}`,
                error: errorMessage,
                node,
              });
              return node;
            }
          })
          .filter((note) => note !== null)
          .map((note, index) => ({
            id: `${i + index}`,
            title: note.title,
            content: note.content,
            creation_date: note.creation_date,
            modification_date: note.modification_date,
          } as NoteData));

        // Save each note to a file in the raw directory
        await Promise.all(
          chunkResults.map(async (note) => {
            try {
              const filename = `note-${note.id}.json`;
              await writeJSON(note, path.join(DIRECTORIES.RAW, filename));
              // Update checkpoint for each note
              await checkpointManager.updateNoteProgress(ProcessingStage.RAW_EXPORT, note.id, true);
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              report += `Error saving note ${note.id} to file: ${errorMessage}\n`;
              log("index-notes.error", {
                status: "error",
                message: `Failed to save note ${note.id} to file`,
                error: errorMessage
              });
            }
          })
        );

        // Add current chunk to database
        await notesTable.add(chunkResults);
        allChunks = [...allChunks, ...chunkResults];
        processedChunks++;

        // Send chunk completion progress with checkpoint info
        const progress = await checkpointManager.getStageProgress(ProcessingStage.RAW_EXPORT);
        log("index-notes.progress", {
          status: "chunk-complete",
          message: `Completed chunk ${processedChunks} of ${totalChunks}`,
          currentChunk: processedChunks,
          totalChunks,
          notesProcessed: allChunks.length,
          notesSaved: allChunks.length,
          progress
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        report += `Error processing chunk ${processedChunks + 1}: ${errorMessage}\n`;
        log("index-notes.error", {
          status: "error",
          message: `Failed to process chunk ${processedChunks + 1}`,
          error: errorMessage
        });
        // Continue with next chunk
        processedChunks++;
      }
    }

    // Complete the stage
    await checkpointManager.completeStage(ProcessingStage.RAW_EXPORT);

    // Send final progress
    const finalProgress = await checkpointManager.getStageProgress(ProcessingStage.RAW_EXPORT);
    log("index-notes.progress", {
      status: "completed",
      message: "All chunks processed and saved successfully",
      totalProcessed: allChunks.length,
      time: performance.now() - start,
      progress: finalProgress
    });

    return {
      chunks: allChunks.length,
      report,
      allNotes: allNotes.length,
      time: performance.now() - start,
      progress: finalProgress
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    // Mark stage as failed in checkpoint
    await checkpointManager.failStage(ProcessingStage.RAW_EXPORT, errorMessage);

    log("index-notes.error", {
      status: "fatal",
      message: "Fatal error during indexing",
      error: errorMessage
    });
    throw new Error(`Failed to index notes: ${errorMessage}`);
  }
};

export const createNotesTable = async (overrideName?: string) => {
  const start = performance.now();
  const notesTable = await db.createEmptyTable(
    overrideName || "notes",
    notesTableSchema,
    {
      mode: "create",
      existOk: true,
    }
  );

  const indices = await notesTable.listIndices();
  if (!indices.find((index) => index.name === "content_idx")) {
    await notesTable.createIndex("content", {
      config: lancedb.Index.fts(),
      replace: true,
    });
  }
  return { notesTable, time: performance.now() - start };
};

const createNote = async (title: string, content: string) => {
  // Escape special characters and convert newlines to \n
  const escapedTitle = title.replace(/[\\'"]/g, "\\$&");
  const escapedContent = content
    .replace(/[\\'"]/g, "\\$&")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");

  await runJxa(`
    const app = Application('Notes');
    const note = app.make({new: 'note', withProperties: {
      name: "${escapedTitle}",
      body: "${escapedContent}"
    }});
    
    return true
  `);

  return true;
};

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request, c) => {
  const { notesTable } = await createNotesTable();
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "create-note": {
        const { title, content } = CreateNoteSchema.parse(args);
        await createNote(title, content);
        return createTextResponse(`Created note "${title}" successfully.`);
      }
      case "list-notes":
        return createTextResponse(`There are ${await notesTable.countRows()} notes in your Apple Notes database.`);
      case "get-note": {
        const { title } = GetNoteSchema.parse(args);
        const note = await getNoteDetailsByTitle(title);
        return createTextResponse(JSON.stringify(note));
      }
      case "index-notes": {
        const { time, chunks } = await indexNotes(notesTable);
        return createTextResponse(`Indexed ${chunks} notes in ${time}ms. You can now search for them using the "search-notes" tool.`);
      }
      case "search-notes": {
        const { query } = QueryNotesSchema.parse(args);
        const results = await searchAndCombineResults(notesTable, query);
        return createTextResponse(JSON.stringify(results));
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid arguments: ${error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", ")}`);
    }
    throw error;
  }
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Local Machine MCP Server running on stdio");

const createTextResponse = (text: string) => ({
  content: [{ type: "text", text }],
});

/**
 * Search for notes by title or content using both vector and FTS search.
 * The results are combined using RRF
 */
export const searchAndCombineResults = async (
  notesTable: lancedb.Table,
  query: string,
  limit = 20
) => {
  const [vectorResults, ftsSearchResults] = await Promise.all([
    (async () => {
      const results = await notesTable
        .search(query, "vector")
        .limit(limit)
        .toArray();
      return results;
    })(),
    (async () => {
      const results = await notesTable
        .search(query, "fts", "content")
        .limit(limit)
        .toArray();
      return results;
    })(),
  ]);

  const k = 60;
  const scores = new Map<string, number>();

  const processResults = (results: NoteData[], startRank: number) => {
    results.forEach((result, idx) => {
      const key = `${result.title}::${result.content}`;
      const score = 1 / (k + startRank + idx);
      scores.set(key, (scores.get(key) || 0) + score);
    });
  };

  processResults(vectorResults, 0);
  processResults(ftsSearchResults, 0);

  const results = Array.from(scores.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([key]) => {
      const [title, content] = key.split("::");
      return { title, content };
    });

  return results;
};

const CreateNoteSchema = z.object({
  title: z.string(),
  content: z.string(),
});