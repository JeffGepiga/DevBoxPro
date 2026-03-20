# Service Files Refactoring Plan

> **Goal**: Split oversized service manager files (400–500 lines max per file) using a sustainable, long-term pattern that preserves the existing public API.

---

## Current State

| File | Lines | Status |
|------|------:|--------|
| ProjectManager.js | 254 | ✅ Refactored — under target |
| ServiceManager.js | 3,863 | **Critical** — still large |
| BinaryDownloadManager.js | 3,499 | **Critical** — still large |
| CliManager.js | 2,278 | **High** — still large |
| DatabaseManager.js | 2,160 | **High** — still large |
| SupervisorManager.js | 572 | Moderate — slightly over |
| GitManager.js | 561 | Moderate — slightly over |
| CompatibilityManager.js | 556 | Moderate — slightly over |
| SslManager.js | 462 | ✅ OK |
| PhpManager.js | 443 | ✅ OK |
| UpdateManager.js | 415 | ✅ OK |
| LogManager.js | 326 | ✅ OK |
| MigrationManager.js | 309 | ✅ OK |
| extractWorker.js | 72 | ✅ OK |

---

## Progress Snapshot

**Last verified:** March 20, 2026

### Overall Status

- [x] Pattern chosen and documented: prototype mixin composition
- [x] Phase 1 started and validated on real code
- [x] `ProjectManager.js` reduced below the 400–500 line target
- [ ] Phase 2 (`ServiceManager.js`) started
- [ ] Phase 3 (`BinaryDownloadManager.js`) started
- [ ] Phase 4 (`CliManager.js`) started
- [ ] Phase 5 (`DatabaseManager.js`) started

### Phase 1 Status: ProjectManager

Actual implementation is slightly more granular than the original plan. Instead of a single `vhosts.js` and `detection.js`, the refactor currently uses smaller concern-focused files:

- `vhostOrchestration.js`
- `vhostNginx.js`
- `vhostApache.js`
- `discovery.js`
- `installation.js` plus `installation/` submodules

This still follows the same long-term pattern: thin facade + prototype mixins + tests mirroring source structure.

### Phase 1 Checklist

- [x] Create `src/main/services/project/`
- [x] Extract helper/accessor logic to `project/helpers.js`
- [x] Extract project catalog logic to `project/catalog.js`
- [x] Extract hosts-file logic to `project/hosts.js`
- [x] Extract environment/config sync logic to `project/environment.js`
- [x] Extract service dependency logic to `project/serviceDeps.js`
- [x] Extract installation flow into `project/installation.js` and `project/installation/*`
- [x] Extract framework installers into `project/installation/laravel.js`, `wordpress.js`, `symfony.js`
- [x] Extract lifecycle/start-stop logic to `project/lifecycle.js`
- [x] Extract vhost logic into `project/vhostOrchestration.js`, `project/vhostNginx.js`, `project/vhostApache.js`
- [x] Extract discovery/import logic to `project/discovery.js`
- [x] Replace `ProjectManager.js` with a thin facade + `Object.assign(...)`
- [x] Add focused unit tests under `tests/main/services/project/`
- [x] Keep integration coverage in `tests/main/services/ProjectManager.test.js`
- [x] Validate the current ProjectManager slice
- [ ] Extract remaining facade coordinator methods into `project/crud.js` if we want the facade to be constructor-only
- [ ] Decide whether to normalize names in the plan (`detection.js`/`vhosts.js`) to match the actual split files

### Last Verified Test Slice

- `tests/main/services/ProjectManager.test.js`
- `tests/main/services/project/helpers.test.js`
- `tests/main/services/project/serviceDeps.test.js`
- `tests/main/services/project/environment.test.js`
- `tests/main/services/project/catalog.test.js`
- `tests/main/services/project/hosts.test.js`
- `tests/main/services/project/installation/nodeFramework.test.js`
- `tests/main/services/project/installation/frameworkInstallers.test.js`
- `tests/main/services/project/lifecycle.test.js`
- `tests/main/services/project/discovery.test.js`

