# Service Files Refactoring Plan

> **Goal**: Split oversized service manager files (400–500 lines max per file) using a sustainable, long-term pattern that preserves the existing public API.

---

## Current State

| File | Lines | Status |
|------|------:|--------|
| ProjectManager.js | 254 | ✅ Refactored — under target |
| ServiceManager.js | 160 | ✅ Refactored — under target |
| BinaryDownloadManager.js | 182 | ✅ Refactored — under target |
| CliManager.js | 48 | ✅ Refactored — under target |
| DatabaseManager.js | 23 | ✅ Refactored — under target |
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
- [x] Phase 2 (`ServiceManager.js`) structurally split and validated
- [x] Phase 3 (`BinaryDownloadManager.js`) started
- [x] Phase 4 (`CliManager.js`) started
- [x] Phase 5 (`DatabaseManager.js`) structurally split and validated

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

### Phase 2 Status: ServiceManager

Phase 2 is now functionally complete and under the target size. The actual implementation matches the planned pattern with a thin facade plus domain mixins under `src/main/services/service/`.

Implemented service mixins:

- `helpers.js`
- `core.js`
- `health.js`
- `processes.js`
- `nginx.js`
- `apache.js`
- `mysql.js`
- `mariadb.js`
- `redis.js`
- `mailpit.js`
- `phpmyadmin.js`
- `extras.js`

### Phase 2 Checklist

- [x] Create `src/main/services/service/`
- [x] Extract helper/path/runtime logic to `service/helpers.js`
- [x] Extract orchestration/start-stop logic to `service/core.js`
- [x] Extract health/status/port logic to `service/health.js`
- [x] Extract process/kill/version-tracking logic to `service/processes.js`
- [x] Extract service-specific runners for nginx/apache/mysql/mariadb/redis/mailpit/phpMyAdmin/extras
- [x] Replace `ServiceManager.js` with a thin facade + `Object.assign(...)`
- [x] Reduce `ServiceManager.js` below the 400–500 line target
- [x] Keep integration coverage in `tests/main/services/ServiceManager.test.js`
- [x] Add focused unit tests under `tests/main/services/service/`
- [x] Validate the current ServiceManager slice

### Last Verified Phase 2 Test Slice

- `tests/main/services/ServiceManager.test.js`
- `tests/main/services/service/helpers.test.js`
- `tests/main/services/service/processes.test.js`

Result: `30` tests passed across `3` files.

---

### Phase 3 Status: BinaryDownloadManager

Phase 3 has started with multiple safe extraction slices. Progress/listener tracking, config/update logic, installed-binary detection, generic download transport/cancellation flow, metadata helpers, and archive extraction have been moved into focused mixins and composed back into the manager prototype.

Implemented so far:

- `binary/progress.js`
- `binary/config.js`
- `binary/installed.js`
- `binary/download.js`
- `binary/metadata.js`
- `binary/extraction.js`
- `binary/php.js`
- `binary/serviceDownloads.js`
- `binary/runtimeTools.js`
- `binary/platformServices.js`
- `binary/catalog.js`
- `binary/imports.js`
- `tests/main/services/binary/progress.test.js`
- `tests/main/services/binary/config.test.js`
- `tests/main/services/binary/installed.test.js`
- `tests/main/services/binary/download.test.js`
- `tests/main/services/binary/metadata.test.js`
- `tests/main/services/binary/extraction.test.js`
- `tests/main/services/binary/php.test.js`
- `tests/main/services/binary/serviceDownloads.test.js`
- `tests/main/services/binary/runtimeTools.test.js`
- `tests/main/services/binary/platformServices.test.js`
- `tests/main/services/binary/catalog.test.js`
- `tests/main/services/binary/imports.test.js`

Current checkpoint:

- `BinaryDownloadManager.js` is now a thin facade reduced to `182` lines
- core service entry points for MySQL, MariaDB, Redis, Mailpit, phpMyAdmin, Nginx, and Apache now live in `binary/serviceDownloads.js`
- Node.js, Composer, and Git runtime installers and helpers now live in `binary/runtimeTools.js`
- PostgreSQL, Python, MongoDB, SQLite, MinIO, and Memcached installers now live in `binary/platformServices.js`
- binary catalog/removal/update helpers now live in `binary/catalog.js`
- binary import and extracted-structure normalization now live in `binary/imports.js`
- Phase 3 is functionally complete for the current target: the public manager API is preserved and the facade is back under the 400–500 line limit

