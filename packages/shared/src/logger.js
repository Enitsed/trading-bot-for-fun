export var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["WARN"] = 2] = "WARN";
    LogLevel[LogLevel["ERROR"] = 3] = "ERROR";
})(LogLevel || (LogLevel = {}));
class Logger {
    config;
    constructor(config = {}) {
        this.config = {
            level: LogLevel.INFO,
            enableFileOutput: false,
            enableConsole: true,
            ...config,
        };
    }
    formatMessage(level, message, tag) {
        const timestamp = new Date().toISOString();
        const prefix = this.config.prefix ? `[${this.config.prefix}] ` : '';
        const tagStr = tag ? `[${tag}] ` : '';
        return `${timestamp} ${level} ${prefix}${tagStr}${message}`;
    }
    shouldLog(level) {
        return level >= this.config.level;
    }
    async writeToFile(message) {
        if (!this.config.enableFileOutput || !this.config.outputPath)
            return;
        try {
            const { writeFile } = await import('node:fs/promises');
            await writeFile(this.config.outputPath, message + '\n', { flag: 'a' });
        }
        catch (error) {
            // Fail silently to avoid infinite logging loops
        }
    }
    async log(level, levelName, message, tag) {
        if (!this.shouldLog(level))
            return;
        const formattedMessage = this.formatMessage(levelName, message, tag);
        if (this.config.enableConsole) {
            console.log(formattedMessage);
        }
        if (this.config.enableFileOutput) {
            await this.writeToFile(formattedMessage);
        }
    }
    debug(message, tag) {
        return this.log(LogLevel.DEBUG, 'DEBUG', message, tag);
    }
    info(message, tag) {
        return this.log(LogLevel.INFO, 'INFO', message, tag);
    }
    warn(message, tag) {
        return this.log(LogLevel.WARN, 'WARN', message, tag);
    }
    error(message, tag) {
        return this.log(LogLevel.ERROR, 'ERROR', message, tag);
    }
    updateConfig(config) {
        this.config = { ...this.config, ...config };
    }
}
// Default logger instance
export const logger = new Logger();
// Factory function for creating loggers with specific configs
export function createLogger(config = {}) {
    return new Logger(config);
}
// Convenience functions for common use cases
export const botLogger = createLogger({
    prefix: 'BOT',
    level: LogLevel.INFO,
    enableFileOutput: true,
    outputPath: 'logs/bot.log',
});
export const webLogger = createLogger({
    prefix: 'WEB',
    level: LogLevel.INFO,
});
export const tradeLogger = createLogger({
    prefix: 'TRADE',
    level: LogLevel.INFO,
    enableFileOutput: true,
    outputPath: 'logs/trades.log',
});
