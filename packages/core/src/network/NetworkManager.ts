/**
 * DevsPilot Network & Service Discovery Manager
 *
 * Implements Category M (Network & Service Discovery) features:
 * - Scrapes route structures (API endpoints) using static analysis
 * - Identifies gRPC configs and proto files
 * - Detects WebSocket setups
 * - Identifies message queues (RabbitMQ, Kafka, BullMQ)
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import type { ResolvedConfig } from '@devspilot/shared';
import { EventBus } from '../bus/EventBus.js';
import { StateManager } from '../state/StateManager.js';
import { createLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';

export interface NetworkManagerOptions {
  eventBus: EventBus;
  stateManager: StateManager;
  projectRoot: string;
}

export class NetworkManager {
  private readonly log: Logger;
  private readonly stateManager: StateManager;
  private readonly projectRoot: string;

  constructor(options: NetworkManagerOptions) {
    this.stateManager = options.stateManager;
    this.projectRoot = resolve(options.projectRoot);
    this.log = createLogger({ name: 'NetworkManager' });
  }

  /**
   * Run discovery and populate network status state.
   */
  async discover(_config: ResolvedConfig): Promise<void> {
    this.log.info('Running network discovery scan...');

    let websockets = false;
    let grpcEnabled = false;
    const messageQueues: string[] = [];
    const apis: string[] = [];

    // 1. Scan dependencies inside package.json
    const pkgJsonPath = join(this.projectRoot, 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        // WebSockets
        if (deps['ws'] || deps['socket.io'] || deps['express-ws'] || deps['socket.io-client']) {
          websockets = true;
        }

        // gRPC
        if (deps['@grpc/grpc-js'] || deps['grpc']) {
          grpcEnabled = true;
        }

        // Message Queues
        if (deps['amqplib'] || deps['amqp']) messageQueues.push('rabbitmq');
        if (deps['kafkajs'] || deps['kafka-node']) messageQueues.push('kafka');
        if (deps['bull'] || deps['bullmq']) messageQueues.push('bullmq');
        if (deps['redis'] || deps['ioredis']) {
          // Redis also acts as cache
          messageQueues.push('redis');
        }
      } catch {
        // ignore JSON parse errors
      }
    }

    // 2. Scan for proto files (gRPC M5)
    this.scanForProtos(this.projectRoot, (_protoFile) => {
      grpcEnabled = true;
    });

    // 3. Scan code files for route endpoints (M3)
    this.scanForRoutes(this.projectRoot, (route) => {
      if (apis.length < 50 && !apis.includes(route)) {
        apis.push(route);
      }
    });

    this.stateManager.update((_state) => ({
      network: {
        apis,
        websockets,
        grpcEnabled,
        messageQueues,
      },
    }));

    this.log.info(`Discovery complete. Found ${apis.length} API route(s). WS: ${websockets ? 'yes' : 'no'}. gRPC: ${grpcEnabled ? 'yes' : 'no'}.`);
  }

  private scanForProtos(dir: string, callback: (filePath: string) => void, depth = 0): void {
    if (depth > 4) return;
    try {
      const items = readdirSync(dir);
      for (const item of items) {
        if (item === 'node_modules' || item === '.git' || item === 'dist') continue;
        const fullPath = join(dir, item);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          this.scanForProtos(fullPath, callback, depth + 1);
        } else if (extname(item) === '.proto') {
          callback(fullPath);
        }
      }
    } catch {
      // ignore read errors
    }
  }

  private scanForRoutes(dir: string, callback: (route: string) => void, depth = 0): void {
    if (depth > 4) return;
    try {
      const items = readdirSync(dir);
      for (const item of items) {
        if (item === 'node_modules' || item === '.git' || item === 'dist' || item === 'build') continue;
        const fullPath = join(dir, item);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          this.scanForRoutes(fullPath, callback, depth + 1);
        } else if (/\.(js|ts|jsx|tsx)$/.test(item)) {
          const content = readFileSync(fullPath, 'utf-8');
          // Match patterns: router.get('/foo'), app.post('/bar'), etc.
          const matches = content.matchAll(/\.(?:get|post|put|delete|patch)\(\s*['"`]([^'"`\s]+)['"`]/g);
          for (const m of matches) {
            if (m[1] && m[1].startsWith('/')) {
              callback(m[1]);
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }
}
