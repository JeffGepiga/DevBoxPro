# Plan: Public Tunnel Feature (cloudflared + zrok)

## TL;DR
Add Cloudflare Tunnel (`cloudflared`) and OpenZiti `zrok` as downloadable binaries in the Tools tab. Introduce a `TunnelManager` in the main process to spawn/stop tunnel processes per project. Add a "Share on Internet" section in **ProjectDetail** where users pick which provider to use. Store tunnel preferences in project schema, move app-wide zrok setup into **Binary Manager → Tools**, and surface provider readiness plus active tunnel visibility in the **Services** page.

---

## Phase 1 — Binary Download & Detection

### Step 1.1: Add entries to `config/binaries.json`
Add `cloudflared` and `zrok` entries following the mailpit pattern (unversioned, per-platform URLs):

```
cloudflared:
  versions: ["latest"]
  downloads.latest:
    win:  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
    mac:  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz
    linux: https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64

zrok:
  versions: ["latest"]
  downloads.latest:
    win:  https://github.com/openziti/zrok/releases/latest/download/zrok_*_windows_amd64.zip
    mac:  https://github.com/openziti/zrok/releases/latest/download/zrok_*_darwin_arm64.tar.gz
    linux: https://github.com/openziti/zrok/releases/latest/download/zrok_*_linux_amd64.tar.gz
```

**Files:** `config/binaries.json`

### Step 1.2: Add download methods in `binary/serviceDownloads.js`
Add `downloadCloudflared()` and `downloadZrok()` following the exact `downloadMailpit()` pattern:
- Download to `resources/cloudflared/{platform}/` and `resources/zrok/{platform}/`
- Extract archive, emit progress
- cloudflared on Windows is a standalone `.exe` (no archive), needs direct copy instead of extract

**Files:** `src/main/services/binary/serviceDownloads.js`

### Step 1.3: Add installation detection in `binary/installed.js`
Add to `getInstalledBinaries()`:
- `installed.cloudflared = await fs.pathExists(path.join(resourcesPath, 'cloudflared', platform, exe))`
- `installed.zrok = await fs.pathExists(path.join(resourcesPath, 'zrok', platform, exe))`

Initialize both as `false` in the defaults object.

**Files:** `src/main/services/binary/installed.js`

### Step 1.4: Wire IPC handlers for download
Add `binaries:downloadCloudflared` and `binaries:downloadZrok` handlers following the `binaries:downloadMailpit` pattern.

Add both to the `binaries:getStatus` return object: `cloudflared: { installed: !!installed.cloudflared }`, `zrok: { installed: !!installed.zrok }`.

**Files:** `src/main/ipc/handlers.js`

### Step 1.5: Expose in preload API
Add `downloadCloudflared: () => ipcRenderer.invoke('binaries:downloadCloudflared')` and same for zrok under `window.devbox.binaries`.

**Files:** `src/main/preload.js`

### Step 1.6: Add to BinaryManager Tools tab
Add two `SimpleRow` entries in the Tools tab for cloudflared and zrok, following the Mailpit/MinIO/Git pattern. Add cases for `'cloudflared'` and `'zrok'` in `handleDownloadService()` switch.

For zrok, extend the Tools tab with an app-wide setup panel or expandable row state that includes:
- token input
- `Enable zrok` action that calls `zrok enable <token>`
- enabled / not enabled status badge
- optional `Reconfigure` or `Reset` action

Cloudflared stays install-only because Quick Tunnels do not require sign-in.

**Files:** `src/renderer/src/pages/BinaryManager.jsx`

---

## Phase 2 — TunnelManager (Main Process)

### Step 2.1: Create `TunnelManager.js` facade + mixins
Create `src/main/services/TunnelManager.js` as a thin facade class following the manager pattern in `main.js`. Compose mixins from `src/main/services/tunnel/`:

