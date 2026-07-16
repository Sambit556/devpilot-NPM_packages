/**
 * DevsPilot Event Bus
 *
 * Typed publish/subscribe event system. All inter-module communication
 * flows through this bus. Events are immutable (frozen).
 *
 * Features:
 * - Strongly typed via EventMap
 * - Event history for late subscribers (configurable)
 * - Wildcard listeners for debugging
 * - Auto-cleanup on dispose
 * - Memory-safe: tracks listener counts
 */

import { EventEmitter } from 'eventemitter3';
import type { EventMap, EventType, AllEvents } from '@devspilot/shared';
import { deepFreeze } from '@devspilot/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EventHandler<T> = (event: T) => void;
type WildcardHandler = (type: string, event: AllEvents) => void;

interface EventBusOptions {
  /** Max events to retain in history (default: 100) */
  historySize?: number;
  /** Max listeners per event before warning (default: 20) */
  maxListeners?: number;
  /** Enable debug logging of all events */
  debug?: boolean;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class EventBus {
  private readonly emitter = new EventEmitter();
  private readonly history: AllEvents[] = [];
  private readonly historySize: number;
  private readonly maxListeners: number;
  private readonly debug: boolean;
  private readonly wildcardHandlers = new Set<WildcardHandler>();
  private readonly listenerCounts = new Map<string, number>();
  private disposed = false;

  constructor(options: EventBusOptions = {}) {
    this.historySize = options.historySize ?? 100;
    this.maxListeners = options.maxListeners ?? 20;
    this.debug = options.debug ?? false;
  }

  /**
   * Subscribe to a typed event.
   */
  on<K extends EventType>(type: K, handler: EventHandler<EventMap[K]>): () => void {
    this.assertNotDisposed();
    this.trackListener(type, 1);
    this.emitter.on(type, handler as (...args: unknown[]) => void);

    // Return unsubscribe function
    return () => {
      this.emitter.off(type, handler as (...args: unknown[]) => void);
      this.trackListener(type, -1);
    };
  }

  /**
   * Subscribe to a typed event (one-time only).
   */
  once<K extends EventType>(type: K, handler: EventHandler<EventMap[K]>): () => void {
    this.assertNotDisposed();
    this.trackListener(type, 1);

    const wrappedHandler = (event: EventMap[K]) => {
      this.trackListener(type, -1);
      handler(event);
    };

    this.emitter.once(type, wrappedHandler as (...args: unknown[]) => void);

    return () => {
      this.emitter.off(type, wrappedHandler as (...args: unknown[]) => void);
      this.trackListener(type, -1);
    };
  }

  /**
   * Emit a typed event. The event payload is frozen to prevent mutation.
   */
  emit<K extends EventType>(type: K, event: EventMap[K]): void {
    this.assertNotDisposed();

    // Freeze event to ensure immutability
    const frozenEvent = deepFreeze(event as object) as EventMap[K];

    // Add to history
    this.addToHistory(frozenEvent as AllEvents);

    // Debug logging
    if (this.debug) {
      console.debug(`[EventBus] ${type}`, frozenEvent);
    }

    // Emit to typed listeners
    this.emitter.emit(type, frozenEvent);

    // Emit to wildcard listeners
    for (const handler of this.wildcardHandlers) {
      try {
        handler(type, frozenEvent as AllEvents);
      } catch (error) {
        console.error(`[EventBus] Wildcard handler error for ${type}:`, error);
      }
    }
  }

  /**
   * Remove a specific listener.
   */
  off<K extends EventType>(type: K, handler: EventHandler<EventMap[K]>): void {
    this.emitter.off(type, handler as (...args: unknown[]) => void);
    this.trackListener(type, -1);
  }

  /**
   * Subscribe to ALL events (for debugging/logging).
   */
  onAny(handler: WildcardHandler): () => void {
    this.assertNotDisposed();
    this.wildcardHandlers.add(handler);
    return () => {
      this.wildcardHandlers.delete(handler);
    };
  }

  /**
   * Get recent event history.
   */
  getHistory(limit?: number): readonly AllEvents[] {
    const count = limit ?? this.history.length;
    return this.history.slice(-count);
  }

  /**
   * Get event history filtered by type.
   */
  getHistoryByType<K extends EventType>(type: K, limit?: number): readonly EventMap[K][] {
    const filtered = this.history.filter(
      (event): event is EventMap[K] => event.type === type,
    );
    if (limit !== undefined) {
      return filtered.slice(-limit);
    }
    return filtered;
  }

  /**
   * Get the number of listeners for an event type.
   */
  listenerCount(type: EventType): number {
    return this.listenerCounts.get(type) ?? 0;
  }

  /**
   * Remove all listeners and clear history. Irreversible.
   */
  dispose(): void {
    this.emitter.removeAllListeners();
    this.wildcardHandlers.clear();
    this.history.length = 0;
    this.listenerCounts.clear();
    this.disposed = true;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private addToHistory(event: AllEvents): void {
    this.history.push(event);
    if (this.history.length > this.historySize) {
      this.history.shift();
    }
  }

  private trackListener(type: string, delta: number): void {
    const current = this.listenerCounts.get(type) ?? 0;
    const next = Math.max(0, current + delta);
    this.listenerCounts.set(type, next);

    if (next > this.maxListeners) {
      console.warn(
        `[EventBus] Warning: ${next} listeners for "${type}" exceeds max (${this.maxListeners}). ` +
        'Possible memory leak.',
      );
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error('[EventBus] Cannot use disposed EventBus');
    }
  }
}
