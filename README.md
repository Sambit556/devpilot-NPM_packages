# DevsPilot

> **The Developer Operating System** — One command to simplify your entire local development experience. Zero configuration. Everything just works.

```bash
npx DevsPilot up
```

---

## ⚡ Quick Start

### 1. Run in any Node.js project
You can launch DevsPilot immediately in any existing backend, frontend, or monorepo project:
```bash
npx DevsPilot up
```
DevsPilot will auto-detect your project type, package manager, frameworks, Docker setups, and start everything in dependency-ordered processes with aggregated log streaming and smart change watching.

### 2. Available Commands
```bash
DevsPilot up              # Start all dev services
DevsPilot status          # List status, port, memory, and CPU metrics of running services
DevsPilot logs [service]  # Tail and aggregate logs from services
DevsPilot restart [svc]   # Restart one or all services
DevsPilot doctor          # Run diagnostics checks
DevsPilot health          # View liveness/readiness probe status
DevsPilot env             # Audits environment files and variables
DevsPilot ports           # Inspect mapped port configurations
DevsPilot config          # Dump the resolved JSON configuration profile
DevsPilot version         # Show version information
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
Apache-2.0 License.
