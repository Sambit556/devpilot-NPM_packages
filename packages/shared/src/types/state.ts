/**
 * DevsPilot Shared Types — State
 *
 * Defines the complete state shape for the DevsPilot engine.
 * The StateManager holds a single immutable tree of this shape.
 */

import type { HealthStatus, ServicePerfMetrics } from './events.js';

// ---------------------------------------------------------------------------
// Root State
// ---------------------------------------------------------------------------

export interface DevsPilotState {
  readonly engine: EngineState;
  readonly config: ConfigState;
  readonly project: ProjectState;
  readonly services: Record<string, ServiceState>;
  readonly ports: PortState[];
  readonly env: EnvState;
  readonly health: HealthAggregateState;
  readonly docker: DockerState;
  readonly database: DatabaseState;
  readonly network: NetworkState;
  readonly git: GitState;
  readonly performance: PerfAggregateState;
  readonly plugins: Record<string, PluginInstanceState>;
  readonly diagnostics: DiagnosticState;
}

// ---------------------------------------------------------------------------
// Engine State
// ---------------------------------------------------------------------------

export type EngineStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

export interface EngineState {
  readonly status: EngineStatus;
  readonly version: string;
  readonly startedAt: number | null;
  readonly uptimeMs: number;
  readonly pid: number;
}

// ---------------------------------------------------------------------------
// Config State
// ---------------------------------------------------------------------------

export interface ConfigState {
  readonly loaded: boolean;
  readonly source: string | null;
  readonly profile: string | null;
}

// ---------------------------------------------------------------------------
// Project State
// ---------------------------------------------------------------------------

export type ProjectType =
  | 'node'
  | 'typescript'
  | 'monorepo'
  | 'unknown';

export type Framework =
  | 'react'
  | 'next'
  | 'vue'
  | 'nuxt'
  | 'angular'
  | 'svelte'
  | 'sveltekit'
  | 'express'
  | 'fastify'
  | 'nest'
  | 'koa'
  | 'hapi'
  | 'unknown'
  | null;

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun' | 'unknown';

export type BuildTool = 'vite' | 'webpack' | 'esbuild' | 'rollup' | 'swc' | 'tsc' | 'unknown' | null;

export interface ProjectState {
  readonly name: string;
  readonly root: string;
  readonly type: ProjectType;
  readonly framework: Framework;
  readonly packageManager: PackageManager;
  readonly buildTool: BuildTool;
  readonly nodeVersion: string | null;
  readonly isMonorepo: boolean;
  readonly workspaces: WorkspaceInfo[];
  readonly detectedAt: number;
}

