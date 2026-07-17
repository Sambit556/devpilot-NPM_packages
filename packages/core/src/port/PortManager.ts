/**
 * DevsPilot Port Manager
 *
 * Handles port allocation, conflict detection, and resolution.
 * Never kills processes without user confirmation.
 */

import { createConnection, type Socket } from 'node:net';
import { execSync } from 'node:child_process';
import { isWindows, isValidPort } from '@devspilot/shared';
import type { PortState } from '@devspilot/shared';
import { EventBus } from '../bus/EventBus.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PortConflictInfo {
  port: number;
  pid: number | null;
  processName: string | null;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class PortManager {
  private readonly eventBus: EventBus;
  private readonly allocations = new Map<number, string>();

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Check if a port is available.
   */
  async isPortAvailable(port: number): Promise<boolean> {
    if (!isValidPort(port)) return false;

    return new Promise<boolean>((resolve) => {
      const socket: Socket = createConnection({ port, host: '127.0.0.1' });

      socket.once('connect', () => {
        socket.destroy();
        resolve(false); // Port is in use
      });

      socket.once('error', () => {
        socket.destroy();
        resolve(true); // Port is free
      });

      // Timeout after 1s
      socket.setTimeout(1000, () => {
        socket.destroy();
        resolve(true); // Assume available on timeout
      });
    });
  }

  /**
   * Check multiple ports and return their status.
   */
  async checkPorts(ports: number[]): Promise<PortState[]> {
    const results: PortState[] = [];

    for (const port of ports) {
      const available = await this.isPortAvailable(port);
      const service = this.allocations.get(port) ?? '';

      if (available) {
        results.push({
          port,
          service,
          status: 'available',
          conflictPid: null,
          conflictProcess: null,
        });
      } else {
        const conflict = this.findProcessOnPort(port);
        results.push({
          port,
          service,
          status: 'conflict',
          conflictPid: conflict?.pid ?? null,
          conflictProcess: conflict?.processName ?? null,
        });
      }
    }

    return results;
  }

  /**
   * Allocate a port for a service.
   */
  allocate(port: number, service: string): void {
    this.allocations.set(port, service);
    this.eventBus.emit('port:allocated', {
      type: 'port:allocated',
      payload: { port, service },
      timestamp: Date.now(),
      source: 'PortManager',
    });
  }

  /**
   * Release a port allocation.
   */
  release(port: number): void {
    const service = this.allocations.get(port) ?? '';
    this.allocations.delete(port);
    this.eventBus.emit('port:released', {
      type: 'port:released',
      payload: { port, service },
      timestamp: Date.now(),
      source: 'PortManager',
    });
  }

  /**
   * Find a free port starting from a given port number.
   */
  async findFreePort(startPort: number): Promise<number> {
    let port = startPort;
    const maxAttempts = 100;

    for (let i = 0; i < maxAttempts; i++) {
      if (await this.isPortAvailable(port)) {
        return port;
      }
      port++;
    }

    throw new Error(`Could not find a free port starting from ${startPort}`);
  }

  /**
   * Get all current port allocations.
   */
  getAllocations(): Map<number, string> {
    return new Map(this.allocations);
  }

  /**
   * Find which process is using a port (best effort).
   */
  findProcessOnPort(port: number): PortConflictInfo | null {
    try {
      if (isWindows()) {
        const output = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
          encoding: 'utf-8',
          timeout: 3000,
        });
        const match = /\s+(\d+)\s*$/.exec(output.trim().split('\n')[0] ?? '');
        if (match?.[1]) {
          const pid = parseInt(match[1], 10);
          return { port, pid, processName: null };
        }
      } else {
        const output = execSync(`lsof -i :${port} -t 2>/dev/null`, {
          encoding: 'utf-8',
          timeout: 3000,
        });
        const pid = parseInt(output.trim().split('\n')[0] ?? '', 10);
        if (!isNaN(pid)) {
          return { port, pid, processName: null };
        }
      }
    } catch {
      // Best effort — lsof/netstat may not be available
    }

    return null;
  }

  /**
   * Dispose and release all allocations.
   */
  dispose(): void {
    this.allocations.clear();
  }
}
