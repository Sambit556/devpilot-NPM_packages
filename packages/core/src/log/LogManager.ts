/**
 * DevsPilot Log Manager
 *
 * Aggregates, colors, filters, and routes log output from all services.
 * Handles structured log detection, error highlighting, and secret redaction.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import type { EventBus } from '../bus/EventBus.js';
import { LOG_COLORS, redactLogLine, truncate, MAX_LOG_LINE_LENGTH } from '@devspilot/shared';
import type { LogLevel } from '@devspilot/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogEntry {
  readonly timestamp: number;
  readonly service: string;
  readonly stream: 'stdout' | 'stderr';
  readonly level: LogLevel | null;
  readonly message: string;
  readonly raw: string;
}

export interface LogManagerOptions {
  eventBus: EventBus;
  /** Max log entries to buffer per service */
  bufferSize?: number;
  /** Minimum log level to display */
  minLevel?: LogLevel;
  /** Additional redaction patterns */
  redactPatterns?: string[];
  /** Persist logs to file on disk */
  persist?: boolean;
}

type LogHandler = (entry: LogEntry) => void;

// ---------------------------------------------------------------------------
// Log Level Ordering
// ---------------------------------------------------------------------------

const LOG_LEVEL_ORDER: Record<string, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
  silent: 6,
};

// ---------------------------------------------------------------------------
// Log Level Detection Patterns
// ---------------------------------------------------------------------------

