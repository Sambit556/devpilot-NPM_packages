/**
 * DevsPilot Health Engine
 *
 * Runs liveness/readiness probes on services. Support probes:
 * - HTTP (GET request, checks status code)
 * - TCP (Connects to port)
 * - Process (Verifies PID liveness)
 * - File (Verifies file existence)
 *
 * Implements liveness transition states:
 * UNKNOWN -> STARTING -> HEALTHY -> DEGRADED -> UNHEALTHY -> DEAD
 */

import { createConnection } from 'node:net';
import { existsSync, accessSync, constants } from 'node:fs';
import type { ResolvedConfig, ResolvedServiceConfig, HealthStatus } from '@devspilot/shared';
import {
  DEFAULT_HEALTH_INTERVAL_MS,
  DEFAULT_HEALTH_TIMEOUT_MS,
  DEFAULT_HEALTH_RETRIES,
  DEFAULT_HEALTH_START_PERIOD_MS,
} from '@devspilot/shared';
import { EventBus } from '../bus/EventBus.js';
import { StateManager } from '../state/StateManager.js';
import { ProcessManager } from '../process/ProcessManager.js';
import { createLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';

export interface HealthEngineOptions {
  eventBus: EventBus;
  stateManager: StateManager;
  processManager: ProcessManager;
}

interface ActiveHealthCheck {
  serviceName: string;
  config: ResolvedServiceConfig;
  timer: ReturnType<typeof setInterval> | null;
  consecutiveFailures: number;
  status: HealthStatus;
  upSince: number | null;
}

export class HealthEngine {
  private readonly log: Logger;
  private readonly eventBus: EventBus;
  private readonly stateManager: StateManager;
  private readonly processManager: ProcessManager;
  private readonly activeChecks = new Map<string, ActiveHealthCheck>();

  constructor(options: HealthEngineOptions) {
    this.eventBus = options.eventBus;
    this.stateManager = options.stateManager;
    this.processManager = options.processManager;
    this.log = createLogger({ name: 'HealthEngine' });
  }

  /**
   * Starts periodic health checks for all defined services.
   */
  start(config: ResolvedConfig): void {
    this.stop();

    this.log.info('Starting health engine checks...');

    for (const [name, svc] of Object.entries(config.services)) {
      const active: ActiveHealthCheck = {
        serviceName: name,
        config: svc,
        timer: null,
        consecutiveFailures: 0,
        status: 'unknown',
        upSince: null,
      };

      this.activeChecks.set(name, active);

      const interval = svc.health.interval ?? DEFAULT_HEALTH_INTERVAL_MS;

      // Initial check after startPeriod or immediately if startPeriod is 0
      const startPeriod = svc.health.startPeriod ?? DEFAULT_HEALTH_START_PERIOD_MS;
      setTimeout(() => {
        if (!this.activeChecks.has(name)) return;
        this.runSingleCheck(active);

        // Start interval
        active.timer = setInterval(() => {
          this.runSingleCheck(active);
        }, interval);
      }, startPeriod);
    }
  }

  /**
   * Stop all running health check intervals.
   */
  stop(): void {
    for (const check of this.activeChecks.values()) {
      if (check.timer) {
        clearInterval(check.timer);
      }
    }
    this.activeChecks.clear();
    this.log.info('Health engine stopped');
  }

  /**
   * Trigger check manually for a specific service.
   */
  async checkService(name: string): Promise<HealthStatus> {
    const active = this.activeChecks.get(name);
    if (!active) return 'unknown';

    await this.runSingleCheck(active);
    return active.status;
  }

  /**
   * Executes a single probe against the target service.
   */
  private async runSingleCheck(active: ActiveHealthCheck): Promise<void> {
    const { serviceName, config } = active;
    const startTime = performance.now();

    const serviceStates = this.stateManager.getState().services;
    const processState = serviceStates[serviceName];

    // If service isn't running according to process manager, skip check and mark dead/starting
    if (!processState || processState.status === 'stopped' || processState.status === 'failed') {
      this.updateServiceHealth(active, 'dead', 0, 'Service process is not running');
      return;
    }

    if (processState.status === 'starting') {
      this.updateServiceHealth(active, 'starting', 0, 'Service is spawning');
      return;
    }

    let isHealthy = false;
    let errorMsg = '';

    // Decide check method
    try {
      if (config.health.path) {
        isHealthy = await this.probeHttp(config);
      } else if (config.port) {
        isHealthy = await this.probeTcp(config.port, config.health.timeout ?? DEFAULT_HEALTH_TIMEOUT_MS);
      } else if (processState.pid) {
        isHealthy = this.probeProcess(processState.pid);
      } else {
        // Default liveness check
        isHealthy = true;
      }
    } catch (err) {
      isHealthy = false;
      errorMsg = err instanceof Error ? err.message : String(err);
    }

    const elapsed = Math.round(performance.now() - startTime);

    if (isHealthy) {
      active.consecutiveFailures = 0;
      if (active.status !== 'healthy') {
        const prevStatus = active.status;
        this.updateServiceHealth(active, 'healthy', elapsed);
        if (prevStatus === 'degraded' || prevStatus === 'unhealthy') {
          this.eventBus.emit('health:recovered', {
            type: 'health:recovered',
            payload: { service: serviceName, downMs: active.upSince ? Date.now() - active.upSince : 0 },
            timestamp: Date.now(),
            source: 'HealthEngine',
          });
        }
      }
    } else {
      active.consecutiveFailures++;
      const maxRetries = config.health.retries ?? DEFAULT_HEALTH_RETRIES;

      let nextStatus: HealthStatus = 'degraded';
      if (active.consecutiveFailures >= maxRetries) {
        nextStatus = 'unhealthy';
      }

      this.updateServiceHealth(active, nextStatus, elapsed, errorMsg || 'Probe failed');

      if (active.status !== nextStatus) {
        this.eventBus.emit('health:degraded', {
          type: 'health:degraded',
          payload: { service: serviceName, reason: errorMsg || 'Probe failed' },
          timestamp: Date.now(),
          source: 'HealthEngine',
        });
      }
    }
  }

  private updateServiceHealth(
    active: ActiveHealthCheck,
    status: HealthStatus,
    responseMs: number,
    message = '',
  ): void {
    const prevStatus = active.status;
    active.status = status;

    if (status === 'healthy' && prevStatus !== 'healthy') {
      active.upSince = Date.now();
    } else if (status !== 'healthy') {
      active.upSince = null;
    }

    // Update state manager
    this.stateManager.update((state) => {
      const currentServicesHealth = { ...state.health.services };
      currentServicesHealth[active.serviceName] = {
        status,
        lastCheckAt: Date.now(),
        responseMs,
        consecutiveFailures: active.consecutiveFailures,
        upSince: active.upSince,
      };

      // Recalculate overall health
      let overall: HealthStatus = 'healthy';
      const statuses = Object.values(currentServicesHealth).map((h) => h.status);

      if (statuses.includes('unhealthy') || statuses.includes('dead')) {
        overall = 'unhealthy';
      } else if (statuses.includes('degraded')) {
        overall = 'degraded';
      } else if (statuses.includes('starting')) {
        overall = 'starting';
      }

      return {
        health: {
          overall,
          services: currentServicesHealth,
          lastCheckAt: Date.now(),
        },
      };
    });

    this.eventBus.emit('health:check', {
      type: 'health:check',
      payload: { service: active.serviceName, status, responseMs },
      timestamp: Date.now(),
      source: 'HealthEngine',
    });
  }

  // Probes

  private async probeHttp(config: ResolvedServiceConfig): Promise<boolean> {
    const port = config.health.port ?? config.port ?? 80;
    const path = config.health.path ?? '/';
    const timeout = config.health.timeout ?? DEFAULT_HEALTH_TIMEOUT_MS;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
      const url = `http://127.0.0.1:${port}${path}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'DevsPilot-HealthEngine' },
      });
      clearTimeout(id);
      return response.status >= 200 && response.status < 400;
    } catch {
      clearTimeout(id);
      return false;
    }
  }

  private probeTcp(port: number, timeout: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const socket = createConnection({ port, host: '127.0.0.1' });
      socket.setTimeout(timeout);

      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  private probeProcess(pid: number): boolean {
    try {
      process.kill(pid, 0); // Send 0 signal to test PID existence
      return true;
    } catch {
      return false;
    }
  }

  private probeFile(filePath: string): boolean {
    try {
      accessSync(filePath, constants.R_OK | constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}
