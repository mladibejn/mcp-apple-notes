import type { Logger } from '../types';
import { FileLogger } from './file-logger';
import { DIRECTORIES } from '../constants';

export class LoggingService implements Logger {
    private fileLogger: FileLogger;

    constructor() {
        this.fileLogger = new FileLogger(DIRECTORIES.logs, 7);
    }

    async debug(message: string): Promise<void> {
        console.debug(message);
        await this.fileLogger.debug(message);
    }

    async info(message: string): Promise<void> {
        console.info(message);
        await this.fileLogger.info(message);
    }

    async warn(message: string): Promise<void> {
        console.warn(message);
        await this.fileLogger.warn(message);
    }

    async error(message: string, error?: unknown): Promise<void> {
        console.error(message);
        if (error) {
            console.error(error);
        }
        await this.fileLogger.error(message, error);
    }

    forComponent(component: string): Logger {
        return this;
    }
} 