const LEVEL_PATTERNS: Array<{ pattern: RegExp; level: LogLevel }> = [
  { pattern: /\b(?:FATAL|fatal)\b/, level: 'fatal' },
  { pattern: /\b(?:ERR(?:OR)?|err(?:or)?)\b/, level: 'error' },
  { pattern: /\b(?:WARN(?:ING)?|warn(?:ing)?)\b/, level: 'warn' },
  { pattern: /\b(?:INFO|info)\b/, level: 'info' },
  { pattern: /\b(?:DEBUG|debug)\b/, level: 'debug' },
  { pattern: /\b(?:TRACE|trace|VERBOSE|verbose)\b/, level: 'trace' },
];

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class LogManager {
  private readonly eventBus: EventBus;
  private readonly bufferSize: number;
  private readonly minLevel: LogLevel;
  private readonly persistLogs: boolean;
  private readonly logDir: string;
  private readonly buffers = new Map<string, LogEntry[]>();
  private readonly colorMap = new Map<string, string>();
  private readonly handlers = new Set<LogHandler>();
  private colorIndex = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(options: LogManagerOptions) {
    this.eventBus = options.eventBus;
    this.bufferSize = options.bufferSize ?? 1000;
    this.minLevel = options.minLevel ?? 'info';
    this.persistLogs = options.persist ?? false;
    this.logDir = join(os.homedir(), '.DevsPilot', 'logs');

    // Subscribe to process output events
    this.unsubscribe = this.eventBus.on('process:output', (event) => {
      const { name, stream, data } = event.payload;

      // Split multi-line output into individual entries
      const lines = data.split('\n').filter((line) => line.trim().length > 0);

      for (const line of lines) {
        const entry = this.createEntry(name, stream, line);
        this.bufferEntry(entry);
        this.persistEntry(entry);
        this.notifyHandlers(entry);
      }
    });
  }

  /**
   * Register a log handler (e.g., terminal renderer, file writer).
   */
  onLog(handler: LogHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /**
   * Get buffered logs for a service (or all services).
   */
  getLogs(service?: string, limit?: number): LogEntry[] {
    if (service) {
      const buffer = this.buffers.get(service) ?? [];
      return limit ? buffer.slice(-limit) : [...buffer];
    }

    // All services, sorted by timestamp
    const all: LogEntry[] = [];
    for (const buffer of this.buffers.values()) {
      all.push(...buffer);
    }
    all.sort((a, b) => a.timestamp - b.timestamp);
    return limit ? all.slice(-limit) : all;
  }

  /**
   * Get the assigned color for a service.
   */
  getColor(service: string): string {
    let color = this.colorMap.get(service);
    if (!color) {
      color = LOG_COLORS[this.colorIndex % LOG_COLORS.length]!;
      this.colorMap.set(service, color);
      this.colorIndex++;
    }
    return color;
  }

  /**
   * Get the max service name length (for alignment).
   */
  getMaxNameLength(): number {
    let max = 0;
    for (const name of this.colorMap.keys()) {
      if (name.length > max) max = name.length;
    }
    return Math.max(max, 4);
  }

  /**
   * Clear logs for a service (or all).
   */
  clear(service?: string): void {
    if (service) {
      this.buffers.delete(service);
    } else {
      this.buffers.clear();
    }
  }

  /**
   * Dispose and stop listening.
   */
  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.handlers.clear();
    this.buffers.clear();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private createEntry(service: string, stream: 'stdout' | 'stderr', raw: string): LogEntry {
    // Truncate extremely long lines
    const safeLine = truncate(raw, MAX_LOG_LINE_LENGTH);

    // Redact secrets
    const redacted = redactLogLine(safeLine);

    // Detect log level
    const level = this.detectLevel(redacted, stream);

    // Try to parse JSON log line
    const message = this.parseMessage(redacted);

    return {
      timestamp: Date.now(),
      service,
      stream,
      level,
      message,
      raw: redacted,
    };
  }

  private detectLevel(line: string, stream: 'stdout' | 'stderr'): LogLevel | null {
    // Try structured JSON first
    if (line.startsWith('{')) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const levelField = parsed['level'] ?? parsed['severity'];
        if (typeof levelField === 'string') {
          return levelField.toLowerCase() as LogLevel;
        }
        if (typeof levelField === 'number') {
          // pino-style numeric levels
          if (levelField <= 10) return 'trace';
          if (levelField <= 20) return 'debug';
          if (levelField <= 30) return 'info';
          if (levelField <= 40) return 'warn';
          if (levelField <= 50) return 'error';
          return 'fatal';
        }
      } catch {
        // Not valid JSON
      }
    }

    // Pattern-based detection
    for (const { pattern, level } of LEVEL_PATTERNS) {
      if (pattern.test(line)) return level;
    }

    // stderr defaults to error level
    if (stream === 'stderr') return 'error';

    return null;
  }

  private parseMessage(line: string): string {
    // Try to extract message from JSON logs
    if (line.startsWith('{')) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const msg = parsed['msg'] ?? parsed['message'] ?? parsed['text'];
        if (typeof msg === 'string') return msg;
      } catch {
        // Not valid JSON, use raw line
      }
    }

    return line;
  }

  private bufferEntry(entry: LogEntry): void {
    let buffer = this.buffers.get(entry.service);
    if (!buffer) {
      buffer = [];
      this.buffers.set(entry.service, buffer);
    }

    buffer.push(entry);

    // Trim buffer if exceeding max size
    if (buffer.length > this.bufferSize) {
      buffer.splice(0, buffer.length - this.bufferSize);
    }
  }

  private notifyHandlers(entry: LogEntry): void {
    // Skip entries below minimum level
    if (entry.level) {
      const entryLevel = LOG_LEVEL_ORDER[entry.level] ?? 2;
      const minLevel = LOG_LEVEL_ORDER[this.minLevel] ?? 2;
      if (entryLevel < minLevel) return;
    }

    for (const handler of this.handlers) {
      try {
        handler(entry);
      } catch {
        // Don't let handler errors crash the log pipeline
      }
    }
  }

  private persistEntry(entry: LogEntry): void {
    if (!this.persistLogs) return;
    try {
      mkdirSync(this.logDir, { recursive: true });
      const filePath = join(this.logDir, `${entry.service}.log`);
      const line = `[${new Date(entry.timestamp).toISOString()}] [${entry.level?.toUpperCase() ?? 'INFO'}] ${entry.message}\n`;
      appendFileSync(filePath, line, 'utf-8');
    } catch {
      // Ignore write errors
    }
  }

  /**
   * Search through buffered logs using query strings or RegExp.
   */
  searchLogs(service: string | undefined, query: string | RegExp): LogEntry[] {
    const list = this.getLogs(service);
    const regex = typeof query === 'string' ? new RegExp(query, 'i') : query;
    return list.filter((e) => regex.test(e.message) || regex.test(e.raw));
  }

  /**
   * Export logs as a combined JSON string or raw text content.
   */
  exportLogs(service: string | undefined, format: 'json' | 'text'): string {
    const list = this.getLogs(service);
    if (format === 'json') {
      return JSON.stringify(list, null, 2);
    }
    return list
      .map((e) => `[${new Date(e.timestamp).toISOString()}] [${e.service}] [${e.level?.toUpperCase() ?? 'INFO'}] ${e.message}`)
      .join('\n');
  }
}
