/**
 * DevsPilot Custom Errors
 *
 * Structured error hierarchy with error codes, user-friendly messages,
 * and fix suggestions. Every error shown to users includes actionable advice.
 */

import { EXIT_CODES } from '@devspilot/shared';

// ---------------------------------------------------------------------------
// Base Error
// ---------------------------------------------------------------------------

export abstract class DevsPilotError extends Error {
  /** Machine-readable error code */
  abstract readonly code: string;

  /** Process exit code */
  abstract readonly exitCode: number;

  /** User-friendly fix suggestions */
  abstract readonly suggestions: string[];

  /** Documentation URL (optional) */
  readonly docsUrl?: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;

    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Format for terminal display.
   */
  toUserMessage(): string {
    const lines = [
      `✗ Error: ${this.message}`,
      '',
    ];

    if (this.suggestions.length > 0) {
      lines.push('  Suggestions:');
      for (let i = 0; i < this.suggestions.length; i++) {
        lines.push(`  ${i + 1}. ${this.suggestions[i]}`);
      }
    }

    if (this.docsUrl) {
      lines.push('');
      lines.push(`  Documentation: ${this.docsUrl}`);
    }

    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Config Errors
// ---------------------------------------------------------------------------

export class ConfigNotFoundError extends DevsPilotError {
  readonly code = 'CONFIG_NOT_FOUND';
  readonly exitCode = EXIT_CODES.CONFIG_ERROR;
  readonly suggestions = [
    'Create a DevsPilot.config.yml in your project root',
    'Run: DevsPilot init',
    'DevsPilot can work with zero config — try: DevsPilot up',
  ];

  constructor(searchPaths: string[]) {
    super(`No configuration file found. Searched: ${searchPaths.join(', ')}`);
  }
}

export class ConfigParseError extends DevsPilotError {
  readonly code = 'CONFIG_PARSE_ERROR';
  readonly exitCode = EXIT_CODES.CONFIG_ERROR;
  readonly suggestions: string[];

  constructor(filePath: string, reason: string) {
    super(`Failed to parse config file: ${filePath}\n  Reason: ${reason}`);
    this.suggestions = [
      `Check ${filePath} for syntax errors`,
      'Run: DevsPilot config --validate',
      'See: https://DevsPilot.dev/docs/reference/config',
    ];
  }
}

export class ConfigValidationError extends DevsPilotError {
  readonly code = 'CONFIG_VALIDATION_ERROR';
  readonly exitCode = EXIT_CODES.CONFIG_ERROR;
  readonly suggestions: string[];
  readonly validationErrors: string[];

  constructor(errors: string[]) {
    super(`Configuration validation failed:\n${errors.map((e) => `  • ${e}`).join('\n')}`);
    this.validationErrors = errors;
    this.suggestions = [
      'Run: DevsPilot config --validate for detailed validation',
      'See: https://DevsPilot.dev/docs/reference/config',
    ];
  }
}

// ---------------------------------------------------------------------------
// Port Errors
// ---------------------------------------------------------------------------

export class PortConflictError extends DevsPilotError {
  readonly code = 'PORT_CONFLICT';
  readonly exitCode = EXIT_CODES.PORT_CONFLICT;
  readonly suggestions: string[];

  constructor(
    public readonly port: number,
    public readonly service: string,
    public readonly blockingPid: number | null,
    public readonly blockingProcess: string | null,
  ) {
    const blocker = blockingProcess
      ? `${blockingProcess} (PID ${blockingPid})`
      : `PID ${blockingPid}`;
    super(`Port ${port} is already in use by ${blocker}`);
    this.suggestions = [
      `Kill the blocking process: DevsPilot ports --kill ${port}`,
      `Use a different port: DevsPilot up --port ${service}=${port + 1}`,
      `Find what's using the port: ${process.platform === 'win32' ? `netstat -ano | findstr :${port}` : `lsof -i :${port}`}`,
    ];
  }
}

// ---------------------------------------------------------------------------
// Process Errors
// ---------------------------------------------------------------------------

export class ProcessCrashError extends DevsPilotError {
  readonly code = 'PROCESS_CRASH';
  readonly exitCode = EXIT_CODES.PROCESS_CRASH;
  readonly suggestions: string[];

  constructor(
    public readonly serviceName: string,
    public readonly serviceExitCode: number | null,
    public readonly signal: string | null,
  ) {
    const reason = signal ? `signal ${signal}` : `exit code ${serviceExitCode}`;
    super(`Service "${serviceName}" crashed with ${reason}`);
    this.suggestions = [
      `Check logs: DevsPilot logs ${serviceName}`,
      `Restart manually: DevsPilot restart ${serviceName}`,
      'Check for missing dependencies or environment variables',
    ];
  }
}

export class ProcessMaxRestartsError extends DevsPilotError {
  readonly code = 'PROCESS_MAX_RESTARTS';
  readonly exitCode = EXIT_CODES.PROCESS_CRASH;
  readonly suggestions: string[];

  constructor(
    public readonly serviceName: string,
    public readonly restartCount: number,
  ) {
    super(`Service "${serviceName}" exceeded max restart attempts (${restartCount})`);
    this.suggestions = [
      `Check logs for root cause: DevsPilot logs ${serviceName}`,
      `Run diagnostics: DevsPilot doctor`,
      'Increase max retries in config if this is expected behavior',
    ];
  }
}

// ---------------------------------------------------------------------------
// Dependency Errors
// ---------------------------------------------------------------------------

export class MissingDependencyError extends DevsPilotError {
  readonly code = 'MISSING_DEPENDENCY';
  readonly exitCode = EXIT_CODES.MISSING_DEPENDENCY;
  readonly suggestions: string[];

  constructor(
    public readonly dependency: string,
    public readonly installCommand: string,
  ) {
    super(`Required dependency not found: ${dependency}`);
    this.suggestions = [
      `Install it: ${installCommand}`,
      'Run: DevsPilot doctor for a full dependency check',
    ];
  }
}

// ---------------------------------------------------------------------------
// Plugin Errors
// ---------------------------------------------------------------------------

export class PluginLoadError extends DevsPilotError {
  readonly code = 'PLUGIN_LOAD_ERROR';
  readonly exitCode = EXIT_CODES.PLUGIN_ERROR;
  readonly suggestions: string[];

  constructor(
    public readonly pluginName: string,
    reason: string,
  ) {
    super(`Failed to load plugin "${pluginName}": ${reason}`);
    this.suggestions = [
      `Check plugin version compatibility: DevsPilot plugins list`,
      `Reinstall the plugin: DevsPilot plugins remove ${pluginName} && DevsPilot plugins add ${pluginName}`,
      'Check for plugin updates',
    ];
  }
}

export class PluginPermissionError extends DevsPilotError {
  readonly code = 'PLUGIN_PERMISSION_DENIED';
  readonly exitCode = EXIT_CODES.PERMISSION_DENIED;
  readonly suggestions: string[];

  constructor(
    public readonly pluginName: string,
    public readonly permission: string,
  ) {
    super(`Plugin "${pluginName}" requires permission: ${permission}`);
    this.suggestions = [
      `Grant permission: DevsPilot plugins permit ${pluginName}`,
      'Review plugin permissions in ~/.DevsPilot/plugin-permissions.json',
    ];
  }
}

// ---------------------------------------------------------------------------
// Health Errors
// ---------------------------------------------------------------------------

export class HealthCheckFailedError extends DevsPilotError {
  readonly code = 'HEALTH_CHECK_FAILED';
  readonly exitCode = EXIT_CODES.HEALTH_CHECK_FAILED;
  readonly suggestions: string[];

  constructor(
    public readonly serviceName: string,
    public readonly checkType: string,
    reason: string,
  ) {
    super(`Health check failed for "${serviceName}" (${checkType}): ${reason}`);
    this.suggestions = [
      `Check service status: DevsPilot status`,
      `View logs: DevsPilot logs ${serviceName}`,
      `Restart service: DevsPilot restart ${serviceName}`,
    ];
  }
}

// ---------------------------------------------------------------------------
// Environment Errors
// ---------------------------------------------------------------------------

export class MissingEnvVarError extends DevsPilotError {
  readonly code = 'MISSING_ENV_VAR';
  readonly exitCode = EXIT_CODES.CONFIG_ERROR;
  readonly suggestions: string[];

  constructor(public readonly variables: string[]) {
    super(`Required environment variables missing: ${variables.join(', ')}`);
    this.suggestions = [
      'Add them to your .env file',
      'Run: DevsPilot env --check for a full environment audit',
      'See: DevsPilot env --diff to compare env files',
    ];
  }
}
