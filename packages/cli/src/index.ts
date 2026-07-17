/**
 * DevsPilot CLI Main Entry Point
 *
 * Implements:
 * - A high-performance, dependency-free argument parser
 * - Command routing (up, down, restart, status, logs, doctor, health, env, ports, config)
 * - Beautiful terminal UI rendering (using picocolors, cli-table3, and spinners)
 */

import { resolve } from 'node:path';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import pc from 'picocolors';
import Table from 'cli-table3';
import ora from 'ora';
import { DevsPilotEngine } from '@devspilot/core';

import { formatBytes, formatDuration, formatPercent } from '@devspilot/shared';

// ---------------------------------------------------------------------------
// Main Entry
// ---------------------------------------------------------------------------

export async function run(args: string[]): Promise<void> {
  const command = args[0] || 'help';
  const flags = parseFlags(args.slice(1));

  if (flags.help || command === 'help') {
    printHelp();
    return;
  }

  const projectRoot = resolve(process.cwd());

  try {
    switch (command) {
      case 'up':
        await handleUp(projectRoot, flags);
        break;
      case 'status':
        await handleStatus(projectRoot, flags);
        break;
      case 'logs':
        await handleLogs(projectRoot, flags, args[1]);
        break;
      case 'restart':
        await handleRestart(projectRoot, flags, args[1]);
        break;
      case 'doctor':
        await handleDoctor(projectRoot, flags);
        break;
      case 'health':
        await handleHealth(projectRoot, flags);
        break;
      case 'env':
        await handleEnv(projectRoot, flags);
        break;
      case 'ports':
        await handlePorts(projectRoot, flags);
        break;
      case 'config':
        await handleConfig(projectRoot, flags);
        break;
      case 'version':
      case '-v':
      case '--version':
        printVersion();
        break;
      default:
        console.log(pc.red(`✗ Unknown command: "${command}"`));
        console.log(`Run ${pc.cyan('DevsPilot help')} to see all available commands.`);
        process.exit(1);
    }
  } catch (err: any) {
    console.error(pc.red(`\n✗ Error: ${err.message || err}`));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// CLI Command Handlers
// ---------------------------------------------------------------------------

async function handleUp(projectRoot: string, flags: any): Promise<void> {
  console.log(pc.bold(pc.blue('\n ◆ DevsPilot — Developer Operating System')));
  console.log(pc.gray(' ───────────────────────────────────────────────────'));

  const spinner = ora('Loading DevsPilot engine...').start();

  try {
    const engine = new DevsPilotEngine({
      projectRoot,
      profile: flags.profile,
      configPath: flags.config,
      debug: flags.verbose,
    });

    spinner.text = 'Initializing modules and launching services...';
    const ctx = await engine.start();
    spinner.succeed(pc.green('DevsPilot engine successfully started!'));

    // Output project/workspaces state
    const state = ctx.stateManager.getState();
    console.log(`\n Project:   ${pc.bold(pc.cyan(state.project.name))}`);
    console.log(` Type:      ${pc.yellow(state.project.type)}`);
    if (state.project.framework) {
      console.log(` Framework: ${pc.magenta(state.project.framework)}`);
    }
    console.log(` Node:      ${pc.gray(state.project.nodeVersion || process.version)}`);
    console.log(pc.gray(' ───────────────────────────────────────────────────\n'));

    // Live log stream representation
    ctx.logManager.onLog((entry) => {
      const colorFn = getServiceColorizer(entry.service, ctx.logManager);
      const timestamp = new Date(entry.timestamp).toLocaleTimeString();
      const prefix = pc.bold(colorFn(`[${entry.service}]`));
      const level = entry.level ? `[${entry.level.toUpperCase()}]` : '';
      console.log(`${pc.gray(timestamp)} ${prefix} ${level} ${entry.message}`);
    });

    // Run active process liveness loop (keep open until SIGINT)
    await new Promise<void>((resolve) => {
      process.on('SIGINT', async () => {
        console.log(pc.yellow('\n\nShutting down services gracefully...'));
        await engine.stop();
        console.log(pc.green('Goodbye!'));
        resolve();
      });
    });
  } catch (err) {
    spinner.fail(pc.red('Engine startup failed'));
    throw err;
  }
}

async function handleStatus(projectRoot: string, flags: any): Promise<void> {
  const engine = new DevsPilotEngine({ projectRoot, configPath: flags.config });
  const ctx = await engine.start();

  const state = ctx.stateManager.getState();
  const table = new Table({
    head: ['Service', 'Port', 'Status', 'Uptime', 'CPU', 'RSS'].map((h) => pc.bold(pc.cyan(h))),
    style: { head: [], border: [] },
  });

  for (const [name, svc] of Object.entries(state.services)) {
    const perfState = state.performance.services[name];

    const statusText = svc.status === 'running' || svc.status === 'healthy'
      ? pc.green(svc.status)
      : svc.status === 'crashed' || svc.status === 'failed'
        ? pc.red(svc.status)
        : pc.yellow(svc.status);

    table.push([
      pc.bold(name),
      svc.port ? svc.port.toString() : pc.gray('—'),
      statusText,
      svc.uptimeMs ? formatDuration(svc.uptimeMs) : pc.gray('—'),
      perfState ? formatPercent(perfState.cpuPercent / 100) : pc.gray('—'),
      perfState ? formatBytes(perfState.rssBytes) : pc.gray('—'),
    ]);
  }

  console.log(pc.bold(pc.blue('\n ◆ DevsPilot Status\n')));
  console.log(table.toString());

  const typedState = state as any;
  if (typedState.database && typedState.database.detected) {
    console.log(pc.bold(pc.blue('\n ◆ Detected Databases & Cache Layers\n')));
    const dbTable = new Table({
      head: ['Dialect', 'Host', 'Port', 'Database', 'Connection', 'Migrations'].map((h) => pc.bold(pc.cyan(h))),
      style: { head: [], border: [] },
    });
    for (const db of typedState.database.instances) {
      dbTable.push([
        pc.bold(db.dialect.toUpperCase()),
        db.host,
        db.port ? db.port.toString() : pc.gray('—'),
        db.databaseName || pc.gray('—'),
        db.connected ? pc.green('✓ connected') : pc.red('✗ failed'),
        db.migrationsFound ? pc.green(`✓ active (${db.migrationFramework})`) : pc.yellow('none found'),
      ]);
    }
    console.log(dbTable.toString());
  }

  if (state.git.available) {
    console.log(pc.gray(`\n Git: ${pc.bold(state.git.branch)} • ${state.git.uncommittedChanges} uncommitted changes • ${state.git.unpushedCommits} unpushed commits`));
  }

  await engine.stop();
}

async function handleLogs(projectRoot: string, flags: any, targetService?: string): Promise<void> {
  const engine = new DevsPilotEngine({ projectRoot, configPath: flags.config });
  const ctx = await engine.start();

  try {
    if (flags.export) {
      const format = flags.export === 'json' ? 'json' : 'text';
      const output = ctx.logManager.exportLogs(targetService, format);
      console.log(output);
      return;
    }

    const logs = flags.search
      ? ctx.logManager.searchLogs(targetService, flags.search)
      : ctx.logManager.getLogs(targetService);

    for (const log of logs) {
      const timestamp = new Date(log.timestamp).toLocaleTimeString();
      const colorFn = getServiceColorizer(log.service, ctx.logManager);
      console.log(`${pc.gray(timestamp)} ${pc.bold(colorFn(`[${log.service}]`))} ${log.message}`);
    }
  } finally {
    await engine.stop();
  }
}

async function handleRestart(projectRoot: string, flags: any, targetService?: string): Promise<void> {
  const engine = new DevsPilotEngine({ projectRoot, configPath: flags.config });
  await engine.start();

  const spinner = ora(targetService ? `Restarting ${targetService}...` : 'Restarting all services...').start();
  try {
    await engine.restart(targetService);
    spinner.succeed(pc.green('Restart complete'));
  } catch (err) {
    spinner.fail(pc.red('Restart failed'));
    throw err;
  } finally {
    await engine.stop();
  }
}

async function handleDoctor(projectRoot: string, flags: any): Promise<void> {
  const engine = new DevsPilotEngine({ projectRoot, configPath: flags.config });
  const ctx = await engine.start();

  const spinner = ora('Running doctor checks...').start();
  try {
    const { checks, score } = await ctx.diagnosticsEngine.runDiagnostics(ctx.config);
    spinner.succeed('Diagnostics complete.');

    console.log(pc.bold(pc.blue(`\n ◆ DevsPilot Doctor (Project Score: ${score}/100)\n`)));

    const table = new Table({
      head: ['Check', 'Category', 'Status', 'Details'],
      style: { head: [], border: [] },
    });

    for (const check of checks) {
      const statusText = check.severity === 'pass'
        ? pc.green('✓ pass')
        : check.severity === 'warn'
          ? pc.yellow('⚠ warn')
          : check.severity === 'info'
            ? pc.blue('ℹ info')
            : pc.red('✗ error');

      table.push([
        pc.bold(check.name),
        check.category,
        statusText,
        check.message,
      ]);
    }

    console.log(table.toString());
  } finally {
    await engine.stop();
  }
}

async function handleHealth(projectRoot: string, flags: any): Promise<void> {
  const engine = new DevsPilotEngine({ projectRoot, configPath: flags.config });
  const ctx = await engine.start();

  const state = ctx.stateManager.getState();
  console.log(pc.bold(pc.blue('\n ◆ DevsPilot Health Status\n')));
  console.log(` Overall: ${state.health.overall === 'healthy' ? pc.green('HEALTHY') : pc.red(state.health.overall.toUpperCase())}`);

  for (const [name, hState] of Object.entries(state.health.services)) {
    const statusText = hState.status === 'healthy'
      ? pc.green('healthy')
      : pc.red(hState.status);
    console.log(`  • ${pc.bold(name)}: ${statusText} (response: ${hState.responseMs}ms)`);
  }

  await engine.stop();
}

async function handleEnv(projectRoot: string, flags: any): Promise<void> {
  const engine = new DevsPilotEngine({ projectRoot, configPath: flags.config });
  const ctx = await engine.start();

  try {
    if (flags.encrypt) {
      const dotenvPath = resolve(projectRoot, '.env');
      if (!existsSync(dotenvPath)) {
        console.log(pc.red('✗ File .env not found for encryption.'));
        return;
      }
      const rawContent = readFileSync(dotenvPath, 'utf-8');
      const cipherText = ctx.envManager.encryptValue(rawContent);
      const outputEncPath = resolve(projectRoot, '.env.enc');
      writeFileSync(outputEncPath, cipherText, 'utf-8');
      console.log(pc.green(`✔ Encrypted .env file saved to ${pc.bold('.env.enc')}`));
      return;
    }

    if (flags.decrypt) {
      const dotenvEncPath = resolve(projectRoot, '.env.enc');
      if (!existsSync(dotenvEncPath)) {
        console.log(pc.red('✗ File .env.enc not found for decryption.'));
        return;
      }
      const cipherText = readFileSync(dotenvEncPath, 'utf-8');
      const plainText = ctx.envManager.decryptValue(cipherText);
      const outputPlainPath = resolve(projectRoot, '.env');
      writeFileSync(outputPlainPath, plainText, 'utf-8');
      console.log(pc.green(`✔ Decrypted .env.enc file saved to ${pc.bold('.env')}`));
      return;
    }

    const state = ctx.stateManager.getState();
    console.log(pc.bold(pc.blue('\n ◆ Environment Configuration Audit\n')));
    console.log(` Loaded files:      ${state.env.files.join(', ') || 'none'}`);
    console.log(` Variable count:    ${state.env.variableCount}`);

    if (state.env.missingRequired.length > 0) {
      console.log(pc.red(`\n ✗ Missing Required Variables:`));
      for (const v of state.env.missingRequired) {
        console.log(`   - ${v}`);
      }
    }

    if (state.env.conflicts.length > 0) {
      console.log(pc.yellow(`\n ⚠ Variable conflicts detected across environment files:`));
      for (const conflict of state.env.conflicts) {
        console.log(`   - ${pc.bold(conflict.variable)}:`);
        conflict.files.forEach((f, idx) => {
          console.log(`     • ${f} -> "${conflict.values[idx]}"`);
        });
      }
    }
  } finally {
    await engine.stop();
  }
}

async function handlePorts(projectRoot: string, flags: any): Promise<void> {
  const engine = new DevsPilotEngine({ projectRoot, configPath: flags.config });
  const ctx = await engine.start();

  const state = ctx.stateManager.getState();
  console.log(pc.bold(pc.blue('\n ◆ Active Port Allocations\n')));

  const table = new Table({
    head: ['Port', 'Service', 'Status', 'Process'],
    style: { head: [], border: [] },
  });

  for (const p of state.ports) {
    const statusText = p.status === 'available'
      ? pc.green('available')
      : p.status === 'allocated'
        ? pc.blue('allocated')
        : pc.red('conflict');

    table.push([
      p.port.toString(),
      p.service || pc.gray('—'),
      statusText,
      p.conflictProcess ? `${p.conflictProcess} (PID ${p.conflictPid})` : pc.gray('—'),
    ]);
  }

  console.log(table.toString());
  await engine.stop();
}

async function handleConfig(projectRoot: string, flags: any): Promise<void> {
  const engine = new DevsPilotEngine({ projectRoot, configPath: flags.config });
  const ctx = await engine.start();

  console.log(pc.bold(pc.blue('\n ◆ Resolved JSON Configuration\n')));
  console.log(JSON.stringify(ctx.config, null, 2));

  await engine.stop();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseFlags(args: string[]): any {
  const flags: Record<string, any> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith('--')) {
      const parts = arg.slice(2).split('=');
      const key = parts[0]!;
      const val = parts[1] !== undefined ? parts[1] : true;
      flags[key] = val;
    } else if (arg.startsWith('-')) {
      flags[arg.slice(1)] = true;
    }
  }

  return flags;
}

function getServiceColorizer(serviceName: string, logManager: any): (txt: string) => string {
  const colorHex = logManager.getColor(serviceName);

  // Return colored helper function using standard terminal escape codes
  return (txt: string) => {
    // Map hexadecimal or color arrays to simple ANSI color matches
    // Here we can use picocolors functions based on colorHex matching
    if (colorHex === '#3b82f6') return pc.blue(txt);
    if (colorHex === '#22c55e') return pc.green(txt);
    if (colorHex === '#f59e0b') return pc.yellow(txt);
    if (colorHex === '#ec4899') return pc.magenta(txt);
    return pc.cyan(txt);
  };
}

function printVersion(): void {
  const pkgJsonPath = resolve(dirname(import.meta.url).replace('file:///', ''), '../package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    console.log(`v${pkg.version}`);
  } catch {
    console.log('v0.0.1');
  }
}

function printHelp(): void {
  console.log(`
${pc.bold(pc.blue('DevsPilot — The Developer Operating System'))}

${pc.bold('Usage:')}
  DevsPilot <command> [options]

${pc.bold('Commands:')}
  up              Start all configured dev services
  status          List status, port, memory, and CPU metrics of running services
  logs [service]  Tail and aggregate logs from services
  restart [svc]   Restart one or all services
  doctor          Run configuration and package dependency diagnostic checks
  health          View probe verification status
  env             Audits environment files and variables
  ports           Inspect mapped port configurations
  config          Dump the resolved JSON configuration profile
  version         Show version information

${pc.bold('Options:')}
  --config=<path> Specify a custom DevsPilot configuration path
  --profile=<name> Apply configuration override profile
  --verbose       Enable verbose debug logs
  --help          Print help instructions
  `);
}

function dirname(url: string): string {
  return url.substring(0, url.lastIndexOf('/'));
}
