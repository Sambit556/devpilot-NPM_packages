/**
 * DevsPilot Logger
 *
 * Thin wrapper around pino for structured, high-performance logging.
 * Automatically redacts secrets and prefixes module name.
 */

import pino from 'pino';
import type { LogLevel } from '@devspilot/shared';
import { DEFAULT_LOG_LEVEL, REDACTED_PLACEHOLDER, SECRET_KEY_PATTERNS } from '@devspilot/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Logger = pino.Logger;

interface LoggerOptions {
  /** Logger name (module/service prefix) */
  name: string;
  /** Minimum log level */
  level?: LogLevel;
  /** Pretty print in development */
  pretty?: boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a logger instance for a specific module.
 *
 * Usage:
 *   const log = createLogger({ name: 'ProcessManager' });
 *   log.info('Process started', { pid: 1234 });
 */
export function createLogger(options: LoggerOptions): Logger {
  const { name, level = DEFAULT_LOG_LEVEL, pretty = false } = options;

  const redactPaths = [
    'password',
    'secret',
    'token',
    'apiKey',
    'api_key',
    'accessToken',
    'access_token',
    'authorization',
    'cookie',
    'connectionString',
    'connection_string',
    'databaseUrl',
    'database_url',
  ];

  const transport = pretty
    ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
        messageFormat: `[${name}] {msg}`,
      },
    }
    : undefined;

  return pino({
    name,
    level,
    transport,
    redact: {
      paths: redactPaths,
      censor: REDACTED_PLACEHOLDER,
    },
    serializers: {
      err: pino.stdSerializers.err,
      // Custom serializer that redacts env-like objects
      env: (env: Record<string, string>) => {
        const redacted: Record<string, string> = {};
        for (const [key, value] of Object.entries(env)) {
          const isSecret = SECRET_KEY_PATTERNS.some((p) => p.test(key));
          redacted[key] = isSecret ? REDACTED_PLACEHOLDER : value;
        }
        return redacted;
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

/**
 * Create a child logger with additional context.
 */
export function createChildLogger(parent: Logger, bindings: Record<string, unknown>): Logger {
  return parent.child(bindings);
}
