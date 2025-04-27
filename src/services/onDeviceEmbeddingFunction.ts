import { EmbeddingFunction, register } from '@lancedb/lancedb/embedding';
import { type Float, Float32 } from 'apache-arrow';

// The extractor must be passed in or imported from a shared location if needed
// For now, this file will export only the class definition

@register('openai')
export class OnDeviceEmbeddingFunction extends EmbeddingFunction<string> {
  extractor: any;
  constructor(extractor: any) {
    super();
    this.extractor = extractor;
  }
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
    const output = await this.extractor(data, { pooling: 'mean' });
    return output.data as number[];
  }
  async computeSourceEmbeddings(data: string[]) {
    return await Promise.all(
      data.map(async (item) => {
        const output = await this.extractor(item, { pooling: 'mean' });
        return output.data as number[];
      })
    );
  }
}