Result: `74` tests passed across `10` files.

---

## Chosen Pattern: Prototype Mixin Composition

### Why This Pattern

1. **Zero breaking changes** — The manager class remains the public API. IPC handlers, cross-manager calls, and tests continue calling `manager.methodName()` unchanged.
2. **`this` context preserved** — Mixin methods are assigned to the prototype, so `this.configStore`, `this.managers`, `this.runningProjects` etc. all work naturally.
3. **Clean domain separation** — Each mixin file contains a single logical concern (CRUD, lifecycle, vhosts, etc.) at 400–500 lines.
4. **Easy to navigate** — Developers find code by domain folder → file, not by scrolling 5,000 lines.
5. **Testable** — Tests can import individual mixin modules for focused unit testing, or continue testing through the manager facade.
6. **Scales long-term** — Adding new features means adding a new mixin file, not making a giant file bigger.

### How It Works

```
src/main/services/
├── ProjectManager.js           ← Thin facade (~80-120 lines)
├── project/                    ← Domain modules
│   ├── crud.js                 ← module.exports = { createProject, updateProject, ... }
│   ├── lifecycle.js
│   └── ...
├── ServiceManager.js           ← Thin facade (~80-120 lines)
├── service/
│   ├── nginx.js
│   ├── mysql.js
│   └── ...
```

**Facade pattern:**

```javascript
// src/main/services/ProjectManager.js (thin facade)
const crud = require('./project/crud');
const installers = require('./project/installers');
const lifecycle = require('./project/lifecycle');
const vhosts = require('./project/vhosts');
const hosts = require('./project/hosts');
const detection = require('./project/detection');
const environment = require('./project/environment');
const helpers = require('./project/helpers');

class ProjectManager {
  constructor(configStore, managers) {
    this.configStore = configStore;
    this.managers = managers;
    this.runningProjects = new Map();
    this.pendingServiceStops = new Map();
    this.networkPort80Owner = null;
  }

  // Static/simple accessors can stay here if tiny
}

// Apply domain mixins to prototype
Object.assign(
  ProjectManager.prototype,
  crud,
  installers,
  lifecycle,
  vhosts,
  hosts,
  detection,
  environment,
  helpers
);

module.exports = ProjectManager;
```

**Mixin module:**

```javascript
// src/main/services/project/crud.js
const path = require('path');
const fs = require('fs-extra');

// All methods use `this` — they become prototype methods
module.exports = {
  async createProject(config, mainWindow) {
    // `this` is the ProjectManager instance
    const projects = this.configStore.get('projects', []);
    // ...
  },

  async updateProject(id, updates) {
    const project = this.getProject(id);
    // ...
  },

  async deleteProject(id, deleteFiles = false) {
    // ...
  },
};
```

---

## Detailed Breakdown by Manager

### Phase 1: ProjectManager.js (4,980 lines → 10 files)

**Priority: Highest — largest file, most complex**

**Current status:** Mostly complete. The file is now `254` lines and the public API is preserved. The remaining work in this phase is optional cleanup: moving the small coordinator methods (`updateProject`, `reorderProjects`, `deleteProject`, `moveProject`) into a `project/crud.js` mixin if we want the facade to contain only constructor/init + composition.

