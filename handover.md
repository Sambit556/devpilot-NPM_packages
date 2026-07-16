# DevsPilot — Handover & Memory Document

This document serves as the project memory and handover guide for DevsPilot, allowing any future AI assistant or developer to seamlessly continue implementation from the current state.

## Project Vision & Goal
DevsPilot is a production-grade developer environment orchestrator ("Developer Operating System"). It simplifies running local environments with multiple services, docker integration, log aggregation, and smart rebuilds/restarts into a single command:
```bash
npx DevsPilot up
```

## Tech Stack & Architecture
- **Monorepo Manager**: `pnpm` workspaces + `turbo`
- **Compiler**: TypeScript (strict, ESM, Node16 resolution)
- **Shared Package**: `@devspilot/shared` (pure types, constants, utilities, zero dependencies)
- **Core Engine**: `@devspilot/core` (EventBus, StateManager, ProcessManager, PortManager, DetectorEngine, LogManager, ConfigLoader)
- **CLI Package**: `@devspilot/cli` (CLI binary and command router)
- **Build / Bundler**: ESM compiled outputs via `tsc` (configured with project references)

---

## Current Status (As of July 16, 2026)

### 1. Root Configuration & Project Setup (Done)
- `package.json`: Root package configuration with Turborepo and pnpm workspaces.
- `pnpm-workspace.yaml`: Workspace definition mapping `packages/*` and `packages/plugins/*`.
- `turbo.json`: Task definitions for build, dev, test, lint, and formatting.
- `tsconfig.base.json` & `tsconfig.json`: Base and root TypeScript configurations using Project References.
- `.eslintrc.cjs` & `.prettierrc`: ESLint and Prettier configs with strict code quality and safety rules.
- `.gitignore` & `.editorconfig`: Repository rules and ignore patterns.

### 2. `@devspilot/shared` (Done)
- `src/types/events.ts`: Strongly typed, immutable event structures (frozen objects) for the event bus.
- `src/types/state.ts`: Deeply frozen, immutable state tree shape.
- `src/types/config.ts`: Configuration shapes (user-defined input vs resolved configuration).
- `src/types/plugin.ts`: Sandboxed Plugin API, manifest, permissions, and lifecycle shapes.
- `src/constants/index.ts`: Centralized magic numbers, default values, ignore lists, color palettes, and exit codes.
- `src/utils/index.ts`: Pure, dependency-free utility functions (formatting, validation, path safety, redacting secrets).

### 3. `@devspilot/core` (Core Modules Implemented)
- `src/bus/EventBus.ts`: Event bus implementation with typed events, wildcard listener support, and history tracking.
- `src/state/StateManager.ts`: Immutable state store with selector-based subscriptions and state diffing support.
- `src/utils/errors.ts`: Error hierarchy with custom error codes, exit codes, and fix suggestions.
- `src/utils/logger.ts`: Pino-based logger wrapper with automated secret redaction.
- `src/config/ConfigSchema.ts` & `ConfigLoader.ts`: Configuration loading, validation (Zod schema), profiling, and auto-discovery.
- `src/detector/DetectorEngine.ts`: Auto-detection of package manager, framework, build tools, and workspaces.
- `src/process/ProcessManager.ts`: Process management with safe spawning, crash restarts with exponential backoff, and graceful termination.
- `src/port/PortManager.ts`: Conflict detection (TCP socket check, local pid check via `lsof`/`netstat`) and allocation tracking.
- `src/log/LogManager.ts`: Multiplexing, coloring, structured JSON parsing, daily rotating log file writer, and log search/export.
- `src/env/EnvManager.ts`: Environment variable parsing, prioritization files load, static process.env references analysis, and AES-256-GCM encryption/decryption layer.
- `src/watcher/FileWatcher.ts`: Native debounced directory watching via chokidar and smart restarts.
- `src/health/HealthEngine.ts`: Liveness state machine, checking HTTP, TCP, process, and file states.
- `src/git/GitManager.ts`: Repository statistics, stash status, commit descriptions, and hook tracking.
- `src/security/SecurityEngine.ts`: Vulnerability scans, dependency audits, credential check logic, local TLS cert validations, and HTTP security headers audit (CSP, HSTS).
- `src/performance/PerfEngine.ts`: CPU and Memory usage per process, event loop lag mean tracking, GC PerformanceObserver, and active OS process handle count.
- `src/diagnostics/DiagnosticsEngine.ts`: Diagnostics doctor checks and health scoring model.
- `src/plugin/PluginLoader.ts`: Sandboxed PluginAPI triggers and manifest activation.
- `src/storage/StorageManager.ts`: Local JSON stores and Least-Recently-Used memory cache manager.
- `src/docker/DockerManager.ts`: Docker Compose file discovery, container lifecycle, CPU/RAM container statistics, compose logs tailing, and cleanup prune reports.
- `src/database/DatabaseManager.ts`: Config/Env URI detection, socket connectivity validation, and migrations schema folder detection (Prisma, knex, Sequelize).
- `src/network/NetworkManager.ts`: Static route endpoints scanner, gRPC proto mapping, WebSocket dependency matching, and message queues.
- `src/scheduler/TaskScheduler.ts`: Basic cron solvers and scheduled interval timers runner.
- `src/utils/DxHelper.ts`: System notifications (PowerShell, osascript, notify-send), sound beep triggers, and clipboard integrations.
- `src/engine/DevsPilotEngine.ts`: Main orchestrator coordinating all core modules and running the topological service startup ordering.

### 4. `@devspilot/cli` (Fully Implemented CLI MVP)
- `src/bin.ts`: Shebang wrapper that calls `run(process.argv.slice(2))` from `./index.js`.
- `src/index.ts`: Native argument parsing router, picocolors log formatting, status and diagnostics table renderer, and command executors (`up`, `down`, `status`, `logs`, `restart`, `doctor`, `health`, `env`, `ports`, `config`, `version`, `help`). Supports environment encryption (`--encrypt` / `--decrypt`) and logs regex search/export.

---

## Remaining Tasks (To Be Implemented)

### Phase 0: Foundation (Remaining)
1. **`ModuleRegistry.ts`** in `@devspilot/core`: Implement the engine module registration and lifecycle coordinator.

### Phase 1: MVP (CLI Implementation)
1. **Theme system (dark/light)**: Support custom ANSI themes.

---

## Instructions for the next AI Assistant

1. **Verify Setup**: You can run `pnpm install` in the root workspace to install dependencies.
2. **Compile Project**: You can run `npx tsc --build` to build the typescript packages.
3. **Run Commands**: Test CLI scripts via:
   ```bash
   node packages/cli/dist/bin.js status
   node packages/cli/dist/bin.js doctor
   ```
4. **Follow the task list**: Check off remaining items in `task.md` as you make progress.
