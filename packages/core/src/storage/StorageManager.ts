/**
 * DevsPilot Storage Manager
 *
 * Handles file-based persistent key-value storage for the engine and plugins.
 * Stores data in ~/.DevsPilot/store.json or project-local metadata folders.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getHomeDir } from '@devspilot/shared';
import { createLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';

export interface StorageManagerOptions {
  projectRoot: string;
}

export class StorageManager {
  private readonly log: Logger;
  private readonly storePath: string;
  private data: Record<string, any> = {};

  constructor(_options: StorageManagerOptions) {
    this.log = createLogger({ name: 'StorageManager' });

    // Persistent storage location: ~/.DevsPilot/store.json
    const home = getHomeDir();
    const DevsPilotDir = join(home, '.DevsPilot');
    this.storePath = join(DevsPilotDir, 'store.json');

    this.init();
  }

  private init(): void {
    try {
      const dir = dirname(this.storePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      if (existsSync(this.storePath)) {
        const raw = readFileSync(this.storePath, 'utf-8');
        this.data = JSON.parse(raw);
      } else {
        this.data = {};
        this.save();
      }
    } catch (err) {
      this.log.error(`Failed to initialize storage: ${err instanceof Error ? err.message : String(err)}`);
      this.data = {};
    }
  }

  /**
   * Reads a key from persistent storage.
   */
  get<T = unknown>(key: string, namespace = 'global'): T | null {
    const nsData = this.data[namespace] || {};
    return (nsData[key] as T) ?? null;
  }

  /**
   * Sets a key in persistent storage.
   */
  set(key: string, value: unknown, namespace = 'global'): void {
    if (!this.data[namespace]) {
      this.data[namespace] = {};
    }
    this.data[namespace][key] = value;
    this.save();
  }

  /**
   * Deletes a key from persistent storage.
   */
  delete(key: string, namespace = 'global'): void {
    if (this.data[namespace]) {
      delete this.data[namespace][key];
      this.save();
    }
  }

  /**
   * Clears a namespace or all stored data.
   */
  clear(namespace?: string): void {
    if (namespace) {
      delete this.data[namespace];
    } else {
      this.data = {};
    }
    this.save();
  }

  private save(): void {
    try {
      writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      this.log.error(`Failed to write to persistent storage: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Lightweight, memory-bound Least-Recently-Used (LRU) Cache Layer.
 */
export class CacheManager<K, V> {
  private readonly max: number;
  private readonly cache = new Map<K, V>();

  constructor(max = 100) {
    this.max = max;
  }

  get(key: K): V | undefined {
    const item = this.cache.get(key);
    if (item !== undefined) {
      // Refresh key access order
      this.cache.delete(key);
      this.cache.set(key, item);
    }
    return item;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.max) {
      // Evict oldest item
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}
