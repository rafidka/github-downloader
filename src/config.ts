import * as winston from 'winston';

// Create a logger with info in green, warn in yellow, and error in red.

export const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.colorize({
            all: true,
            colors: {
                info: 'green',
                warn: 'yellow',
                error: 'red',
            }
        }),
        winston.format.simple(),
    ),
    transports: [
        new winston.transports.Console({ format: winston.format.simple(), })
    ],
});
