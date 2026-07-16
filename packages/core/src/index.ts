/**
 * @devspilot/core — Public API
 *
 * Exports the engine, all core modules, and utilities.
 */

// Engine
export { DevsPilotEngine } from './engine/index.js';
export type { DevsPilotEngineOptions, EngineContext } from './engine/index.js';

// Event Bus
export { EventBus } from './bus/index.js';

// State Manager
export { StateManager, createInitialState } from './state/index.js';

// Config
export { ConfigLoader } from './config/index.js';
export type { ConfigLoaderOptions } from './config/index.js';

// Detector
export { DetectorEngine } from './detector/index.js';
export type { DetectionResult } from './detector/index.js';

// Process Manager
export { ProcessManager } from './process/index.js';
export type { ProcessManagerOptions } from './process/index.js';

// Port Manager
export { PortManager } from './port/index.js';
export type { PortConflictInfo } from './port/index.js';

// Log Manager
export { LogManager } from './log/index.js';
export type { LogEntry, LogManagerOptions } from './log/index.js';

// Env Manager
export { EnvManager } from './env/index.js';
export type { EnvManagerOptions } from './env/index.js';

// File Watcher
export { FileWatcher } from './watcher/index.js';
export type { FileWatcherOptions } from './watcher/index.js';

// Health Engine
export { HealthEngine } from './health/index.js';
export type { HealthEngineOptions } from './health/index.js';

// Git Manager
export { GitManager } from './git/index.js';
export type { GitManagerOptions } from './git/index.js';

// Security Engine
export { SecurityEngine } from './security/index.js';
export type { SecurityEngineOptions, SecurityIssue } from './security/index.js';

// Performance Engine
export { PerfEngine } from './performance/index.js';
export type { PerfEngineOptions } from './performance/index.js';

// Diagnostics Engine
export { DiagnosticsEngine } from './diagnostics/index.js';
export type { DiagnosticsEngineOptions } from './diagnostics/index.js';

// Plugin Loader
export { PluginLoader } from './plugin/index.js';
export type { PluginLoaderOptions } from './plugin/index.js';

// Storage Manager
export { StorageManager, CacheManager } from './storage/index.js';
export type { StorageManagerOptions } from './storage/index.js';

// Docker Manager
export { DockerManager } from './docker/index.js';
export type { DockerManagerOptions } from './docker/index.js';

// Database Manager
export { DatabaseManager } from './database/index.js';
export type { DatabaseManagerOptions } from './database/index.js';

// Network Manager
export { NetworkManager } from './network/index.js';
export type { NetworkManagerOptions } from './network/index.js';

// Task Scheduler
export { TaskScheduler } from './scheduler/index.js';
export type { TaskDefinition, TaskSchedulerOptions } from './scheduler/index.js';

// Module Registry
export { ModuleRegistry } from './registry/index.js';
export type { CoreModule } from './registry/index.js';

// Utilities
export { createLogger, createChildLogger, sendNotification, playSoundAlert, copyToClipboard } from './utils/index.js';
export type { Logger } from './utils/index.js';
export {
  DevsPilotError,
  ConfigNotFoundError,
  ConfigParseError,
  ConfigValidationError,
  PortConflictError,
  ProcessCrashError,
  ProcessMaxRestartsError,
  MissingDependencyError,
  PluginLoadError,
  PluginPermissionError,
  HealthCheckFailedError,
  MissingEnvVarError,
} from './utils/index.js';
