/**
 * DevsPilot Shared Types — Event System
 *
 * Strongly-typed event definitions for the internal event bus.
 * All inter-module communication flows through these events.
 */

// ---------------------------------------------------------------------------
// Event Base
// ---------------------------------------------------------------------------

export interface DevsPilotEvent<T extends string = string, P = unknown> {
  readonly type: T;
  readonly payload: P;
  readonly timestamp: number;
  readonly source: string;
}

// ---------------------------------------------------------------------------
// Engine Events
// ---------------------------------------------------------------------------

export type EngineStartingEvent = DevsPilotEvent<'engine:starting', { version: string }>;
export type EngineReadyEvent = DevsPilotEvent<'engine:ready', { startupMs: number }>;
export type EngineStoppingEvent = DevsPilotEvent<'engine:stopping', { reason: string }>;
export type EngineStoppedEvent = DevsPilotEvent<'engine:stopped', { shutdownMs: number }>;
export type EngineErrorEvent = DevsPilotEvent<'engine:error', { error: string; fatal: boolean }>;

export type EngineEvent =
  | EngineStartingEvent
  | EngineReadyEvent
  | EngineStoppingEvent
  | EngineStoppedEvent
  | EngineErrorEvent;

// ---------------------------------------------------------------------------
// Process Events
// ---------------------------------------------------------------------------

export type ProcessStartedEvent = DevsPilotEvent<
  'process:started',
  { name: string; pid: number; command: string }
>;
export type ProcessReadyEvent = DevsPilotEvent<
  'process:ready',
  { name: string; pid: number; startupMs: number }
>;
export type ProcessOutputEvent = DevsPilotEvent<
  'process:output',
  { name: string; stream: 'stdout' | 'stderr'; data: string }
>;
export type ProcessCrashedEvent = DevsPilotEvent<
  'process:crashed',
  { name: string; pid: number; exitCode: number | null; signal: string | null }
>;
export type ProcessRestartingEvent = DevsPilotEvent<
  'process:restarting',
  { name: string; attempt: number; maxAttempts: number; backoffMs: number }
>;
export type ProcessStoppedEvent = DevsPilotEvent<
  'process:stopped',
  { name: string; pid: number; exitCode: number | null }
>;
export type ProcessFailedEvent = DevsPilotEvent<
  'process:failed',
  { name: string; reason: string; restartCount: number }
>;

export type ProcessEvent =
  | ProcessStartedEvent
  | ProcessReadyEvent
  | ProcessOutputEvent
  | ProcessCrashedEvent
  | ProcessRestartingEvent
  | ProcessStoppedEvent
  | ProcessFailedEvent;

// ---------------------------------------------------------------------------
// Port Events
// ---------------------------------------------------------------------------

export type PortAllocatedEvent = DevsPilotEvent<
  'port:allocated',
  { port: number; service: string }
>;
export type PortConflictEvent = DevsPilotEvent<
  'port:conflict',
  { port: number; service: string; blockedBy: { pid: number; name: string } | null }
>;
export type PortReleasedEvent = DevsPilotEvent<'port:released', { port: number; service: string }>;

export type PortEvent = PortAllocatedEvent | PortConflictEvent | PortReleasedEvent;

// ---------------------------------------------------------------------------
// Environment Events
// ---------------------------------------------------------------------------

export type EnvLoadedEvent = DevsPilotEvent<
  'env:loaded',
  { file: string; count: number }
>;
export type EnvMissingEvent = DevsPilotEvent<
  'env:missing',
  { variables: string[]; required: boolean }
>;
export type EnvConflictEvent = DevsPilotEvent<
  'env:conflict',
  { variable: string; files: string[] }
>;

export type EnvEvent = EnvLoadedEvent | EnvMissingEvent | EnvConflictEvent;

// ---------------------------------------------------------------------------
// File Events
// ---------------------------------------------------------------------------

export type FileChangedEvent = DevsPilotEvent<
  'file:changed',
  { path: string; type: 'add' | 'change' | 'unlink'; service: string | null }
>;

export type FileEvent = FileChangedEvent;

// ---------------------------------------------------------------------------
// Health Events
// ---------------------------------------------------------------------------

export type HealthCheckEvent = DevsPilotEvent<
  'health:check',
  { service: string; status: HealthStatus; responseMs: number }
>;
export type HealthDegradedEvent = DevsPilotEvent<
  'health:degraded',
  { service: string; reason: string }
>;
export type HealthRecoveredEvent = DevsPilotEvent<
  'health:recovered',
  { service: string; downMs: number }
>;

export type HealthEvent = HealthCheckEvent | HealthDegradedEvent | HealthRecoveredEvent;

// ---------------------------------------------------------------------------
// Docker Events
// ---------------------------------------------------------------------------

export type DockerStartedEvent = DevsPilotEvent<
  'docker:started',
  { container: string; image: string }
>;
export type DockerStoppedEvent = DevsPilotEvent<
  'docker:stopped',
  { container: string }
