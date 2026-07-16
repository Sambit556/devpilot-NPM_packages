/**
 * DevsPilot Config Loader
 *
 * Discovers, parses, validates, and merges configuration from multiple sources.
 *
 * Discovery order:
 * 1. DevsPilot.config.ts / .js / .mjs / .json / .yaml / .yml
 * 2. "DevsPilot" key in package.json
 * 3. CLI flags (passed as overrides)
 *
 * Merge precedence: CLI flags > Env vars > Config file > Plugin defaults > Built-in defaults
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { CONFIG_FILES, PACKAGE_JSON_CONFIG_KEY, MAX_CONFIG_SIZE_BYTES } from '@devspilot/shared';
import type { DevsPilotConfig, ResolvedConfig, ResolvedServiceConfig } from '@devspilot/shared';
import { DevsPilotConfigSchema } from './ConfigSchema.js';
import { ConfigNotFoundError, ConfigParseError, ConfigValidationError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfigLoaderOptions {
  /** Project root directory */
  projectRoot: string;
  /** CLI flag overrides */
  overrides?: Partial<DevsPilotConfig>;
  /** Configuration profile to apply */
  profile?: string;
  /** Specific config file path (skips discovery) */
  configPath?: string;
}

interface ConfigLoadResult {
  config: ResolvedConfig;
  source: string | null;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ResolvedConfig = {
  name: 'project',
  type: 'node',
  services: {},
  docker: { enabled: false, composeFile: undefined, services: undefined, autoStart: false },
  env: { files: [], required: [], validate: true },
  logs: { level: 'info', persist: false, maxSize: '10MB', maxFiles: 5, redact: [] },
  dashboard: { enabled: false, port: 9900, open: false },
  watch: { ignore: [], debounce: 300 },
  plugins: {},
  performance: { maxMemory: undefined, maxCpu: undefined, alerts: true },
  profile: null,
  configPath: null,
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class ConfigLoader {
  private readonly log: Logger;
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
    this.log = createLogger({ name: 'ConfigLoader' });
  }

  /**
   * Load configuration with full discovery, parsing, validation, and merge.
   */
  async load(options: Omit<ConfigLoaderOptions, 'projectRoot'> = {}): Promise<ConfigLoadResult> {
    const { overrides, profile, configPath } = options;

    // 1. Discover and read config file
    let rawConfig: DevsPilotConfig = {};
    let source: string | null = null;

    if (configPath) {
      // Explicit config path provided
      rawConfig = await this.readConfigFile(resolve(this.projectRoot, configPath));
      source = configPath;
    } else {
      // Auto-discovery
      const discovered = await this.discoverConfig();
      if (discovered) {
        rawConfig = discovered.config;
        source = discovered.source;
      }
    }

    // 2. Validate
    const parseResult = DevsPilotConfigSchema.safeParse(rawConfig);
    if (!parseResult.success) {
      const errors = parseResult.error.issues.map(
        (issue: any) => `${issue.path.join('.')}: ${issue.message}`,
      );
      throw new ConfigValidationError(errors);
    }
    const validated = parseResult.data;

    // 3. Apply profile if specified
    let profileConfig: Partial<DevsPilotConfig> = {};
    const profileName = profile ?? undefined;
    if (profileName && validated.profiles?.[profileName]) {
      profileConfig = validated.profiles[profileName] as Partial<DevsPilotConfig>;
      this.log.info(`Applying profile: ${profileName}`);
    }

    // 4. Merge: defaults ← config ← profile ← CLI overrides
    const merged = this.mergeConfigs(DEFAULT_CONFIG, validated, profileConfig, overrides ?? {});

    // 5. Resolve service configs
    const resolvedServices: Record<string, ResolvedServiceConfig> = {};
    if (merged['services']) {
      for (const [name, svc] of Object.entries(merged['services'] as Record<string, any>)) {
        resolvedServices[name] = this.resolveServiceConfig(name, svc);
      }
    }

    const resolvedConfig: ResolvedConfig = {
      ...DEFAULT_CONFIG,
      ...merged,
      services: resolvedServices,
      profile: profileName ?? null,
      configPath: source,
    } as ResolvedConfig;

    this.log.info(`Config loaded from ${source ?? 'defaults'}`);

    return { config: resolvedConfig, source };
  }

  /**
   * Discover a config file in the project root.
   */
  private async discoverConfig(): Promise<{ config: DevsPilotConfig; source: string } | null> {
    // Check each config file name in priority order
    for (const fileName of CONFIG_FILES) {
      const filePath = join(this.projectRoot, fileName);
      if (existsSync(filePath)) {
        this.log.debug(`Found config: ${fileName}`);
        const config = await this.readConfigFile(filePath);
        return { config, source: fileName };
      }
    }

    // Check package.json for "DevsPilot" key
    const packageJsonPath = join(this.projectRoot, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const raw = readFileSync(packageJsonPath, 'utf-8');
        const pkg = JSON.parse(raw) as Record<string, unknown>;
        if (PACKAGE_JSON_CONFIG_KEY in pkg && typeof pkg[PACKAGE_JSON_CONFIG_KEY] === 'object') {
          this.log.debug('Found config in package.json');
          return {
            config: pkg[PACKAGE_JSON_CONFIG_KEY] as DevsPilotConfig,
            source: 'package.json',
          };
        }
      } catch {
        // package.json parse error — not fatal, just skip
      }
    }

    this.log.debug('No config file found, using defaults');
    return null;
  }

