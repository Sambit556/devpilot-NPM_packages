/**
 * DevsPilot Module Registry
 *
 * Coordinates registration and lifecycle operations for all core engine modules.
 * Allows modules to dynamically lookup and invoke methods on other modules.
 */

import { createLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';

export type CoreModule = any;

export class ModuleRegistry {
  private readonly log: Logger;
  private readonly modules = new Map<string, CoreModule>();

  constructor() {
    this.log = createLogger({ name: 'ModuleRegistry' });
  }

  /**
   * Registers a core module instance.
   */
  register(name: string, instance: CoreModule): void {
    if (this.modules.has(name)) {
      this.log.warn(`Module "${name}" is already registered. Overwriting...`);
    }
    this.modules.set(name, instance);
    this.log.debug(`Registered module: ${name}`);
  }

  /**
   * Resolves a registered module by name.
   */
  get<T extends CoreModule>(name: string): T {
    const instance = this.modules.get(name);
    if (!instance) {
      throw new Error(`Module "${name}" is not registered in the ModuleRegistry`);
    }
    return instance as T;
  }

  /**
   * Checks if a module is registered.
   */
  has(name: string): boolean {
    return this.modules.has(name);
  }

  /**
   * Triggers stop and dispose cycles for all registered modules in reverse order.
   */
  async shutdownAll(): Promise<void> {
    const names = Array.from(this.modules.keys()).reverse();
    for (const name of names) {
      const instance = this.modules.get(name);
      if (instance) {
        try {
          if (typeof instance.stop === 'function') {
            await instance.stop();
          }
          if (typeof instance.dispose === 'function') {
            await instance.dispose();
          }
          this.log.debug(`Successfully shut down module: ${name}`);
        } catch (err: any) {
          this.log.error(`Error shutting down module "${name}": ${err.message}`);
        }
      }
    }
    this.modules.clear();
  }
}
