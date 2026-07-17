/**
 * DevsPilot State Manager
 *
 * Single source of truth for the entire DevsPilot engine state.
 * Uses immutable update patterns — state is never mutated in place.
 *
 * Features:
 * - Immutable state tree
 * - Selector-based subscriptions (only notified on relevant changes)
 * - State diffing for efficient WebSocket sync
 * - Snapshot/restore for debugging
 */

import type { DevsPilotState } from '@devspilot/shared';
import { deepFreeze } from '@devspilot/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StateSelector<T> = (state: DevsPilotState) => T;
type StateListener<T> = (value: T, prevValue: T) => void;

interface Subscription {
  readonly id: number;
  readonly selector: StateSelector<unknown>;
  readonly listener: StateListener<unknown>;
  lastValue: unknown;
}

// ---------------------------------------------------------------------------
// Initial State Factory
// ---------------------------------------------------------------------------

export function createInitialState(): DevsPilotState {
  return deepFreeze({
    engine: {
      status: 'idle',
      version: '0.0.1',
      startedAt: null,
      uptimeMs: 0,
      pid: process.pid,
    },
    config: {
      loaded: false,
      source: null,
      profile: null,
    },
    project: {
      name: 'unknown',
      root: process.cwd(),
      type: 'unknown',
      framework: null,
      packageManager: 'unknown',
      buildTool: null,
      nodeVersion: process.version,
      isMonorepo: false,
      workspaces: [],
      detectedAt: 0,
    },
    services: {},
    ports: [],
    env: {
      loaded: false,
      files: [],
      variableCount: 0,
      missingRequired: [],
      unusedVars: [],
      conflicts: [],
    },
    health: {
      overall: 'unknown',
      services: {},
      lastCheckAt: null,
    },
    docker: {
      available: false,
      running: false,
      composeFile: null,
      containers: [],
    },
    git: {
      available: false,
      branch: null,
      commitHash: null,
      commitMessage: null,
      uncommittedChanges: 0,
      untrackedFiles: 0,
      unpushedCommits: 0,
      hasConflicts: false,
      stashCount: 0,
    },
    database: {
      detected: false,
      instances: [],
    },
    network: {
      apis: [],
      websockets: false,
      grpcEnabled: false,
      messageQueues: [],
    },
    performance: {
      startupMs: null,
      shutdownMs: null,
      services: {},
      system: {
        cpuPercent: 0,
        totalMemoryBytes: 0,
        freeMemoryBytes: 0,
        loadAverage: [],
        uptimeSeconds: 0,
        eventLoopLagMs: 0,
        gcDurationMs: 0,
        activeHandles: 0,
      },
    },
    plugins: {},
    diagnostics: {
      lastRunAt: null,
      checks: [],
      score: null,
    },
  }) as DevsPilotState;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class StateManager {
  private state: DevsPilotState;
  private readonly subscriptions = new Map<number, Subscription>();
  private nextId = 0;
  private disposed = false;

  constructor(initialState?: DevsPilotState) {
    this.state = initialState ?? createInitialState();
  }

  /**
   * Get the current state (read-only).
   */
  getState(): Readonly<DevsPilotState> {
    return this.state;
  }

  /**
   * Get a selected slice of state.
   */
  select<T>(selector: StateSelector<T>): T {
    return selector(this.state);
  }

  /**
   * Update state immutably. The updater receives the current state
   * and must return a new state object (or partial for merging).
   */
  update(updater: (state: DevsPilotState) => Partial<DevsPilotState>): void {
    this.assertNotDisposed();

    const prevState = this.state;
    const patch = updater(prevState);

    // Create new state by spreading (shallow merge at top level)
    this.state = deepFreeze({ ...prevState, ...patch }) as DevsPilotState;

    // Notify subscribers whose selected values changed
    this.notifySubscribers(prevState);
  }

  /**
   * Subscribe to state changes. The listener is only called when
   * the selected value actually changes (shallow equality).
   *
   * Returns an unsubscribe function.
   */
  subscribe<T>(selector: StateSelector<T>, listener: StateListener<T>): () => void {
    this.assertNotDisposed();

    const id = this.nextId++;
    const sub: Subscription = {
      id,
      selector: selector as StateSelector<unknown>,
      listener: listener as StateListener<unknown>,
      lastValue: selector(this.state),
    };

    this.subscriptions.set(id, sub);

    return () => {
      this.subscriptions.delete(id);
    };
  }

  /**
   * Create a snapshot of current state (for debugging/restore).
   */
  snapshot(): DevsPilotState {
    return JSON.parse(JSON.stringify(this.state)) as DevsPilotState;
  }

  /**
   * Restore state from a snapshot.
   */
  restore(snapshot: DevsPilotState): void {
    this.assertNotDisposed();
    const prevState = this.state;
    this.state = deepFreeze(snapshot) as DevsPilotState;
    this.notifySubscribers(prevState);
  }

  /**
   * Compute a JSON-serializable diff between current state and a previous snapshot.
   * Used for efficient WebSocket sync to the dashboard.
   */
  diff(previousState: DevsPilotState): Record<string, unknown> {
    const changes: Record<string, unknown> = {};
    const current = this.state;

    for (const key of Object.keys(current) as Array<keyof DevsPilotState>) {
      if (current[key] !== previousState[key]) {
        changes[key] = current[key];
      }
    }

    return changes;
  }

  /**
   * Dispose the state manager. Clears all subscriptions.
   */
  dispose(): void {
    this.subscriptions.clear();
    this.disposed = true;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private notifySubscribers(_prevState: DevsPilotState): void {
    for (const sub of this.subscriptions.values()) {
      try {
        const newValue = sub.selector(this.state);
        if (newValue !== sub.lastValue) {
          const prevValue = sub.lastValue;
          sub.lastValue = newValue;
          sub.listener(newValue, prevValue);
        }
      } catch (error) {
        console.error('[StateManager] Subscriber error:', error);
      }
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error('[StateManager] Cannot use disposed StateManager');
    }
  }
}