### Phase 3 Checklist

- [x] Create `src/main/services/binary/`
- [x] Extract progress/listener tracking to `binary/progress.js`
- [x] Extract config/update logic to `binary/config.js`
- [x] Extract installed-binary scanning to `binary/installed.js`
- [x] Extract download transport/version probing to `binary/download.js`
- [x] Extract archive handling to `binary/extraction.js`
- [x] Extract metadata helpers to `binary/metadata.js`
- [x] Extract PHP-specific setup to `binary/php.js`
- [x] Extract service-specific download entry points to `binary/serviceDownloads.js`
- [x] Extract Node.js / Composer / Git runtime tooling to `binary/runtimeTools.js`
- [x] Extract PostgreSQL / Python / MongoDB / SQLite / MinIO / Memcached installers to `binary/platformServices.js`
- [x] Extract binary catalog/removal/update helpers to `binary/catalog.js`
- [x] Extract binary import helpers to `binary/imports.js`
- [x] Replace `BinaryDownloadManager.js` with a thin facade + `Object.assign(...)`
- [x] Reduce `BinaryDownloadManager.js` below the 400–500 line target
- [x] Add first focused unit test under `tests/main/services/binary/`
- [x] Validate the current BinaryDownloadManager slice

### Last Verified Phase 3 Test Slice

- `tests/main/services/BinaryDownloadManager.test.js`
- `tests/main/services/binary/progress.test.js`
- `tests/main/services/binary/config.test.js`
- `tests/main/services/binary/installed.test.js`
- `tests/main/services/binary/download.test.js`
- `tests/main/services/binary/metadata.test.js`
- `tests/main/services/binary/extraction.test.js`
- `tests/main/services/binary/php.test.js`
- `tests/main/services/binary/serviceDownloads.test.js`
- `tests/main/services/binary/runtimeTools.test.js`
- `tests/main/services/binary/platformServices.test.js`
- `tests/main/services/binary/catalog.test.js`
- `tests/main/services/binary/imports.test.js`

Result: `60` tests passed across `13` files.

---

### Phase 4 Status: CliManager

Phase 4 is now functionally complete. CliManager has been reduced to a thin facade, with concern-specific mixins under `src/main/services/cli/` covering runtime discovery, wrapper installation, project mapping, PATH management, and direct shim management.

Implemented so far:

- `cli/binaries.js`
- `cli/install.js`
- `cli/projects.js`
- `cli/path.js`
- `cli/shims.js`
- `tests/main/services/cli/binaries.test.js`
- `tests/main/services/cli/install.test.js`
- `tests/main/services/cli/projects.test.js`
- `tests/main/services/cli/path.test.js`
- `tests/main/services/cli/shims.test.js`

Current checkpoint:

- `CliManager.js` reduced to `48` lines
- runtime binary path lookups and default-version helpers now live in `cli/binaries.js`
- CLI wrapper installation now lives in `cli/install.js`
- project mapping and command-dispatch helpers now live in `cli/projects.js`
- CLI PATH detection, install instructions, and PATH add/remove flows now live in `cli/path.js`
- direct shim installation, removal, and platform-specific shim generation now live in `cli/shims.js`
- the public manager API is preserved through a thin facade + `Object.assign(...)` mixins
- focused coverage now exists for runtime/path lookup, project dispatch, PATH management, wrapper installation, direct shim toggling, direct shim cleanup, and Windows shim generation behavior

### Phase 4 Checklist

- [x] Create `src/main/services/cli/`
- [x] Extract runtime binary lookup/default helpers to `cli/binaries.js`
- [x] Extract project mapping and command execution to `cli/projects.js`
- [x] Extract PATH management to `cli/path.js`
- [x] Extract CLI install flow to `cli/install.js`
- [x] Extract direct shim installation/removal to `cli/shims.js`
- [x] Replace `CliManager.js` with a thin facade + `Object.assign(...)`
- [x] Reduce `CliManager.js` below the 400–500 line target
- [x] Add first focused unit test under `tests/main/services/cli/`
- [x] Validate the current CliManager slice

### Last Verified Phase 4 Test Slice

- `tests/main/services/cli/binaries.test.js`
- `tests/main/services/cli/install.test.js`
- `tests/main/services/cli/projects.test.js`
- `tests/main/services/cli/path.test.js`
- `tests/main/services/cli/shims.test.js`

Result: `21` tests passed across `5` files.

---

### Phase 5 Status: DatabaseManager

