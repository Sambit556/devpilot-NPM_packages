/**
 * DevsPilot Engine
 *
 * The main orchestrator that coordinates all core modules.
 * Implements the full startup/shutdown lifecycle:
 *
 * 1. Load config
 * 2. Detect project
 * 3. Resolve services
 * 4. Check ports
 * 5. Start services (in dependency order)
 * 6. Monitor health
 * 7. Watch files
 * 8. Await shutdown
 */

import { resolve } from 'node:path';
import type { ResolvedConfig, DevsPilotConfig } from '@devspilot/shared';
import { createTimer } from '@devspilot/shared';
import { EventBus } from '../bus/EventBus.js';
import { StateManager } from '../state/StateManager.js';
import { ConfigLoader } from '../config/ConfigLoader.js';
import { DetectorEngine } from '../detector/DetectorEngine.js';
import { ProcessManager } from '../process/ProcessManager.js';
import { PortManager } from '../port/PortManager.js';
import { LogManager } from '../log/LogManager.js';
import { EnvManager } from '../env/EnvManager.js';
import { FileWatcher } from '../watcher/FileWatcher.js';
import { HealthEngine } from '../health/HealthEngine.js';
import { GitManager } from '../git/GitManager.js';
import { SecurityEngine } from '../security/SecurityEngine.js';
import { PerfEngine } from '../performance/PerfEngine.js';
import { DiagnosticsEngine } from '../diagnostics/DiagnosticsEngine.js';
import { PluginLoader } from '../plugin/PluginLoader.js';
import { StorageManager } from '../storage/StorageManager.js';
import { DockerManager } from '../docker/DockerManager.js';
import { TaskScheduler } from '../scheduler/TaskScheduler.js';
import { DatabaseManager } from '../database/DatabaseManager.js';
import { NetworkManager } from '../network/NetworkManager.js';
import { ModuleRegistry } from '../registry/ModuleRegistry.js';
import { createLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';
import { sendNotification, playSoundAlert } from '../utils/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DevsPilotEngineOptions {
  /** Project root directory */
  projectRoot?: string;
  /** CLI flag overrides */
  configOverrides?: Partial<DevsPilotConfig>;
  /** Configuration profile */
  profile?: string;
  /** Specific config file path */
  configPath?: string;
  /** Enable debug mode */
  debug?: boolean;
}

