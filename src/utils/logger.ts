import { createLogger, format, transports } from 'winston';

const { combine, colorize, printf, timestamp } = format;

const logFormat = printf(({ level, message }) => `${level}: ${message}`);

const logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: combine(colorize(), logFormat),
  transports: [new transports.Console()],
});

export function setLogLevel(level: string): void {
  logger.level = level;
}

export default logger;