- `tunnel/providers.js` — provider-specific spawn logic for cloudflared and zrok
- `tunnel/lifecycle.js` — `startTunnel(projectId, provider)`, `stopTunnel(projectId)`, `stopAllTunnels()`
- `tunnel/status.js` — `getTunnelStatus(projectId)`, `getAllTunnelStatuses()`, public URL parsing

**State tracked:**
- `this.activeTunnels` — `Map<projectId, { provider, process, publicUrl, startedAt }>`
- Receives `managers` object (needs `project`, `log`, `binaryDownload`)

**Files:**
- `src/main/services/TunnelManager.js` (facade)
- `src/main/services/tunnel/providers.js`
- `src/main/services/tunnel/lifecycle.js`
- `src/main/services/tunnel/status.js`

### Step 2.2: Provider spawn logic

**cloudflared:**
```
cloudflared tunnel --url http://projectDomain:httpPort --no-autoupdate
```
- Parse public URL from stdout line: `INF |  https://xxxxx.trycloudflare.com`
- Process spawned with `windowsHide: true, shell: false`
- Kill on stop with tree-kill (same pattern as SupervisorManager)

**zrok:**
```
zrok share public http://projectDomain:httpPort --headless
```
- Parse public URL from stdout/stderr
- Requires one-time app-wide `zrok enable <token>` setup from Binary Manager → Tools
- Store only app-wide enabled status and optional metadata in ConfigStore; do not persist the raw token after enable succeeds

**Port resolution:** Use `this.managers.project.getProjectLocalAccessPorts(project)` to resolve the correct HTTP port (handles front-door ownership, version offsets, network access ports). Point the tunnel at `http://<project.domain>:<resolvedHttpPort>` so nginx/apache vhosts handle routing correctly with the right Host header.

**Files:** `src/main/services/tunnel/providers.js`

### Step 2.3: Register TunnelManager in main.js
Add `managers.tunnel = new TunnelManager(resourcePath, configStore, managers);` after the other manager initializations. Call `managers.tunnel.stopAllTunnels()` in the `before-quit` handler.

**Files:** `src/main/main.js`

---

## Phase 3 — IPC & Preload

### Step 3.1: Add tunnel IPC handlers
Add to `src/main/ipc/handlers.js`:
- `tunnel:start` — `(event, projectId, provider)` → `managers.tunnel.startTunnel(projectId, provider)`
- `tunnel:stop` — `(event, projectId)` → `managers.tunnel.stopTunnel(projectId)`
- `tunnel:getStatus` — `(event, projectId)` → `managers.tunnel.getTunnelStatus(projectId)`
- `tunnel:getAllStatuses` — `()` → `managers.tunnel.getAllTunnelStatuses()`
- `tunnel:zrokEnable` — `(event, token)` → `managers.tunnel.enableZrok(token)` (one-time setup)
- `tunnel:zrokStatus` — `()` → `managers.tunnel.getZrokStatus()` (check if enabled)

Emit `tunnel:statusChanged` event to renderer via `sendToMainWindow()` when tunnel starts/stops/gets URL.

**Files:** `src/main/ipc/handlers.js`

### Step 3.2: Expose in preload
Add `window.devbox.tunnel` namespace:
```
tunnel: {
  start: (projectId, provider) => ipcRenderer.invoke('tunnel:start', projectId, provider),
  stop: (projectId) => ipcRenderer.invoke('tunnel:stop', projectId),
  getStatus: (projectId) => ipcRenderer.invoke('tunnel:getStatus', projectId),
  getAllStatuses: () => ipcRenderer.invoke('tunnel:getAllStatuses'),
  zrokEnable: (token) => ipcRenderer.invoke('tunnel:zrokEnable', token),
  zrokStatus: () => ipcRenderer.invoke('tunnel:zrokStatus'),
  onStatusChanged: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('tunnel:statusChanged', handler);
    return () => ipcRenderer.removeListener('tunnel:statusChanged', handler);
  },
}
```

**Files:** `src/main/preload.js`

---

## Phase 4 — Project Schema & Global Provider Setup

