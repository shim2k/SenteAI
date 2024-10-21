import { createLogger, format, transports } from 'winston';

const { combine, timestamp, printf, errors, metadata } = format;

// Define your custom format to include metadata
const customFormat = printf(({ level, message, timestamp, stack, metadata }) => {
  // Stringify metadata if it exists
  const metaString = metadata && Object.keys(metadata).length ? JSON.stringify(metadata) : '';
  return `${timestamp} [${level.toUpperCase()}]: ${stack || message} ${metaString}`;
});

const logger = createLogger({
  level: 'info', // Set the minimum level to log
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }), // Capture stack traces
    metadata(), // Include metadata in the log info
    customFormat
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'logs/app.log', maxsize: 5242880, maxFiles: 5 }),
  ],
  exceptionHandlers: [
    new transports.File({ filename: 'logs/exceptions.log' }),
  ],
  rejectionHandlers: [
    new transports.File({ filename: 'logs/rejections.log' }),
  ],
});

export default logger;