| New File | Methods | Est. Lines |
|----------|---------|-----------|
| `project/helpers.js` | `getDataPath`, `getResourcesPath`, `getPhpFpmPort`, `getDefaultWebServerVersion`, `getEffectiveWebServer`, `getEffectiveWebServerVersion`, `getProjectDomains`, `getProjectPrimaryDomain`, `getProjectServerNameEntries`, `getProjectServerAliasEntries`, `getProjectLocalAccessPorts`, `getProjectProxyBackendHttpPort`, `getFrontDoorOwner`, `frontDoorServesProjectDirectly`, `projectNeedsFrontDoorProxy`, `ensureApacheListenConfig`, `syncProjectLocalProxy`, `getComparableVhostState`, `hasVhostConfigChanges`, `sanitizeDatabaseName`, `getProjectUrl`, `getDocumentRoot`, `getProjectStatus` | ~400 |
| `project/crud.js` | `createProject`, `getProject`, `getAllProjects`, `findProjectByPath`, `findProjectByName`, `exportProjectConfig`, `updateProject`, `updateProjectInStore`, `deleteProject`, `moveProject`, `reorderProjects` | ~500 |
| `project/installers.js` | `runInstallation`, `runPostCloneLaravelSetup`, `runPostCloneNodeSetup`, `installNodeFramework` | ~500 |
| `project/frameworks.js` | `installLaravel`, `installWordPress`, `installSymfony` | ~450 |
| `project/lifecycle.js` | `startProject`, `stopProject`, `stopAllProjects`, `startProjectServices`, `stopProjectServices`, `startSupervisorProcesses`, `forceKillOrphanPhpProcesses`, `startPhpCgi`, `validateProjectBinaries` | ~500 |
| `project/serviceDeps.js` | `getProjectServiceDependencies`, `getServiceDependencyKey`, `isServiceNeededByRunningProjects`, `cancelPendingServiceStop`, `scheduleServiceStop` | ~150 |
| `project/vhosts.js` | `createVirtualHost`, `createNginxVhost`, `createProxyNginxVhost`, `createApacheVhost`, `createProxyApacheVhost`, `regenerateAllNginxVhosts`, `regenerateAllApacheVhosts`, `reloadWebServerConfigIfRunning`, `removeVirtualHost`, `switchWebServer` | ~500 |
| `project/hosts.js` | `updateHostsFile`, `addToHostsFile`, `removeFromHostsFile`, `validateDomainName` | ~250 |
| `project/detection.js` | `detectProjectType`, `detectProjectTypeFromPath`, `scanUnregisteredProjects`, `looksLikePhpProject`, `registerExistingProject`, `checkCompatibility`, `checkCompatibilityUpdates`, `applyCompatibilityUpdates`, `getCompatibilityConfigInfo` | ~400 |
| `project/environment.js` | `syncEnvFile`, `readEnvFile`, `getDefaultEnvironment`, `ensureProjectSslCertificates`, `initialize`, `cleanupOrphanedConfigs`, `ensureCliInstalled`, `syncCliProjectsFile` | ~350 |
| **ProjectManager.js** (facade) | Constructor, property init, `Object.assign` mixins | ~100 |

### Phase 2: ServiceManager.js (4,497 lines → 12 files)

**Priority: High — second largest, many service-specific blocks**

