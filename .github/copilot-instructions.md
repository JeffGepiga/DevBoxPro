# DevBox Pro - AI Coding Agent Instructions

## Project Overview
DevBox Pro is an Electron desktop app providing a local PHP development environment with bundled services (PHP, MySQL/MariaDB, Redis, Nginx/Apache, etc.). No Docker required.

**Tech Stack:** Electron 28 + React 18 + Vite + TailwindCSS

## Architecture

### Process Separation (Critical)
- **Main Process** (`src/main/`): Node.js backend - service managers, IPC handlers, system operations
- **Renderer Process** (`src/renderer/`): React frontend - UI components, user interaction
- **Communication**: All cross-process calls go through IPC via `preload.js` → `window.devbox.*` API
- **Shared Config** (`src/shared/serviceConfig.js`): Single source of truth for service versions and ports

### Manager Pattern (src/main/services/)
Each service domain has a dedicated manager class initialized in `main.js`:
- `ServiceManager` - Starts/stops services (Nginx, MySQL, Redis, etc.), manages ports
- `ProjectManager` - CRUD for projects, virtual host generation, compatibility checks
- `DatabaseManager` - MySQL/MariaDB operations, import/export, credentials
- `BinaryDownloadManager` - Downloads/extracts binaries with progress tracking
- `CliManager` - External CLI tool (`dvp`) for terminal integration

Managers receive references to each other via `managers` object for cross-communication.

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
- First web server to start claims ports 80/443; second gets 8081/8444

### Project Configuration
Projects stored in `configStore.get('projects')` array with:
- Per-project PHP version, web server choice, SSL settings
- `.test` domain generation (e.g., `myproject.test`)
- Virtual host configs auto-generated for Nginx/Apache

### Binary Management
- Binaries downloaded to `app.getPath('userData')/resources/`
- Remote config at `config/binaries.json` defines download URLs
- Extraction runs in worker thread (`extractWorker.js`) to avoid blocking UI

### Process Spawning (Windows)
Always use `windowsHide: true` to prevent console window flashing:
```javascript
spawn(command, args, { windowsHide: true, shell: process.platform === 'win32' });
```

## Development Workflow

```bash
npm run dev          # Start Electron + Vite dev server concurrently
npm run build:win    # Build Windows installer
npm run build:mac    # Build macOS installer
```

Renderer dev server runs at `http://localhost:3000`. Main process hot-reloads on save.

## File Locations

| Purpose | Location |
|---------|----------|
| Service configs | `src/shared/serviceConfig.js` |
| IPC handlers | `src/main/ipc/handlers.js` |
| Preload API | `src/main/preload.js` |
| React pages | `src/renderer/src/pages/` |
| Binary URLs | `config/binaries.json` |
| App config | `~/.devbox-pro/` (runtime) |

## Common Patterns

### Adding a New IPC Handler
1. Add handler in `src/main/ipc/handlers.js`
2. Expose in `src/main/preload.js` under appropriate namespace
3. Call from renderer as `window.devbox.namespace.method()`

### Adding a New Service Version
1. Update `SERVICE_VERSIONS` in `src/shared/serviceConfig.js`
2. Add download URLs to `config/binaries.json`
3. Define port offset in `VERSION_PORT_OFFSETS` if needed

### Platform-Specific Code
```javascript
const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
const exe = process.platform === 'win32' ? 'php.exe' : 'php';
```

## Testing Notes
- Test service start/stop with multiple versions running
- Verify port conflicts handled gracefully (alternate ports assigned)
- Test on both Windows and macOS for path separator issues (`path.join` always)
