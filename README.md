# DevsPilot

> **The Developer Operating System** — One command to simplify your entire local development experience. Zero configuration. Everything just works.

```bash
npm install -g @devspilot/cli
devspilot up
```

---

## ⚡ Quick Start

### 1. Install
DevsPilot is published as a scoped package, so install the CLI globally:
```bash
npm install -g @devspilot/cli
```
Or run it once without installing (scoped packages need the `-p` flag since the bin name `devspilot` differs from the package's unscoped name `cli`):
```bash
npx -p @devspilot/cli devspilot up
```

### 2. Run in any Node.js project
You can launch DevsPilot immediately in any existing backend, frontend, or monorepo project:
```bash
devspilot up
```
DevsPilot will auto-detect your project type, package manager, frameworks, Docker setups, and start everything in dependency-ordered processes with aggregated log streaming and smart change watching.

### 3. Available Commands
```bash
devspilot up              # Start all dev services
devspilot status          # List status, port, memory, and CPU metrics of running services
devspilot logs [service]  # Tail and aggregate logs from services
devspilot restart [svc]   # Restart one or all services
devspilot doctor          # Run diagnostics checks
devspilot health          # View liveness/readiness probe status
devspilot env             # Audits environment files and variables
devspilot ports           # Inspect mapped port configurations
devspilot config          # Dump the resolved JSON configuration profile
devspilot version         # Show version information
```

---

## ⚙️ Configuration (Optional)

DevsPilot is designed to be **zero-config** by default, automatically scanning scripts in `package.json`, `.env` files, and `docker-compose.yml`. 

If you want to customize startup dependency order or configure specific health probes, create a `DevsPilot.config.yml` in your project root:

```yaml
# DevsPilot.config.yml
services:
  api:
    command: npm run dev:api
    port: 3000
    health:
      path: /health
      interval: 5000

  web:
    command: npm run dev:web
    port: 3001
    dependsOn:
      - api
    watch:
      debounce: 500
```

---

## 🛡️ Security & Performance
- **Zero Telemetry by Default**: We respect your privacy. No tracking.
- **Secret Masking**: Any detected secrets or keys inside env values or logs are automatically redacted as `[REDACTED]` in terminal displays.
- **Fast Startup**: Written with lazy-loaded ESM modules to guarantee a cold start time under 500ms.
- **Low Footprint**: Idle memory is capped below 50MB.

---

## 📄 License
MIT License.
