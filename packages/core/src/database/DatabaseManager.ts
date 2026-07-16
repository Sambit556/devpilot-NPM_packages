/**
 * DevsPilot Database & Cache Manager
 *
 * Scans environment variables and configuration for database/cache connection URIs.
 * Validates active connection pings using net.Socket connectivity tests.
 * Auto-detects schema migrations, DB files, and configurations.
 */

import { existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createConnection } from 'node:net';
import type { DatabaseInstance, ResolvedConfig } from '@devspilot/shared';
import { EventBus } from '../bus/EventBus.js';
import { StateManager } from '../state/StateManager.js';
import { createLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';

export interface DatabaseManagerOptions {
  eventBus: EventBus;
  stateManager: StateManager;
  projectRoot: string;
}

export class DatabaseManager {
  private readonly log: Logger;
  private readonly eventBus: EventBus;
  private readonly stateManager: StateManager;
  private readonly projectRoot: string;

  constructor(options: DatabaseManagerOptions) {
    this.eventBus = options.eventBus;
    this.stateManager = options.stateManager;
    this.projectRoot = resolve(options.projectRoot);
    this.log = createLogger({ name: 'DatabaseManager' });
  }

  /**
   * Scan env files and project structures to identify, verify database/cache layers.
   */
  async scan(config: ResolvedConfig): Promise<void> {
    this.log.info('Scanning for database configurations...');

    const env = process.env;
    const instances: DatabaseInstance[] = [];

    // Parse potential database connection keys in env variables
    const dbEnvKeys = [
      'DATABASE_URL',
      'DB_CONNECTION',
      'MONGODB_URI',
      'MONGO_URL',
      'REDIS_URL',
      'REDIS_HOST',
      'PGPASSWORD',
      'POSTGRES_URL',
      'MYSQL_URL',
      'SQLITE_URL',
    ];

    const detectedSchemes = new Set<string>();

    for (const key of Object.keys(env)) {
      const isDbKey = dbEnvKeys.some((k) => key.includes(k)) || /^(DB|POSTGRES|MYSQL|MONGO|REDIS)_/i.test(key);
      if (!isDbKey) continue;

      const val = env[key] || '';
      if (!val) continue;

      // Match URI patterns
      const match = /^(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|sqlite):\/\/([^:/]+)?(?::(\d+))?(\/([^?]+))?/i.exec(val);
      if (match) {
        const dialect = match[1]!.toLowerCase();
        const host = match[2] || 'localhost';
        const portVal = match[3] ? parseInt(match[3], 10) : this.getDefaultPort(dialect);
        const databaseName = match[5] || null;

        const isDuplicate = instances.some((i) => i.dialect === dialect && i.host === host && i.port === portVal);
        if (!isDuplicate) {
          detectedSchemes.add(dialect);
          const connected = await this.testConnection(host, portVal, dialect);
          const { migrationsFound, framework } = this.detectMigrations(dialect);

          instances.push({
            dialect,
            host,
            port: portVal,
            databaseName,
            connected,
            migrationsFound,
            migrationFramework: framework,
          });
        }
      }
    }

    // SQLite file auto-detection fallback
    const sqlitePaths = ['prisma/dev.db', 'database.sqlite', 'db.sqlite', 'db.sqlite3'];
    for (const file of sqlitePaths) {
      const fullPath = join(this.projectRoot, file);
      if (existsSync(fullPath)) {
        const isDuplicate = instances.some((i) => i.dialect === 'sqlite');
        if (!isDuplicate) {
          detectedSchemes.add('sqlite');
          const { migrationsFound, framework } = this.detectMigrations('sqlite');
          instances.push({
            dialect: 'sqlite',
            host: 'localfile',
            port: null,
            databaseName: file,
            connected: true,
            migrationsFound,
            migrationFramework: framework,
          });
        }
      }
    }

    const detected = instances.length > 0;

    this.stateManager.update((state) => ({
      database: {
        detected,
        instances,
      },
    }));

    if (detected) {
      this.log.info(`Scanned and verified ${instances.length} database engine(s).`);
    }
  }

  private getDefaultPort(dialect: string): number | null {
    if (dialect.startsWith('postgres')) return 5432;
    if (dialect === 'mysql') return 3306;
    if (dialect.startsWith('mongo')) return 27017;
    if (dialect === 'redis') return 6379;
    return null;
  }

  private async testConnection(host: string, port: number | null, dialect: string): Promise<boolean> {
    if (!port) return false;
    return new Promise((resolve) => {
      const socket = createConnection({ host, port, timeout: 1500 });

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  private detectMigrations(dialect: string): { migrationsFound: boolean; framework: string | null } {
    // 1. Prisma checks
    if (existsSync(join(this.projectRoot, 'prisma/schema.prisma'))) {
      const migrationDir = join(this.projectRoot, 'prisma/migrations');
      return {
        migrationsFound: existsSync(migrationDir) && readdirSync(migrationDir).length > 0,
        framework: 'prisma',
      };
    }

    // 2. Standard migrations directory
    const folders = ['migrations', 'src/migrations', 'database/migrations'];
    for (const f of folders) {
      const p = join(this.projectRoot, f);
      if (existsSync(p) && readdirSync(p).length > 0) {
        // Detect knexfile or sequelize
        if (existsSync(join(this.projectRoot, 'knexfile.js')) || existsSync(join(this.projectRoot, 'knexfile.ts'))) {
          return { migrationsFound: true, framework: 'knex' };
        }
        if (existsSync(join(this.projectRoot, '.sequelizerc'))) {
          return { migrationsFound: true, framework: 'sequelize' };
        }
        return { migrationsFound: true, framework: 'generic' };
      }
    }

    return { migrationsFound: false, framework: null };
  }
}
