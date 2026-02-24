# DevBoxPro – Phased Test Implementation Plan

A comprehensive, incremental plan to add automated tests across the entire DevBoxPro Electron application. Each phase builds on the previous one, so contributing developers can progressively rely on `npm test` instead of manual testing.

---

## Project Overview

| Layer | Files | Key Concerns |
|-------|-------|-------------|
| **Shared** | [serviceConfig.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/shared/serviceConfig.js), [appConfig.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/shared/appConfig.js) | Pure config & helper functions – easiest to test |
| **Main / Utils** | [ConfigStore.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js), [PortUtils.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/PortUtils.js), [SpawnUtils.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/SpawnUtils.js) | Node utilities, file I/O, child processes |
| **Main / Services** | 13 manager classes + [extractWorker.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/extractWorker.js) | Complex business logic, system calls, Electron APIs |
| **Main / IPC** | [handlers.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/ipc/handlers.js) | Bridge between renderer ↔ main – 1 460 lines |
| **Renderer / Context** | [AppContext.jsx](file:///c:/Users/Jeffrey/Documents/devboxpro/src/renderer/src/context/AppContext.jsx), [ModalContext.jsx](file:///c:/Users/Jeffrey/Documents/devboxpro/src/renderer/src/context/ModalContext.jsx) | React state management |
| **Renderer / Components** | 7 components (Sidebar, Modal, etc.) | UI units |
| **Renderer / Pages** | 9 pages (Dashboard, Projects, etc.) | Full page views with multiple tabs |

---

## Phase 0 — Test Infrastructure Setup

> **Goal:** Install a test framework and create shared test helpers that every later phase depends on.

### Checklist

- [ ] Install **Vitest** + **@testing-library/react** + **@testing-library/jest-dom** + **jsdom**
  - Vitest is Vite-native, works for both CJS (main) and ESM (renderer)
- [ ] Create root `vitest.config.js` with two workspaces: `main` and `renderer`
- [ ] Create [tests/](file:///c:/Users/Jeffrey/Documents/devboxpro/node_modules/ajv/scripts/prepare-tests) directory structure:
  ```
  tests/
  ├── main/
  │   ├── utils/
  │   ├── services/
  │   └── ipc/
  ├── renderer/
  │   ├── components/
  │   ├── pages/
  │   └── context/
  ├── shared/
  └── helpers/
      ├── mockElectron.js      ← mock electron, ipcMain, app, etc.
      ├── mockFs.js            ← mock fs-extra
      └── setup.js             ← global test setup
  ```
- [ ] Create `tests/helpers/mockElectron.js` – reusable Electron API mocks ([app](file:///c:/Users/Jeffrey/Documents/devboxpro/src/renderer/src/context/AppContext.jsx#18-99), `ipcMain`, `dialog`, `BrowserWindow`, `shell`, `nativeImage`, `nativeTheme`)
- [ ] Create `tests/helpers/mockFs.js` – reusable fs-extra mock factory
- [ ] Create `tests/helpers/setup.js` – global setup (browser env for renderer tests)
- [ ] Add [package.json](file:///c:/Users/Jeffrey/Documents/devboxpro/package.json) scripts:
  ```json
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "test:main": "vitest run --project main",
  "test:renderer": "vitest run --project renderer"
  ```
- [ ] Verify a trivial "hello world" test passes in each workspace

#### [NEW] [vitest.config.js](file:///c:/Users/Jeffrey/Documents/devboxpro/vitest.config.js)
#### [NEW] [tests/helpers/mockElectron.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/helpers/mockElectron.js)
#### [NEW] [tests/helpers/mockFs.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/helpers/mockFs.js)
#### [NEW] [tests/helpers/setup.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/helpers/setup.js)
#### [MODIFY] [package.json](file:///c:/Users/Jeffrey/Documents/devboxpro/package.json) – add test deps & scripts

---

## Phase 1 — Shared Configs (Easiest, Zero Mocks)

> **Goal:** Test the pure-logic shared modules first. These require no mocking and build confidence that the test setup works.

### 1.1 [serviceConfig.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/shared/serviceConfig.js)

| Test Case | Description |
|-----------|-------------|
| `SERVICE_VERSIONS` shape | All expected service keys exist, each is a non-empty string array |
| `VERSION_PORT_OFFSETS` keys match `SERVICE_VERSIONS` | No orphan offset entries |
| `DEFAULT_PORTS` values | All ports are positive integers |
| `SERVICE_INFO` completeness | Every service in `SERVICE_VERSIONS` has a `SERVICE_INFO` entry |
| [getServicePort()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/shared/serviceConfig.js#109-117) – known service+version | Returns correct `basePort + offset` |
| [getServicePort()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/shared/serviceConfig.js#109-117) – unknown service | Returns `null` |
| [getServicePort()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/shared/serviceConfig.js#109-117) – unknown version for known service | Falls back to offset `0` |
| [getDefaultVersion()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#84-99) – known service | Returns first element of version array |
| [getDefaultVersion()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#84-99) – unknown service | Returns `null` |

**Edge Cases:**
- [ ] [getServicePort('mysql', '5.7')](file:///c:/Users/Jeffrey/Documents/devboxpro/src/shared/serviceConfig.js#109-117) → `3306 + 2 = 3308`
- [ ] [getServicePort('apache', '2.4')](file:///c:/Users/Jeffrey/Documents/devboxpro/src/shared/serviceConfig.js#109-117) → `8081 + 0 = 8081`
- [ ] [getServicePort(null, null)](file:///c:/Users/Jeffrey/Documents/devboxpro/src/shared/serviceConfig.js#109-117) → `null`
- [ ] [getServicePort('redis', 'nonexistent')](file:///c:/Users/Jeffrey/Documents/devboxpro/src/shared/serviceConfig.js#109-117) → `6379 + 0`

#### [NEW] [tests/shared/serviceConfig.test.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/shared/serviceConfig.test.js)

### 1.2 [appConfig.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/shared/appConfig.js)

> This file exports build-time injected constants. Tests will verify the module exports the expected shape.

- [ ] Exports `APP_VERSION` (string)
- [ ] Exports `APP_NAME` = `'DevBox Pro'`
- [ ] Default export has `version` and `name` keys

#### [NEW] [tests/shared/appConfig.test.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/shared/appConfig.test.js)

---

## Phase 2 — Main Process Utilities

> **Goal:** Test the three utility modules that every service depends on. These need mocking for `electron-store`, `net`, and `child_process`.

### 2.1 [ConfigStore.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js) (22 methods)

| Test Case | Type |
|-----------|------|
| [constructor()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#6-13) – normal init | Unit |
| [constructor()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#6-13) – fallback when Store fails | Unit |
| [getDefaults()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#29-65) – returns correct shape | Unit |
| [getDefaults()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#29-65) – platform-specific `defaultProjectsPath` | Unit (mock `process.platform`) |
| [get()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#66-83) – normal mode | Unit |
| [get()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#66-83) – fallback mode (nested key) | Unit |
| [get()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#66-83) – missing key returns `defaultValue` | Unit |
| [set()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#84-99) – normal mode | Unit |
| [set()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#84-99) – fallback mode (nested key creation) | Unit |
| [delete()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/preload.js#12-13) – normal & fallback | Unit |
| [has()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#105-108) – existing and missing keys | Unit |
| [getAll()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/preload.js#8-9) | Unit |
| [reset()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#113-121) – clears and restores defaults | Unit |
| [addRecentProject()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#122-129) – adds to front, deduplicates, caps at 10 | Unit |
| [getRecentProjects()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#130-137) – maps IDs to project objects, filters invalid | Unit |
| [getSetting()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#138-143) / [setSetting()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#144-150) | Unit |
| [exportConfig()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#151-157) – writes JSON file | Unit (mock `fs.writeJson`) |
| [importConfig()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#158-182) – file not found | Unit |
| [importConfig()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#158-182) – invalid format (missing fields) | Unit |
| [importConfig()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#158-182) – valid config merges defaults | Unit |
| [getDataPath()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#183-187), [getLogsPath()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#188-191), [getMysqlDataPath()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#192-195), [getRedisDataPath()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#196-199), [getSslPath()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#200-203) | Unit |

**Edge Cases:**
- [ ] [addRecentProject()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#122-129) with 12 projects → only 10 kept
- [ ] [get('deeply.nested.key')](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#66-83) in fallback mode
- [ ] [importConfig()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/ConfigStore.js#158-182) with extra unknown keys (should not crash)

#### [NEW] [tests/main/utils/ConfigStore.test.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/main/utils/ConfigStore.test.js)

### 2.2 [PortUtils.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/PortUtils.js) (4 functions)

| Test Case | Type |
|-----------|------|
| [isPortAvailable()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/PortUtils.js#3-31) – port is free | Unit (mock `net.createServer`) |
| [isPortAvailable()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/PortUtils.js#3-31) – port is in use (`EADDRINUSE`) | Unit |
| [isPortAvailable()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/PortUtils.js#3-31) – other error (returns true) | Unit |
| [findAvailablePort()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/PortUtils.js#32-48) – first port available | Unit |
| [findAvailablePort()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/PortUtils.js#32-48) – skips occupied ports | Unit |
| [findAvailablePort()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/PortUtils.js#32-48) – all ports exhausted → `null` | Unit |
| [findAvailablePorts()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/PortUtils.js#49-72) – finds N ports | Unit |
| [findAvailablePorts()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/PortUtils.js#49-72) – throws when not enough ports | Unit |
| [getProcessOnPort()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/PortUtils.js#73-122) – Windows: parses netstat output | Unit (mock [spawnAsync](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/SpawnUtils.js#41-90)) |
| [getProcessOnPort()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/PortUtils.js#73-122) – Windows: no match → `null` | Unit |
| [getProcessOnPort()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/PortUtils.js#73-122) – non-Windows: parses lsof output | Unit |

#### [NEW] [tests/main/utils/PortUtils.test.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/main/utils/PortUtils.test.js)

### 2.3 [SpawnUtils.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/SpawnUtils.js) (9 functions)

| Test Case | Type |
|-----------|------|
| [spawnSyncSafe()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/SpawnUtils.js#7-40) – successful command | Unit (mock `child_process.spawnSync`) |
| [spawnSyncSafe()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/SpawnUtils.js#7-40) – command error | Unit |
| [spawnSyncSafe()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/SpawnUtils.js#7-40) – timeout | Unit |
| [spawnAsync()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/SpawnUtils.js#41-90) – successful command | Unit (mock `child_process.spawn`) |
| [spawnAsync()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/SpawnUtils.js#41-90) – command failure (non-zero exit) | Unit |
| [spawnAsync()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/SpawnUtils.js#41-90) – timeout handling | Unit |
| [getSanitizedEnv()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/SpawnUtils.js#91-155) – filters sensitive vars | Unit |
| [getSanitizedEnv()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/SpawnUtils.js#91-155) – merges additional env vars | Unit |
| [commandExists()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/SpawnUtils.js#156-182) – command found in PATH | Unit |
| [commandExists()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/SpawnUtils.js#156-182) – command not found | Unit |
| [killProcessByName()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/SpawnUtils.js#183-201) – Windows `taskkill` | Unit |
| [killProcessByPid()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/SpawnUtils.js#202-220) – success and failure | Unit |
| [isProcessRunning()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/SpawnUtils.js#221-235) – running / not running | Unit |
| [getProcessPidsByPath()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/SpawnUtils.js#236-264) – parses WMIC output | Unit |
| [killProcessesByPath()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/utils/SpawnUtils.js#265-277) – orchestrates find + kill | Unit |

#### [NEW] [tests/main/utils/SpawnUtils.test.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/main/utils/SpawnUtils.test.js)

---

## Phase 3 — Main Process Services

> **Goal:** Test the 13 service manager classes + extractWorker. Each service will have its own test file. Services are listed from simplest to most complex.

### 3.1 [LogManager.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js) (328 lines)

- [ ] [initialize()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/UpdateManager.js#35-42) – creates log directories
- [ ] [info()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#26-30), [warn()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#31-34), [error()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#35-38), [debug()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#39-42) – delegates to [writeLog](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#69-85)
- [ ] [systemError()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#43-48), [systemWarn()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#49-52), [systemInfo()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#53-56) – uses `SYSTEM` category
- [ ] [project()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#57-62) – uses per-project log file
- [ ] [service()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#63-68) – uses per-service log file
- [ ] [writeLog()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#69-85) – emits event, calls [appendToLog](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#101-117)
- [ ] [formatLogEntry()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#86-100) – timestamp format, JSON data serialization
- [ ] [appendToLog()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#101-117) – file write, calls [rotateLogIfNeeded](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#118-141)
- [ ] [rotateLogIfNeeded()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#118-141) – renames when > 10MB, deletes excess rotations
- [ ] [readLastLines()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#164-178) – returns correct number of lines from end
- [ ] [getProjectLogs()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#142-147), [getServiceLogs()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#148-152), [getAppLogs()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#153-157), [getSystemLogs()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#158-163)
- [ ] [clearProjectLogs()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#179-189), [clearServiceLogs()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#190-199), [clearSystemLogs()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#200-210)
- [ ] [streamLogs()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#211-233) – watcher setup, callback invocation
- [ ] [stopStreaming()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#234-241) – watcher cleanup
- [ ] [parseLogEntry()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#242-260) – valid and malformed log lines
- [ ] [getAllLogs()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#261-325) – filter by level, category, search term

**Edge Cases:**
- [ ] Log file doesn't exist yet
- [ ] Log rotation with exactly 5 existing rotated files
- [ ] [parseLogEntry()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#242-260) with empty string, null, special characters

#### [NEW] [tests/main/services/LogManager.test.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/main/services/LogManager.test.js)

### 3.2 [UpdateManager.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/UpdateManager.js) (233 lines)

- [ ] [constructor()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#6-13) – sets up autoUpdater event handlers
- [ ] [setMainWindow()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/UpdateManager.js#28-34) – stores reference
- [ ] [initialize()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/UpdateManager.js#35-42) – logs init message
- [ ] [_setupEventHandlers()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/UpdateManager.js#43-108) – all 6 event handlers update state correctly
- [ ] [_sendEvent()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/UpdateManager.js#109-117) – sends to window, no-ops when window destroyed
- [ ] [checkForUpdates()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#280-315) – dev mode returns disabled message
- [ ] [checkForUpdates()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#280-315) – update available
- [ ] [checkForUpdates()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#280-315) – no update available
- [ ] [checkForUpdates()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#280-315) – error handling
- [ ] [downloadUpdate()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/UpdateManager.js#164-199) – no update info → error
- [ ] [downloadUpdate()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/UpdateManager.js#164-199) – dev mode → error
- [ ] [downloadUpdate()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/UpdateManager.js#164-199) – successful download
- [ ] [quitAndInstall()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/UpdateManager.js#200-210) – calls autoUpdater when downloaded
- [ ] [quitAndInstall()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/UpdateManager.js#200-210) – no-op when not downloaded
- [ ] [getStatus()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/preload.js#55-56) – returns correct shape in all states

#### [NEW] [tests/main/services/UpdateManager.test.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/main/services/UpdateManager.test.js)

### 3.3 [SslManager.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/SslManager.js) (453 lines)

- [ ] [constructor()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#6-13) – sets initial state
- [ ] [initialize()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/UpdateManager.js#35-42) – creates directories, generates root CA if needed
- [ ] [createRootCA()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/SslManager.js#113-175) – generates keypair, creates self-signed CA cert
- [ ] [createCertificate()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/SslManager.js#176-289) – generates domain cert signed by CA
- [ ] [createCertificate()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/SslManager.js#176-289) – handles multiple domain SANs
- [ ] [deleteCertificate()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/SslManager.js#290-310) – removes cert files
- [ ] [trustCertificate()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/SslManager.js#311-389) – platform-specific trust (Windows certutil)
- [ ] [getTrustInstructions()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/SslManager.js#390-417) – returns platform-matched instructions
- [ ] [listCertificates()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/SslManager.js#418-421) – reads certificate store
- [ ] [getCertificate()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/SslManager.js#422-426) / [getCertificatePaths()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/SslManager.js#427-436) – correct paths
- [ ] [getStatus()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/preload.js#55-56) – SSL available/unavailable shape
- [ ] [isAvailable()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/SslManager.js#446-450) – checks CA existence

**Edge Cases:**
- [ ] CA cert files missing on init (first run)
- [ ] Domain with special characters
- [ ] [createCertificate()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/SslManager.js#176-289) when CA doesn't exist

#### [NEW] [tests/main/services/SslManager.test.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/main/services/SslManager.test.js)

### 3.4 [PhpManager.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js) (529 lines)

- [ ] [initialize()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/UpdateManager.js#35-42) – discovers PHP binaries, creates default INI
- [ ] [getPhpBinaryPath()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#66-73) – correct path construction
- [ ] [getAvailableVersions()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#74-83) – returns discovered versions
- [ ] [getDefaultVersion()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#84-99) – config lookup with fallback
- [ ] [setDefaultVersion()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#100-109) – validates version exists
- [ ] [discoverExtensions()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#110-144) – parses `php -m` output
- [ ] [getExtensions()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#145-152) / [toggleExtension()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/preload.js#47-49) – INI manipulation
- [ ] [createDefaultIni()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#195-272) – generates correct INI content
- [ ] [validatePhpCommand()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#273-307) – allows safe commands, blocks injection
- [ ] [validateArtisanCommand()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#308-330) – allows safe commands, blocks injection
- [ ] [runCommand()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#331-384) – spawns PHP with correct args
- [ ] [runArtisan()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#385-445) – prepends `artisan` to command
- [ ] [runComposer()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#446-490) – uses composer path
- [ ] [getComposerPath()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#491-494) – returns expected path
- [ ] [getPhpInfo()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#495-526) – parses `php -i` output

**Edge Cases:**
- [ ] [validatePhpCommand()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#273-307) with shell metacharacters (`; && | \``)
- [ ] [validateArtisanCommand()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#308-330) with path traversal (`../`)
- [ ] No PHP versions installed
- [ ] Invalid version string passed

#### [NEW] [tests/main/services/PhpManager.test.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/main/services/PhpManager.test.js)

### 3.5 [GitManager.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/GitManager.js) (652 lines)

- [ ] [initialize()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/UpdateManager.js#35-42) – finds Git executable
- [ ] [findGitExecutable()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/GitManager.js#37-68) – system vs portable fallback
- [ ] [checkSystemGit()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/GitManager.js#69-103) – `where git` / `which git`
- [ ] [isGitAvailable()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/GitManager.js#104-130) – returns correct shape
- [ ] [getGitVersion()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/GitManager.js#131-163) – parses `git --version` output
- [ ] [validateRepositoryUrl()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/GitManager.js#164-194) – HTTPS URLs
- [ ] [validateRepositoryUrl()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/GitManager.js#164-194) – SSH URLs
- [ ] [validateRepositoryUrl()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/GitManager.js#164-194) – invalid URLs
- [ ] [cloneRepository()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/GitManager.js#195-365) – public repo
- [ ] [cloneRepository()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/GitManager.js#195-365) – token auth (injects token into URL)
- [ ] [cloneRepository()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/GitManager.js#195-365) – SSH auth
- [ ] [cloneRepository()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/GitManager.js#195-365) – branch option
- [ ] [cloneRepository()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/GitManager.js#195-365) – progress callback
- [ ] [cloneRepository()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/GitManager.js#195-365) – clone failure
- [ ] [generateSshKey()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/GitManager.js#366-514) – creates key pair
- [ ] [getSshPublicKey()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/GitManager.js#515-533) – key exists / doesn't exist
- [ ] [regenerateSshKey()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/GitManager.js#534-557) – deletes + regenerates
- [ ] [testAuthentication()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/GitManager.js#558-625) – success / failure scenarios
- [ ] [onProgress()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/ipc/handlers.js#1426-1430) / [emitProgress()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/GitManager.js#636-649) – listener pattern

**Edge Cases:**
- [ ] URL with special characters or spaces
- [ ] SSH key generation when `.ssh` dir doesn't exist
- [ ] Clone to path with spaces

#### [NEW] [tests/main/services/GitManager.test.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/main/services/GitManager.test.js)

### 3.6 [CompatibilityManager.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js) (788 lines)

- [ ] [constructor()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/PhpManager.js#6-13) – initializes built-in rules
- [ ] Built-in rules – each embedded [check()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#224-239) function tested with matching/non-matching config
- [ ] [initialize()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/UpdateManager.js#35-42) – loads cached config
- [ ] [checkForUpdates()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#280-315) – fetches remote, compares, notifies
- [ ] [isVersionNewer()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#316-334) – semver comparisons
- [ ] [fetchRemoteConfig()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#335-361) – HTTPS fetch success/timeout/error
- [ ] [compareConfigs()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#362-401) – detects new/updated/removed rules
- [ ] [applyUpdates()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#402-433) – saves and applies remote rules
- [ ] [applyRemoteRules()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#434-462) – converts JSON rules to functions
- [ ] [createRuleChecker()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#463-492) – implements condition operators (`<`, `>`, `=`, [in](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/LogManager.js#26-30), etc.)
- [ ] [getConfigValue()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#493-523) – key lookup in config objects
- [ ] [evaluateCondition()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#524-559) – all condition operators
- [ ] [interpolateMessage()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#560-579) – placeholder replacement
- [ ] [loadCachedConfig()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#580-607) / [saveCachedConfig()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#608-625) – file I/O
- [ ] [getDeprecationInfo()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#626-632) / [getFrameworkRequirements()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#633-639) / [getConfigInfo()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#640-651)

**Edge Cases:**
- [ ] Remote fetch timeout
- [ ] Corrupted cached config file
- [ ] Rule with unknown condition operator (graceful handling)
- [ ] [evaluateCondition()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CompatibilityManager.js#524-559) with non-numeric values for `<` / `>`

#### [NEW] [tests/main/services/CompatibilityManager.test.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/main/services/CompatibilityManager.test.js)

### 3.7 [WebServerManager.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/WebServerManager.js) (28 KB)

- [ ] Config generation (Nginx & Apache vhost configs)
- [ ] Start/stop/restart for each web server type
- [ ] Port allocation and conflict detection
- [ ] SSL cert integration in vhost configs
- [ ] Multi-domain configuration
- [ ] Error handling for missing binaries

#### [NEW] [tests/main/services/WebServerManager.test.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/main/services/WebServerManager.test.js)

### 3.8 [SupervisorManager.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/SupervisorManager.js) (16 KB)

- [ ] Worker process management
- [ ] Start/stop/restart supervisor processes
- [ ] Process health monitoring
- [ ] Auto-restart on crash
- [ ] Config file generation

#### [NEW] [tests/main/services/SupervisorManager.test.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/main/services/SupervisorManager.test.js)

### 3.9 [DatabaseManager.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/DatabaseManager.js) (59 KB)

- [ ] Database creation/deletion
- [ ] Import (SQL file, gzip) with mode (replace/append)
- [ ] Export database to file
- [ ] Query execution
- [ ] Connection management (MySQL/MariaDB)
- [ ] Connection string construction
- [ ] User/permission operations
- [ ] Handling large databases (streaming)

**Edge Cases:**
- [ ] Import of empty SQL file
- [ ] Database name with special characters
- [ ] Connection timeout
- [ ] Query with syntax errors

#### [NEW] [tests/main/services/DatabaseManager.test.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/main/services/DatabaseManager.test.js)

### 3.10 [ServiceManager.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/ServiceManager.js) (113 KB — largest service)

- [ ] Service status tracking (start/stop/restart)
- [ ] Multi-version service management
- [ ] Resource usage monitoring
- [ ] Service dependency ordering
- [ ] Port management per service version
- [ ] Start all / stop all orchestration
- [ ] Health checks and readiness probes
- [ ] Process PID tracking and cleanup

#### [NEW] [tests/main/services/ServiceManager.test.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/main/services/ServiceManager.test.js)

### 3.11 [ProjectManager.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/ProjectManager.js) (138 KB — most complex)

- [ ] Project CRUD (create, read, update, delete)
- [ ] Project start/stop/restart lifecycle
- [ ] Project type detection (Laravel, WordPress, static, etc.)
- [ ] Vhost generation per project
- [ ] Environment file management (`.env` read/write)
- [ ] Project move operation
- [ ] Scan for unregistered projects
- [ ] Register existing project
- [ ] Service version management per project
- [ ] Config export/import (`devbox.json`)

**Edge Cases:**
- [ ] Create project with duplicate name
- [ ] Delete project with running services
- [ ] Move project while services running
- [ ] Project path with spaces and unicode characters
- [ ] Import `devbox.json` with missing binaries

#### [NEW] [tests/main/services/ProjectManager.test.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/main/services/ProjectManager.test.js)

### 3.12 [BinaryDownloadManager.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/BinaryDownloadManager.js) (106 KB)

- [ ] Download queue management
- [ ] Download progress tracking
- [ ] Archive extraction (ZIP, TAR)
- [ ] Binary version discovery
- [ ] Installed binary detection
- [ ] Download cancellation
- [ ] Retry on failure
- [ ] Platform-specific download URLs

#### [NEW] [tests/main/services/BinaryDownloadManager.test.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/main/services/BinaryDownloadManager.test.js)

### 3.13 [CliManager.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/CliManager.js) (57 KB)

- [ ] CLI command routing
- [ ] Terminal session management
- [ ] Command history
- [ ] Environment setup per project
- [ ] PATH management for project-specific binaries

#### [NEW] [tests/main/services/CliManager.test.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/main/services/CliManager.test.js)

### 3.14 [extractWorker.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/extractWorker.js) (2 KB)

- [ ] ZIP extraction
- [ ] TAR extraction
- [ ] Progress reporting via `process.send()`
- [ ] Error handling for corrupted archives

#### [NEW] [tests/main/services/extractWorker.test.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/main/services/extractWorker.test.js)

---

## Phase 4 — IPC Handlers

> **Goal:** Test that each IPC channel routes correctly and returns expected shapes.

### 4.1 [handlers.js](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/ipc/handlers.js) (1 463 lines)

The [setupIpcHandlers](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/ipc/handlers.js#19-1461) function registers ~100 IPC handlers. Tests should verify:

- [ ] **Project handlers** – `project:getAll`, `project:getById`, `project:create`, `project:update`, `project:delete`, `project:start`, `project:stop`, `project:restart`, `project:getStatus`, `project:openInEditor`, `project:openInBrowser`, `project:openFolder`, `project:move`, `project:switchWebServer`, `project:regenerateVhost`, `project:scanUnregistered`, `project:registerExisting`, `project:detectType`, `project:exportConfig`, `project:getServiceVersions`, `project:updateServiceVersions`, `project:checkCompatibility`, `project:getCompatibilityRules`, `project:readEnv`
- [ ] **Compatibility handlers** – `compatibility:checkForUpdates`, `compatibility:applyUpdates`, `compatibility:getConfigInfo`
- [ ] **PHP handlers** – `php:getVersions`, `php:getExtensions`, `php:toggleExtension`, `php:runCommand`, `php:runArtisan`
- [ ] **Service handlers** – `services:getStatus`, `services:start`, `services:stop`, `services:restart`, `services:startAll`, `services:stopAll`, `services:getResourceUsage`, `services:getRunningVersions`, `services:isVersionRunning`, `services:getWebServerPorts`, `services:getProjectNetworkPort`
- [ ] **Database handlers** – `database:getConnections`, `database:getDatabases`, `database:createDatabase`, `database:deleteDatabase`, `database:importDatabase`, `database:exportDatabase`, `database:runQuery`
- [ ] **Binary handlers** – all download/install/uninstall channels
- [ ] **Settings handlers** – `settings:getAll`, `settings:update`, etc.
- [ ] **Log handlers** – `logs:get`, `logs:clear`, etc.
- [ ] **SSH/Git handlers** – clone, SSH key management
- [ ] **Update handlers** – check/download/install updates
- [ ] **Error handling** – each handler returns `{ error }` on failure

**Edge Cases:**
- [ ] Handler called before manager is initialized
- [ ] Handler receives `undefined` / `null` arguments

#### [NEW] [tests/main/ipc/handlers.test.js](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/main/ipc/handlers.test.js)

---

## Phase 5 — Renderer (React) Components, Pages & Context

> **Goal:** Test every user-facing page, component, and context using React Testing Library + Vitest.

### 5.1 Contexts

#### [AppContext.jsx](file:///c:/Users/Jeffrey/Documents/devboxpro/src/renderer/src/context/AppContext.jsx)

- [ ] [appReducer](file:///c:/Users/Jeffrey/Documents/devboxpro/src/renderer/src/context/AppContext.jsx#18-99) – all action types (`SET_PROJECTS`, `SET_SERVICES`, `SET_RESOURCE_USAGE`, `SET_BINARIES`, `SET_INSTALLED`, `SET_DOWNLOADING`, `SET_DOWNLOAD_PROGRESS`, `SET_PROJECT_LOADING`)
- [ ] [AppProvider](file:///c:/Users/Jeffrey/Documents/devboxpro/src/renderer/src/context/AppContext.jsx#100-376) – mounts, provides context values
- [ ] [loadInitialData()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/renderer/src/context/AppContext.jsx#105-125) – calls `window.devbox` APIs, dispatches results
- [ ] [syncActiveDownloads()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/renderer/src/context/AppContext.jsx#197-229) – syncs backend state
- [ ] [useApp()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/renderer/src/context/AppContext.jsx#377-384) – throws when used outside provider
- [ ] `databaseOperation` / `clearDatabaseOperation` state management
- [ ] Project loading state management (`startProject`, `stopProject`)

#### [NEW] [tests/renderer/context/AppContext.test.jsx](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/renderer/context/AppContext.test.jsx)

#### [ModalContext.jsx](file:///c:/Users/Jeffrey/Documents/devboxpro/src/renderer/src/context/ModalContext.jsx)

- [ ] `ModalProvider` – provides open/close modal functions
- [ ] `openModal()` with content
- [ ] `closeModal()` clears state
- [ ] Multiple modals (if supported)
- [ ] `useModal()` – throws outside provider

#### [NEW] [tests/renderer/context/ModalContext.test.jsx](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/renderer/context/ModalContext.test.jsx)

### 5.2 Components

| Component | Test Cases |
|-----------|-----------|
| **Sidebar.jsx** | Renders all nav items; highlights active route; dark mode toggle; collapse/expand |
| **Modal.jsx** | Opens/closes; renders children; backdrop click closes; escape key closes |
| **ImportProjectModal.jsx** | Form validation; submit triggers import; error display; loading state |
| **InstallationProgress.jsx** | Progress bar renders; percentage display; completion state |
| **PhpIniEditor.jsx** | Renders INI content; edit mode; save triggers callback; cancel restores |
| **ProjectTerminal.jsx** | Terminal container renders; sends commands; receives output |
| **XTerminal.jsx** | Terminal initialization; resize handling; input/output |

- [ ] `tests/renderer/components/Sidebar.test.jsx`
- [ ] `tests/renderer/components/Modal.test.jsx`
- [ ] `tests/renderer/components/ImportProjectModal.test.jsx`
- [ ] `tests/renderer/components/InstallationProgress.test.jsx`
- [ ] `tests/renderer/components/PhpIniEditor.test.jsx`
- [ ] `tests/renderer/components/ProjectTerminal.test.jsx`
- [ ] `tests/renderer/components/XTerminal.test.jsx`

### 5.3 Pages

Each page test verifies: renders without crash, shows correct data, tabs switch correctly, user interactions work, loading/error states display.

#### **Dashboard.jsx** (Home Page)

- [ ] Renders project summary cards
- [ ] Shows service status overview
- [ ] Quick-action buttons functional
- [ ] Empty state when no projects exist
- [ ] Links navigate to correct routes

#### [NEW] [tests/renderer/pages/Dashboard.test.jsx](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/renderer/pages/Dashboard.test.jsx)

#### **Projects.jsx** (Projects List)

- [ ] Renders project list
- [ ] Project status badges (running/stopped)
- [ ] Search/filter projects
- [ ] "Create New" button navigates
- [ ] Start/stop buttons trigger IPC calls
- [ ] Delete project with confirmation
- [ ] Empty state

#### [NEW] [tests/renderer/pages/Projects.test.jsx](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/renderer/pages/Projects.test.jsx)

#### **ProjectDetail.jsx** (Project Detail — multiple tabs)

- [ ] **Overview tab** – shows project info, status, quick actions
- [ ] **Services tab** – shows per-project service versions, switch web server
- [ ] **Environment tab** – `.env` editor loads and saves
- [ ] **Terminal tab** – terminal component mounts
- [ ] **Logs tab** – shows project logs, clear button
- [ ] Tab switching preserves state
- [ ] Start/stop/restart project from detail view
- [ ] Edit project name/domain
- [ ] Navigate back to projects list

#### [NEW] [tests/renderer/pages/ProjectDetail.test.jsx](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/renderer/pages/ProjectDetail.test.jsx)

#### **CreateProject.jsx** (New Project Wizard)

- [ ] Step 1: Project name and type selection
- [ ] Step 2: PHP/Node version selection
- [ ] Step 3: Database configuration
- [ ] Step 4: Domain and web server selection
- [ ] Git clone option (URL validation, auth)
- [ ] Form validation (empty name, invalid domain)
- [ ] Submit creates project via IPC
- [ ] Cancel navigates back
- [ ] Compatibility warnings display

#### [NEW] [tests/renderer/pages/CreateProject.test.jsx](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/renderer/pages/CreateProject.test.jsx)

#### **BinaryManager.jsx** (Binary Downloads)

- [ ] Lists all available services and versions
- [ ] Shows installed/not-installed status
- [ ] Download button triggers download
- [ ] Progress bar during download
- [ ] Cancel download
- [ ] Uninstall binary
- [ ] Error state display

#### [NEW] [tests/renderer/pages/BinaryManager.test.jsx](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/renderer/pages/BinaryManager.test.jsx)

#### **Databases.jsx** (Database Management)

- [ ] Lists databases
- [ ] Create database (name input, submit)
- [ ] Delete database with confirmation
- [ ] Import database (file selection, mode)
- [ ] Export database (file selection)
- [ ] Import/export progress notifications
- [ ] Empty state

#### [NEW] [tests/renderer/pages/Databases.test.jsx](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/renderer/pages/Databases.test.jsx)

#### **Services.jsx** (Global Services)

- [ ] Lists all services with running/stopped state
- [ ] Start/stop/restart individual services
- [ ] Start all / stop all
- [ ] Version selection per service
- [ ] Resource usage display (CPU, memory)
- [ ] Port display

#### [NEW] [tests/renderer/pages/Services.test.jsx](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/renderer/pages/Services.test.jsx)

#### **Logs.jsx** (System Logs)

- [ ] Renders log entries
- [ ] Filter by level (info/warn/error)
- [ ] Filter by category (system/project/service)
- [ ] Search within logs
- [ ] Clear logs button
- [ ] Auto-scroll to latest
- [ ] Empty state

#### [NEW] [tests/renderer/pages/Logs.test.jsx](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/renderer/pages/Logs.test.jsx)

#### **Settings.jsx** (App Settings — largest page)

- [ ] General settings (auto-start, default editor, theme)
- [ ] Port configuration
- [ ] Database settings (user, password, active type)
- [ ] SSL configuration
- [ ] Timezone setting
- [ ] Default projects path
- [ ] Config export/import
- [ ] Reset to defaults
- [ ] About section (version, update check)
- [ ] Changes persist after save

#### [NEW] [tests/renderer/pages/Settings.test.jsx](file:///c:/Users/Jeffrey/Documents/devboxpro/tests/renderer/pages/Settings.test.jsx)

---

## Phase 6 — Integration & End-to-End

> **Goal:** Test full flows that span multiple layers (renderer → IPC → service → filesystem).

- [ ] **Full project lifecycle** – create → start → stop → delete
- [ ] **Binary download → service start** – download PHP → start PHP-FPM
- [ ] **Database workflow** – create DB → import SQL → export → delete DB
- [ ] **SSL workflow** – generate CA → create cert → configure project with SSL
- [ ] **Settings persistence** – change settings → restart app → settings retained
- [ ] **Config export/import** – export `devbox.json` → import on fresh install

> [!NOTE]
> Phase 6 tests are more complex and may require a real or emulated Electron environment. Consider using `@electron/test` or Playwright for Electron. These can be deferred until Phases 0-5 are complete.

---

## Verification Plan

### Automated Tests

After implementing each phase, run:

```bash
# Run all tests
npm test

# Run only main process tests
npm run test:main

# Run only renderer tests  
npm run test:renderer

# Run with coverage report
npm run test:coverage
```

### CI Integration

- [ ] Add GitHub Actions workflow `.github/workflows/test.yml`:
  ```yaml
  name: Tests
  on: [push, pull_request]
  jobs:
    test:
      runs-on: windows-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 20
        - run: npm ci
        - run: npm test
  ```

### Manual Verification

After each phase, verify that the existing app still works:

1. Run `npm run dev` to start the app in development mode
2. Verify the Dashboard loads correctly
3. Navigate through all sidebar menu items (Projects, Services, Databases, Logs, Binaries, Settings)
4. Confirm no regressions from test infrastructure changes

---

## Priority Order Summary

| Priority | Phase | Est. Tests | Difficulty |
|----------|-------|-----------|------------|
| 🟢 P0 | Phase 0 — Setup | 2 | Easy |
| 🟢 P1 | Phase 1 — Shared | ~15 | Easy |
| 🟡 P2 | Phase 2 — Utils | ~45 | Medium |
| 🟡 P3 | Phase 3 — Services | ~150+ | Medium-Hard |
| 🟡 P4 | Phase 4 — IPC | ~50 | Medium |
| 🔴 P5 | Phase 5 — Renderer | ~100+ | Medium |
| 🔴 P6 | Phase 6 — E2E | ~10 | Hard |

**Total estimated test cases: ~370+**

> [!TIP]
> Start with Phases 0-2 to establish the testing foundation. These are self-contained and will immediately catch regressions in the most-reused code paths.
