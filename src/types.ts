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
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}
