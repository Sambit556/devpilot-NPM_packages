/**
 * DevsPilot Shared Utilities
 *
 * Pure, dependency-free utility functions used across all packages.
 */

import { SECRET_KEY_PATTERNS, SECRET_VALUE_PATTERNS, REDACTED_PLACEHOLDER } from '../constants/index.js';

// ---------------------------------------------------------------------------
// String Utilities
// ---------------------------------------------------------------------------

/**
 * Truncate a string to a max length, appending ellipsis if truncated.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength - 1)}…`;
}

/**
 * Pad a string on the right to a fixed width.
 */
export function padRight(str: string, width: number): string {
  if (str.length >= width) return str;
  return str + ' '.repeat(width - str.length);
}

/**
 * Pad a string on the left to a fixed width.
 */
export function padLeft(str: string, width: number): string {
  if (str.length >= width) return str;
  return ' '.repeat(width - str.length) + str;
}

/**
 * Convert bytes to a human-readable string (e.g., "48.2 MB").
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const index = Math.min(i, sizes.length - 1);
  const size = sizes[index];
  if (size === undefined) return `${bytes} B`;
  return `${(bytes / Math.pow(k, index)).toFixed(decimals)} ${size}`;
}

/**
 * Parse a size string (e.g., "10MB") to bytes.
 */
export function parseBytes(sizeStr: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)$/i.exec(sizeStr.trim());
  if (!match) throw new Error(`Invalid size string: "${sizeStr}"`);
  const value = parseFloat(match[1]!);
  const unit = (match[2]!).toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };
  const multiplier = multipliers[unit];
  if (multiplier === undefined) throw new Error(`Unknown unit: ${unit}`);
  return Math.floor(value * multiplier);
}

/**
 * Format milliseconds to a human-readable duration (e.g., "2m 34s").
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Format a percentage (e.g., 0.856 → "85.6%").
 */
export function formatPercent(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

// ---------------------------------------------------------------------------
// Security Utilities
// ---------------------------------------------------------------------------

/**
 * Check if a key name looks like it holds a secret.
 */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Check if a value looks like a secret (token, key, etc.).
 */
export function isSecretValue(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Redact a value if the key suggests it's a secret.
 */
export function redactEnvValue(key: string, value: string): string {
  if (isSecretKey(key) || isSecretValue(value)) {
    return REDACTED_PLACEHOLDER;
  }
  return value;
}

/**
 * Redact secrets in a log line.
 */
export function redactLogLine(line: string): string {
  let result = line;

  // Redact key=value patterns where key is secret-like
  result = result.replace(
    /(\b(?:password|secret|token|key|credential|authorization|api_key)\s*[=:]\s*)(["']?)(\S+)\2/gi,
    `$1$2${REDACTED_PLACEHOLDER}$2`,
  );

  // Redact Bearer tokens
  result = result.replace(
    /(Authorization:\s*Bearer\s+)\S+/gi,
    `$1${REDACTED_PLACEHOLDER}`,
  );

  // Redact AWS keys
  result = result.replace(/AKIA[0-9A-Z]{16}/g, REDACTED_PLACEHOLDER);

  // Redact JWTs
  result = result.replace(
    /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    REDACTED_PLACEHOLDER,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Path Utilities
// ---------------------------------------------------------------------------

/**
 * Normalize a path to use forward slashes (for display).
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Check if a path is inside a base directory (prevents path traversal).
 */
export function isPathInside(childPath: string, parentPath: string): boolean {
  const normalizedChild = normalizePath(childPath).toLowerCase();
  const normalizedParent = normalizePath(parentPath).toLowerCase();

  if (normalizedChild === normalizedParent) return true;

  const parentWithSlash = normalizedParent.endsWith('/')
    ? normalizedParent
    : `${normalizedParent}/`;

  return normalizedChild.startsWith(parentWithSlash);
}

// ---------------------------------------------------------------------------
// Validation Utilities
// ---------------------------------------------------------------------------

/**
 * Validate that a port number is in valid range.
 */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Validate a semver string (loose check).
 */
export function isValidSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$/.test(version);
}

// ---------------------------------------------------------------------------
// Platform Utilities
// ---------------------------------------------------------------------------

/**
 * Check if running on Windows.
 */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Check if running on macOS.
 */
export function isMacOS(): boolean {
  return process.platform === 'darwin';
}

/**
 * Check if running on Linux.
 */
export function isLinux(): boolean {
  return process.platform === 'linux';
}

/**
 * Get the home directory path.
 */
export function getHomeDir(): string {
  return process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
}

/**
 * Get the DevsPilot data directory (~/.DevsPilot).
 */
export function getDataDir(): string {
  const home = getHomeDir();
  return `${normalizePath(home)}/.DevsPilot`;
}

// ---------------------------------------------------------------------------
// Timing Utilities
// ---------------------------------------------------------------------------

/**
 * Create a high-resolution timer.
 */
export function createTimer(): () => number {
  const start = performance.now();
  return () => Math.round(performance.now() - start);
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Object Utilities
// ---------------------------------------------------------------------------

/**
 * Deep freeze an object (make fully immutable).
 */
export function deepFreeze<T extends object>(obj: T): Readonly<T> {
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value as object);
    }
  }
  return obj;
}

/**
 * Shallow clone with overrides (immutable update pattern).
 */
export function merge<T extends object>(target: T, overrides: Partial<T>): T {
  return Object.freeze({ ...target, ...overrides });
}
