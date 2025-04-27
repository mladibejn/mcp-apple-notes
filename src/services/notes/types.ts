import type { Connection, Table } from '@lancedb/lancedb';
import { z } from 'zod';
import type { CheckpointManager } from '../../utils/checkpoint';

export interface Note {
  id: string;
  title: string;
  content: string;
  rawContent?: string;
  creation_date: string;
  modification_date: string;
  folder?: string;
  attachments?: string[];
}

export interface NoteData extends Note, Record<string, unknown> {}

export interface NotesServiceConfig {
  db: Connection;
  checkpointManager: CheckpointManager;
  notesTableSchema: any; // We'll type this properly later
}

export const CreateNoteSchema = z.object({
  title: z.string(),
  content: z.string(),
});

export const GetNoteSchema = z.object({
  title: z.string(),
});

export const QueryNotesSchema = z.object({
  query: z.string(),
});

export const EnrichNotesSchema = z.object({
  batchSize: z.number().min(1).max(20).default(5),
  parallelLimit: z.number().min(1).max(5).default(3),
});
