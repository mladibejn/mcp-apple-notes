import type { Logger } from '../types';

export const log = (method: string, params: Record<string, unknown>) => {
    console.error(
        JSON.stringify({
            jsonrpc: '2.0',
            method: 'progress',
            params: {
                timestamp: new Date().toISOString(),
                method,
                ...params,
            },
        })
    );
};

export class LoggingService implements Logger {
    async debug(message: string): Promise<void> {
        log('debug', { message });
    }

    async info(message: string): Promise<void> {
        log('info', { message });
    }

    async warn(message: string): Promise<void> {
        log('warn', { message });
    }

    async error(message: string, error?: unknown): Promise<void> {
        log('error', {
            message,
            error: error ? String(error) : undefined
        });
    }

    forComponent(component: string): Logger {
        return this;
    }
} 