| New File | Methods | Est. Lines |
|----------|---------|-----------|
| `service/helpers.js` | `getDataPath`, `getLegacyUserDataPath`, `getLegacyMySQLDataDir`, `getBundledVCRedistDirs`, `quoteConfigPath`, `maybeAdoptLegacyMySQLData`, `ensureWindowsRuntimeDlls`, `appendProcessOutputSnippet`, `logServiceStartupFailure`, `readMySQLErrorLog`, `getMySQLErrorLogTail`, `hasRecoverableMySQLRedoCorruption`, `recoverCorruptMySQLRedoLogs`, `getProcessKey`, `getVersionPort`, all `get*Path` methods | ~400 |
| `service/core.js` | `initialize`, `startService`, `stopService`, `restartService`, `startAllServices`, `stopAllServices`, `startCoreServices`, `runExclusiveWebServerStart`, `startServiceWithOptions`, `forceKillOrphanProcesses` | ~500 |
| `service/nginx.js` | `startNginx`, `testNginxConfig`, `reloadNginx`, `createNginxConfig` | ~400 |
| `service/apache.js` | `startApache`, `reloadApache`, `createApacheConfig`, `regenerateWebServerVhosts` | ~450 |
| `service/mysql.js` | `startMySQL`, `startMySQLDirect`, `startMySQLWithSkipGrant`, `createMySQLConfig`, `createMySQLConfigWithSkipGrant`, `initializeMySQLData`, `createCredentialsInitFile`, `syncCredentialsToAllVersions`, `updateMySQLCredentials` | ~500 |
| `service/mariadb.js` | `startMariaDB`, `startMariaDBDirect`, `startMariaDBWithSkipGrant`, `createMariaDBConfig`, `createMariaDBConfigWithSkipGrant`, `initializeMariaDBData` | ~350 |
| `service/redis.js` | `startRedis`, `createRedisConfig`, `getTimezoneOffset` | ~200 |
| `service/mailpit.js` | `startMailpit` | ~100 |
| `service/phpmyadmin.js` | `startPhpMyAdmin`, `updatePhpMyAdminConfig` | ~200 |
| `service/extras.js` | `startPostgreSQL`, `startMongoDB`, `startMemcached`, `startMinIO` | ~300 |
| `service/health.js` | `waitForService`, all `check*Health` methods, `checkPortOpen`, `getAllServicesStatus`, `getResourceUsage`, `getProcessStats`, `getServicePorts`, `getRunningVersions`, `getAllRunningVersions`, `isVersionRunning`, `waitForNamedPipeReady`, `waitForPortReady` | ~400 |
| `service/processes.js` | `killOrphanMySQLProcesses`, `killOrphanMariaDBProcesses`, `killProcess` | ~100 |
| **ServiceManager.js** (facade) | Constructor, property init, `Object.assign` mixins | ~100 |

### Phase 3: BinaryDownloadManager.js (4,069 lines → 9 files)

| New File | Methods | Est. Lines |
|----------|---------|-----------|
| `binary/download.js` | `downloadFile`, `downloadWithVersionProbe`, `downloadPhp`, `isVersionProbeEligibleError`, `buildPatchFallbackCandidates` | ~400 |
| `binary/extraction.js` | `extractArchive`, `extractZipAsync`, `validateZipFile` | ~200 |
| `binary/config.js` | `checkForUpdates`, `isVersionNewer`, `fetchRemoteConfig`, `compareConfigs`, `applyUpdates`, `applyConfigToDownloads`, `loadBundledConfig`, `loadCachedConfig`, `saveCachedConfig`, `cloneDownloadConfig` | ~400 |
| `binary/installed.js` | `getInstalledBinaries`, `scanCustomVersions`, `scanCustomPhpVersions`, `scanBinaryVersionsRecursive`, `findExecutableRecursive`, `isNodejsVersionInstalled` | ~350 |
| `binary/php.js` | `enablePhpExtensions`, `ensureCaCertBundle`, `ensureVCRedist`, `createPhpIni` | ~400 |
| `binary/metadata.js` | `saveServiceMetadata`, `getLocalServiceMetadata`, `fetchRemoteMetadata` | ~150 |
| `binary/progress.js` | `addProgressListener`, `emitProgress`, `getActiveDownloads`, `cancelDownload`, `checkCancelled` | ~200 |
| `binary/serviceDownloads.js` | All individual `download*` methods (nginx, mysql, redis, etc.) beyond PHP | ~500 |
| **BinaryDownloadManager.js** (facade) | Constructor, property init, `Object.assign` mixins | ~100 |

### Phase 4: CliManager.js (2,603 lines → 6 files)

| New File | Methods | Est. Lines |
|----------|---------|-----------|
| `cli/install.js` | `installCli`, `installWindowsCli`, `installUnixCli` | ~500 |
| `cli/path.js` | `addToPath`, `addToUserPath`, `addToUnixPath`, `tryAddToSystemPath`, `removeFromPath`, `removeFromUserPath`, `removeFromUnixPath`, `tryRemoveFromSystemPath`, `checkCliInstalled`, `isInWindowsUserPath`, `getInstallInstructions` | ~450 |
| `cli/shims.js` | `installDirectShims`, `removeDirectShims`, `installWindowsDirectShims`, `installUnixDirectShims`, `getDirectShimsEnabled`, `setDirectShimsEnabled` | ~500 |
| `cli/binaries.js` | All `get*Path` methods, `getActiveMysqlInfo`, `getFirstInstalled*Version`, `getDefault*Version`, `setDefault*Version`, `buildProjectEnv` | ~400 |
| `cli/projects.js` | `syncProjectsFile`, `getProjectsFilePath`, `getProjectForPath`, `executeCommand` | ~200 |
| **CliManager.js** (facade) | Constructor, property init, `Object.assign` mixins | ~100 |

