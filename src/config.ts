import * as winston from "winston";

const LOGGER_LEVELS = ["debug", "info", "warn", "error"] as const;
type LoggerLevel = typeof LOGGER_LEVELS[number];

/**
 * Creates a logger that logs to the given file. The file is created if it
 * doesn't exist.
 * @param level The level of the logger.
 * @returns The logger.
 */
function createFileLogger(level: LoggerLevel): winston.Logger {
  return winston.createLogger({
    level: level,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ timestamp, level, message }) => {
        return `${timestamp} [${level}] ${message}`;
      })
    ),
    transports: [
      // Create a file transport.
      new winston.transports.File({
        filename: `${level}.log`,
        level: level,
      }),
    ],
  });
}

// Create file loggers for the different levels. The reason we need multiple
// loggers is we would like to log to different files depending on the level.
const fileLoggers = LOGGER_LEVELS.reduce((loggers, level) => {
  loggers[level] = createFileLogger(level);
  return loggers;
}, {} as Record<LoggerLevel, winston.Logger>);

/**
 * A logger that logs to files only.
 */
const fileOnlyLogger = LOGGER_LEVELS.reduce((logger, level) => {
  logger[level] = (message: string, meta?: any) =>
    fileLoggers[level].log(level, message, meta);
  return logger;
}, {} as Record<LoggerLevel, (message: string, meta?: any) => void>);

/**
 * A logger that logs to the console only.
 */
const consoleOnlyLogger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level}] ${message}`;
    })
  ),
  transports: [
    // Create a file transport for info logs only.
    new winston.transports.Console({
      level: "info",
    }),
  ],
});

export const logger = LOGGER_LEVELS.reduce((logger, level) => {
  logger[level] = (message: string, meta?: any) => {
    consoleOnlyLogger.log(level, message, meta);
    fileLoggers[level].log(level, message, meta);
  };
  return logger;
}, {} as Record<LoggerLevel, (message: string, meta?: any) => void>);

/**
 * Stops logging to the console. This is useful when progress bars are running.
 */
export function disableConsoleLogging() {
  consoleOnlyLogger.silent = true;
}

/**
 * Enables logging to the console.
 */
export function enableConsoleLogging() {
  consoleOnlyLogger.silent = false;
}

/**
 * Sets the logging level.
 * @param level The new logging level.
 */
export function setLogLevel(level: LoggerLevel) {
  [consoleOnlyLogger, ...Object.values(fileLoggers)].forEach((logger) => {
    logger.level = level;
    logger.transports.forEach((t) => (t.level = level));
  });
}
