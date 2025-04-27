import { LanceSchema } from '@lancedb/lancedb/embedding';
import { Utf8 } from 'apache-arrow';
import type { OnDeviceEmbeddingFunction } from '../onDeviceEmbeddingFunction';

export const createNotesTableSchema = (func: OnDeviceEmbeddingFunction) =>
  LanceSchema({
    title: func.sourceField(new Utf8()),
    content: func.sourceField(new Utf8()),
    creation_date: func.sourceField(new Utf8()),
    modification_date: func.sourceField(new Utf8()),
    vector: func.vectorField(),
  });
