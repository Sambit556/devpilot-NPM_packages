/**
 * DevsPilot Config Schema
 *
 * Zod schemas for validating the user-facing configuration.
 * All validation errors produce human-readable messages.
 */

import { z } from 'zod';
import {
  DEFAULT_HEALTH_INTERVAL_MS,
  DEFAULT_HEALTH_TIMEOUT_MS,
  DEFAULT_HEALTH_RETRIES,
  DEFAULT_HEALTH_START_PERIOD_MS,
  DEFAULT_RESTART_MAX_RETRIES,
  DEFAULT_RESTART_BACKOFF_MS,
  DEFAULT_RESTART_MAX_BACKOFF_MS,
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_DASHBOARD_PORT,
  DEFAULT_LOG_LEVEL,
  DEFAULT_LOG_MAX_FILES,
} from '@devspilot/shared';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const portSchema = z.number().int().min(1).max(65535);
const logLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);

// ---------------------------------------------------------------------------
// Service Health Config
// ---------------------------------------------------------------------------

export const serviceHealthConfigSchema = z.object({
  path: z.string().optional(),
  port: portSchema.optional(),
  interval: z.number().int().positive().optional().default(DEFAULT_HEALTH_INTERVAL_MS),
  timeout: z.number().int().positive().optional().default(DEFAULT_HEALTH_TIMEOUT_MS),
  retries: z.number().int().nonnegative().optional().default(DEFAULT_HEALTH_RETRIES),
  startPeriod: z.number().int().nonnegative().optional().default(DEFAULT_HEALTH_START_PERIOD_MS),
}).strict().optional();

// ---------------------------------------------------------------------------
// Service Watch Config
// ---------------------------------------------------------------------------

export const serviceWatchConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  paths: z.array(z.string()).optional().default([]),
  ignore: z.array(z.string()).optional().default([]),
  debounce: z.number().int().nonnegative().optional().default(DEFAULT_DEBOUNCE_MS),
}).strict().optional();

// ---------------------------------------------------------------------------
// Restart Config
// ---------------------------------------------------------------------------

export const restartConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  maxRetries: z.number().int().nonnegative().optional().default(DEFAULT_RESTART_MAX_RETRIES),
  backoff: z.number().int().positive().optional().default(DEFAULT_RESTART_BACKOFF_MS),
  maxBackoff: z.number().int().positive().optional().default(DEFAULT_RESTART_MAX_BACKOFF_MS),
}).strict().optional();

// ---------------------------------------------------------------------------
// Service Config
// ---------------------------------------------------------------------------

export const serviceConfigSchema = z.object({
  command: z.string().min(1, 'Service command cannot be empty'),
  cwd: z.string().optional(),
  port: portSchema.optional(),
  env: z.record(z.string(), z.string()).optional(),
  envFile: z.union([z.string(), z.array(z.string())]).optional(),
  dependsOn: z.array(z.string()).optional(),
  health: serviceHealthConfigSchema,
  watch: serviceWatchConfigSchema,
  restart: restartConfigSchema,
  group: z.string().optional(),
  priority: z.number().int().nonnegative().optional().default(100),
});

// ---------------------------------------------------------------------------
// Docker Config
// ---------------------------------------------------------------------------

export const dockerConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  composeFile: z.string().optional(),
  services: z.array(z.string()).optional(),
  autoStart: z.boolean().optional().default(false),
}).strict().optional();

// ---------------------------------------------------------------------------
// Environment Config
// ---------------------------------------------------------------------------

export const envConfigSchema = z.object({
  files: z.array(z.string()).optional().default([]),
  required: z.array(z.string()).optional().default([]),
  validate: z.boolean().optional().default(true),
}).strict().optional();

// ---------------------------------------------------------------------------
// Log Config
// ---------------------------------------------------------------------------

export const logConfigSchema = z.object({
  level: logLevelSchema.optional().default(DEFAULT_LOG_LEVEL),
  persist: z.boolean().optional().default(false),
  maxSize: z.string().optional().default('10MB'),
  maxFiles: z.number().int().positive().optional().default(DEFAULT_LOG_MAX_FILES),
  redact: z.array(z.string()).optional().default([]),
}).strict().optional();

// ---------------------------------------------------------------------------
// Dashboard Config
// ---------------------------------------------------------------------------

export const dashboardConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  port: portSchema.optional().default(DEFAULT_DASHBOARD_PORT),
  open: z.boolean().optional().default(false),
}).strict().optional();

// ---------------------------------------------------------------------------
// Watch Config (global)
// ---------------------------------------------------------------------------

export const watchConfigSchema = z.object({
  ignore: z.array(z.string()).optional().default([]),
  debounce: z.number().int().nonnegative().optional().default(DEFAULT_DEBOUNCE_MS),
}).strict().optional();

// ---------------------------------------------------------------------------
// Plugin Config
// ---------------------------------------------------------------------------

export const pluginConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
}).passthrough(); // Allow plugin-specific options

// ---------------------------------------------------------------------------
// Performance Config
// ---------------------------------------------------------------------------

export const performanceConfigSchema = z.object({
  maxMemory: z.string().optional(),
  maxCpu: z.number().min(0).max(100).optional(),
  alerts: z.boolean().optional().default(true),
}).strict().optional();

// ---------------------------------------------------------------------------
// Root Config Schema
// ---------------------------------------------------------------------------

export const DevsPilotConfigSchema: z.ZodType<any> = z.object({
  name: z.string().optional(),
  type: z.enum(['node', 'monorepo']).optional(),
  services: z.record(z.string(), serviceConfigSchema).optional(),
  docker: dockerConfigSchema,
  env: envConfigSchema,
  logs: logConfigSchema,
  dashboard: dashboardConfigSchema,
  watch: watchConfigSchema,
  plugins: z.record(z.string(), pluginConfigSchema).optional(),
  performance: performanceConfigSchema,
  profiles: z.record(z.string(), z.lazy(() => DevsPilotConfigSchema)).optional(),
});

export type DevsPilotConfigInput = z.input<typeof DevsPilotConfigSchema>;
export type DevsPilotConfigOutput = z.output<typeof DevsPilotConfigSchema>;