### Phase 5: DatabaseManager.js (2,516 lines → 6 files)

| New File | Methods | Est. Lines |
|----------|---------|-----------|
| `database/operations.js` | `createDatabase`, `deleteDatabase`, `listDatabases`, `runDbQuery`, `runQuery`, `dropAllTables`, `getTables`, `getTableStructure`, `getDatabaseSize` | ~400 |
| `database/importExport.js` | `importDatabase`, `exportDatabase`, `createSqlProcessorStream`, `splitDefinitions`, `removeColumnsFromValues`, `parseValueSets`, `splitValues`, `validateFilePath`, `processImportSql` | ~500 |
| `database/postgres.js` | `_importPostgres`, `_exportPostgres`, `_runPostgresQuery`, `_buildPgEnv` | ~250 |
| `database/mongo.js` | `_importMongo`, `_exportMongo`, `_runMongoQuery` | ~200 |
| `database/helpers.js` | `initialize`, `getActiveDatabaseType`, `getActiveDatabaseVersion`, `setActiveDatabaseType`, `getDatabaseInfo`, `getConnections`, `isServiceRunning`, `getActualPort`, `sanitizeName`, `_getBinaryPath`, `getDbClientPath`, `getDbDumpPath`, `getDbRestorePath`, `getBinaryRuntimeDir`, `ensureDbBinaryRuntime`, `buildBinarySpawnOptions`, `getPhpMyAdminUrl`, `checkConnection`, `cancelOperation`, `getRunningOperations` | ~450 |
| `database/credentials.js` | `resetCredentials`, `createCredentialResetInitFile`, `runDbQueryNoAuth` | ~200 |
| **DatabaseManager.js** (facade) | Constructor, property init, `Object.assign` mixins | ~100 |

### Phase 6: Smaller Files (optional, only if >500 lines)

These files are only slightly over the limit and can be split if desired:

| File | Lines | Action |
|------|------:|--------|
| SupervisorManager.js | 673 | Split into `supervisor/processes.js` + facade |
| GitManager.js | 656 | Split into `git/clone.js` + `git/ssh.js` + facade |
| CompatibilityManager.js | 653 | Split into `compatibility/checks.js` + `compatibility/config.js` + facade |
| SslManager.js | 541 | Split into `ssl/certificates.js` + `ssl/trust.js` + facade |
| PhpManager.js | 528 | Split into `php/versions.js` + `php/extensions.js` + facade |

---

## Test Update Strategy

### Principle: Tests Follow Source Structure

For each split manager, create a corresponding test directory mirroring the source:

```
tests/main/services/
├── ProjectManager.test.js          → Keeps integration/facade tests
├── project/
│   ├── crud.test.js                → Unit tests for project/crud.js
│   ├── lifecycle.test.js           → Unit tests for project/lifecycle.js
│   ├── vhosts.test.js              → Unit tests for project/vhosts.js
│   └── ...
├── ServiceManager.test.js          → Keeps integration/facade tests
├── service/
│   ├── nginx.test.js
│   ├── mysql.test.js
│   └── ...
```

### Test Migration Steps

1. **Keep existing test files intact** as integration tests — they test the composed manager and should still pass after refactoring.
2. **Move domain-specific tests** from the monolithic test file into the corresponding domain test file.
3. **Add focused unit tests** per mixin module — these can import the mixin directly and test with a minimal mock context:

