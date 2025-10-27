export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LoggerConfig {
  level: LogLevel;
  enableFileOutput: boolean;
  outputPath?: string;
  enableConsole: boolean;
  prefix?: string;
}

class Logger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: LogLevel.INFO,
      enableFileOutput: false,
      enableConsole: true,
      ...config,
    };
  }

  private formatMessage(level: string, message: string, tag?: string): string {
    const timestamp = new Date().toISOString();
    const prefix = this.config.prefix ? `[${this.config.prefix}] ` : '';
    const tagStr = tag ? `[${tag}] ` : '';
    return `${timestamp} ${level} ${prefix}${tagStr}${message}`;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.config.level;
  }

  private async writeToFile(message: string): Promise<void> {
    if (!this.config.enableFileOutput || !this.config.outputPath) return;

    try {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(this.config.outputPath, message + '\n', { flag: 'a' });
    } catch (error) {
      // Fail silently to avoid infinite logging loops
    }
  }

  private async log(level: LogLevel, levelName: string, message: string, tag?: string): Promise<void> {
    if (!this.shouldLog(level)) return;

    const formattedMessage = this.formatMessage(levelName, message, tag);

    if (this.config.enableConsole) {
      console.log(formattedMessage);
    }

    if (this.config.enableFileOutput) {
      await this.writeToFile(formattedMessage);
    }
  }

  debug(message: string, tag?: string): Promise<void> {
    return this.log(LogLevel.DEBUG, 'DEBUG', message, tag);
  }

  info(message: string, tag?: string): Promise<void> {
    return this.log(LogLevel.INFO, 'INFO', message, tag);
  }

  warn(message: string, tag?: string): Promise<void> {
    return this.log(LogLevel.WARN, 'WARN', message, tag);
  }

  error(message: string, tag?: string): Promise<void> {
    return this.log(LogLevel.ERROR, 'ERROR', message, tag);
  }

  updateConfig(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Default logger instance
export const logger = new Logger();

// Factory function for creating loggers with specific configs
export function createLogger(config: Partial<LoggerConfig> = {}): Logger {
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