/**
 * DevsPilot Shared Constants
 *
 * All magic numbers, default values, limits, and patterns
 * centralized here to avoid duplication across packages.
 */

// ---------------------------------------------------------------------------
// Package Identity
// ---------------------------------------------------------------------------

export const PACKAGE_NAME = 'devspilot';
export const PACKAGE_SCOPE = '@devspilot';
export const CONFIG_DIR_NAME = '.devspilot';
export const BINARY_NAME = 'devspilot';

// ---------------------------------------------------------------------------
// Config File Discovery (in priority order)
// ---------------------------------------------------------------------------

export const CONFIG_FILES = [
  'devspilot.config.ts',
  'devspilot.config.js',
  'devspilot.config.mjs',
  'devspilot.config.json',
  'devspilot.config.yaml',
  'devspilot.config.yml',
] as const;

export const PACKAGE_JSON_CONFIG_KEY = 'devspilot';

// ---------------------------------------------------------------------------
// Env File Discovery (in priority order)
// ---------------------------------------------------------------------------

export const ENV_FILES = [
  '.env.local',
  '.env.development.local',
  '.env.development',
  '.env',
] as const;

// ---------------------------------------------------------------------------
// Lock File → Package Manager Mapping
// ---------------------------------------------------------------------------

export const LOCK_FILE_MAP: Record<string, string> = {
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'package-lock.json': 'npm',
  'bun.lockb': 'bun',
  'bun.lock': 'bun',
} as const;

// ---------------------------------------------------------------------------
// Framework Detection Patterns
// ---------------------------------------------------------------------------

export const FRAMEWORK_DEPS: Record<string, string> = {
  'next': 'next',
  'nuxt': 'nuxt',
  '@angular/core': 'angular',
  'react': 'react',
  'vue': 'vue',
  'svelte': 'svelte',
  '@sveltejs/kit': 'sveltekit',
  '@nestjs/core': 'nest',
  'express': 'express',
  'fastify': 'fastify',
  'koa': 'koa',
  '@hapi/hapi': 'hapi',
} as const;

// ---------------------------------------------------------------------------
// Build Tool Detection
// ---------------------------------------------------------------------------

export const BUILD_TOOL_CONFIGS: Record<string, string> = {
  'vite.config': 'vite',
  'webpack.config': 'webpack',
  'rollup.config': 'rollup',
  'esbuild.config': 'esbuild',
} as const;

// ---------------------------------------------------------------------------
// Monorepo Detection
// ---------------------------------------------------------------------------

export const MONOREPO_MARKERS = [
  'pnpm-workspace.yaml',
  'lerna.json',
  'nx.json',
  'turbo.json',
  'rush.json',
] as const;

// ---------------------------------------------------------------------------
// File Watching Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_WATCH_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.svelte-kit/**',
  '**/coverage/**',
  '**/.turbo/**',
  '**/.cache/**',
  '**/*.log',
  '**/*.tsbuildinfo',
  '**/tmp/**',
  '**/temp/**',
] as const;

export const DEFAULT_WATCH_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.yaml', '.yml', '.toml',
  '.env', '.env.*',
  '.html', '.css', '.scss', '.sass', '.less',
  '.graphql', '.gql',
  '.prisma',
  '.sql',
] as const;

export const DEFAULT_DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// Process Management Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_RESTART_MAX_RETRIES = 10;
export const DEFAULT_RESTART_BACKOFF_MS = 1000;
export const DEFAULT_RESTART_MAX_BACKOFF_MS = 30_000;
export const DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 10_000;
export const DEFAULT_KILL_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Health Check Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_HEALTH_INTERVAL_MS = 10_000;
export const DEFAULT_HEALTH_TIMEOUT_MS = 5_000;
export const DEFAULT_HEALTH_RETRIES = 3;
export const DEFAULT_HEALTH_START_PERIOD_MS = 30_000;

// ---------------------------------------------------------------------------
// Dashboard Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_DASHBOARD_PORT = 9900;
export const DEFAULT_DASHBOARD_HOST = '127.0.0.1';

// ---------------------------------------------------------------------------
// Log Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_LOG_LEVEL = 'info';
export const DEFAULT_LOG_MAX_SIZE = '10MB';
export const DEFAULT_LOG_MAX_FILES = 5;
export const DEFAULT_LOG_BUFFER_SIZE = 1000;

// ---------------------------------------------------------------------------
// Performance Limits
// ---------------------------------------------------------------------------

export const MAX_SERVICES = 200;
export const MAX_WATCH_FILES = 50_000;
export const MAX_LOG_LINE_LENGTH = 10_000;
export const MAX_CONFIG_SIZE_BYTES = 1_024_000; // 1MB
export const MAX_PLUGIN_LOAD_TIME_MS = 5_000;

// ---------------------------------------------------------------------------
// Secret Redaction Patterns
// ---------------------------------------------------------------------------

export const SECRET_KEY_PATTERNS = [
  /(?:_|^)(?:SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|AUTH|PRIVATE|API_KEY)(?:_|$)/i,
  /(?:_|^)(?:ACCESS_KEY|SECRET_KEY|SESSION_TOKEN)(?:_|$)/i,
  /(?:_|^)(?:DATABASE_URL|REDIS_URL|MONGODB_URI|AMQP_URL)(?:_|$)/i,
  /(?:_|^)(?:CONNECTION_STRING|DSN)(?:_|$)/i,
] as const;

export const SECRET_VALUE_PATTERNS = [
  /^AKIA[0-9A-Z]{16}$/, // AWS Access Key
  /^-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/, // Private keys
  /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, // JWT
  /^ghp_[A-Za-z0-9]{36}$/, // GitHub personal access token
  /^gh[pousr]_[A-Za-z0-9]{36,}$/, // GitHub tokens
  /^npm_[A-Za-z0-9]{36}$/, // npm token
  /^sk-[A-Za-z0-9]{48}$/, // OpenAI API key
  /^sk_live_[A-Za-z0-9]{24,}$/, // Stripe secret key
] as const;

export const REDACTED_PLACEHOLDER = '[REDACTED]';

// ---------------------------------------------------------------------------
// Terminal Colors (semantic)
// ---------------------------------------------------------------------------

export const COLORS = {
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#6366f1',
  muted: '#71717a',
  accent: '#3b82f6',
  text: '#fafafa',
  textSecondary: '#a0a0a8',
  bg: '#0a0a0b',
  bgSecondary: '#141416',
  border: '#2a2a2e',
} as const;

// ---------------------------------------------------------------------------
// Service Log Color Palette (cycled for multi-service logs)
// ---------------------------------------------------------------------------

export const LOG_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#14b8a6', // teal
  '#e879f9', // fuchsia
  '#a3e635', // lime
  '#fb923c', // light orange
  '#38bdf8', // light blue
  '#c084fc', // light purple
  '#34d399', // emerald
  '#fbbf24', // yellow
  '#f472b6', // light pink
] as const;

// ---------------------------------------------------------------------------
// Exit Codes
// ---------------------------------------------------------------------------

export const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  CONFIG_ERROR: 2,
  MISSING_DEPENDENCY: 3,
  PORT_CONFLICT: 4,
  PROCESS_CRASH: 5,
  HEALTH_CHECK_FAILED: 6,
  PLUGIN_ERROR: 7,
  PERMISSION_DENIED: 8,
  INTERRUPTED: 130, // SIGINT
} as const;

// ---------------------------------------------------------------------------
// Environment Variable Prefixes (DevsPilot's own)
// ---------------------------------------------------------------------------

export const ENV_PREFIX = 'DEVSPILOT_';