export interface EngineContext {
  readonly eventBus: EventBus;
  readonly stateManager: StateManager;
  readonly processManager: ProcessManager;
  readonly portManager: PortManager;
  readonly logManager: LogManager;
  readonly envManager: EnvManager;
  readonly fileWatcher: FileWatcher;
  readonly healthEngine: HealthEngine;
  readonly gitManager: GitManager;
  readonly securityEngine: SecurityEngine;
  readonly perfEngine: PerfEngine;
  readonly diagnosticsEngine: DiagnosticsEngine;
  readonly pluginLoader: PluginLoader;
  readonly storageManager: StorageManager;
  readonly dockerManager: DockerManager;
  readonly databaseManager: DatabaseManager;
  readonly networkManager: NetworkManager;
  readonly taskScheduler: TaskScheduler;
  readonly moduleRegistry: ModuleRegistry;
  readonly config: ResolvedConfig;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class DevsPilotEngine {
  private readonly log: Logger;
  private readonly projectRoot: string;
  private readonly options: DevsPilotEngineOptions;

  // Core modules (initialized on start)
  private eventBus: EventBus | null = null;
  private stateManager: StateManager | null = null;
  private configLoader: ConfigLoader | null = null;
  private processManager: ProcessManager | null = null;
  private portManager: PortManager | null = null;
  private logManager: LogManager | null = null;
  private envManager: EnvManager | null = null;
  private fileWatcher: FileWatcher | null = null;
  private healthEngine: HealthEngine | null = null;
  private gitManager: GitManager | null = null;
  private securityEngine: SecurityEngine | null = null;
  private perfEngine: PerfEngine | null = null;
  private diagnosticsEngine: DiagnosticsEngine | null = null;
  private pluginLoader: PluginLoader | null = null;
  private storageManager: StorageManager | null = null;
  private dockerManager: DockerManager | null = null;
  private databaseManager: DatabaseManager | null = null;
  private networkManager: NetworkManager | null = null;
  private taskScheduler: TaskScheduler | null = null;
  private moduleRegistry: ModuleRegistry | null = null;
  private resolvedConfig: ResolvedConfig | null = null;
  private running = false;

  constructor(options: DevsPilotEngineOptions = {}) {
    this.options = options;
    this.projectRoot = resolve(options.projectRoot ?? process.cwd());
    this.log = createLogger({ name: 'Engine', pretty: options.debug });
  }

  /**
   * Start the DevsPilot engine. This is the `DevsPilot up` flow.
   */
  async start(): Promise<EngineContext> {
    if (this.running) {
      throw new Error('Engine is already running');
    }

    const totalTimer = createTimer();

    // 1. Initialize core modules
    this.eventBus = new EventBus({ debug: this.options.debug });

    // Native OS notifications & warnings alerts
    this.eventBus.on('process:crashed', (evt) => {
      sendNotification('DevsPilot Alert', `Service "${evt.payload.name}" crashed (exit code: ${evt.payload.exitCode})`);
      playSoundAlert('error');
    });
    this.eventBus.on('port:conflict', (evt) => {
      sendNotification('Port Conflict', `Port ${evt.payload.port} required by "${evt.payload.service}" is in use`);
      playSoundAlert('error');
    });

    this.stateManager = new StateManager();
    this.moduleRegistry = new ModuleRegistry();
    this.storageManager = new StorageManager({ projectRoot: this.projectRoot });

    this.stateManager.update(() => ({
      engine: {
        status: 'starting',
        version: '0.0.1',
        startedAt: Date.now(),
        uptimeMs: 0,
        pid: process.pid,
      },
    }));

    this.eventBus.emit('engine:starting', {
      type: 'engine:starting',
      payload: { version: '0.0.1' },
      timestamp: Date.now(),
      source: 'Engine',
    });

    // 2. Load configuration
    this.log.info('Loading configuration...');
    const configTimer = createTimer();
    this.configLoader = new ConfigLoader(this.projectRoot);

    const { config, source } = await this.configLoader.load({
      overrides: this.options.configOverrides,
      profile: this.options.profile,
      configPath: this.options.configPath,
    });

    this.resolvedConfig = config;
    this.log.info(`Config loaded from ${source ?? 'defaults'} (${configTimer()}ms)`);

    this.stateManager.update(() => ({
      config: {
        loaded: true,
        source,
        profile: config.profile,
      },
    }));

    // 3. Initialize Env and Git early
    this.envManager = new EnvManager({
      eventBus: this.eventBus,
      stateManager: this.stateManager,
      projectRoot: this.projectRoot,
    });
    await this.envManager.load(config);

    // 4. Detect project
    this.log.info('Detecting project...');
    const detectTimer = createTimer();
    const detector = new DetectorEngine(this.projectRoot);
    const detection = await detector.detect();

    this.stateManager.update(() => ({
      project: detection.project,
    }));

    this.log.info(
      `Detected: ${detection.project.type} / ${detection.project.framework ?? 'generic'} / ${detection.project.packageManager} (${detectTimer()}ms)`,
    );

    this.gitManager = new GitManager({
      eventBus: this.eventBus,
      stateManager: this.stateManager,
      projectRoot: this.projectRoot,
    });
    this.gitManager.init();
    await this.gitManager.update();

    // 5. Initialize plugin loader
    this.pluginLoader = new PluginLoader({
      eventBus: this.eventBus,
      stateManager: this.stateManager,
      projectRoot: this.projectRoot,
    });
    await this.pluginLoader.loadPlugins(config);

    // 6. Initialize remaining modules
    this.processManager = new ProcessManager({
      eventBus: this.eventBus,
      stateManager: this.stateManager,
      projectRoot: this.projectRoot,
    });

    this.portManager = new PortManager(this.eventBus);

    this.logManager = new LogManager({
      eventBus: this.eventBus,
      minLevel: config.logs.level,
      persist: config.logs.persist,
    });

    this.diagnosticsEngine = new DiagnosticsEngine({
      eventBus: this.eventBus,
      stateManager: this.stateManager,
      projectRoot: this.projectRoot,
    });
    await this.diagnosticsEngine.runDiagnostics(config);

    this.dockerManager = new DockerManager({
      eventBus: this.eventBus,
      stateManager: this.stateManager,
      projectRoot: this.projectRoot,
    });
    this.dockerManager.init(config);
    await this.dockerManager.startContainers(config);

    this.databaseManager = new DatabaseManager({
      eventBus: this.eventBus,
      stateManager: this.stateManager,
      projectRoot: this.projectRoot,
    });
    // Scan databases in background
    void this.databaseManager.scan(config);

    this.networkManager = new NetworkManager({
      eventBus: this.eventBus,
      stateManager: this.stateManager,
      projectRoot: this.projectRoot,
    });
    // Scan APIs/services in background
    void this.networkManager.discover(config);

    this.taskScheduler = new TaskScheduler({
      eventBus: this.eventBus,
    });

    this.securityEngine = new SecurityEngine({
      eventBus: this.eventBus,
      stateManager: this.stateManager,
      projectRoot: this.projectRoot,
    });
    // Run background scan
    void this.securityEngine.scan(config);

    // 7. Check ports
    const servicePorts = Object.values(config.services)
      .map((s) => s.port)
      .filter((p): p is number => p !== null);

    if (servicePorts.length > 0) {
      this.log.info('Checking ports...');
      const portStates = await this.portManager.checkPorts(servicePorts);

      for (const ps of portStates) {
        if (ps.status === 'conflict') {
          const conflictInfo = ps.conflictPid
            ? ` (PID ${ps.conflictPid})`
            : '';
          this.log.warn(`Port ${ps.port} is in use${conflictInfo}`);

          this.eventBus.emit('port:conflict', {
            type: 'port:conflict',
            payload: {
              port: ps.port,
              service: ps.service,
              blockedBy: ps.conflictPid
                ? { pid: ps.conflictPid, name: ps.conflictProcess ?? 'unknown' }
                : null,
            },
            timestamp: Date.now(),
            source: 'Engine',
          });
        }
      }

      this.stateManager.update(() => ({ ports: portStates }));
    }

    // 8. Start services in dependency order
    const serviceOrder = this.resolveStartOrder(config.services);
    this.log.info(`Starting ${serviceOrder.length} service(s)...`);

    for (const name of serviceOrder) {
      const serviceConfig = config.services[name];
      if (!serviceConfig) continue;

      await this.processManager.start(serviceConfig);
    }

    // 9. Start monitoring components
    this.healthEngine = new HealthEngine({
      eventBus: this.eventBus,
      stateManager: this.stateManager,
      processManager: this.processManager,
    });
    this.healthEngine.start(config);

    this.fileWatcher = new FileWatcher({
      eventBus: this.eventBus,
      processManager: this.processManager,
      projectRoot: this.projectRoot,
    });
    await this.fileWatcher.start(config);

    this.perfEngine = new PerfEngine({
      eventBus: this.eventBus,
      stateManager: this.stateManager,
      projectRoot: this.projectRoot,
    });
    this.perfEngine.start(config);

    // 10. Activate plugins matching context
    await this.pluginLoader.activatePlugins({
      projectRoot: this.projectRoot,
      packageJson: null,
      rootFiles: [],
      dockerAvailable: this.dockerManager ? this.stateManager.getState().docker.available : false,
      packageManager: detection.project.packageManager,
    });

    // Register all core module instances in ModuleRegistry
    if (this.moduleRegistry) {
      this.moduleRegistry.register('configLoader', this.configLoader!);
      this.moduleRegistry.register('gitManager', this.gitManager!);
      this.moduleRegistry.register('pluginLoader', this.pluginLoader!);
      this.moduleRegistry.register('processManager', this.processManager!);
      this.moduleRegistry.register('portManager', this.portManager!);
      this.moduleRegistry.register('logManager', this.logManager!);
      this.moduleRegistry.register('diagnosticsEngine', this.diagnosticsEngine!);
      this.moduleRegistry.register('dockerManager', this.dockerManager!);
      this.moduleRegistry.register('databaseManager', this.databaseManager!);
      this.moduleRegistry.register('networkManager', this.networkManager!);
      this.moduleRegistry.register('taskScheduler', this.taskScheduler!);
      this.moduleRegistry.register('securityEngine', this.securityEngine!);
      this.moduleRegistry.register('healthEngine', this.healthEngine!);
      this.moduleRegistry.register('fileWatcher', this.fileWatcher!);
      this.moduleRegistry.register('perfEngine', this.perfEngine!);
    }

    // 11. Mark engine as running
    this.running = true;

    const startupMs = totalTimer();
    this.stateManager.update((state) => ({
      engine: {
        ...state.engine,
        status: 'running',
        uptimeMs: startupMs,
      },
      performance: {
        ...state.performance,
        startupMs,
      },
    }));

    this.eventBus.emit('engine:ready', {
      type: 'engine:ready',
      payload: { startupMs },
      timestamp: Date.now(),
      source: 'Engine',
    });

    this.log.info(`Engine ready (${startupMs}ms)`);

    return this.getContext()!;
  }

  /**
   * Stop the DevsPilot engine. This is the `DevsPilot down` flow.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    const shutdownTimer = createTimer();

    this.log.info('Shutting down...');

    this.eventBus?.emit('engine:stopping', {
      type: 'engine:stopping',
      payload: { reason: 'user_requested' },
      timestamp: Date.now(),
      source: 'Engine',
    });

    this.stateManager?.update((state) => ({
      engine: { ...state.engine, status: 'stopping' },
    }));

    // Stop watcher & monitor engines early
    await this.fileWatcher?.stop();
    this.healthEngine?.stop();
    this.perfEngine?.stop();

    if (this.pluginLoader) {
      await this.pluginLoader.deactivateAll();
    }

    if (this.dockerManager && this.resolvedConfig) {
      await this.dockerManager.stopContainers(this.resolvedConfig);
    }
    this.taskScheduler?.dispose();

    // Stop all processes
    await this.processManager?.dispose();

    // Release ports
    this.portManager?.dispose();

    // Stop log aggregation
    this.logManager?.dispose();

    if (this.moduleRegistry) {
      await this.moduleRegistry.shutdownAll();
      this.moduleRegistry = null;
    }

    const shutdownMs = shutdownTimer();

    this.stateManager?.update((state) => ({
      engine: { ...state.engine, status: 'stopped' },
      performance: { ...state.performance, shutdownMs },
    }));

    this.eventBus?.emit('engine:stopped', {
      type: 'engine:stopped',
      payload: { shutdownMs },
      timestamp: Date.now(),
      source: 'Engine',
    });

    this.log.info(`Shutdown complete (${shutdownMs}ms)`);

    // Dispose event bus last (other modules may emit during shutdown)
    this.eventBus?.dispose();
    this.stateManager?.dispose();

    this.running = false;
  }

  /**
   * Restart a specific service or all services.
   */
  async restart(serviceName?: string): Promise<void> {
    if (!this.processManager) return;

    if (serviceName) {
      await this.processManager.restart(serviceName);
    } else {
      // Restart all services
      const names = Object.keys(this.resolvedConfig?.services ?? {});
      for (const name of names) {
        await this.processManager.restart(name);
      }
    }
  }

  /**
   * Get the current engine context.
   */
  getContext(): EngineContext | null {
    if (
      !this.running ||
      !this.eventBus ||
      !this.stateManager ||
      !this.processManager ||
      !this.portManager ||
      !this.logManager ||
      !this.envManager ||
      !this.fileWatcher ||
      !this.healthEngine ||
      !this.gitManager ||
      !this.securityEngine ||
      !this.perfEngine ||
      !this.diagnosticsEngine ||
      !this.pluginLoader ||
      !this.storageManager ||
      !this.dockerManager ||
      !this.databaseManager ||
      !this.networkManager ||
      !this.taskScheduler ||
      !this.moduleRegistry ||
      !this.resolvedConfig
    ) {
      return null;
    }

    return {
      eventBus: this.eventBus,
      stateManager: this.stateManager,
      processManager: this.processManager,
      portManager: this.portManager,
      logManager: this.logManager,
      envManager: this.envManager,
      fileWatcher: this.fileWatcher,
      healthEngine: this.healthEngine,
      gitManager: this.gitManager,
      securityEngine: this.securityEngine,
      perfEngine: this.perfEngine,
      diagnosticsEngine: this.diagnosticsEngine,
      pluginLoader: this.pluginLoader,
      storageManager: this.storageManager,
      dockerManager: this.dockerManager,
      databaseManager: this.databaseManager,
      networkManager: this.networkManager,
      taskScheduler: this.taskScheduler,
      moduleRegistry: this.moduleRegistry,
      config: this.resolvedConfig,
    };
  }

  /**
   * Check if the engine is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Topological sort of services based on dependsOn.
   */
  private resolveStartOrder(
    services: Record<string, { dependsOn: string[]; priority: number }>,
  ): string[] {
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (name: string, path: Set<string> = new Set()) => {
      if (visited.has(name)) return;
      if (path.has(name)) {
        this.log.warn(`Circular dependency detected: ${[...path, name].join(' → ')}`);
        return;
      }

      path.add(name);

      const service = services[name];
      if (service) {
        for (const dep of service.dependsOn) {
          visit(dep, new Set(path));
        }
      }

      visited.add(name);
      order.push(name);
    };

    // Sort by priority first, then topo-sort
    const sorted = Object.entries(services)
      .sort(([, a], [, b]) => a.priority - b.priority)
      .map(([name]) => name);

    for (const name of sorted) {
      visit(name);
    }

    return order;
  }
}
