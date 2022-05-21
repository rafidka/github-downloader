import * as winston from "winston";

const LOGGER_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type LoggerLevel = typeof LOGGER_LEVELS[number];

// Create a logger with info in green, warn in yellow, and error in red.
function createLogger(level: LoggerLevel): winston.Logger {
  return winston.createLogger({
    level: level,
    format: winston.format.simple(),
    transports: [
      // Create a file transport for info logs only.
      new winston.transports.File({
        filename: `${level}.log`,
        level: level,
      }),
    ],
  });
}

const loggers = LOGGER_LEVELS.reduce((loggers, level) => {
  loggers[level] = createLogger(level);
  return loggers;
}, {} as Record<LoggerLevel, winston.Logger>);

// Create a logger object with info method that uses the info logger, warn
// method that uses the warn logger, etc.
export const logger = LOGGER_LEVELS.reduce((logger, level) => {
  logger[level] = (message: string, meta?: any) => loggers[level].log(level, message, meta);
  return logger;
}, {} as Record<LoggerLevel, (message: string, meta?: any) => void>);