Phase 5 is now functionally complete. DatabaseManager has been reduced to a thin facade, with concern-specific mixins under `src/main/services/database/` covering helpers, credentials, import/export flow, engine-specific PostgreSQL and MongoDB behavior, and higher-level database operations.

Implemented so far:

- `database/helpers.js`
- `database/credentials.js`
- `database/importExport.js`
- `database/postgres.js`
- `database/mongo.js`
- `database/operations.js`
- `tests/main/services/database/helpers.test.js`
- `tests/main/services/database/credentials.test.js`
- `tests/main/services/database/importExport.test.js`
- `tests/main/services/database/postgres.test.js`
- `tests/main/services/database/mongo.test.js`
- `tests/main/services/database/operations.test.js`

Current checkpoint:

- `DatabaseManager.js` reduced to `23` lines
- operation tracking now lives in `database/helpers.js`
- active database type/version accessors and port resolution now live in `database/helpers.js`
- phpMyAdmin URL resolution and binary path/runtime helpers now live in `database/helpers.js`
- connection metadata, name sanitization, and TCP connection probing now live in `database/helpers.js`
- credential persistence, init-file generation, and no-auth query setup now live in `database/credentials.js`
- import/export flow, SQL stream processing, and import file validation now live in `database/importExport.js`
- PostgreSQL env setup, query execution, and PostgreSQL-specific import/export now live in `database/postgres.js`
- MongoDB query execution and MongoDB-specific import/export now live in `database/mongo.js`
- database creation/deletion, query execution, schema introspection, and size lookup now live in `database/operations.js`
- the public manager API remains unchanged through `Object.assign(DatabaseManager.prototype, databaseHelpers, databaseCredentials, databasePostgres, databaseMongo, databaseOperations, databaseImportExport)`
- focused coverage now exists for database info, port calculation, binary path selection, spawn option runtime cwd behavior, connection metadata, name sanitization, credential persistence, init-file generation behavior, SQL import/export helper parsing, PostgreSQL env precedence, PostgreSQL mocked database tracking, MongoDB mocked database tracking, MySQL mocked database tracking, connection-error fallback while listing databases, MongoDB schema introspection mapping, and database size parsing

### Phase 5 Checklist

- [x] Create `src/main/services/database/`
- [x] Extract helper/accessor/runtime logic to `database/helpers.js`
- [x] Extract credential/reset helpers to `database/credentials.js`
- [x] Extract MySQL/MariaDB operations/query logic to `database/operations.js`
- [x] Extract import/export flow to `database/importExport.js`
- [x] Extract PostgreSQL helpers to `database/postgres.js`
- [x] Extract MongoDB helpers to `database/mongo.js`
- [x] Replace `DatabaseManager.js` with a thin facade + `Object.assign(...)`
- [x] Reduce `DatabaseManager.js` below the 400–500 line target
- [x] Add first focused unit test under `tests/main/services/database/`
- [x] Validate the current DatabaseManager slice

### Last Verified Phase 5 Test Slice

- `tests/main/services/DatabaseManager.test.js`
- `tests/main/services/database/helpers.test.js`
- `tests/main/services/database/credentials.test.js`
- `tests/main/services/database/importExport.test.js`
- `tests/main/services/database/postgres.test.js`
- `tests/main/services/database/mongo.test.js`
- `tests/main/services/database/operations.test.js`

Result: `66` tests passed across `7` files.

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

**Current status:** Complete enough to count done. The facade is now `160` lines, the service domain mixins are in place, and the current integration plus focused mixin tests are passing.

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

**Current status:** In progress. The manager is still large at `2,125` lines, but the extracted mixins `binary/progress.js`, `binary/config.js`, `binary/installed.js`, `binary/download.js`, `binary/metadata.js`, `binary/extraction.js`, and `binary/php.js` are in place and validated.

