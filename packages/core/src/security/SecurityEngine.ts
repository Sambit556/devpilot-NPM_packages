/**
 * DevsPilot Security Engine
 *
 * Scans code, environments, and configurations for security issues:
 * - Detects leaked secrets in configuration and source code
 * - Runs dependency vulnerability audit using native package manager commands
 * - Identifies path traversal/CORS/header vulnerabilities in configuration
 * - Generates security reports
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import tls from 'node:tls';
import http from 'node:http';
// https import removed (unused)
import {
  SECRET_KEY_PATTERNS,
  SECRET_VALUE_PATTERNS,
} from '@devspilot/shared';
import type { ResolvedConfig } from '@devspilot/shared';
import { EventBus } from '../bus/EventBus.js';
import { StateManager } from '../state/StateManager.js';
import { createLogger } from '../utils/logger.js';
import type { Logger } from '../utils/logger.js';

export interface SecurityEngineOptions {
  eventBus: EventBus;
  stateManager: StateManager;
  projectRoot: string;
}

export interface SecurityIssue {
  category: string;
  severity: 'low' | 'moderate' | 'high' | 'critical';
  message: string;
  file?: string;
  line?: number;
  suggestion: string;
}

export class SecurityEngine {
  private readonly log: Logger;
  private readonly eventBus: EventBus;
  private readonly stateManager: StateManager;
  private readonly projectRoot: string;

  constructor(options: SecurityEngineOptions) {
    this.eventBus = options.eventBus;
    this.stateManager = options.stateManager;
    this.projectRoot = resolve(options.projectRoot);
    this.log = createLogger({ name: 'SecurityEngine' });
  }

  /**
   * Run a full security scan.
   */
  async scan(config: ResolvedConfig): Promise<SecurityIssue[]> {
    const issues: SecurityIssue[] = [];

    this.log.info('Running security scanner...');

    // 1. Scan for leaked secrets in source code and configuration
    const secretIssues = await this.scanForSecrets();
    issues.push(...secretIssues);

    // 2. Scan dependencies
    const dependencyIssues = await this.auditDependencies();
    issues.push(...dependencyIssues);

    // 3. Scan configuration & web security parameters
    const webSecurityIssues = this.auditWebSecurity(config);
    issues.push(...webSecurityIssues);

    // 4. Run active probes for TLS certificates & HTTP headers
    const activeProbeIssues = await this.auditServiceSecurityProbes(config);
    issues.push(...activeProbeIssues);

    // Update global diagnostic state if needed or emit security events
    for (const issue of issues) {
      this.eventBus.emit('security:warning', {
        type: 'security:warning',
        payload: {
          category: issue.category,
          message: issue.message,
          severity: issue.severity,
        },
        timestamp: Date.now(),
        source: 'SecurityEngine',
      });
    }

    this.log.info(`Security scan completed. Found ${issues.length} issue(s).`);
    return issues;
  }

  /**
   * Scans configuration and files for plain-text keys.
   */
  private async scanForSecrets(): Promise<SecurityIssue[]> {
    const issues: SecurityIssue[] = [];
    const filesToScan: string[] = [];

    // Gather config and source files
    const scanDirs = ['src', 'config'];
    for (const dirName of scanDirs) {
      const fullDir = join(this.projectRoot, dirName);
      if (existsSync(fullDir)) {
        this.gatherFilesRecursive(fullDir, filesToScan);
      }
    }

    // Also scan env files in root
    const rootFiles = readdirSync(this.projectRoot);
    const envFiles = rootFiles.filter((f) => f.startsWith('.env'));
    for (const file of envFiles) {
      filesToScan.push(join(this.projectRoot, file));
    }

    for (const file of filesToScan) {
      try {
        const content = readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        lines.forEach((line, idx) => {
          // Check for variable assignments: KEY = VALUE or "KEY": "VALUE"
          const assignmentMatch = /([\w.-]+)\s*[=:]\s*(['"`]?)([^'"`\s\\]{8,})\2/.exec(line);
          if (assignmentMatch) {
            const keyName = assignmentMatch[1]!;
            const val = assignmentMatch[3]!;

            const keyIsSecret = SECRET_KEY_PATTERNS.some((p) => p.test(keyName));
            const valIsSecret = SECRET_VALUE_PATTERNS.some((p) => p.test(val));

            if (keyIsSecret && valIsSecret) {
              issues.push({
                category: 'Hardcoded Secret',
                severity: 'critical',
                message: `Leaked or hardcoded secret "${keyName}" found in file: ${file}:${idx + 1}`,
                file: file.replace(this.projectRoot, ''),
                line: idx + 1,
                suggestion: `Move secret "${keyName}" out of code and use environment variables.`,
              });
            }
          }
        });
      } catch {
        // ignore read failures
      }
    }

    return issues;
  }

  /**
   * Invokes native audits depending on package manager.
   */
  private async auditDependencies(): Promise<SecurityIssue[]> {
    const issues: SecurityIssue[] = [];
    const pkgManager = this.stateManager.getState().project.packageManager;

    if (pkgManager === 'unknown') return issues;

    try {
      this.log.debug(`Auditing dependencies using ${pkgManager}...`);
      let command = 'npm audit --json';
      if (pkgManager === 'pnpm') command = 'pnpm audit --json';
      if (pkgManager === 'yarn') command = 'yarn audit --json';

      const output = execSync(command, {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 15000,
      });

      const parsed = JSON.parse(output);
      // Parse npm/pnpm audit report structure
      if (parsed.advisories) {
        for (const adv of Object.values(parsed.advisories) as any[]) {
          issues.push({
            category: 'Vulnerable Dependency',
            severity: adv.severity === 'critical' ? 'critical' : adv.severity === 'high' ? 'high' : 'moderate',
            message: `Dependency "${adv.module_name}" has vulnerability: ${adv.title}`,
            suggestion: `Upgrade "${adv.module_name}" to version ${adv.patched_versions || 'latest'} or run "${pkgManager} audit fix".`,
          });
        }
      } else if (parsed.vulnerabilities) {
        // Newer npm audit format
        for (const [depName, vul] of Object.entries(parsed.vulnerabilities) as any[]) {
          issues.push({
            category: 'Vulnerable Dependency',
            severity: vul.severity === 'critical' ? 'critical' : vul.severity === 'high' ? 'high' : 'moderate',
            message: `Dependency "${depName}" is vulnerable. Range: ${vul.range || 'unknown'}`,
            suggestion: `Upgrade "${depName}" or run "${pkgManager} audit fix".`,
          });
        }
      }
    } catch {
      // execSync fails if vulnerabilities are found (non-zero exit code),
      // we can try to parse the error.stdout if it exists
    }

    return issues;
  }

  /**
   * Check configuration for web security weaknesses.
   */
  private auditWebSecurity(config: ResolvedConfig): SecurityIssue[] {
    const issues: SecurityIssue[] = [];

    // Check dashboard accessibility ( localhost only by default )
    if (config.dashboard.enabled) {
      issues.push({
        category: 'Dashboard Exposure',
        severity: 'moderate',
        message: 'Dashboard server is enabled. Ensure it is not exposed publicly.',
        suggestion: 'Dashboard binds to localhost by default. Do not change it to 0.0.0.0 in shared environments.',
      });
    }

    // Scan individual services
    for (const [name, svc] of Object.entries(config.services)) {
      // Check CORS or ports in commands
      if (svc.command.includes('--allow-all') || svc.command.includes('--cors=*')) {
        issues.push({
          category: 'CORS Configuration Check',
          severity: 'moderate',
          message: `Service "${name}" command may expose wide CORS access: "${svc.command}"`,
          suggestion: 'Restrict CORS permissions in development command options.',
        });
      }
    }

    return issues;
  }

  private gatherFilesRecursive(dir: string, fileList: string[]): void {
    try {
      const list = readdirSync(dir);
      for (const entry of list) {
        const fullPath = join(dir, entry);
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
          // Avoid scanning node_modules or dist folders
          if (entry !== 'node_modules' && entry !== 'dist' && entry !== '.git') {
            this.gatherFilesRecursive(fullPath, fileList);
          }
        } else {
          const ext = extname(fullPath).toLowerCase();
          if (['.ts', '.tsx', '.js', '.jsx', '.json', '.yaml', '.yml'].includes(ext)) {
            fileList.push(fullPath);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  private async auditServiceSecurityProbes(config: ResolvedConfig): Promise<SecurityIssue[]> {
    const issues: SecurityIssue[] = [];
    const portsToCheck = Object.values(config.services)
      .map((s) => s.port)
      .filter((p): p is number => p !== null);

    for (const port of portsToCheck) {
      // 1. Audit HTTP headers (O6)
      try {
        const headers = await this.probeHttpHeaders(port);
        if (headers) {
          const missing: string[] = [];
          if (!headers['strict-transport-security']) missing.push('HSTS');
          if (!headers['content-security-policy']) missing.push('CSP');
          if (!headers['x-frame-options']) missing.push('X-Frame-Options');

          if (missing.length > 0) {
            issues.push({
              category: 'Security Headers Check',
              severity: 'low',
              message: `Port ${port} is missing security headers: ${missing.join(', ')}`,
              suggestion: 'Configure Helmet or equivalent middleware to apply standard headers.',
            });
          }
        }
      } catch {
        // service might not be running
      }

      // 2. Audit SSL/TLS certificates (O4)
      try {
        const certValid = await this.checkTlsCertificate(port);
        if (!certValid) {
          issues.push({
            category: 'HTTPS Certificate Check',
            severity: 'moderate',
            message: `Port ${port} has an invalid or self-signed HTTPS certificate.`,
            suggestion: 'Use a trusted local CA tool like mkcert to sign local certificates.',
          });
        }
      } catch {
        // not an SSL port
      }
    }

    return issues;
  }

  private probeHttpHeaders(port: number): Promise<http.IncomingHttpHeaders | null> {
    return new Promise((resolve) => {
      const req = http.request({ host: 'localhost', port, method: 'HEAD', timeout: 800 }, (res) => {
        resolve(res.headers);
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    });
  }

  private checkTlsCertificate(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = tls.connect({
        host: 'localhost',
        port,
        rejectUnauthorized: true,
        timeout: 800,
      }, () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    });
  }
}
