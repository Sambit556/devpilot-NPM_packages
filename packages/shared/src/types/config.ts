/**
 * DevsPilot Shared Types — Configuration
 *
 * User-facing configuration schema. All fields optional.
 * Defaults are applied by the ConfigLoader in @devspilot/core.
 */

// ---------------------------------------------------------------------------
// Root Config (what users write in DevsPilot.config.yml)
// ---------------------------------------------------------------------------

export interface DevsPilotConfig {
  /** Project name override (auto-detected from package.json) */
  readonly name?: string;

  /** Project type override */
  readonly type?: 'node' | 'monorepo';

  /** Service definitions */
  readonly services?: Record<string, ServiceConfig>;

  /** Docker integration */
  readonly docker?: DockerConfig;

  /** Environment configuration */
  readonly env?: EnvConfig;

  /** Log configuration */
  readonly logs?: LogConfig;

  /** Dashboard configuration */
  readonly dashboard?: DashboardConfig;

  /** File watching (global) */
  readonly watch?: WatchConfig;

  /** Plugin configuration */
  readonly plugins?: Record<string, PluginConfig>;

  /** Performance thresholds */
  readonly performance?: PerformanceConfig;

  /** Configuration profiles */
  readonly profiles?: Record<string, Partial<DevsPilotConfig>>;
}

// ---------------------------------------------------------------------------
// Service Config
// ---------------------------------------------------------------------------

export interface ServiceConfig {
  /** Command to execute */
  readonly command: string;

  /** Working directory (relative to project root) */
  readonly cwd?: string;

  /** Expected port number */
  readonly port?: number;

  /** Additional environment variables */
  readonly env?: Record<string, string>;

  /** Env file(s) to load */
  readonly envFile?: string | string[];

  /** Services that must start first */
  readonly dependsOn?: string[];

  /** Health check configuration */
  readonly health?: ServiceHealthConfig;

  /** File watching configuration */
  readonly watch?: ServiceWatchConfig;

  /** Restart configuration */
  readonly restart?: RestartConfig;

  /** Service group label */
  readonly group?: string;

  /** Startup priority (lower = first) */
  readonly priority?: number;
}

export interface ServiceHealthConfig {
  /** HTTP health endpoint path */
  readonly path?: string;

  /** Health check port (if different from service port) */
  readonly port?: number;

  /** Check interval in milliseconds */
  readonly interval?: number;

  /** Check timeout in milliseconds */
  readonly timeout?: number;

  /** Failures before marking unhealthy */
  readonly retries?: number;

  /** Grace period after start (milliseconds) */
  readonly startPeriod?: number;
}

export interface ServiceWatchConfig {
  /** Enable file watching for this service */
  readonly enabled?: boolean;

  /** Paths to watch (relative to service cwd) */
  readonly paths?: string[];

  /** Additional ignore patterns */
  readonly ignore?: string[];

  /** Debounce delay in milliseconds */
  readonly debounce?: number;
}

export interface RestartConfig {
  /** Enable auto-restart on crash */
  readonly enabled?: boolean;

  /** Max restart attempts */
  readonly maxRetries?: number;

  /** Initial backoff in milliseconds */
  readonly backoff?: number;

  /** Max backoff in milliseconds */
  readonly maxBackoff?: number;
}

// ---------------------------------------------------------------------------
// Docker Config
// ---------------------------------------------------------------------------

export interface DockerConfig {
  /** Enable Docker integration */
  readonly enabled?: boolean;

  /** Path to docker-compose file */
  readonly composeFile?: string;

  /** Specific services to manage */
  readonly services?: string[];

  /** Auto-start containers on DevsPilot up */
  readonly autoStart?: boolean;
}

// ---------------------------------------------------------------------------
// Environment Config
// ---------------------------------------------------------------------------

export interface EnvConfig {
  /** Env files to load */
  readonly files?: string[];

  /** Required environment variables */
  readonly required?: string[];

  /** Enable env validation */
  readonly validate?: boolean;
}

// ---------------------------------------------------------------------------
// Log Config
// ---------------------------------------------------------------------------

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

export interface LogConfig {
  /** Minimum log level */
  readonly level?: LogLevel;

  /** Persist logs to disk */
  readonly persist?: boolean;

  /** Max log file size (e.g., "10MB") */
  readonly maxSize?: string;

  /** Max number of rotated log files */
  readonly maxFiles?: number;

  /** Patterns to redact from logs */
  readonly redact?: string[];
}

// ---------------------------------------------------------------------------
// Dashboard Config
// ---------------------------------------------------------------------------

export interface DashboardConfig {
  /** Enable dashboard server */
  readonly enabled?: boolean;

  /** Dashboard port */
  readonly port?: number;

  /** Auto-open in browser */
  readonly open?: boolean;
}

// ---------------------------------------------------------------------------
// Watch Config (global)
// ---------------------------------------------------------------------------

export interface WatchConfig {
  /** Global ignore patterns */
  readonly ignore?: string[];

  /** Global debounce in milliseconds */
  readonly debounce?: number;
}

// ---------------------------------------------------------------------------
// Plugin Config
// ---------------------------------------------------------------------------

export interface PluginConfig {
  /** Enable/disable this plugin */
  readonly enabled?: boolean;

  /** Plugin-specific options */
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Performance Config
// ---------------------------------------------------------------------------

export interface PerformanceConfig {
  /** Max memory per service (e.g., "512MB") */
  readonly maxMemory?: string;

  /** Max CPU percent per service */
  readonly maxCpu?: number;

  /** Enable performance alerts */
  readonly alerts?: boolean;
}

// ---------------------------------------------------------------------------
// Resolved Config (after defaults + merge)
// ---------------------------------------------------------------------------

export interface ResolvedConfig {
  readonly name: string;
  readonly type: 'node' | 'monorepo';
  readonly services: Record<string, ResolvedServiceConfig>;
  readonly docker: Omit<Required<DockerConfig>, 'composeFile' | 'services'> & {
    readonly composeFile?: string;
    readonly services?: string[];
  };
  readonly env: Required<EnvConfig>;
  readonly logs: Required<LogConfig>;
  readonly dashboard: Required<DashboardConfig>;
  readonly watch: Required<WatchConfig>;
  readonly plugins: Record<string, PluginConfig>;
  readonly performance: Omit<Required<PerformanceConfig>, 'maxMemory' | 'maxCpu'> & {
    readonly maxMemory?: string;
    readonly maxCpu?: number;
  };
  readonly profile: string | null;
  readonly configPath: string | null;
}

export interface ResolvedServiceConfig {
  readonly name: string;
  readonly command: string;
  readonly cwd: string;
  readonly port: number | null;
  readonly env: Record<string, string>;
  readonly envFile: string[];
  readonly dependsOn: string[];
  readonly health: Required<ServiceHealthConfig>;
  readonly watch: Required<ServiceWatchConfig>;
  readonly restart: Required<RestartConfig>;
  readonly group: string | null;
  readonly priority: number;
}