>;
export type DockerHealthyEvent = DevsPilotEvent<
  'docker:healthy',
  { container: string }
>;

export type DockerEvent = DockerStartedEvent | DockerStoppedEvent | DockerHealthyEvent;

// ---------------------------------------------------------------------------
// Plugin Events
// ---------------------------------------------------------------------------

export type PluginLoadedEvent = DevsPilotEvent<
  'plugin:loaded',
  { name: string; version: string }
>;
export type PluginErrorEvent = DevsPilotEvent<
  'plugin:error',
  { name: string; error: string }
>;
export type PluginUnloadedEvent = DevsPilotEvent<
  'plugin:unloaded',
  { name: string }
>;

export type PluginEvent = PluginLoadedEvent | PluginErrorEvent | PluginUnloadedEvent;

// ---------------------------------------------------------------------------
// Security Events
// ---------------------------------------------------------------------------

export type SecurityWarningEvent = DevsPilotEvent<
  'security:warning',
  { category: string; message: string; severity: 'low' | 'moderate' | 'high' | 'critical' }
>;
export type SecurityVulnerabilityEvent = DevsPilotEvent<
  'security:vulnerability',
  { package: string; severity: string; advisory: string }
>;

export type SecurityEvent = SecurityWarningEvent | SecurityVulnerabilityEvent;

// ---------------------------------------------------------------------------
// Performance Events
// ---------------------------------------------------------------------------

export type PerfThresholdEvent = DevsPilotEvent<
  'perf:threshold',
  { metric: string; value: number; threshold: number; service: string }
>;
export type PerfReportEvent = DevsPilotEvent<
  'perf:report',
  { services: Record<string, ServicePerfMetrics> }
>;

export type PerfEvent = PerfThresholdEvent | PerfReportEvent;

// ---------------------------------------------------------------------------
// Scheduler Events
// ---------------------------------------------------------------------------

export type SchedulerTaskDoneEvent = DevsPilotEvent<
  'scheduler:task_done',
  { task: string; elapsedMs: number }
>;
export type SchedulerTaskFailedEvent = DevsPilotEvent<
  'scheduler:task_failed',
  { task: string; error: string }
>;

export type SchedulerEvent = SchedulerTaskDoneEvent | SchedulerTaskFailedEvent;

// ---------------------------------------------------------------------------
// All Events Union
// ---------------------------------------------------------------------------

export type AllEvents =
  | EngineEvent
  | ProcessEvent
  | PortEvent
  | EnvEvent
  | FileEvent
  | HealthEvent
  | DockerEvent
  | PluginEvent
  | SecurityEvent
  | PerfEvent
  | SchedulerEvent;

// ---------------------------------------------------------------------------
// Event Map (for typed listeners)
// ---------------------------------------------------------------------------

export interface EventMap {
  'engine:starting': EngineStartingEvent;
  'engine:ready': EngineReadyEvent;
  'engine:stopping': EngineStoppingEvent;
  'engine:stopped': EngineStoppedEvent;
  'engine:error': EngineErrorEvent;
  'process:started': ProcessStartedEvent;
  'process:ready': ProcessReadyEvent;
  'process:output': ProcessOutputEvent;
  'process:crashed': ProcessCrashedEvent;
  'process:restarting': ProcessRestartingEvent;
  'process:stopped': ProcessStoppedEvent;
  'process:failed': ProcessFailedEvent;
  'port:allocated': PortAllocatedEvent;
  'port:conflict': PortConflictEvent;
  'port:released': PortReleasedEvent;
  'env:loaded': EnvLoadedEvent;
  'env:missing': EnvMissingEvent;
  'env:conflict': EnvConflictEvent;
  'file:changed': FileChangedEvent;
  'health:check': HealthCheckEvent;
  'health:degraded': HealthDegradedEvent;
  'health:recovered': HealthRecoveredEvent;
  'docker:started': DockerStartedEvent;
  'docker:stopped': DockerStoppedEvent;
  'docker:healthy': DockerHealthyEvent;
  'plugin:loaded': PluginLoadedEvent;
  'plugin:error': PluginErrorEvent;
  'plugin:unloaded': PluginUnloadedEvent;
  'security:warning': SecurityWarningEvent;
  'security:vulnerability': SecurityVulnerabilityEvent;
  'perf:threshold': PerfThresholdEvent;
  'perf:report': PerfReportEvent;
  'scheduler:task_done': SchedulerTaskDoneEvent;
  'scheduler:task_failed': SchedulerTaskFailedEvent;
}

export type EventType = keyof EventMap;

// ---------------------------------------------------------------------------
// Supporting Types (referenced by events)
// ---------------------------------------------------------------------------

export type HealthStatus = 'unknown' | 'starting' | 'healthy' | 'degraded' | 'unhealthy' | 'dead';

export interface ServicePerfMetrics {
  cpuPercent: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  uptimeMs: number;
  restartCount: number;
}
