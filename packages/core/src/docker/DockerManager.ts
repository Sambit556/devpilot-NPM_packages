/**
 * DevsPilot Docker Manager
 *
 * Interacts with local Docker daemon and docker-compose files:
 * - Verifies Docker daemon status
 * - Parses compose files
 * - Coordinates container lifecycle (up, down, restart)
 * - Gathers container stats (CPU, RAM, Networks, Volumes)
 * - Streams container logs into log aggregate
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { ResolvedConfig, ContainerState } from '@devspilot/shared';
import { EventBus } from '../bus/EventBus.js';
import { StateManager } from '../state/StateManager.js';
import { createLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';

export interface DockerManagerOptions {
  eventBus: EventBus;
  stateManager: StateManager;
  projectRoot: string;
}

export class DockerManager {
  private readonly log: Logger;
  private readonly eventBus: EventBus;
  private readonly stateManager: StateManager;
  private readonly projectRoot: string;
  private isDockerAvailable = false;
  private isDockerComposeFound = false;
  private logProcess: any = null;

  constructor(options: DockerManagerOptions) {
    this.eventBus = options.eventBus;
    this.stateManager = options.stateManager;
    this.projectRoot = resolve(options.projectRoot);
    this.log = createLogger({ name: 'DockerManager' });
  }

  /**
   * Initialize Docker capability checks.
   */
  init(config: ResolvedConfig): boolean {
    const composeFile = config.docker.composeFile || 'docker-compose.yml';
    const composePath = join(this.projectRoot, composeFile);

    if (existsSync(composePath)) {
      this.isDockerComposeFound = true;
    }

    try {
      execSync('docker info', { stdio: 'ignore', timeout: 3000 });
      this.isDockerAvailable = true;

      this.stateManager.update((state) => ({
        docker: {
          ...state.docker,
          available: true,
          running: true,
          composeFile: this.isDockerComposeFound ? composeFile : null,
        },
      }));
      return true;
    } catch {
      this.log.debug('Docker daemon is not running or docker CLI is missing.');
      this.stateManager.update((state) => ({
        docker: {
          ...state.docker,
          available: false,
          running: false,
          composeFile: this.isDockerComposeFound ? composeFile : null,
        },
      }));
      return false;
    }
  }

  /**
   * Start Docker compose containers if autoStart is configured.
   */
  async startContainers(config: ResolvedConfig): Promise<void> {
    if (!this.isDockerAvailable || !this.isDockerComposeFound) return;
    if (!config.docker.autoStart) return;

    this.log.info('Launching docker compose containers...');

    try {
      const composeFile = config.docker.composeFile || 'docker-compose.yml';
      // Pull images (H9) in background
      this.log.debug('Verifying Docker images pull status...');
      execSync(`docker compose -f ${composeFile} pull`, {
        cwd: this.projectRoot,
        stdio: 'ignore',
        timeout: 60000,
      });

      // Start containers (H3)
      execSync(`docker compose -f ${composeFile} up -d`, {
        cwd: this.projectRoot,
        stdio: 'ignore',
        timeout: 30000,
      });

      this.log.info('Docker compose containers started successfully.');
      await this.updateContainerStates(config);

      // Tail logs (H5)
      this.streamComposeLogs(composeFile);
    } catch (err: any) {
      this.log.error(`Docker compose up failed: ${err.message}`);
    }
  }

  /**
   * Stops docker compose containers gracefully.
   */
  async stopContainers(config: ResolvedConfig): Promise<void> {
    if (this.logProcess) {
      this.logProcess.kill();
      this.logProcess = null;
    }

    if (!this.isDockerAvailable || !this.isDockerComposeFound) return;

    this.log.info('Stopping docker compose containers...');
    try {
      const composeFile = config.docker.composeFile || 'docker-compose.yml';
      execSync(`docker compose -f ${composeFile} down`, {
        cwd: this.projectRoot,
        stdio: 'ignore',
        timeout: 30000,
      });
      this.log.info('Docker compose containers stopped.');
    } catch (err: any) {
      this.log.error(`Docker compose down failed: ${err.message}`);
    }
  }

  /**
   * Scrapes status, health, and resource usages of active containers.
   */
  async updateContainerStates(config: ResolvedConfig): Promise<void> {
    if (!this.isDockerAvailable || !this.isDockerComposeFound) return;

    const composeFile = config.docker.composeFile || 'docker-compose.yml';
    try {
      // Get container list (H4)
      const psOutput = execSync(`docker compose -f ${composeFile} ps --format json`, {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
      });

      const rawContainers = psOutput
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter((c) => c !== null);

      const containers: ContainerState[] = [];

      for (const raw of rawContainers) {
        const name = raw.Name || raw.Service || 'container';
        const id = raw.ID || name;
        const status = raw.State === 'running' ? 'running' : 'exited';
        const health = raw.Health === 'healthy' ? 'healthy' : 'unknown';

        // Scrape memory/CPU metrics (H6)
        let cpuPercent = 0;
        let memoryBytes = 0;
        try {
          const statsOutput = execSync(`docker stats ${id} --no-stream --format "{{.CPUPerc}},{{.MemUsage}}"`, {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 2000,
          });
          const parts = statsOutput.trim().split(',');
          if (parts[0] && parts[1]) {
            cpuPercent = parseFloat(parts[0].replace('%', '')) || 0;
            // Memory formats like "2.3MiB / 7.7GiB"
            const memPart = parts[1].split('/')[0]?.trim();
            if (memPart) {
              memoryBytes = this.parseDockerBytes(memPart);
            }
          }
        } catch {
          // stats not available or container stopped
        }

        containers.push({
          id,
          name,
          image: raw.Image || '',
          status,
          health,
          ports: [],
          cpuPercent,
          memoryBytes,
        });

        // Emit lifecycle state change
        if (status === 'running') {
          this.eventBus.emit('docker:started', {
            type: 'docker:started',
            payload: { container: name, image: raw.Image || '' },
            timestamp: Date.now(),
            source: 'DockerManager',
          });
        }
      }

      this.stateManager.update((state) => ({
        docker: {
          ...state.docker,
          containers,
        },
      }));
    } catch {
      // ignore
    }
  }

  /**
   * Offers volume size/prune information (H10).
   */
  getCleanupSuggestions(): string[] {
    const suggestions: string[] = [];
    if (!this.isDockerAvailable) return suggestions;

    try {
      const pruneReport = execSync('docker system df', { encoding: 'utf-8', timeout: 3000 });
      suggestions.push('Docker resource summary:', ...pruneReport.trim().split('\n'));
    } catch {
      // ignore
    }

    return suggestions;
  }

  private streamComposeLogs(composeFile: string): void {
    try {
      this.logProcess = spawn('docker', ['compose', '-f', composeFile, 'logs', '-f', '--tail=10'], {
        cwd: this.projectRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      this.logProcess.stdout.on('data', (data: Buffer) => {
        this.eventBus.emit('process:output', {
          type: 'process:output',
          payload: { name: 'docker-compose', stream: 'stdout', data: data.toString() },
          timestamp: Date.now(),
          source: 'DockerManager',
        });
      });

      this.logProcess.stderr.on('data', (data: Buffer) => {
        this.eventBus.emit('process:output', {
          type: 'process:output',
          payload: { name: 'docker-compose', stream: 'stderr', data: data.toString() },
          timestamp: Date.now(),
          source: 'DockerManager',
        });
      });
    } catch {
      // ignore
    }
  }

  private parseDockerBytes(sizeStr: string): number {
    const match = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TIB|MIB|KIB)?/i.exec(sizeStr.trim());
    if (!match) return 0;
    const value = parseFloat(match[1]!);
    const unit = match[2]?.toUpperCase();

    if (unit === 'KIB' || unit === 'KB') return value * 1024;
    if (unit === 'MIB' || unit === 'MB') return value * 1024 * 1024;
    if (unit === 'GIB' || unit === 'GB') return value * 1024 * 1024 * 1024;
    return value;
  }
}