### Step 4.1: Add tunnel fields to project schema
Projects gain optional fields:
- `tunnelProvider: 'cloudflared' | 'zrok' | null` — which provider this project uses
- `tunnelAutoStart: boolean` — start tunnel automatically when project starts

These are persisted via the existing `projects:update` flow (no schema migration needed — they're optional fields).

**Files:** No new files; affects `src/main/services/project/helpers.js` (`getComparableVhostState` should NOT include tunnel fields since tunnels don't affect vhosts)

### Step 4.2: Add app-wide zrok setup to Binary Manager → Tools
Add a dedicated app-wide setup UI for zrok in BinaryManager.jsx instead of Settings:
- token input
- `Enable zrok` button that calls `window.devbox.tunnel.zrokEnable(token)`
- enabled / not enabled / configuring states
- help text explaining that the setup is shared across the whole app and all projects
- optional `Reset zrok` or `Reconfigure` action for replacing the identity later

Store app-wide state as `settings.zrokEnabled` plus optional metadata such as `settings.zrokConfiguredAt`. Do not store the raw token after setup succeeds unless there is a hard product requirement to reuse it.

**Files:** `src/renderer/src/pages/BinaryManager.jsx`

### Step 4.3: Surface provider readiness in the Services page
Add a lightweight Internet Tunnels status area to Services.jsx so users can see app-wide tunnel readiness without opening Binary Manager:
- cloudflared installed / not installed
- zrok installed / not installed
- zrok enabled / not enabled
- active tunnel count across projects
- quick links to Binary Manager and running projects using tunnels

This should be visibility-first, not a full duplicate of the Binary Manager setup UI.

**Files:** `src/renderer/src/pages/Services.jsx`

---

## Phase 5 — ProjectDetail UI

### Step 5.1: Add "Share on Internet" section
Add below the existing "Share on Local Network" toggle in ProjectDetail.jsx overview tab (around line 1051):

**UI elements:**
1. **Toggle** — "Share on Internet" (enables/disables the tunnel for this project)
2. **Provider selector** — dropdown: "Cloudflare Tunnel" / "zrok" — only shows installed providers
3. **Start/Stop button** — starts or stops the tunnel process
4. **Public URL display** — shows the generated URL with copy-to-clipboard and open-in-browser buttons
5. **Status indicator** — connecting / active / error with spinner
6. **Warning states:**
   - "Project must be running" if project is stopped
   - "cloudflared not installed — Install in Binary Manager" if binary missing
  - "zrok not enabled — Configure in Binary Manager → Tools" if zrok selected but not enabled

**State:**
- `tunnelStatus` — fetched via `window.devbox.tunnel.getStatus(projectId)` on mount and via `onStatusChanged` listener
- `tunnelLoading` — tracks start/stop in progress

Wire save through existing `pendingChanges` flow for `tunnelProvider` and `tunnelAutoStart`.

**Files:** `src/renderer/src/pages/ProjectDetail.jsx`

### Step 5.2: Auto-start tunnel on project start (optional)
In `project/lifecycle.js` `startProject()`, after the project is fully started and all services are running, check if `project.tunnelAutoStart` is true and call `this.managers.tunnel?.startTunnel(project.id)`.

In `stopProject()`, call `this.managers.tunnel?.stopTunnel(project.id)` before stopping services.

**Files:** `src/main/services/project/lifecycle.js`

### Step 5.3: Reflect active tunnel state in Services page
Use the app-wide tunnel status data to show active tunnel counts and currently exposed projects in Services.jsx. If a public URL exists, the Services page can show a compact external-link action, but start/stop remains project-scoped in ProjectDetail.

**Files:** `src/renderer/src/pages/Services.jsx`

### Step 5.4: Subscribe to tunnel events in AppContext
Add a `tunnel:statusChanged` listener in AppContext.jsx to keep tunnel state fresh across navigation. Store in a new `tunnelStatuses` reducer key: `Map<projectId, { provider, publicUrl, status }>`.

**Files:** `src/renderer/src/context/AppContext.jsx`

---

## Phase 6 — Tests

### Step 6.1: Main process unit tests

**`tests/main/services/TunnelManager.test.js`** — Integration tests for the facade:
- `startTunnel()` spawns correct binary for cloudflared/zrok
- `stopTunnel()` kills the child process
- `stopAllTunnels()` kills all active tunnels
- `getTunnelStatus()` returns correct state
- Error when binary not installed
- Error when project not running

**`tests/main/services/tunnel/providers.test.js`** — Unit tests for provider logic:
- cloudflared command construction
- zrok command construction
- Public URL parsing from stdout for each provider
- `windowsHide: true` passed on Windows
- zrok enable/status token handling

**`tests/main/services/tunnel/lifecycle.test.js`** — Unit tests for lifecycle:
- Start stores tunnel in `activeTunnels` map
- Stop removes from map and kills process
- Double-start returns existing tunnel
- Start with missing binary throws descriptive error
- Auto-start on project start
- Auto-stop on project stop

### Step 6.2: Binary download tests

**`tests/main/services/binary/serviceDownloads.test.js`** — Add cases:
- `downloadCloudflared()` downloads to correct path
- `downloadZrok()` downloads to correct path
- Both emit progress events

**`tests/main/services/binary/installed.test.js`** — Add cases:
- `getInstalledBinaries()` detects cloudflared exe
- `getInstalledBinaries()` detects zrok exe
- Returns false when not installed

### Step 6.3: IPC handler tests

**`tests/main/ipc/handlers.test.js`** — Add tunnel handler registration checks to the existing handler registration test (the test that verifies all expected IPC channel names are registered).

### Step 6.4: Renderer tests

**`tests/renderer/pages/ProjectDetail.test.jsx`** — Add cases:
- Tunnel section renders when project has tunnel provider set
- Start/stop buttons call correct IPC methods
- Public URL displays and copy works
- Warning shown when project is stopped
- Warning shown when binary not installed

**`tests/renderer/pages/BinaryManager.test.jsx`** — Add cases:
- cloudflared and zrok rows render in Tools tab
- Download button triggers correct IPC call
- zrok setup input and enable action render in Tools tab
- enabled / not enabled state updates correctly after setup

**`tests/renderer/pages/Services.test.jsx`** — Add cases:
- Internet tunnel readiness panel renders in Services page
- Active tunnel count displays correctly
- zrok enabled / not enabled state is visible

### Step 6.5: Mock setup

**`tests/helpers/setup.js`** — Add tunnel mocks:
```
tunnel: {
  start: async () => ({ success: true, publicUrl: 'https://test.trycloudflare.com' }),
  stop: async () => ({ success: true }),
  getStatus: async () => null,
  getAllStatuses: async () => ({}),
  zrokEnable: async () => ({ success: true }),
  zrokStatus: async () => ({ enabled: false }),
  onStatusChanged: () => () => {},
}
```

**`tests/renderer/setup.js`** — Same tunnel mocks under `window.devbox.tunnel`.

Add `cloudflared` and `zrok` to binaries status mock objects.

---

## Relevant Files

### New files to create:
- `src/main/services/TunnelManager.js` — Facade class
- `src/main/services/tunnel/providers.js` — cloudflared + zrok spawn/parse logic
- `src/main/services/tunnel/lifecycle.js` — start/stop/stopAll
- `src/main/services/tunnel/status.js` — status getters, URL tracking
- `tests/main/services/TunnelManager.test.js`
- `tests/main/services/tunnel/providers.test.js`
- `tests/main/services/tunnel/lifecycle.test.js`

### Existing files to modify:
- `config/binaries.json` — Add cloudflared + zrok download entries
- `src/main/services/binary/serviceDownloads.js` — Add `downloadCloudflared()`, `downloadZrok()`
- `src/main/services/binary/installed.js` — Add cloudflared/zrok detection
- `src/main/ipc/handlers.js` — Add tunnel handlers + binary download handlers + status entries
- `src/main/preload.js` — Add `tunnel` namespace + binary download methods
- `src/main/main.js` — Register TunnelManager, add cleanup on quit
- `src/renderer/src/pages/BinaryManager.jsx` — Add SimpleRow entries + switch cases
- `src/renderer/src/pages/ProjectDetail.jsx` — Add "Share on Internet" UI section
- `src/renderer/src/pages/Services.jsx` — Add app-wide tunnel readiness and active tunnel visibility
- `src/renderer/src/context/AppContext.jsx` — Add tunnel status reducer + listener
- `src/main/services/project/lifecycle.js` — Auto-start/stop tunnel integration
- `src/main/services/project/helpers.js` — Exclude tunnel fields from vhost comparison
- `tests/helpers/setup.js` — Add tunnel mocks
- `tests/renderer/setup.js` — Add tunnel mocks
- `tests/main/ipc/handlers.test.js` — Add tunnel handler checks
- `tests/renderer/pages/ProjectDetail.test.jsx` — Add tunnel UI tests
- `tests/renderer/pages/BinaryManager.test.jsx` — Add cloudflared/zrok tool tests
- `tests/renderer/pages/Services.test.jsx` — Add tunnel visibility tests
- `tests/main/services/binary/serviceDownloads.test.js` — Add download tests
- `tests/main/services/binary/installed.test.js` — Add detection tests

---

## Verification

1. `npm test` — All existing + new tests pass
2. Manual: Install cloudflared from Binary Manager Tools tab, verify exe appears in `resources/cloudflared/{platform}/`
3. Manual: Start a running project's tunnel → verify public URL appears in ProjectDetail
4. Manual: Open public URL in browser → verify project loads correctly
5. Manual: Stop tunnel → verify process killed and UI updates
6. Manual: Stop project → tunnel auto-stops
7. Manual: Enable zrok once from Binary Manager → Tools, then switch a project to zrok and repeat the tunnel test
8. Manual: Verify `windowsHide: true` — no console window flashes on Windows
9. Manual: Services page shows cloudflared/zrok readiness and active tunnel visibility
10. `npm run test:renderer` — Tunnel UI tests pass
11. `npm run test:main` — TunnelManager + binary tests pass

---

## Decisions

- **Tunnel target**: Point at `http://<project.domain>:<resolvedHttpPort>` (not raw localhost port) so nginx/apache vhosts handle Host header routing correctly
- **zrok setup location**: zrok is configured once at the app level from Binary Manager → Tools, then reused by every project
- **Token storage**: persist only `settings.zrokEnabled` and optional metadata; do not keep the raw token after `zrok enable` succeeds because zrok stores its own state in `~/.zrok/`
- **No custom domains in MVP**: Cloudflare named tunnels and zrok reserved shares are excluded from initial scope
- **Separate from networkAccess**: Tunnel state is independent of the LAN sharing toggle; both can be active simultaneously
- **cloudflared Windows**: The Windows release is a standalone .exe, not an archive — download method must handle direct file copy instead of extraction
- **WebSocket support**: The existing nginx/apache proxy configs lack WebSocket upgrade headers; this is a known limitation that affects HMR for Vite/Next/Nuxt dev servers over the tunnel. Can be addressed as a follow-up by adding `proxy_set_header Upgrade` directives

## Further Considerations

1. **zrok download URL**: zrok releases use version-tagged filenames (e.g., `zrok_1.0.0_windows_amd64.zip`). The download method will need to either query the GitHub API for the latest release asset URL, or use a redirect-following pattern. Recommend using the GitHub API approach (same as how UpdateManager queries releases).
2. **macOS cloudflared**: The macOS release is a `.tgz` archive containing the binary. The download method should use `extractArchive()` like mailpit. But verify the actual archive structure.
3. **Tunnel process cleanup on crash**: If the app crashes or force-closes, tunnel child processes may be orphaned. Consider adding orphan detection on startup (similar to how ServiceManager rehydrates running services on launch).
4. **zrok reset flow**: Decide whether the first version needs a `Reset zrok identity` action in Binary Manager or if re-running `zrok enable` is enough for MVP.
