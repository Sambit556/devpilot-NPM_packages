/**
 * DevsPilot Environment Manager
 *
 * Handles:
 * - Environment file discovery
 * - File loading and validation (required vars)
 * - Conflict detection across multiple env files
 * - Secret checking
 * - Variable analysis (missing vs unused in source code)
 */

import { readFileSync, existsSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import crypto from 'node:crypto';
import { ENV_FILES, redactEnvValue, isSecretKey, isSecretValue } from '@devspilot/shared';
import type { ResolvedConfig, EnvState, EnvConflict } from '@devspilot/shared';
import { EventBus } from '../bus/EventBus.js';
import { StateManager } from '../state/StateManager.js';
import { createLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';

export interface EnvManagerOptions {
  eventBus: EventBus;
  stateManager: StateManager;
  projectRoot: string;
}

export class EnvManager {
  private readonly log: Logger;
  private readonly eventBus: EventBus;
  private readonly stateManager: StateManager;
  private readonly projectRoot: string;

  constructor(options: EnvManagerOptions) {
    this.eventBus = options.eventBus;
    this.stateManager = options.stateManager;
    this.projectRoot = resolve(options.projectRoot);
    this.log = createLogger({ name: 'EnvManager' });
  }

  private getEncryptionKey(): Buffer {
    const salt = 'DevsPilot-salt';
    const hardwareSeed = process.env['COMPUTERNAME'] || process.env['HOSTNAME'] || 'DevsPilot-default-seed';
    return crypto.scryptSync(hardwareSeed, salt, 32);
  }

  /**
   * Encrypt plain text using AES-256-GCM.
   */
  encryptValue(text: string): string {
    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /**
   * Decrypt AES-256-GCM cipher text.
   */
  decryptValue(cipherText: string): string {
    const key = this.getEncryptionKey();
    const [ivHex, authTagHex, encryptedHex] = cipherText.split(':');
    if (!ivHex || !authTagHex || !encryptedHex) {
      throw new Error('Invalid encrypted env format');
    }
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Load and validate the environment.
   */
  async load(config: ResolvedConfig): Promise<void> {
    const defaultFiles: string[] = [...ENV_FILES];
    if (existsSync(join(this.projectRoot, '.env.enc'))) {
      defaultFiles.push('.env.enc');
    }
    const envFilesToLoad = config.env.files.length > 0
      ? config.env.files
      : defaultFiles;

    const loadedFiles: string[] = [];
    const mergedEnv: Record<string, string> = {};
    const fileValues: Record<string, Record<string, string>> = {};

    // 1. Discover and load environment files in priority order (reverse priority for overriding)
    const filesToProcess = [...envFilesToLoad].reverse();

    for (const file of filesToProcess) {
      const filePath = join(this.projectRoot, file);
      if (existsSync(filePath)) {
        try {
          let content = readFileSync(filePath, 'utf-8');
          if (file.endsWith('.enc')) {
            content = this.decryptValue(content);
          }
          const parsed = this.parseEnvContent(content);
          fileValues[file] = parsed;
          loadedFiles.push(file);

          for (const [key, value] of Object.entries(parsed)) {
            mergedEnv[key] = value;
            process.env[key] = value;
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.log.error(`Failed to parse env file "${file}": ${msg}`);
        }
      }
    }

    // Restore correct priority order for reporting (high priority first)
    loadedFiles.reverse();

    // 2. Validate required variables
    const missingRequired: string[] = [];
    if (config.env.validate) {
      for (const requiredVar of config.env.required) {
        if (!process.env[requiredVar] && !mergedEnv[requiredVar]) {
          missingRequired.push(requiredVar);
        }
      }
    }

    // 3. Detect conflicts
    const conflicts = this.detectConflicts(fileValues);

    // 4. Scan source code for missing and unused variables (basic AST / grep scanning)
    const { missingVars, unusedVars } = await this.analyzeSourceVariables(mergedEnv);

    // 5. Check for raw secrets in env files
    this.checkSecrets(mergedEnv);

    // 6. Update State
    const totalLoadedVars = Object.keys(mergedEnv).length;
    this.stateManager.update((state) => ({
      env: {
        loaded: true,
        files: loadedFiles,
        variableCount: totalLoadedVars,
        missingRequired,
        unusedVars,
        conflicts,
      },
    }));

    // 7. Emit events
    this.eventBus.emit('env:loaded', {
      type: 'env:loaded',
      payload: { file: loadedFiles.join(', '), count: totalLoadedVars },
      timestamp: Date.now(),
      source: 'EnvManager',
    });

    if (missingRequired.length > 0) {
      this.eventBus.emit('env:missing', {
        type: 'env:missing',
        payload: { variables: missingRequired, required: true },
        timestamp: Date.now(),
        source: 'EnvManager',
      });
    }
  }

  /**
   * Simple parser for .env contents.
   */
  private parseEnvContent(content: string): Record<string, string> {
    const env: Record<string, string> = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = /^\s*([\w.-]+)\s*=\s*(.*)$/.exec(trimmed);
      if (match) {
        const key = match[1]!;
        let value = match[2]!.trim();

        // Strip quotes if wrapped
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        env[key] = value;
      }
    }

    return env;
  }

  /**
   * Detects variables that have different values in different env files.
   */
  private detectConflicts(fileValues: Record<string, Record<string, string>>): EnvConflict[] {
    const conflicts: EnvConflict[] = [];
    const allKeys = new Set<string>();

    for (const parsed of Object.values(fileValues)) {
      for (const key of Object.keys(parsed)) {
        allKeys.add(key);
      }
    }

    for (const key of allKeys) {
      const filesWithKey: string[] = [];
      const values: string[] = [];

      for (const [file, parsed] of Object.entries(fileValues)) {
        if (key in parsed) {
          filesWithKey.push(file);
          values.push(parsed[key]!);
        }
      }

      // If key is present in multiple files with different values
      const uniqueValues = new Set(values);
      if (filesWithKey.length > 1 && uniqueValues.size > 1) {
        conflicts.push({
          variable: key,
          files: filesWithKey,
          values,
        });

        this.eventBus.emit('env:conflict', {
          type: 'env:conflict',
          payload: { variable: key, files: filesWithKey },
          timestamp: Date.now(),
          source: 'EnvManager',
        });
      }
    }

    return conflicts;
  }

  /**
   * Generates a template (.env.example) from the currently loaded env.
   */
  generateTemplate(outputName = '.env.example'): void {
    const state = this.stateManager.getState();
    const envFiles = state.env.files;

    if (envFiles.length === 0) {
      this.log.warn('No env files loaded to generate template from.');
      return;
    }

    // Aggregate all keys from loaded env files
    const allKeys = new Set<string>();
    for (const file of envFiles) {
      const filePath = join(this.projectRoot, file);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8');
        const parsed = this.parseEnvContent(content);
        for (const key of Object.keys(parsed)) {
          allKeys.add(key);
        }
      }
    }

    const templateContent = [...allKeys]
      .map((key) => `${key}=`)
      .join('\n');

    writeFileSync(join(this.projectRoot, outputName), templateContent, 'utf-8');
    this.log.info(`Generated template env file at ${outputName}`);
  }

  /**
   * Simple scanning of source files to find process.env References.
   */
  private getSourceFilesRecursive(dir: string, fileList: string[] = []): string[] {
    try {
      const list = readdirSync(dir);
      for (const entry of list) {
        const fullPath = join(dir, entry);
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
          if (entry !== 'node_modules' && entry !== 'dist' && entry !== '.git') {
            this.getSourceFilesRecursive(fullPath, fileList);
          }
        } else {
          const ext = extname(fullPath).toLowerCase();
          if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
            fileList.push(fullPath);
          }
        }
      }
    } catch {
      // ignore
    }
    return fileList;
  }

  private async analyzeSourceVariables(
    loadedEnv: Record<string, string>,
  ): Promise<{ missingVars: string[]; unusedVars: string[] }> {
    const missingVars: string[] = [];
    const unusedVars: string[] = [];

    // Skip heavy scan in very large directories by default, or just do a quick scan of src/
    const srcDir = join(this.projectRoot, 'src');
    if (!existsSync(srcDir)) {
      return { missingVars, unusedVars };
    }

    try {
      const files = this.getSourceFilesRecursive(srcDir);

      const referencedVars = new Set<string>();
      const envRegex = /process\.env\.([A-Z_][A-Z0-9_]*)/g;

      for (const file of files) {
        const content = readFileSync(file, 'utf-8');
        let match;
        while ((match = envRegex.exec(content)) !== null) {
          if (match[1]) {
            referencedVars.add(match[1]);
          }
        }
      }

      // Unused variables: defined in env but not referenced in source code
      const loadedKeys = Object.keys(loadedEnv);
      for (const key of loadedKeys) {
        if (!referencedVars.has(key) && !key.startsWith('NODE_')) {
          unusedVars.push(key);
        }
      }

      // Missing variables: referenced in source code but not defined in env or process.env
      for (const refVar of referencedVars) {
        if (!(refVar in loadedEnv) && !process.env[refVar]) {
          missingVars.push(refVar);
        }
      }
    } catch {
      // Ignore scanning failures, return empty
    }

    return { missingVars, unusedVars };
  }

  /**
   * Scans env for potential plain text secrets.
   */
  private checkSecrets(env: Record<string, string>): void {
    for (const [key, value] of Object.entries(env)) {
      if (isSecretKey(key) && isSecretValue(value)) {
        this.log.warn(
          `Potential plain text secret detected in env configuration: ${key}. Consider using a secure vault or config.`,
        );
      }
    }
  }
}
