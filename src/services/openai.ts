import OpenAI from 'openai';
import { config } from '../config';

// Rate limiting configuration
const RATE_LIMITS = {
    COMPLETIONS: {
        REQUESTS_PER_MINUTE: 60,
        TOKENS_PER_MINUTE: 90000,
    },
    EMBEDDINGS: {
        REQUESTS_PER_MINUTE: 1000,
        TOKENS_PER_MINUTE: 150000,
    },
} as const;

// Retry configuration
const RETRY_CONFIG = {
    MAX_RETRIES: 3,
    INITIAL_RETRY_DELAY: 1000, // 1 second
    MAX_RETRY_DELAY: 8000, // 8 seconds
    BACKOFF_FACTOR: 2,
} as const;

export interface OpenAIConfig {
    apiKey: string;
    summaryModel?: string;
    embeddingModel?: string;
    maxRetries?: number;
}

export class OpenAIService {
    private client: OpenAI;
    private summaryModel: string;
    private embeddingModel: string;
    private maxRetries: number;
    private completionsTokens: number;
    private embeddingsTokens: number;
    private lastCompletionTime: number;
    private lastEmbeddingTime: number;

    constructor(config: OpenAIConfig) {
        this.client = new OpenAI({ apiKey: config.apiKey });
        this.summaryModel = config.summaryModel || 'gpt-3.5-turbo';
        this.embeddingModel = config.embeddingModel || 'text-embedding-ada-002';
        this.maxRetries = config.maxRetries || RETRY_CONFIG.MAX_RETRIES;
        this.completionsTokens = 0;
        this.embeddingsTokens = 0;
        this.lastCompletionTime = 0;
        this.lastEmbeddingTime = 0;
    }

    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async handleRateLimit(
        type: 'COMPLETIONS' | 'EMBEDDINGS',
        tokens: number
    ): Promise<void> {
        const now = Date.now();
        const limits = RATE_LIMITS[type];
        const lastTime = type === 'COMPLETIONS' ? this.lastCompletionTime : this.lastEmbeddingTime;
        const tokenCount = type === 'COMPLETIONS' ? this.completionsTokens : this.embeddingsTokens;

        // Check if we need to reset token count (after 1 minute)
        if (now - lastTime >= 60000) {
            if (type === 'COMPLETIONS') {
                this.completionsTokens = 0;
            } else {
                this.embeddingsTokens = 0;
            }
        }

        // Check if adding these tokens would exceed the limit
        if (tokenCount + tokens > limits.TOKENS_PER_MINUTE) {
            const waitTime = 60000 - (now - lastTime);
            await this.sleep(waitTime);
            if (type === 'COMPLETIONS') {
                this.completionsTokens = 0;
            } else {
                this.embeddingsTokens = 0;
            }
        }

        // Update token count and last request time
        if (type === 'COMPLETIONS') {
            this.completionsTokens += tokens;
            this.lastCompletionTime = now;
        } else {
            this.embeddingsTokens += tokens;
            this.lastEmbeddingTime = now;
        }
    }

    private async retryWithExponentialBackoff<T>(
        operation: () => Promise<T>,
        retryCount = 0
    ): Promise<T> {
        try {
            return await operation();
        } catch (error) {
            if (retryCount >= this.maxRetries) {
                throw error;
            }

            const delay = Math.min(
                RETRY_CONFIG.INITIAL_RETRY_DELAY * (RETRY_CONFIG.BACKOFF_FACTOR ** retryCount),
                RETRY_CONFIG.MAX_RETRY_DELAY
            );

            await this.sleep(delay);
            return this.retryWithExponentialBackoff(operation, retryCount + 1);
        }
    }

    private estimateTokens(text: string): number {
        // Rough estimation: 1 token ≈ 4 characters
        return Math.ceil(text.length / 4);
    }

    async generateSummary(content: string): Promise<string> {
        const estimatedTokens = this.estimateTokens(content) + 100; // Add buffer for prompt
        await this.handleRateLimit('COMPLETIONS', estimatedTokens);

        return this.retryWithExponentialBackoff(async () => {
            const response = await this.client.chat.completions.create({
                model: this.summaryModel,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a note summarization assistant. Create a concise summary of the following note content in 2-3 sentences.'
                    },
                    {
                        role: 'user',
                        content
                    }
                ],
                temperature: 0.3,
                max_tokens: 150
            });

            return response.choices[0]?.message?.content || '';
        });
    }

    async extractTags(content: string): Promise<string[]> {
        const estimatedTokens = this.estimateTokens(content) + 100; // Add buffer for prompt
        await this.handleRateLimit('COMPLETIONS', estimatedTokens);

        return this.retryWithExponentialBackoff(async () => {
            const response = await this.client.chat.completions.create({
                model: this.summaryModel,
                messages: [
                    {
                        role: 'system',
                        content: 'Extract 3-5 relevant tags from the following note content. Return only the tags as a comma-separated list, without any additional text.'
                    },
                    {
                        role: 'user',
                        content
                    }
                ],
                temperature: 0.3,
                max_tokens: 50
            });

            const tags = response.choices[0]?.message?.content?.split(',') || [];
            return tags.map((tag: string) => tag.trim()).filter(Boolean);
        });
    }

    async generateEmbedding(text: string): Promise<number[]> {
        const estimatedTokens = this.estimateTokens(text);
        await this.handleRateLimit('EMBEDDINGS', estimatedTokens);

        return this.retryWithExponentialBackoff(async () => {
            const response = await this.client.embeddings.create({
                model: this.embeddingModel,
                input: text
            });

            return response.data[0]?.embedding || [];
        });
    }

    async generateSummaryAndTags(content: string): Promise<{ summary: string; tags: string[] }> {
        const estimatedTokens = this.estimateTokens(content) + 150; // Add buffer for prompt
        await this.handleRateLimit('COMPLETIONS', estimatedTokens);

        return this.retryWithExponentialBackoff(async () => {
            const response = await this.client.chat.completions.create({
                model: this.summaryModel,
                messages: [
                    {
                        role: 'system',
                        content: 'You are helping organize a collection of personal notes. For the input text, provide a 1-2 sentence summary and extract 3-5 relevant tags. Respond in JSON format: {"summary": "<SUMMARY>", "tags": "<TAG1, TAG2, TAG3>"}'
                    },
                    {
                        role: 'user',
                        content
                    }
                ],
                temperature: 0.3,
                max_tokens: 200,
                response_format: { type: "json_object" }
            });

            const result = JSON.parse(response.choices[0]?.message?.content || '{"summary": "", "tags": ""}');
            return {
                summary: result.summary || '',
                tags: result.tags.split(',').map((tag: string) => tag.trim()).filter(Boolean)
            };
        });
    }

    async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
        const totalEstimatedTokens = texts.reduce((sum, text) => sum + this.estimateTokens(text), 0);
        await this.handleRateLimit('EMBEDDINGS', totalEstimatedTokens);

        return this.retryWithExponentialBackoff(async () => {
            const response = await this.client.embeddings.create({
                model: this.embeddingModel,
                input: texts
            });

            return response.data.map(item => item.embedding);
        });
    }
} 