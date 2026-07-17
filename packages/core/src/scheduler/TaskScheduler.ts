/**
 * DevsPilot Task Scheduler
 *
 * Lightweight, dependency-free local job/cron task scheduler.
 * Handles recurring tasks, cron schedules, and intervals defined by plugins or config.
 */

import { EventBus } from '../bus/EventBus.js';
import { createLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';

export interface TaskDefinition {
  name: string;
  schedule: string; // e.g., "*/5 * * * *" (cron) or "every 10s"
  execute: () => Promise<void> | void;
}

export interface TaskSchedulerOptions {
  eventBus: EventBus;
}

export class TaskScheduler {
  private readonly log: Logger;
  private readonly eventBus: EventBus;
  private readonly activeTasks = new Map<string, { definition: TaskDefinition; timer: ReturnType<typeof setInterval> | null }>();

  constructor(options: TaskSchedulerOptions) {
    this.eventBus = options.eventBus;
    this.log = createLogger({ name: 'TaskScheduler' });
  }

  /**
   * Register and start a scheduled task.
   */
  register(task: TaskDefinition): void {
    if (this.activeTasks.has(task.name)) {
      this.unregister(task.name);
    }

    this.log.info(`Registering task "${task.name}" with schedule "${task.schedule}"`);

    let timer: ReturnType<typeof setInterval> | null = null;

    // Parse simple interval format: "every 10s" or "every 5m"
    const intervalMatch = /^every\s+(\d+)(s|m|h)$/i.exec(task.schedule.trim());
    if (intervalMatch) {
      const amount = parseInt(intervalMatch[1]!, 10);
      const unit = intervalMatch[2]!.toLowerCase();
      let ms = amount * 1000;

      if (unit === 'm') ms = amount * 60 * 1000;
      if (unit === 'h') ms = amount * 60 * 60 * 1000;

      timer = setInterval(() => {
        void this.runTask(task);
      }, ms);
    } else {
      // Basic fallback cron evaluation (runs every 60s for standard minute resolution)
      timer = setInterval(() => {
        if (this.matchCronPattern(task.schedule)) {
          void this.runTask(task);
        }
      }, 60000);
    }

    this.activeTasks.set(task.name, { definition: task, timer });
  }

  /**
   * Stop and remove a registered task.
   */
  unregister(name: string): void {
    const active = this.activeTasks.get(name);
    if (active) {
      if (active.timer) {
        clearInterval(active.timer);
      }
      this.activeTasks.delete(name);
      this.log.info(`Unregistered task "${name}"`);
    }
  }

  /**
   * Clear all active timers.
   */
  dispose(): void {
    for (const name of this.activeTasks.keys()) {
      this.unregister(name);
    }
  }

  private async runTask(task: TaskDefinition): Promise<void> {
    const startTime = performance.now();
    this.log.debug(`Executing task: ${task.name}`);

    try {
      await task.execute();
      const elapsed = Math.round(performance.now() - startTime);

      this.eventBus.emit('scheduler:task_done', {
        type: 'scheduler:task_done',
        payload: { task: task.name, elapsedMs: elapsed },
        timestamp: Date.now(),
        source: 'TaskScheduler',
      } as any);
    } catch (err: any) {
      this.log.error(`Task "${task.name}" failed: ${err.message}`);
      this.eventBus.emit('scheduler:task_failed', {
        type: 'scheduler:task_failed',
        payload: { task: task.name, error: err.message },
        timestamp: Date.now(),
        source: 'TaskScheduler',
      } as any);
    }
  }

  /**
   * Evaluates standard cron strings (limited subset: handles *, values, and steps).
   */
  private matchCronPattern(pattern: string): boolean {
    const parts = pattern.trim().split(/\s+/);
    if (parts.length !== 5) return false;

    const now = new Date();
    const current = {
      minute: now.getMinutes(),
      hour: now.getHours(),
      dayOfMonth: now.getDate(),
      month: now.getMonth() + 1, // Jan is 0
      dayOfWeek: now.getDay(), // Sun is 0, Sat is 6
    };

    const cronParts = [
      this.evaluateField(parts[0]!, current.minute, 0, 59),
      this.evaluateField(parts[1]!, current.hour, 0, 23),
      this.evaluateField(parts[2]!, current.dayOfMonth, 1, 31),
      this.evaluateField(parts[3]!, current.month, 1, 12),
      this.evaluateField(parts[4]!, current.dayOfWeek, 0, 6),
    ];

    return cronParts.every((matched) => matched);
  }

  private evaluateField(field: string, current: number, _min: number, _max: number): boolean {
    if (field === '*') return true;

    // Step pattern: */5
    const stepMatch = /^\*\/(\d+)$/.exec(field);
    if (stepMatch?.[1]) {
      const step = parseInt(stepMatch[1], 10);
      return current % step === 0;
    }

    // List of values: 1,3,5
    if (field.includes(',')) {
      const values = field.split(',').map((v) => parseInt(v.trim(), 10));
      return values.includes(current);
    }

    // Single value
    const val = parseInt(field, 10);
    return val === current;
  }
}