```javascript
// tests/main/services/project/crud.test.js
const crud = require('../../src/main/services/project/crud');

describe('project/crud', () => {
  let ctx; // mock ProjectManager context

  beforeEach(() => {
    ctx = {
      configStore: { get: vi.fn(), set: vi.fn() },
      managers: { log: { project: vi.fn() } },
      // ...minimal mocks
    };
  });

  it('should create a project', async () => {
    const result = await crud.createProject.call(ctx, { name: 'test', path: '/tmp/test' });
    expect(result).toBeDefined();
  });
});
```

4. **Update imports** in any test that directly imports from the old monolithic file.

---

## Execution Order

### Recommended sequence (highest impact first):

| Step | Task | Risk | Estimated Files Changed |
|------|------|------|------------------------|
| 1 | **ProjectManager.js** split | Medium — most methods, most cross-references | ~12 new files, 2 test files |
| 2 | **ServiceManager.js** split | Medium — service-specific blocks are isolated | ~14 new files, 2 test files |
| 3 | **BinaryDownloadManager.js** split | Low — mostly self-contained download logic | ~10 new files, 2 test files |
| 4 | **CliManager.js** split | Low — CLI/PATH logic is platform-specific but isolated | ~7 new files, 1 test file |
| 5 | **DatabaseManager.js** split | Low — clean DB engine separation | ~7 new files, 2 test files |
| 6 | **Smaller files** (Phase 6) | Very Low — optional, only if team wants strict 500-line max | ~10 new files |

### Per-Step Process

For each manager:

1. Create the domain folder (e.g., `src/main/services/project/`)
2. Extract methods into mixin modules (one file per concern)
3. Ensure each mixin has its own `require()` statements for `path`, `fs`, etc.
4. Replace the original manager with the thin facade + `Object.assign`
5. Run the existing integration tests first to confirm behavior is preserved
6. Move or add domain-specific tests in the new test sub-folder
7. Re-run the integration suite plus the new focused tests

### Execution Checklist

Use this checklist for each remaining manager:

- [ ] Domain folder created
- [ ] Core helper mixins extracted
- [ ] Runtime/business logic extracted
- [ ] Facade reduced below 500 lines
- [ ] Existing integration tests still pass
- [ ] Focused mixin tests added
- [ ] Plan updated with actual file names and status

---

## Rules for Long-Term Maintenance

1. **No file over 500 lines** — If a mixin file grows beyond 500 lines, split it further.
2. **One concern per file** — Each mixin addresses a single domain (e.g., "nginx config generation", not "web server stuff").
3. **Facade stays thin** — The manager facade file should only contain: constructor, property initialization, and `Object.assign`. No business logic.
4. **Cross-mixin calls use `this`** — Since all mixins share the prototype, they call each other via `this.methodName()`. No circular imports.
5. **New features = new mixin** — When adding a new service or feature domain, create a new mixin file rather than appending to an existing one.
6. **Tests mirror source** — Every `src/main/services/foo/bar.js` should have a corresponding `tests/main/services/foo/bar.test.js`.
7. **Shared utilities** — If multiple mixins need the same helper (e.g., `spawnHidden`), it stays in `src/main/utils/` (already exists: `SpawnUtils.js`, `PortUtils.js`).

---

## Final Directory Structure

