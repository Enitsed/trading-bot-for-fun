export declare enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}
export interface LoggerConfig {
    level: LogLevel;
    enableFileOutput: boolean;
    outputPath?: string;
    enableConsole: boolean;
    prefix?: string;
}
declare class Logger {
    private config;
    constructor(config?: Partial<LoggerConfig>);
    private formatMessage;
    private shouldLog;
    private writeToFile;
    private log;
    debug(message: string, tag?: string): Promise<void>;
    info(message: string, tag?: string): Promise<void>;
    warn(message: string, tag?: string): Promise<void>;
    error(message: string, tag?: string): Promise<void>;
    updateConfig(config: Partial<LoggerConfig>): void;
}
export declare const logger: Logger;
export declare function createLogger(config?: Partial<LoggerConfig>): Logger;
export declare const botLogger: Logger;
export declare const webLogger: Logger;
export declare const tradeLogger: Logger;
export {};
//# sourceMappingURL=logger.d.ts.map