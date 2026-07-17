/**
 * DevsPilot Git Manager
 *
 * Runs git commands to analyze repository status:
 * - Current branch and commit info
 * - Uncommitted changes count
 * - Unpushed commits count
 * - Merge conflict detection
 * - Active Git hook tracking
 * - Repository size calculation
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { GitState } from '@devspilot/shared';
import { EventBus } from '../bus/EventBus.js';
import { StateManager } from '../state/StateManager.js';
import { createLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';

export interface GitManagerOptions {
  eventBus: EventBus;
  stateManager: StateManager;
  projectRoot: string;
}

export class GitManager {
  private readonly log: Logger;
  private readonly stateManager: StateManager;
  private readonly projectRoot: string;
  private isGitAvailable = false;

  constructor(options: GitManagerOptions) {
    this.stateManager = options.stateManager;
    this.projectRoot = resolve(options.projectRoot);
    this.log = createLogger({ name: 'GitManager' });
  }

  /**
   * Initializes git checks and caches availability.
   */
  init(): boolean {
    const gitDir = join(this.projectRoot, '.git');
    if (!existsSync(gitDir)) {
      this.log.debug('Not a git repository (no .git folder found)');
      this.updateState({ available: false });
      return false;
    }

    try {
      execSync('git --version', { stdio: 'ignore', timeout: 2000 });
      this.isGitAvailable = true;
      this.updateState({ available: true });
      return true;
    } catch {
      this.log.warn('Git is not installed or not in PATH');
      this.updateState({ available: false });
      return false;
    }
  }

  /**
   * Fetches Git repository details and updates the state.
   */
  async update(): Promise<GitState> {
    if (!this.isGitAvailable) {
      return this.stateManager.getState().git;
    }

    try {
      const branch = this.runGit('rev-parse --abbrev-ref HEAD');
      const commitHash = this.runGit('rev-parse HEAD');
      const commitMessage = this.runGit('log -1 --pretty=%B');

      // Count uncommitted (staged + unstaged) changes
      const statusOutput = this.runGit('status --porcelain');
      const lines = statusOutput.split('\n').filter((l) => l.trim().length > 0);

      const untrackedFiles = lines.filter((l) => l.startsWith('??')).length;
      const uncommittedChanges = lines.length - untrackedFiles;

      // Count unpushed commits
      let unpushedCommits = 0;
      try {
        const trackingOutput = this.runGit('rev-list --count @{u}..HEAD');
        unpushedCommits = parseInt(trackingOutput, 10) || 0;
      } catch {
        // No upstream branch set, unpushed = 0 or count commits on branch
        try {
          const commitCount = this.runGit('rev-list --count HEAD');
          unpushedCommits = parseInt(commitCount, 10) || 0;
        } catch {
          // ignore
        }
      }

      // Check for merge conflicts
      const hasConflicts = lines.some(
        (l) =>
          l.startsWith('UU') ||
          l.startsWith('AA') ||
          l.startsWith('DD') ||
          l.startsWith('AU') ||
          l.startsWith('UD'),
      );

      // Stash count
      let stashCount = 0;
      try {
        const stashOutput = this.runGit('stash list');
        stashCount = stashOutput.split('\n').filter((l) => l.trim().length > 0).length;
      } catch {
        // ignore
      }

      const gitState: GitState = {
        available: true,
        branch,
        commitHash,
        commitMessage,
        uncommittedChanges,
        untrackedFiles,
        unpushedCommits,
        hasConflicts,
        stashCount,
      };

      this.updateState(gitState);
      return gitState;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log.error(`Failed to update git stats: ${msg}`);
      return this.stateManager.getState().git;
    }
  }

  /**
   * Scan for active git hooks under .git/hooks/
   */
  getActiveHooks(): string[] {
    const hooksDir = join(this.projectRoot, '.git', 'hooks');
    if (!existsSync(hooksDir)) return [];

    try {
      const entries = readdirSync(hooksDir);
      // Active hooks do not end with '.sample' and must be executable (best effort check)
      return entries.filter(
        (file) =>
          !file.endsWith('.sample') &&
          statSync(join(hooksDir, file)).isFile(),
      );
    } catch {
      return [];
    }
  }

  /**
   * Get size of the .git directory.
   */
  getGitDirectorySize(): number {
    const gitDir = join(this.projectRoot, '.git');
    if (!existsSync(gitDir)) return 0;
    return this.getDirectorySizeRecursive(gitDir);
  }

  private runGit(args: string): string {
    return execSync(`git ${args}`, {
      cwd: this.projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
  }

  private updateState(patch: Partial<GitState>): void {
    this.stateManager.update((state) => ({
      git: {
        ...state.git,
        ...patch,
      },
    }));
  }

  private getDirectorySizeRecursive(dir: string): number {
    let totalSize = 0;
    try {
      const list = readdirSync(dir);
      for (const entry of list) {
        const fullPath = join(dir, entry);
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
          totalSize += this.getDirectorySizeRecursive(fullPath);
        } else {
          totalSize += stats.size;
        }
      }
    } catch {
      // ignore failures
    }
    return totalSize;
  }
}