  /**
   * Read and parse a config file based on its extension.
   */
  private async readConfigFile(filePath: string): Promise<DevsPilotConfig> {
    // Size check
    const stat = await import('node:fs').then((fs) => fs.statSync(filePath));
    if (stat.size > MAX_CONFIG_SIZE_BYTES) {
      throw new ConfigParseError(filePath, `File too large (${stat.size} bytes, max ${MAX_CONFIG_SIZE_BYTES})`);
    }

    const ext = extname(filePath).toLowerCase();

    try {
      switch (ext) {
        case '.json': {
          const raw = readFileSync(filePath, 'utf-8');
          return JSON.parse(raw) as DevsPilotConfig;
        }
        case '.yaml':
        case '.yml': {
          const raw = readFileSync(filePath, 'utf-8');
          return (parseYaml(raw) ?? {}) as DevsPilotConfig;
        }
        case '.js':
        case '.mjs':
        case '.ts': {
          // Dynamic import for JS/TS configs
          const fileUrl = pathToFileURL(filePath).href;
          const mod = (await import(fileUrl)) as { default?: DevsPilotConfig };
          return mod.default ?? (mod as unknown as DevsPilotConfig);
        }
        default:
          throw new ConfigParseError(filePath, `Unsupported config format: ${ext}`);
      }
    } catch (error) {
      if (error instanceof ConfigParseError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new ConfigParseError(filePath, message);
    }
  }

  /**
   * Merge multiple config layers (shallow at top level, deep for services).
   */
  private mergeConfigs(
    defaults: ResolvedConfig,
    config: Record<string, unknown>,
    profile: Partial<DevsPilotConfig>,
    overrides: Partial<DevsPilotConfig>,
  ): Record<string, unknown> {
    return {
      ...defaults,
      ...config,
      ...profile,
      ...overrides,
    };
  }

  /**
   * Resolve a service config by applying defaults for all optional fields.
   */
  private resolveServiceConfig(name: string, svc: Record<string, unknown>): ResolvedServiceConfig {
    const service = svc as Record<string, unknown>;
    const health = (service['health'] ?? {}) as Record<string, unknown>;
    const watch = (service['watch'] ?? {}) as Record<string, unknown>;
    const restart = (service['restart'] ?? {}) as Record<string, unknown>;

    return {
      name,
      command: (service['command'] as string) ?? '',
      cwd: (service['cwd'] as string) ?? this.projectRoot,
      port: (service['port'] as number) ?? null,
      env: (service['env'] as Record<string, string>) ?? {},
      envFile: Array.isArray(service['envFile'])
        ? service['envFile'] as string[]
        : service['envFile']
          ? [service['envFile'] as string]
          : [],
      dependsOn: (service['dependsOn'] as string[]) ?? [],
      health: {
        path: (health['path'] as string) ?? undefined,
        port: (health['port'] as number) ?? undefined,
        interval: (health['interval'] as number) ?? 10_000,
        timeout: (health['timeout'] as number) ?? 5_000,
        retries: (health['retries'] as number) ?? 3,
        startPeriod: (health['startPeriod'] as number) ?? 30_000,
      },
      watch: {
        enabled: (watch['enabled'] as boolean) ?? true,
        paths: (watch['paths'] as string[]) ?? [],
        ignore: (watch['ignore'] as string[]) ?? [],
        debounce: (watch['debounce'] as number) ?? 300,
      },
      restart: {
        enabled: (restart['enabled'] as boolean) ?? true,
        maxRetries: (restart['maxRetries'] as number) ?? 10,
        backoff: (restart['backoff'] as number) ?? 1_000,
        maxBackoff: (restart['maxBackoff'] as number) ?? 30_000,
      },
      group: (service['group'] as string) ?? null,
      priority: (service['priority'] as number) ?? 100,
    };
  }
}
