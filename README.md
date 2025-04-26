# MCP Apple Notes

![MCP Apple Notes](./images/logo.png)

A [Model Context Protocol (MCP)](https://www.anthropic.com/news/model-context-protocol) server that enables semantic search and RAG (Retrieval Augmented Generation) over your Apple Notes. This allows AI assistants like Claude to search and reference your Apple Notes during conversations.

![MCP Apple Notes](./images/demo.png)

## Features

- 🔍 Semantic search over Apple Notes using [`all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) on-device embeddings model
- 📝 Full-text search capabilities
- 📊 Vector storage using [LanceDB](https://lancedb.github.io/lancedb/)
- 🤖 MCP-compatible server for AI assistant integration
- 🍎 Native Apple Notes integration via JXA
- 🏃‍♂️ Fully local execution - no API keys needed

## Prerequisites

- [Bun](https://bun.sh/docs/installation)
- [Claude Desktop](https://claude.ai/download)

## Installation

1. Clone the repository:

```bash
git clone https://github.com/RafalWilinski/mcp-apple-notes
cd mcp-apple-notes
```

2. Install dependencies:

```bash
bun install
```

## Usage

1. Open Claude desktop app and go to Settings -> Developer -> Edit Config

![Claude Desktop Settings](./images/desktop_settings.png)

2. Open the `claude_desktop_config.json` and add the following entry:

```json
{
  "mcpServers": {
    "local-machine": {
      "command": "/Users/<YOUR_USER_NAME>/.bun/bin/bun",
      "args": ["/Users/<YOUR_USER_NAME>/apple-notes-mcp/index.ts"]
    }
  }
}
```

Important: Replace `<YOUR_USER_NAME>` with your actual username.

3. Restart Claude desktop app. You should see this:

![Claude MCP Connection Status](./images/verify_installation.png)

4. Start by indexing your notes. Ask Claude to index your notes by saying something like: "Index my notes" or "Index my Apple Notes".

## Troubleshooting

To see logs:

```bash
tail -n 50 -f ~/Library/Logs/Claude/mcp-server-local-machine.log
# or
tail -n 50 -f ~/Library/Logs/Claude/mcp.log
```

## Todos

- [ ] Apple notes are returned in the HTML format. We should turn them to Markdown and embed that
- [ ] Chunk source content using recursive text splitter or markdown text splitter
- [ ] Add an option to use custom embeddings model
- [ ] More control over DB - purge, custom queries, etc.
- [x] Storing notes in Notes via Claude

## File Utilities Documentation

The application provides a comprehensive set of file utilities for managing data across different stages of processing. These utilities are organized into several modules, each with a specific focus:

### Directory Structure

The application uses a structured directory layout under the `data/` directory:

- `data/raw/` - Raw data from Apple Notes
- `data/enriched/` - Processed and enriched note data
- `data/clusters/` - Note clustering results
- `data/final/` - Final processed outputs

### Core Modules

#### FileManager (`src/utils/fileManager.ts`)

The `FileManager` class provides a unified interface for all file operations:

```typescript
// Initialize directory structure
await FileManager.initialize();

// Read JSON from a specific directory
const data = await FileManager.readJSONFromDirectory('RAW', 'notes.json');

// Write JSON safely (atomic operation)
await FileManager.writeJSONToDirectory(data, 'ENRICHED', 'processed.json', true);

// Generate unique filename
const filename = await FileManager.generateUniqueFilename('FINAL', 'report');

// List files matching a pattern
const files = await FileManager.listFilesInDirectory('CLUSTERS', /cluster-\d+/);
```

#### Directory Utilities (`src/utils/directory.ts`)

Functions for managing directories:

```typescript
import { ensureDirectory, ensureDirectoryStructure } from './utils/directory';

// Create a directory if it doesn't exist
await ensureDirectory('/path/to/dir');

// Ensure all required directories exist
await ensureDirectoryStructure();
```

#### JSON Utilities (`src/utils/json.ts`)

Functions for reading and writing JSON files:

```typescript
import { readJSON, writeJSON, updateJSON } from './utils/json';

// Read JSON file
const data = await readJSON<MyType>('file.json');

// Write JSON with pretty printing
await writeJSON(data, 'output.json', true);

// Update JSON atomically
await updateJSON('config.json', (data) => ({ ...data, updated: true }));
```

#### Path Utilities (`src/utils/paths.ts`)

Functions for handling file paths and names:

```typescript
import { 
    getFilePath,
    fileExists,
    generateTimestampedFilename 
} from './utils/paths';

// Get full path in a data directory
const path = getFilePath('RAW', 'notes.json');

// Check if file exists
const exists = await fileExists(path);

// Generate timestamped filename
const filename = generateTimestampedFilename('backup', '.json');
```

### Error Handling

The utilities provide custom error classes for better error handling:

- `JSONFileError` - For JSON file operation errors
- `PathError` - For path-related errors

Example error handling:

```typescript
try {
    await FileManager.readJSONFromDirectory('RAW', 'notes.json');
} catch (error) {
    if (error instanceof JSONFileError) {
        console.error('JSON file error:', error.message);
    } else if (error instanceof PathError) {
        console.error('Path error:', error.message);
    }
}
```

### Configuration

File-related configuration is centralized in `src/config.ts`:

```typescript
import { DIRECTORIES, FILE_CONFIG } from './config';

// Access directory paths
console.log(DIRECTORIES.RAW); // /path/to/data/raw

// Access file configuration
console.log(FILE_CONFIG.ENCODING); // utf-8
```

## Development

### Prerequisites

- Node.js 18 or higher
- TypeScript 5.0 or higher

### Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```

### Running Tests

```bash
npm test
```

## License

MIT