| New File | Methods | Est. Lines |
|----------|---------|-----------|
| `binary/download.js` | `downloadFile`, `downloadWithVersionProbe`, `cancelDownload`, `checkCancelled`, `isVersionProbeEligibleError`, `buildPatchFallbackCandidates` | ~400 |
| `binary/extraction.js` | `extractArchive`, `extractZipAsync`, `validateZipFile` | ~200 |
| `binary/config.js` | `checkForUpdates`, `isVersionNewer`, `fetchRemoteConfig`, `compareConfigs`, `applyUpdates`, `applyConfigToDownloads`, `loadBundledConfig`, `loadCachedConfig`, `saveCachedConfig`, `cloneDownloadConfig` | ~400 |
| `binary/installed.js` | `getInstalledBinaries`, `scanCustomVersions`, `scanCustomPhpVersions`, `scanBinaryVersionsRecursive`, `findExecutableRecursive`, `isNodejsVersionInstalled` | ~350 |
| `binary/php.js` | `enablePhpExtensions`, `downloadPhp`, `ensureCaCertBundle`, `ensureVCRedist`, `createPhpIni` | ~400 |
| `binary/metadata.js` | `saveServiceMetadata`, `getLocalServiceMetadata`, `fetchRemoteMetadata` | ~150 |
| `binary/progress.js` | `addProgressListener`, `emitProgress`, `getActiveDownloads`, `cancelDownload`, `checkCancelled` | ~200 |
| `binary/serviceDownloads.js` | All individual `download*` methods (nginx, mysql, redis, etc.) beyond PHP | ~500 |
| **BinaryDownloadManager.js** (facade) | Constructor, property init, `Object.assign` mixins | ~100 |

### Phase 4: CliManager.js (2,603 lines → 6 files)

| New File | Methods | Est. Lines |
|----------|---------|-----------|
| `cli/install.js` | `installCli`, `installWindowsCli`, `installUnixCli` | ~500 |
| `cli/binaries.js` | All `get*Path` methods, `getActiveMysqlInfo`, `getFirstInstalled*Version`, `getDefault*Version`, `setDefault*Version`, `buildProjectEnv` | ~400 |
| `cli/projects.js` | `syncProjectsFile`, `getProjectsFilePath`, `getProjectForPath`, `executeCommand` | ~200 |
| `cli/path.js` | `getInstallInstructions`, `checkCliInstalled`, PATH add/remove helpers | ~350 |
| `cli/shims.js` | `installDirectShims`, `removeDirectShims`, `installWindowsDirectShims`, `installUnixDirectShims`, `getDirectShimsEnabled`, `setDirectShimsEnabled` | ~500 |
| **CliManager.js** (facade) | Constructor, property init, `Object.assign` mixins | ~100 |

### Phase 5: DatabaseManager.js (2,160 lines → 6 files)

| New File | Methods | Est. Lines |
|----------|---------|-----------|
| `database/operations.js` | `createDatabase`, `deleteDatabase`, `listDatabases`, `runDbQuery`, `runQuery`, `dropAllTables`, `getTables`, `getTableStructure`, `getDatabaseSize` | ~400 |
| `database/importExport.js` | `importDatabase`, `exportDatabase`, `createSqlProcessorStream`, `splitDefinitions`, `removeColumnsFromValues`, `parseValueSets`, `splitValues`, `validateFilePath`, `processImportSql` | ~500 |
| `database/postgres.js` | `_buildPgEnv`, `_runPostgresQuery`, `_importPostgres`, `_exportPostgres` | Implemented |
| `database/mongo.js` | `_runMongoQuery`, `_importMongo`, `_exportMongo` | Implemented |
| `database/helpers.js` | `initialize`, `getActiveDatabaseType`, `getActiveDatabaseVersion`, `setActiveDatabaseType`, `getDatabaseInfo`, `getConnections`, `isServiceRunning`, `getActualPort`, `sanitizeName`, `_getBinaryPath`, `getDbClientPath`, `getDbDumpPath`, `getDbRestorePath`, `getBinaryRuntimeDir`, `ensureDbBinaryRuntime`, `buildBinarySpawnOptions`, `getPhpMyAdminUrl`, `checkConnection`, `cancelOperation`, `getRunningOperations` | Implemented |
| `database/credentials.js` | `resetCredentials`, `createCredentialResetInitFile`, `runDbQueryNoAuth` | Implemented |
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
│   ├── helpers.test.js            (implemented)
│   ├── processes.test.js          (implemented)
│   ├── core.test.js               (optional follow-up)
│   ├── nginx.test.js              (optional follow-up)
│   ├── apache.test.js             (optional follow-up)
│   ├── mysql.test.js              (optional follow-up)
│   ├── mariadb.test.js            (optional follow-up)
│   ├── redis.test.js              (optional follow-up)
│   ├── mailpit.test.js            (optional follow-up)
│   ├── phpmyadmin.test.js         (optional follow-up)
│   ├── extras.test.js             (optional follow-up)
│   └── health.test.js             (optional follow-up)
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
