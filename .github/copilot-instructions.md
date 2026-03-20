# DevBox Pro - AI Coding Agent Instructions

## Project Overview
DevBox Pro is an Electron desktop app for local PHP and Node.js development with bundled runtimes and services. It supports multi-version PHP, Node.js, MySQL, MariaDB, Redis, PostgreSQL, MongoDB, Nginx, Apache, Mailpit, phpMyAdmin, MinIO, Memcached, and related tooling without Docker.

**Tech Stack:** Electron 40 + React 19 + Vite 7 + TailwindCSS 4

## Architecture

### Process Separation (Critical)
- **Main Process** (`src/main/`): Node.js backend - service managers, IPC handlers, system operations
- **Renderer Process** (`src/renderer/`): React frontend - UI components, user interaction
- **Communication**: All cross-process calls go through IPC via `preload.js` → `window.devbox.*` API
- **Shared Config** (`src/shared/serviceConfig.js`): Single source of truth for service versions and ports

### Service Architecture (Critical)
Service managers have been refactored into thin facade classes plus concern-specific mixins under `src/main/services/<domain>/`.

Examples:
- `ProjectManager.js` composes mixins from `src/main/services/project/`
- `ServiceManager.js` composes mixins from `src/main/services/service/`
- `BinaryDownloadManager.js` composes mixins from `src/main/services/binary/`
- `DatabaseManager.js` composes mixins from `src/main/services/database/`
- `GitManager.js` composes mixins from `src/main/services/git/`
- `CompatibilityManager.js` composes mixins from `src/main/services/compatibility/`
- `SupervisorManager.js` composes mixins from `src/main/services/supervisor/`

Managers receive references to each other via `managers` object for cross-communication.

### Manager Responsibilities
- `ProjectManager` - Project CRUD, install flows, environment sync, vhost orchestration, compatibility checks
- `ServiceManager` - Starts/stops web servers and bundled services, owns runtime config generation
- `DatabaseManager` - Multi-engine database operations, import/export, credentials, metadata
- `BinaryDownloadManager` - Download, extract, import, update, and discover binary assets
- `CliManager` - External `dvp` command integration and PATH/project mapping
- `GitManager` - Git executable discovery, clone/auth, SSH key workflows, progress reporting
- `CompatibilityManager` - Bundled/remote compatibility rules and config normalization
- `SupervisorManager` - Background worker/process management for PHP, Node.js, Python, and queues

### IPC Handler Pattern
All frontend-to-backend calls defined in `src/main/ipc/handlers.js`:
```javascript
ipcMain.handle('projects:create', async (event, config) => {
  return project.createProject(config, mainWindow);
});
```
Exposed to renderer via `preload.js` as `window.devbox.projects.create(config)`.

### State Management
- **Backend**: `ConfigStore` (electron-store) persists config to `~/.devbox-pro/`
- **Frontend**: `AppContext.jsx` with useReducer for global React state

## Key Conventions

### Service Versioning
Multiple versions of services can run simultaneously on different ports:
- Port offsets defined in `shared/serviceConfig.js` (`VERSION_PORT_OFFSETS`)
- Base/default ports defined in `shared/serviceConfig.js` (`DEFAULT_PORTS`)
- First web server to start can claim ports `80` and `443`; the alternate server is assigned fallback ports and proxied automatically

### Project Configuration
Projects stored in `configStore.get('projects')` array with:
- Per-project PHP version, web server choice, SSL settings
- Per-project Node.js version and runtime command configuration for Node projects
- `.test` domain generation (for example `myproject.test`)
- Virtual host configs auto-generated for Nginx and Apache
- Compatibility checks accept both saved-project and flattened UI payloads

### Binary Management
- Binaries downloaded to `app.getPath('userData')/resources/`
- Remote config at `config/binaries.json` defines download URLs
- Extraction runs in worker thread (`extractWorker.js`) to avoid blocking UI
- Installed/versioned assets are discovered via manager mixins under `src/main/services/binary/`

### Process Spawning (Windows)
Always use `windowsHide: true` to prevent console window flashing.

Preferred approach:
```javascript
spawn(executablePath, args, { windowsHide: true, shell: false });
```

Rules:
- Prefer direct executable paths plus argument arrays
- Avoid `shell: true` with argument arrays; Node now emits `DEP0190` for that pattern
- Only use shell execution when you truly need a shell builtin or wrapper, and then keep it explicit
- Quote filesystem paths inside generated config files because install paths commonly contain spaces on Windows

### Generated Configs
- Runtime web server and service configs under the user data path are derived artifacts
- Do not hand-edit generated Nginx, Apache, or database config files; update the generator code instead

### Tests Mirror Source
- Keep integration coverage in the main manager tests under `tests/main/services/*Manager.test.js`
- Add focused unit tests under subfolders that mirror the mixin layout, such as `tests/main/services/project/` or `tests/main/services/git/`

## Development Workflow

```bash
npm run dev          # Start Electron + Vite dev server concurrently
npm run build:renderer
npm run build:win    # Build Windows installer
npm run build:mac    # Build macOS installer
npm run build:all    # Build Windows and macOS packages
npm test             # Run all Vitest suites
npm run test:main
npm run test:renderer
npm run test:e2e
```

Renderer dev server runs at `http://localhost:3000`.

## File Locations

| Purpose | Location |
|---------|----------|
| Service configs | `src/shared/serviceConfig.js` |
| IPC handlers | `src/main/ipc/handlers.js` |
| Preload API | `src/main/preload.js` |
| React pages | `src/renderer/src/pages/` |
| Binary URLs | `config/binaries.json` |
| Compatibility rules | `config/compatibility.json` |
| Service mixins | `src/main/services/<domain>/` |
| App config | `~/.devbox-pro/` (runtime) |

## Common Patterns

### Adding a New IPC Handler
1. Add handler in `src/main/ipc/handlers.js`
2. Expose in `src/main/preload.js` under appropriate namespace
3. Call from renderer as `window.devbox.namespace.method()`

### Adding a New Service Version
1. Update `SERVICE_VERSIONS` in `src/shared/serviceConfig.js`
2. Add download URLs to `config/binaries.json`
3. Define port offset in `VERSION_PORT_OFFSETS` if the service is versioned and daemonized
4. Update renderer selectors or service metadata if the service is user-facing

### Extending a Manager
1. Prefer adding a new mixin under the relevant `src/main/services/<domain>/` folder
2. Keep the facade thin: constructor state plus `Object.assign(...)`
3. Use `this.methodName()` for cross-mixin calls instead of cross-importing mixins
4. Mirror new mixins with focused tests under `tests/main/services/<domain>/`

### Platform-Specific Code
```javascript
const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
const exe = process.platform === 'win32' ? 'php.exe' : 'php';
```

## Testing Notes
- Test service start/stop with multiple versions running
- Verify port conflicts handled gracefully (alternate ports assigned)
- Test on both Windows and macOS for path separator issues (`path.join` always)
- Prefer targeted Vitest slices for the service or mixin you changed before running broader suites
- When changing generated configs or runtime spawning, cover Windows path and quoting behavior explicitly
