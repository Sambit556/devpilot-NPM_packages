/**
 * DevsPilot Shared Types — Plugin API
 *
 * Types that define the plugin contract: manifest, permissions,
 * lifecycle hooks, and the API surface exposed to plugins.
 */

import type { HealthStatus } from './events.js';

// ---------------------------------------------------------------------------
// Plugin Manifest (what plugin authors export)
// ---------------------------------------------------------------------------

export interface DevsPilotPlugin {
  /** Unique plugin name (e.g., "@devspilot/plugin-react") */
  readonly name: string;

  /** Semver version string */
  readonly version: string;

  /** Human-readable description */
  readonly description: string;

  /** Required permissions */
  readonly permissions: PluginPermission[];

  /** Engine + Node compatibility */
  readonly engines: {
    readonly DevsPilot: string;
    readonly node?: string;
  };

  /** Dependencies on other DevsPilot plugins */
  readonly dependencies?: string[];

  /** Detection function — return non-null if this plugin should activate */
  detect?(context: DetectionContext): DetectionResult | null;

  /** Called when plugin is registered (before detection) */
  onRegister?(api: PluginAPI): void | Promise<void>;

  /** Called when plugin is activated (after detection matched) */
  onActivate?(api: PluginAPI): void | Promise<void>;

  /** Called when plugin is deactivating (shutdown) */
  onDeactivate?(api: PluginAPI): void | Promise<void>;

  /** Health check providers */
  readonly healthChecks?: HealthCheckProvider[];

  /** CLI command providers */
  readonly commands?: CommandProvider[];

  /** Dashboard panel providers */
  readonly dashboardPanels?: PanelProvider[];

  /** Additional detector providers */
  readonly detectors?: DetectorProvider[];
}

// ---------------------------------------------------------------------------
// Plugin Permissions
// ---------------------------------------------------------------------------

export type PluginPermission =
  | { readonly type: 'event'; readonly pattern: string }
  | { readonly type: 'state'; readonly namespace: string; readonly mode: 'read' | 'readwrite' }
  | { readonly type: 'config'; readonly namespace: string }
  | { readonly type: 'command'; readonly name: string }
  | { readonly type: 'dashboard'; readonly panel: string }
  | { readonly type: 'health'; readonly probe: string }
  | { readonly type: 'fs'; readonly path: string; readonly mode: 'read' | 'write' }
  | { readonly type: 'network'; readonly host: string; readonly port?: number }
  | { readonly type: 'process'; readonly command: string };

// ---------------------------------------------------------------------------
// Plugin API (exposed to plugins in sandbox)
// ---------------------------------------------------------------------------

export interface PluginAPI {
  /** Scoped event bus */
  readonly events: PluginEventAPI;

  /** Scoped state access */
  readonly state: PluginStateAPI;

  /** Scoped config access */
  readonly config: PluginConfigAPI;

  /** Prefixed logger */
  readonly logger: PluginLoggerAPI;

  /** Health probe registration */
  readonly health: PluginHealthAPI;

  /** CLI command registration */
  readonly cli: PluginCliAPI;

  /** Dashboard panel registration */
  readonly dashboard: PluginDashboardAPI;

  /** Scoped persistent storage */
  readonly storage: PluginStorageAPI;

  /** Read-only project context */
  readonly context: PluginContext;
}

export interface PluginEventAPI {
  on(event: string, handler: (...args: unknown[]) => void): void;
  emit(event: string, data: unknown): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
}

export interface PluginStateAPI {
  get<T = unknown>(selector: string): T;
  subscribe(selector: string, handler: (value: unknown) => void): () => void;
  setOwn(key: string, value: unknown): void;
}

export interface PluginConfigAPI {
  get<T = unknown>(key: string, defaultValue?: T): T;
}

export interface PluginLoggerAPI {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  fatal(message: string, ...args: unknown[]): void;
}

export interface PluginHealthAPI {
  register(probe: HealthProbeDefinition): void;
  report(status: HealthStatus, message?: string): void;
}

export interface PluginCliAPI {
  register(command: CommandDefinition): void;
}

export interface PluginDashboardAPI {
  register(panel: PanelDefinition): void;
}

export interface PluginStorageAPI {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface PluginContext {
  readonly projectRoot: string;
  readonly projectName: string;
  readonly projectType: string;
  readonly framework: string | null;
  readonly packageManager: string;
  readonly nodeVersion: string;
}

// ---------------------------------------------------------------------------
// Detection Types
// ---------------------------------------------------------------------------

export interface DetectionContext {
  /** Absolute path to project root */
  readonly projectRoot: string;

  /** Parsed package.json (if exists) */
  readonly packageJson: Record<string, unknown> | null;

  /** List of files in project root */
  readonly rootFiles: string[];

  /** Whether Docker is available */
  readonly dockerAvailable: boolean;

  /** Detected package manager */
  readonly packageManager: string;
}

export interface DetectionResult {
  /** Confidence score (0–1) */
  readonly confidence: number;

  /** Detected framework/technology name */
  readonly name: string;

  /** Additional metadata */
  readonly meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Provider Types
// ---------------------------------------------------------------------------

export interface HealthCheckProvider {
  readonly name: string;
  readonly probe: HealthProbeDefinition;
}

export interface HealthProbeDefinition {
  readonly type: 'http' | 'tcp' | 'process' | 'custom';
  readonly target?: string;
  readonly interval?: number;
  readonly timeout?: number;
  readonly retries?: number;
  check?(): Promise<{ healthy: boolean; message?: string }>;
}

export interface CommandProvider {
  readonly name: string;
  readonly command: CommandDefinition;
}

export interface CommandDefinition {
  readonly name: string;
  readonly description: string;
  readonly aliases?: string[];
  readonly args?: CommandArg[];
  readonly flags?: CommandFlag[];
  execute(args: Record<string, unknown>, flags: Record<string, unknown>): Promise<void>;
}

export interface CommandArg {
  readonly name: string;
  readonly description: string;
  readonly required?: boolean;
}

export interface CommandFlag {
  readonly name: string;
  readonly alias?: string;
  readonly description: string;
  readonly type: 'string' | 'number' | 'boolean';
  readonly default?: unknown;
}

export interface PanelProvider {
  readonly name: string;
  readonly panel: PanelDefinition;
}

export interface PanelDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly icon?: string;
  readonly order?: number;
  getData(): Promise<Record<string, unknown>>;
}

export interface DetectorProvider {
  readonly name: string;
  detect(context: DetectionContext): DetectionResult | null;
}
