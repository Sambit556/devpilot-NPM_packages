/**
 * DevsPilot Performance Engine
 *
 * Scrapes system and service resource usage:
 * - Monitors CPU and memory (RSS) per running service
 * - Tracks system-wide load average and free memory
 * - Triggers events when services exceed memory/CPU thresholds
 */

import { execSync } from 'node:child_process';
import { freemem, totalmem, loadavg, uptime } from 'node:os';
import { monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks';
import type { ResolvedConfig, ServicePerfMetrics, SystemMetrics } from '@devspilot/shared';
import { EventBus } from '../bus/EventBus.js';
import { StateManager } from '../state/StateManager.js';
import { createLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';

export interface PerfEngineOptions {
  eventBus: EventBus;
  stateManager: StateManager;
  projectRoot: string;
}

export class PerfEngine {
  private readonly log: Logger;
  private readonly eventBus: EventBus;
  private readonly stateManager: StateManager;
  private readonly eventLoopMonitor = monitorEventLoopDelay({ resolution: 20 });
  private gcDurationMs = 0;
  private gcObserver: PerformanceObserver | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: PerfEngineOptions) {
    this.eventBus = options.eventBus;
    this.stateManager = options.stateManager;
    this.log = createLogger({ name: 'PerfEngine' });

    // Enable Event Loop monitor
    this.eventLoopMonitor.enable();

    // Enable GC Performance Observer
    try {
      this.gcObserver = new PerformanceObserver((items) => {
        for (const entry of items.getEntries()) {
          this.gcDurationMs += entry.duration;
        }
      });
      this.gcObserver.observe({ entryTypes: ['gc'] });
    } catch {
      // GC observer not supported in this run context
    }
  }

  /**
   * Starts performance metrics scraping.
   */
  start(config: ResolvedConfig): void {
    this.stop();

    this.log.info('Starting performance engine monitoring...');

    // Run scrape every 5 seconds
    this.timer = setInterval(() => {
      void this.scrape(config);
    }, 5000);
  }

  /**
   * Stops scraping.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.log.info('Performance engine stopped');
  }

  /**
   * Scrapes CPU and memory usage of all running services and system.
   */
  private async scrape(config: ResolvedConfig): Promise<void> {
    const serviceStates = this.stateManager.getState().services;
    const servicesMetrics: Record<string, ServicePerfMetrics> = {};

    for (const [name, svc] of Object.entries(serviceStates)) {
      if (svc.pid && svc.status === 'running') {
        const metrics = this.getProcessMetrics(svc.pid);
        if (metrics) {
          servicesMetrics[name] = {
            cpuPercent: metrics.cpu,
            rssBytes: metrics.memory,
            heapUsedBytes: process.memoryUsage().heapUsed,
            heapTotalBytes: process.memoryUsage().heapTotal,
            uptimeMs: svc.startedAt ? Date.now() - svc.startedAt : 0,
            restartCount: svc.restartCount,
          };

          // Check against config thresholds
          this.checkThresholds(name, metrics, config);
        }
      }
    }

    // Capture Event Loop lag (converted from nanoseconds to milliseconds)
    const eventLoopLagMs = Math.round((this.eventLoopMonitor.mean || 0) / 1e6 * 100) / 100;
    this.eventLoopMonitor.reset();

    // Capture GC durations
    const gcDurationMs = Math.round(this.gcDurationMs * 100) / 100;
    this.gcDurationMs = 0; // reset

    // Capture active process handles count (file, socket, timer handles)
    let activeHandles = 0;
    if (typeof (process as any)._getActiveHandles === 'function') {
      try {
        activeHandles = (process as any)._getActiveHandles().length;
      } catch {
        // ignore
      }
    }

    const system: SystemMetrics = {
      cpuPercent: this.getSystemCpu(),
      totalMemoryBytes: totalmem(),
      freeMemoryBytes: freemem(),
      loadAverage: loadavg(),
      uptimeSeconds: uptime(),
      eventLoopLagMs,
      gcDurationMs,
      activeHandles,
    };

    // Update state
    this.stateManager.update((state) => ({
      performance: {
        ...state.performance,
        services: servicesMetrics,
        system,
      },
    }));

    this.eventBus.emit('perf:report', {
      type: 'perf:report',
      payload: { services: servicesMetrics },
      timestamp: Date.now(),
      source: 'PerfEngine',
    });
  }

  /**
   * Fetches process metrics using tasklist/wmic (Windows) or ps (Mac/Linux).
   */
  private getProcessMetrics(pid: number): { cpu: number; memory: number } | null {
    try {
      if (process.platform === 'win32') {
        // Use wmic to get WorkingSetSize (Memory in bytes)
        const output = execSync(
          `wmic process where "ProcessID=${pid}" get WorkingSetSize /value`,
          { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 },
        );
        const match = /WorkingSetSize=(\d+)/.exec(output);
        if (match?.[1]) {
          const memory = parseInt(match[1], 10);
          return { cpu: 0, memory }; // CPU calculation on Windows via CLI is slow, default 0
        }
      } else {
        // Use ps to get %cpu and rss (in KB)
        const output = execSync(`ps -p ${pid} -o %cpu,rss`, {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 2000,
        });
        const lines = output.trim().split('\n');
        if (lines[1]) {
          const parts = lines[1].trim().split(/\s+/);
          const cpu = parseFloat(parts[0] ?? '0');
          const memoryKb = parseInt(parts[1] ?? '0', 10);
          return { cpu, memory: memoryKb * 1024 };
        }
      }
    } catch {
      // ignore errors
    }

    return null;
  }

  private checkThresholds(
    serviceName: string,
    metrics: { cpu: number; memory: number },
    config: ResolvedConfig,
  ): void {
    if (!config.performance.alerts) return;

    // Validate memory threshold if set
    if (config.performance.maxMemory) {
      const limitBytes = this.parseBytes(config.performance.maxMemory);
      if (metrics.memory > limitBytes) {
        this.eventBus.emit('perf:threshold', {
          type: 'perf:threshold',
          payload: {
            metric: 'memory',
            value: metrics.memory,
            threshold: limitBytes,
            service: serviceName,
          },
          timestamp: Date.now(),
          source: 'PerfEngine',
        });
      }
    }

    // Validate CPU threshold if set
    if (config.performance.maxCpu) {
      if (metrics.cpu > config.performance.maxCpu) {
        this.eventBus.emit('perf:threshold', {
          type: 'perf:threshold',
          payload: {
            metric: 'cpu',
            value: metrics.cpu,
            threshold: config.performance.maxCpu,
            service: serviceName,
          },
          timestamp: Date.now(),
          source: 'PerfEngine',
        });
      }
    }
  }

  private getSystemCpu(): number {
    // Simple load-based approximation
    const loads = loadavg();
    const load = loads[0] ?? 0;
    return Math.min(Math.round(load * 10), 100);
  }

  private parseBytes(sizeStr: string): number {
    const match = /^(\d+)(KB|MB|GB)?$/i.exec(sizeStr.trim());
    if (!match) return 0;
    const value = parseInt(match[1]!, 10);
    const unit = match[2]?.toUpperCase();
    if (unit === 'KB') return value * 1024;
    if (unit === 'MB') return value * 1024 * 1024;
    if (unit === 'GB') return value * 1024 * 1024 * 1024;
    return value;
  }
}
