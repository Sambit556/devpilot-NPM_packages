/**
 * DevsPilot File Watcher
 *
 * Listens for file changes and triggers smart, debounced, targeted service restarts.
 * Extends chokidar for native OS events and reads ignore patterns dynamically.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { DEFAULT_WATCH_IGNORE, DEFAULT_DEBOUNCE_MS } from '@devspilot/shared';
import type { ResolvedConfig, ResolvedServiceConfig } from '@devspilot/shared';
import { EventBus } from '../bus/EventBus.js';
import { ProcessManager } from '../process/ProcessManager.js';
import { createLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';

export interface FileWatcherOptions {
  eventBus: EventBus;
  processManager: ProcessManager;
  projectRoot: string;
}

export class FileWatcher {
  private readonly log: Logger;
  private readonly eventBus: EventBus;
  private readonly processManager: ProcessManager;
  private readonly projectRoot: string;
  private watcher: FSWatcher | null = null;
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: FileWatcherOptions) {
    this.eventBus = options.eventBus;
    this.processManager = options.processManager;
    this.projectRoot = resolve(options.projectRoot);
    this.log = createLogger({ name: 'FileWatcher' });
  }

  /**
   * Start watching files across the project directory.
   */
  async start(config: ResolvedConfig): Promise<void> {
    if (this.watcher) {
      await this.stop();
    }

    const ignorePatterns = this.gatherIgnorePatterns(config);

    this.log.info('Initializing file watcher...');
    this.log.debug(`Ignore patterns: ${JSON.stringify(ignorePatterns)}`);

    this.watcher = chokidar.watch(this.projectRoot, {
      ignored: ignorePatterns,
      persistent: true,
      ignoreInitial: true,
      cwd: this.projectRoot,
      useFsEvents: true, // Use FSEvents on macOS natively
    });

    this.watcher.on('all', (event, filePath) => {
      const type = event === 'add' || event === 'change' || event === 'unlink' ? event : 'change';
      this.handleFileChange(filePath, type, config);
    });

    this.watcher.on('error', (error) => {
      this.log.error(`Watcher error: ${error.message}`);
    });
  }

  /**
   * Stop watching files.
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this.log.info('File watcher stopped');
    }

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /**
   * Gathers all watch ignore patterns from global settings, individual services,
   * and .gitignore/.dockerignore if they exist.
   */
  private gatherIgnorePatterns(config: ResolvedConfig): string[] {
    const patterns = new Set<string>([...DEFAULT_WATCH_IGNORE, ...config.watch.ignore]);

    // Parse .gitignore
    const gitignorePath = join(this.projectRoot, '.gitignore');
    if (existsSync(gitignorePath)) {
      this.parseIgnoreFile(gitignorePath, patterns);
    }

    // Parse .dockerignore
    const dockerignorePath = join(this.projectRoot, '.dockerignore');
    if (existsSync(dockerignorePath)) {
      this.parseIgnoreFile(dockerignorePath, patterns);
    }

    // Parse service-specific ignores
    for (const svc of Object.values(config.services)) {
      if (svc.watch.ignore) {
        for (const pattern of svc.watch.ignore) {
          patterns.add(pattern);
        }
      }
    }

    return [...patterns];
  }

  private parseIgnoreFile(filePath: string, patternsSet: Set<string>): void {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        patternsSet.add(trimmed);
      }
    } catch {
      // Ignore reading issues
    }
  }

  /**
   * Processes a file change event and triggers corresponding service restarts.
   */
  private handleFileChange(
    filePath: string,
    type: 'add' | 'change' | 'unlink',
    config: ResolvedConfig,
  ): void {
    const absolutePath = resolve(this.projectRoot, filePath);
    this.log.debug(`File changed: [${type}] ${filePath}`);

    // Find services affected by this file change
    const affectedServices: ResolvedServiceConfig[] = [];

    for (const svc of Object.values(config.services)) {
      if (!svc.watch.enabled) continue;

      const svcDir = resolve(this.projectRoot, svc.cwd);

      // Check if file is inside the service's cwd/subdirectory
      if (absolutePath.startsWith(svcDir)) {
        // If the service has explicit paths, check them
        if (svc.watch.paths.length > 0) {
          const matched = svc.watch.paths.some((p) => {
            const fullWatchPath = resolve(svcDir, p);
            return absolutePath.startsWith(fullWatchPath);
          });
          if (matched) {
            affectedServices.push(svc);
          }
        } else {
          // If no specific paths are declared, watch all files in cwd
          affectedServices.push(svc);
        }
      }
    }

    // Emit watch change events
    for (const svc of affectedServices) {
      this.eventBus.emit('file:changed', {
        type: 'file:changed',
        payload: { path: filePath, type, service: svc.name },
        timestamp: Date.now(),
        source: 'FileWatcher',
      });

      this.triggerServiceRestart(svc);
    }

    // If no service is matched, emit global file changed event
    if (affectedServices.length === 0) {
      this.eventBus.emit('file:changed', {
        type: 'file:changed',
        payload: { path: filePath, type, service: null },
        timestamp: Date.now(),
        source: 'FileWatcher',
      });
    }
  }

  /**
   * Debounces service restarts to handle multiple rapid file writes.
   */
  private triggerServiceRestart(svc: ResolvedServiceConfig): void {
    const { name, watch } = svc;
    const debounceDelay = watch.debounce ?? DEFAULT_DEBOUNCE_MS;

    const existingTimer = this.debounceTimers.get(name);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(name);
      this.log.info(`Smart restart triggered by watch for service: ${name}`);
      void this.processManager.restart(name);
    }, debounceDelay);

    this.debounceTimers.set(name, timer);
  }
}