```
src/main/services/
├── ProjectManager.js              (~100 lines - facade)
├── project/
│   ├── helpers.js                 (~400 lines)
│   ├── crud.js                    (~500 lines)
│   ├── installers.js              (~500 lines)
│   ├── frameworks.js              (~450 lines)
│   ├── lifecycle.js               (~500 lines)
│   ├── serviceDeps.js             (~150 lines)
│   ├── vhosts.js                  (~500 lines)
│   ├── hosts.js                   (~250 lines)
│   ├── detection.js               (~400 lines)
│   └── environment.js             (~350 lines)
│
├── ServiceManager.js              (~100 lines - facade)
├── service/
│   ├── helpers.js                 (~400 lines)
│   ├── core.js                    (~500 lines)
│   ├── nginx.js                   (~400 lines)
│   ├── apache.js                  (~450 lines)
│   ├── mysql.js                   (~500 lines)
│   ├── mariadb.js                 (~350 lines)
│   ├── redis.js                   (~200 lines)
│   ├── mailpit.js                 (~100 lines)
│   ├── phpmyadmin.js              (~200 lines)
│   ├── extras.js                  (~300 lines)
│   ├── health.js                  (~400 lines)
│   └── processes.js               (~100 lines)
│
├── BinaryDownloadManager.js       (~100 lines - facade)
├── binary/
│   ├── download.js                (~400 lines)
│   ├── extraction.js              (~200 lines)
│   ├── config.js                  (~400 lines)
│   ├── installed.js               (~350 lines)
│   ├── php.js                     (~400 lines)
│   ├── metadata.js                (~150 lines)
│   ├── progress.js                (~200 lines)
│   └── serviceDownloads.js        (~500 lines)
│
├── CliManager.js                  (~100 lines - facade)
├── cli/
│   ├── install.js                 (~500 lines)
│   ├── path.js                    (~450 lines)
│   ├── shims.js                   (~500 lines)
│   ├── binaries.js                (~400 lines)
│   └── projects.js                (~200 lines)
│
├── DatabaseManager.js             (~100 lines - facade)
├── database/
│   ├── operations.js              (~400 lines)
│   ├── importExport.js            (~500 lines)
│   ├── postgres.js                (~250 lines)
│   ├── mongo.js                   (~200 lines)
│   ├── helpers.js                 (~450 lines)
│   └── credentials.js             (~200 lines)
│
├── SupervisorManager.js           (673 lines - optional split)
├── GitManager.js                  (656 lines - optional split)
├── CompatibilityManager.js        (653 lines - optional split)
├── SslManager.js                  (541 lines - optional split)
├── PhpManager.js                  (528 lines - optional split)
├── UpdateManager.js               (415 lines - ✅ OK)
├── LogManager.js                  (326 lines - ✅ OK)
├── MigrationManager.js            (309 lines - ✅ OK)
└── extractWorker.js               (72 lines - ✅ OK)
```

**Total new files**: ~43 domain modules + 5 facades = ~48 files
**Average file size**: ~350 lines (well within 400-500 target)
**Breaking changes**: Zero — all public APIs remain identical

---

## Test Directory Structure

```
tests/main/services/
├── ProjectManager.test.js         (integration - keep existing)
├── project/
│   ├── helpers.test.js
│   ├── crud.test.js
│   ├── installers.test.js
│   ├── frameworks.test.js
│   ├── lifecycle.test.js
│   ├── serviceDeps.test.js
│   ├── vhosts.test.js
│   ├── hosts.test.js
│   ├── detection.test.js
│   └── environment.test.js
│
├── ServiceManager.test.js         (integration - keep existing)
├── service/
│   ├── helpers.test.js
│   ├── core.test.js
│   ├── nginx.test.js
│   ├── apache.test.js
│   ├── mysql.test.js
│   ├── mariadb.test.js
│   ├── redis.test.js
│   ├── mailpit.test.js
│   ├── phpmyadmin.test.js
│   ├── extras.test.js
│   ├── health.test.js
│   └── processes.test.js
│
├── BinaryDownloadManager.test.js  (integration - keep existing)
├── binary/
│   ├── download.test.js
│   ├── extraction.test.js
│   ├── config.test.js
│   ├── installed.test.js
│   ├── php.test.js
│   ├── metadata.test.js
│   ├── progress.test.js
│   └── serviceDownloads.test.js
│
├── CliManager.test.js             (integration - keep if exists)
├── cli/
│   ├── install.test.js
│   ├── path.test.js
│   ├── shims.test.js
│   ├── binaries.test.js
│   └── projects.test.js
│
├── DatabaseManager.test.js        (integration - keep existing)
├── database/
│   ├── operations.test.js
│   ├── importExport.test.js
│   ├── postgres.test.js
│   ├── mongo.test.js
│   ├── helpers.test.js
│   └── credentials.test.js
```
