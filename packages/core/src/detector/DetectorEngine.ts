/**
 * DevsPilot Detector Engine
 *
 * Orchestrates parallel detection of project type, framework,
 * package manager, build tool, monorepo structure, Docker,
 * databases, and more. All detection is file-based — no network requests.
 *
 * Each detector is a pure function that receives file system info
 * and returns a result with confidence score.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  LOCK_FILE_MAP,
  FRAMEWORK_DEPS,
  BUILD_TOOL_CONFIGS,
  MONOREPO_MARKERS,
} from '@devspilot/shared';
import type {
  ProjectType,
  Framework,
  PackageManager,
  BuildTool,
  ProjectState,
  WorkspaceInfo,
} from '@devspilot/shared';
import { createLogger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetectionResult {
  project: ProjectState;
}

interface PackageJson {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages: string[] };
  engines?: { node?: string };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class DetectorEngine {
  private readonly log = createLogger({ name: 'DetectorEngine' });
  private readonly projectRoot: string;
  private readonly rootFiles: string[];
  private readonly packageJson: PackageJson | null;

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);

    // Read root files once (reused by all detectors)
    try {
      this.rootFiles = readdirSync(this.projectRoot);
    } catch {
      this.rootFiles = [];
    }

    // Parse package.json once
    this.packageJson = this.readPackageJson(this.projectRoot);
  }

  /**
   * Run all detectors in parallel and return aggregated results.
   */
  async detect(): Promise<DetectionResult> {
    const startTime = performance.now();

    // All detectors run in parallel (they're all synchronous file reads)
    const [packageManager, framework, buildTool, isMonorepo, workspaces] = await Promise.all([
      this.detectPackageManager(),
      this.detectFramework(),
      this.detectBuildTool(),
      this.detectMonorepo(),
      this.detectWorkspaces(),
    ]);

    const projectType = this.detectProjectType(isMonorepo);
    const name = this.packageJson?.name ?? this.getDirectoryName();
    const nodeVersion = process.version;

    const elapsed = Math.round(performance.now() - startTime);
    this.log.info(`Detection completed in ${elapsed}ms`);
    this.log.debug(`Detected: ${projectType} / ${framework ?? 'no framework'} / ${packageManager} / ${buildTool ?? 'no build tool'}`);

    const project: ProjectState = {
      name,
      root: this.projectRoot,
      type: projectType,
      framework,
      packageManager,
      buildTool,
      nodeVersion,
      isMonorepo,
      workspaces,
      detectedAt: Date.now(),
    };

    return { project };
  }

  // -------------------------------------------------------------------------
  // Package Manager Detection
  // -------------------------------------------------------------------------

  private async detectPackageManager(): Promise<PackageManager> {
    for (const [lockFile, manager] of Object.entries(LOCK_FILE_MAP)) {
      if (this.rootFiles.includes(lockFile)) {
        return manager as PackageManager;
      }
    }

    // Fallback: check if package.json exists → default to npm
    if (this.rootFiles.includes('package.json')) {
      return 'npm';
    }

    return 'unknown';
  }

  // -------------------------------------------------------------------------
  // Framework Detection
  // -------------------------------------------------------------------------

  private async detectFramework(): Promise<Framework> {
    if (!this.packageJson) return null;

    const allDeps = {
      ...this.packageJson.dependencies,
      ...this.packageJson.devDependencies,
    };

    // Check framework deps in priority order (most specific first)
    // Next.js before React (Next depends on React)
    const priorityOrder = [
      'next', 'nuxt', '@sveltejs/kit', '@angular/core', '@nestjs/core',
      'react', 'vue', 'svelte',
      'fastify', 'express', 'koa', '@hapi/hapi',
    ];

    for (const dep of priorityOrder) {
      if (dep in allDeps) {
        const framework = FRAMEWORK_DEPS[dep];
        if (framework) return framework as Framework;
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Build Tool Detection
  // -------------------------------------------------------------------------

  private async detectBuildTool(): Promise<BuildTool> {
    for (const [configPrefix, tool] of Object.entries(BUILD_TOOL_CONFIGS)) {
      const hasConfig = this.rootFiles.some((f) =>
        f.startsWith(configPrefix),
      );
      if (hasConfig) return tool as BuildTool;
    }

    // Check if using TypeScript compiler directly
    if (this.rootFiles.includes('tsconfig.json') || this.rootFiles.includes('tsconfig.build.json')) {
      // Only mark as tsc if no other build tool found
      return 'tsc';
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Monorepo Detection
  // -------------------------------------------------------------------------

  private async detectMonorepo(): Promise<boolean> {
    // Check for monorepo markers
    for (const marker of MONOREPO_MARKERS) {
      if (this.rootFiles.includes(marker)) return true;
    }

    // Check for workspaces in package.json
    if (this.packageJson?.workspaces) return true;

    return false;
  }

  // -------------------------------------------------------------------------
  // Workspace Detection
  // -------------------------------------------------------------------------

  private async detectWorkspaces(): Promise<WorkspaceInfo[]> {
    if (!this.packageJson?.workspaces) return [];

    const workspacePatterns = Array.isArray(this.packageJson.workspaces)
      ? this.packageJson.workspaces
      : this.packageJson.workspaces.packages ?? [];

    const workspaces: WorkspaceInfo[] = [];

    for (const pattern of workspacePatterns) {
      // Simple glob expansion: "packages/*" → list dirs in packages/
      const basePath = pattern.replace(/\/\*$/, '');
      const fullBasePath = join(this.projectRoot, basePath);

      if (!existsSync(fullBasePath)) continue;

      try {
        const entries = readdirSync(fullBasePath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const workspacePath = join(fullBasePath, entry.name);
          const workspacePackageJson = this.readPackageJson(workspacePath);

          if (workspacePackageJson) {
            // Detect framework for this workspace
            const allDeps = {
              ...workspacePackageJson.dependencies,
              ...workspacePackageJson.devDependencies,
            };

            let framework: Framework = null;
            for (const [dep, fw] of Object.entries(FRAMEWORK_DEPS)) {
              if (dep in allDeps) {
                framework = fw as Framework;
                break;
              }
            }

            workspaces.push({
              name: workspacePackageJson.name ?? entry.name,
              path: workspacePath,
              type: 'node',
              framework,
              scripts: workspacePackageJson.scripts ?? {},
            });
          }
        }
      } catch {
        // Directory read error — skip
      }
    }

    return workspaces;
  }

  // -------------------------------------------------------------------------
  // Project Type Detection
  // -------------------------------------------------------------------------

  private detectProjectType(isMonorepo: boolean): ProjectType {
    if (isMonorepo) return 'monorepo';

    if (
      this.rootFiles.includes('tsconfig.json') ||
      this.rootFiles.some((f) => f.endsWith('.ts'))
    ) {
      return 'typescript';
    }

    if (this.rootFiles.includes('package.json')) {
      return 'node';
    }

    return 'unknown';
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private readPackageJson(dir: string): PackageJson | null {
    const filePath = join(dir, 'package.json');
    try {
      if (!existsSync(filePath)) return null;
      const raw = readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as PackageJson;
    } catch {
      return null;
    }
  }

  private getDirectoryName(): string {
    return this.projectRoot.split(/[/\\]/).pop() ?? 'project';
  }
}
