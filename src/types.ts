export interface Note {
  id: string;
  title: string;
  content: string;
  creation_date: string;
  modification_date: string;
}

export interface EnrichedNote extends Note {
  summary: string;
  tags: string[];
  embedding: number[];
  enrichedAt: string;
}

export interface Logger {
  debug(message: string): Promise<void>;
  info(message: string): Promise<void>;
  warn(message: string): Promise<void>;
  error(message: string, error?: unknown): Promise<void>;
  forComponent(component: string): Logger;
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * Maps note IDs to their assigned cluster IDs
 * @example { "note1": 0, "note2": 1, "note3": 2 }
 */
export type ClusterAssignments = {
  [noteId: string]: number;
};