export interface WorkspaceInfo {
  readonly name: string;
  readonly path: string;
  readonly type: ProjectType;
  readonly framework: Framework;
  readonly scripts: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Service State
// ---------------------------------------------------------------------------

export type ServiceStatus =
  | 'pending'
  | 'starting'
  | 'running'
  | 'healthy'
  | 'degraded'
  | 'unhealthy'
  | 'crashed'
  | 'restarting'
  | 'stopping'
  | 'stopped'
  | 'failed';

export interface ServiceState {
  readonly name: string;
  readonly command: string;
  readonly cwd: string;
  readonly status: ServiceStatus;
  readonly pid: number | null;
  readonly port: number | null;
  readonly startedAt: number | null;
  readonly uptimeMs: number;
  readonly exitCode: number | null;
  readonly restartCount: number;
  readonly lastRestartAt: number | null;
  readonly group: string | null;
  readonly health: HealthStatus;
  readonly perf: ServicePerfMetrics | null;
}

// ---------------------------------------------------------------------------
// Port State
// ---------------------------------------------------------------------------

export interface PortState {
  readonly port: number;
  readonly service: string;
  readonly status: 'available' | 'allocated' | 'conflict';
  readonly conflictPid: number | null;
  readonly conflictProcess: string | null;
}

// ---------------------------------------------------------------------------
// Environment State
// ---------------------------------------------------------------------------

export interface EnvState {
  readonly loaded: boolean;
  readonly files: string[];
  readonly variableCount: number;
  readonly missingRequired: string[];
  readonly unusedVars: string[];
  readonly conflicts: EnvConflict[];
}

export interface EnvConflict {
  readonly variable: string;
  readonly files: string[];
  readonly values: string[];
}

// ---------------------------------------------------------------------------
// Health Aggregate State
// ---------------------------------------------------------------------------

export interface HealthAggregateState {
  readonly overall: HealthStatus;
  readonly services: Record<string, ServiceHealthState>;
  readonly lastCheckAt: number | null;
}

export interface ServiceHealthState {
  readonly status: HealthStatus;
  readonly lastCheckAt: number;
  readonly responseMs: number;
  readonly consecutiveFailures: number;
  readonly upSince: number | null;
}

// ---------------------------------------------------------------------------
// Docker State
// ---------------------------------------------------------------------------

export interface DockerState {
  readonly available: boolean;
  readonly running: boolean;
  readonly composeFile: string | null;
  readonly containers: ContainerState[];
}

export interface ContainerState {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly status: 'created' | 'running' | 'paused' | 'restarting' | 'exited' | 'dead';
  readonly health: HealthStatus;
  readonly ports: Array<{ host: number; container: number; protocol: string }>;
  readonly cpuPercent: number;
  readonly memoryBytes: number;
}

// ---------------------------------------------------------------------------
// Git State
// ---------------------------------------------------------------------------

export interface GitState {
  readonly available: boolean;
  readonly branch: string | null;
  readonly commitHash: string | null;
  readonly commitMessage: string | null;
  readonly uncommittedChanges: number;
  readonly untrackedFiles: number;
  readonly unpushedCommits: number;
  readonly hasConflicts: boolean;
  readonly stashCount: number;
}

// ---------------------------------------------------------------------------
// Performance Aggregate State
// ---------------------------------------------------------------------------

export interface PerfAggregateState {
  readonly startupMs: number | null;
  readonly shutdownMs: number | null;
  readonly services: Record<string, ServicePerfMetrics>;
  readonly system: SystemMetrics;
}

export interface SystemMetrics {
  readonly cpuPercent: number;
  readonly totalMemoryBytes: number;
  readonly freeMemoryBytes: number;
  readonly loadAverage: number[];
  readonly uptimeSeconds: number;
  readonly eventLoopLagMs: number;
  readonly gcDurationMs: number;
  readonly activeHandles: number;
}

// ---------------------------------------------------------------------------
// Plugin Instance State
// ---------------------------------------------------------------------------

export type PluginStatus = 'discovered' | 'validated' | 'registered' | 'activated' | 'running' | 'deactivating' | 'stopped' | 'error';

export interface PluginInstanceState {
  readonly name: string;
  readonly version: string;
  readonly status: PluginStatus;
  readonly permissions: string[];
  readonly loadTimeMs: number;
  readonly error: string | null;
}

// ---------------------------------------------------------------------------
// Diagnostic State
// ---------------------------------------------------------------------------

export interface DiagnosticState {
  readonly lastRunAt: number | null;
  readonly checks: DiagnosticCheck[];
  readonly score: number | null;
}

export type DiagnosticSeverity = 'pass' | 'info' | 'warn' | 'error';

export interface DiagnosticCheck {
  readonly name: string;
  readonly category: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly suggestion: string | null;
}

// ---------------------------------------------------------------------------
// Database State
// ---------------------------------------------------------------------------

export interface DatabaseInstance {
  readonly dialect: string;
  readonly host: string;
  readonly port: number | null;
  readonly databaseName: string | null;
  readonly connected: boolean;
  readonly migrationsFound: boolean;
  readonly migrationFramework: string | null;
}

export interface DatabaseState {
  readonly detected: boolean;
  readonly instances: DatabaseInstance[];
}

// ---------------------------------------------------------------------------
// Network State
// ---------------------------------------------------------------------------

export interface NetworkState {
  readonly apis: string[];
  readonly websockets: boolean;
  readonly grpcEnabled: boolean;
  readonly messageQueues: string[];
}
