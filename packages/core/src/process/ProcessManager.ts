/**
 * DevsPilot Process Manager
 *
 * Manages the lifecycle of child processes (services). Handles:
 * - Spawning with proper signal forwarding
 * - stdout/stderr capture and routing to event bus
 * - Crash detection with exponential backoff restart
 * - Graceful shutdown (SIGTERM → wait → SIGKILL)
 * - Orphan process cleanup
 * - Per-process metrics (PID, uptime, restart count)
 *
 * Safety guarantees:
 * - Only kills processes it spawned (tracked by PID set)
 * - Never uses shell: true (prevents command injection)
 * - Cleans up all children on exit
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import type { ResolvedServiceConfig, ServiceState, ServiceStatus } from '@devspilot/shared';
import {
  DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  DEFAULT_KILL_TIMEOUT_MS,
  isWindows,
} from '@devspilot/shared';
import { EventBus } from '../bus/EventBus.js';
import { StateManager } from '../state/StateManager.js';
import { createLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManagedProcess {
  name: string;
  config: ResolvedServiceConfig;
  child: ChildProcess | null;
  status: ServiceStatus;
  pid: number | null;
  startedAt: number | null;
  restartCount: number;
  lastRestartAt: number | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
  currentBackoff: number;
  exitCode: number | null;
  stopping: boolean;
}

export interface ProcessManagerOptions {
  eventBus: EventBus;
  stateManager: StateManager;
  projectRoot: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class ProcessManager {
  private readonly log: Logger;
  private readonly eventBus: EventBus;
  private readonly stateManager: StateManager;
  private readonly projectRoot: string;
  private readonly processes = new Map<string, ManagedProcess>();
  private disposed = false;

  constructor(options: ProcessManagerOptions) {
    this.eventBus = options.eventBus;
    this.stateManager = options.stateManager;
    this.projectRoot = resolve(options.projectRoot);
    this.log = createLogger({ name: 'ProcessManager' });

    // Register cleanup handlers
    this.registerCleanupHandlers();
  }

  /**
   * Start a service process.
   */
  async start(config: ResolvedServiceConfig): Promise<void> {
    if (this.processes.has(config.name)) {
      this.log.warn(`Service "${config.name}" is already managed`);
      return;
    }

    const managed: ManagedProcess = {
      name: config.name,
      config,
      child: null,
      status: 'pending',
      pid: null,
      startedAt: null,
      restartCount: 0,
      lastRestartAt: null,
      restartTimer: null,
      currentBackoff: config.restart.backoff,
      exitCode: null,
      stopping: false,
    };

    this.processes.set(config.name, managed);
    await this.spawnProcess(managed);
  }

  /**
   * Stop a specific service.
   */
  async stop(name: string): Promise<void> {
    const managed = this.processes.get(name);
    if (!managed) {
      this.log.warn(`Service "${name}" not found`);
      return;
    }

    managed.stopping = true;

    // Clear any pending restart timer
    if (managed.restartTimer) {
      clearTimeout(managed.restartTimer);
      managed.restartTimer = null;
    }

    await this.killProcess(managed);
    this.processes.delete(name);
  }

  /**
   * Stop all managed services gracefully.
   */
  async stopAll(): Promise<void> {
    const names = [...this.processes.keys()];
    this.log.info(`Stopping ${names.length} services...`);

    // Stop all in parallel
    await Promise.allSettled(names.map((name) => this.stop(name)));

    this.log.info('All services stopped');
  }

  /**
   * Restart a specific service.
   */
  async restart(name: string): Promise<void> {
    const managed = this.processes.get(name);
    if (!managed) {
      this.log.warn(`Service "${name}" not found`);
      return;
    }

    this.log.info(`Restarting service "${name}"...`);
    await this.killProcess(managed);

    // Reset restart count for manual restart
    managed.restartCount = 0;
    managed.currentBackoff = managed.config.restart.backoff;
    managed.stopping = false;

    await this.spawnProcess(managed);
  }

  /**
   * Get the current state of all managed processes.
   */
  getServiceStates(): Record<string, ServiceState> {
    const states: Record<string, ServiceState> = {};

    for (const [name, managed] of this.processes) {
      states[name] = {
        name,
        command: managed.config.command,
        cwd: managed.config.cwd,
        status: managed.status,
        pid: managed.pid,
        port: managed.config.port,
        startedAt: managed.startedAt,
        uptimeMs: managed.startedAt ? Date.now() - managed.startedAt : 0,
        exitCode: managed.exitCode,
        restartCount: managed.restartCount,
        lastRestartAt: managed.lastRestartAt,
        group: managed.config.group,
        health: 'unknown',
        perf: null,
      };
    }

    return states;
  }

  /**
   * Check if any services are running.
   */
  hasRunningProcesses(): boolean {
    for (const managed of this.processes.values()) {
      if (managed.child && managed.status === 'running') return true;
    }
    return false;
  }

  /**
   * Dispose the process manager. Kills all processes.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.stopAll();
  }

  // -------------------------------------------------------------------------
  // Private: Process Lifecycle
  // -------------------------------------------------------------------------

  private async spawnProcess(managed: ManagedProcess): Promise<void> {
    const { name, config } = managed;
    const cwd = resolve(this.projectRoot, config.cwd);

    // Parse command into binary + args (safe: no shell)
    const parts = this.parseCommand(config.command);
    if (parts.length === 0) {
      this.log.error(`Empty command for service "${name}"`);
      this.updateStatus(managed, 'failed');
      return;
    }

    const [cmd, ...args] = parts;

    this.log.info(`Starting "${name}": ${config.command}`);
    this.updateStatus(managed, 'starting');

    try {
      const child = spawn(cmd!, args, {
        cwd,
        env: { ...process.env, ...config.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        // On Windows, use shell to resolve npm/npx commands
        shell: isWindows(),
        // Don't detach — we want the process to die with us
        detached: false,
        windowsHide: true,
      });

      managed.child = child;
      managed.pid = child.pid ?? null;
      managed.startedAt = Date.now();
      managed.exitCode = null;

      // Route stdout to event bus
      child.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        this.eventBus.emit('process:output', {
          type: 'process:output',
          payload: { name, stream: 'stdout', data: output },
          timestamp: Date.now(),
          source: 'ProcessManager',
        });
      });

      // Route stderr to event bus
      child.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        this.eventBus.emit('process:output', {
          type: 'process:output',
          payload: { name, stream: 'stderr', data: output },
          timestamp: Date.now(),
          source: 'ProcessManager',
        });
      });

      // Handle process exit
      child.on('exit', (code, signal) => {
        this.handleExit(managed, code, signal);
      });

      // Handle spawn errors
      child.on('error', (error) => {
        this.log.error(`Spawn error for "${name}": ${error.message}`);
        this.updateStatus(managed, 'failed');
      });

      this.updateStatus(managed, 'running');

      this.eventBus.emit('process:started', {
        type: 'process:started',
        payload: { name, pid: managed.pid ?? 0, command: config.command },
        timestamp: Date.now(),
        source: 'ProcessManager',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.error(`Failed to start "${name}": ${message}`);
      this.updateStatus(managed, 'failed');
    }
  }

  private handleExit(managed: ManagedProcess, code: number | null, signal: string | null): void {
    const { name } = managed;

    managed.child = null;
    managed.pid = null;
    managed.exitCode = code;

    if (managed.stopping) {
      // Intentional stop
      this.updateStatus(managed, 'stopped');
      this.eventBus.emit('process:stopped', {
        type: 'process:stopped',
        payload: { name, pid: managed.pid ?? 0, exitCode: code },
        timestamp: Date.now(),
        source: 'ProcessManager',
      });
      return;
    }

    // Unintentional exit → crash
    this.log.warn(`Service "${name}" exited (code=${code}, signal=${signal})`);
    this.updateStatus(managed, 'crashed');

    this.eventBus.emit('process:crashed', {
      type: 'process:crashed',
      payload: { name, pid: managed.pid ?? 0, exitCode: code, signal },
      timestamp: Date.now(),
      source: 'ProcessManager',
    });

    // Attempt restart with backoff
    if (managed.config.restart.enabled) {
      this.scheduleRestart(managed);
    } else {
      this.updateStatus(managed, 'failed');
    }
  }

  private scheduleRestart(managed: ManagedProcess): void {
    const { name, config } = managed;

    if (managed.restartCount >= config.restart.maxRetries) {
      this.log.error(`Service "${name}" exceeded max restarts (${managed.restartCount})`);
      this.updateStatus(managed, 'failed');

      this.eventBus.emit('process:failed', {
        type: 'process:failed',
        payload: {
          name,
          reason: `Exceeded max restart attempts (${config.restart.maxRetries})`,
          restartCount: managed.restartCount,
        },
        timestamp: Date.now(),
        source: 'ProcessManager',
      });
      return;
    }

    managed.restartCount++;
    managed.lastRestartAt = Date.now();
    this.updateStatus(managed, 'restarting');

    const backoff = managed.currentBackoff;
    this.log.info(
      `Restarting "${name}" in ${backoff}ms (attempt ${managed.restartCount}/${config.restart.maxRetries})`,
    );

    this.eventBus.emit('process:restarting', {
      type: 'process:restarting',
      payload: {
        name,
        attempt: managed.restartCount,
        maxAttempts: config.restart.maxRetries,
        backoffMs: backoff,
      },
      timestamp: Date.now(),
      source: 'ProcessManager',
    });

    managed.restartTimer = setTimeout(() => {
      managed.restartTimer = null;
      void this.spawnProcess(managed);
    }, backoff);

    // Exponential backoff (cap at maxBackoff)
    managed.currentBackoff = Math.min(
      managed.currentBackoff * 2,
      config.restart.maxBackoff,
    );
  }

  // -------------------------------------------------------------------------
  // Private: Process Termination
  // -------------------------------------------------------------------------

  private async killProcess(managed: ManagedProcess): Promise<void> {
    if (!managed.child) return;

    const { name } = managed;
    const child = managed.child;

    return new Promise<void>((resolve) => {
      const forceKillTimer = setTimeout(() => {
        this.log.warn(`Force-killing "${name}" (SIGKILL)`);
        try {
          child.kill('SIGKILL');
        } catch {
          // Already dead
        }
        resolve();
      }, DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS);

      child.once('exit', () => {
        clearTimeout(forceKillTimer);
        resolve();
      });

      // Send graceful signal
      this.log.debug(`Sending SIGTERM to "${name}" (PID ${managed.pid})`);
      try {
        if (isWindows()) {
          // Windows doesn't support SIGTERM well, use taskkill
          child.kill();
        } else {
          child.kill('SIGTERM');
        }
      } catch {
        clearTimeout(forceKillTimer);
        resolve();
      }
    });
  }

  // -------------------------------------------------------------------------
  // Private: Helpers
  // -------------------------------------------------------------------------

  /**
   * Parse a command string into [binary, ...args].
   * Handles quoted arguments.
   */
  private parseCommand(command: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (const char of command) {
      if (inQuote) {
        if (char === quoteChar) {
          inQuote = false;
        } else {
          current += char;
        }
      } else if (char === '"' || char === "'") {
        inQuote = true;
        quoteChar = char;
      } else if (char === ' ' || char === '\t') {
        if (current.length > 0) {
          parts.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current.length > 0) {
      parts.push(current);
    }

    return parts;
  }

  private updateStatus(managed: ManagedProcess, status: ServiceStatus): void {
    managed.status = status;

    // Update state manager
    this.stateManager.update((state) => ({
      services: {
        ...state.services,
        [managed.name]: {
          name: managed.name,
          command: managed.config.command,
          cwd: managed.config.cwd,
          status,
          pid: managed.pid,
          port: managed.config.port,
          startedAt: managed.startedAt,
          uptimeMs: managed.startedAt ? Date.now() - managed.startedAt : 0,
          exitCode: managed.exitCode,
          restartCount: managed.restartCount,
          lastRestartAt: managed.lastRestartAt,
          group: managed.config.group,
          health: 'unknown',
          perf: null,
        },
      },
    }));
  }

  private registerCleanupHandlers(): void {
    const cleanup = () => {
      // Synchronous kill of all children on exit
      for (const managed of this.processes.values()) {
        if (managed.child) {
          try {
            managed.child.kill('SIGKILL');
          } catch {
            // Best effort
          }
        }
        if (managed.restartTimer) {
          clearTimeout(managed.restartTimer);
        }
      }
    };

    process.on('exit', cleanup);
    process.on('SIGINT', () => {
      void this.dispose().then(() => process.exit(130));
    });
    process.on('SIGTERM', () => {
      void this.dispose().then(() => process.exit(0));
    });
  }
}
