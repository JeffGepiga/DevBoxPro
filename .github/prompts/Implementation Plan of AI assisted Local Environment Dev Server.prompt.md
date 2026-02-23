## Plan: Local AI Assistant (Per-Project Chat)

**TL;DR:** Add a per-project "AI" chat tab to `ProjectDetail.jsx` powered by a pluggable AI provider system. Users choose between a free local Ollama binary or paid cloud providers (Claude, OpenAI) via API keys stored with Electron's `safeStorage`. A new `AIManager` orchestrates providers through a common interface. A new `AIContextBuilder` injects live DevBox Pro environment data (logs, services, `.env`, `php.ini`, project config) into every system prompt so the AI answers with full environment awareness. A new `AIActionExecutor` parses AI responses and maps suggested fixes to one-click buttons wired to existing IPC handlers — including applying code fixes, updating `php.ini`, fixing `.env` values, restarting services, and safely applying web server config changes. Critically, the AI **never writes vhost/Apache config files directly** — instead it writes structured `customDirectives` fields to the project in `ConfigStore` so that changes survive project restarts (which fully regenerate vhost files). An error watcher silently monitors PHP/Nginx logs and badges the AI tab when issues are detected.

---

**Steps**

**Phase 1 — Ollama Binary & Config**

1. Add `ollama` entry to [config/binaries.json](config/binaries.json) following the existing `{ win: { url, filename }, mac: { url, filename } }` format — points to the official Ollama GitHub release zip for each platform

2. Add `AI_CONFIG` export to [src/shared/serviceConfig.js](src/shared/serviceConfig.js) with:
   - `ollamaPort: 11434`
   - `defaultModel: 'llama3.2:3b'`
   - `availableModels` array with `id`, `name`, `size`, `ramRequired`, `speed`, `description` for `llama3.2:3b`, `llama3.1:8b`, `qwen2.5:7b`, `deepseek-r1:7b`
   - `cloudProviders` array: `[{ id: 'claude', name: 'Claude (Anthropic)', models: ['claude-3-5-haiku-20241022', 'claude-sonnet-4-5'] }, { id: 'openai', name: 'OpenAI', models: ['gpt-4o-mini', 'gpt-4o', 'o1-mini'] }]`

**Phase 2 — Provider Abstraction Layer**

3. Create `src/main/services/ai/` directory with:

   **`providers/BaseAIProvider.js`** — abstract base class:
   - `chat(messages, systemPrompt, onChunk)` → must implement
   - `isAvailable()` → must implement
   - `getModelOptions()` → must implement
   - `cancelChat(projectId)` → must implement

   **`providers/OllamaProvider.js`** extends `BaseAIProvider`:
   - Manages Ollama binary lifecycle in `userData/resources/ollama/`
   - `initialize()` — resolves binary path, auto-starts server if `configStore.get('settings.ai.autoStart')`
   - `startServer()` — spawns `ollama serve` with `spawnHidden`, health-checks `GET /api/tags` (5s timeout loop)
   - `stopServer()` — kills the process
   - `getInstalledModels()` → `GET /api/tags` → `[{ name, size, modified }]`
   - `pullModel(modelName, onProgress)` → streams `POST /api/pull`, emits `ai:modelProgress` push events
   - `deleteModel(modelName)` → `DELETE /api/delete`
   - `chat(projectId, messages, systemPrompt, onChunk)` → streams `POST /api/chat` with `stream: true`
   - Uses `windowsHide: true` via existing `SpawnUtils` pattern

   **`providers/ClaudeProvider.js`** extends `BaseAIProvider`:
   - Uses `@anthropic-ai/sdk` package
   - API key retrieved via `safeStorage.decryptString(configStore.get('settings.ai.claudeApiKeyEncrypted'))`
   - `isAvailable()` → tests key with a minimal API call
   - `chat(projectId, messages, systemPrompt, onChunk)` → `anthropic.messages.stream(...)` using the selected `claude-*` model
   - `cancelChat(projectId)` — aborts the active stream

   **`providers/OpenAIProvider.js`** extends `BaseAIProvider`:
   - Uses `openai` npm package
   - API key retrieved via `safeStorage.decryptString(configStore.get('settings.ai.openaiApiKeyEncrypted'))`
   - `isAvailable()` → tests key with `models.list()`
   - `chat(projectId, messages, systemPrompt, onChunk)` → `openai.chat.completions.create({ stream: true, ... })`
   - Supports `gpt-4o-mini`, `gpt-4o`, `o1-mini`

   **`AIManager.js`** — orchestrator (replaces `OllamaManager` as the single manager registered in `main.js`):
   - Constructor `(resourcePath, configStore, managers)`
   - `initialize()` — instantiates all three providers, initializes Ollama provider
   - `getActiveProvider()` → returns the provider matching `configStore.get('settings.ai.provider', 'ollama')`
   - `chat(projectId, messages, systemPrompt, onChunk)` → delegates to `getActiveProvider().chat(...)`
   - `cancelChat(projectId)` → delegates to active provider
   - `getStatus()` → `{ provider, ollamaInstalled, ollamaRunning, currentModel, cloudProviderConfigured }`
   - `setApiKey(provider, plainKey)` → encrypts with `safeStorage.encryptString(plainKey)`, stores encrypted buffer in `configStore`
   - `testApiKey(provider, plainKey)` → instantiates provider with key, calls `isAvailable()`
   - Ollama-specific passthrough: `getInstalledModels`, `pullModel`, `deleteModel`, `startServer`, `stopServer`

**Phase 3 — `AIContextBuilder.js` & `AIActionExecutor.js`**

4. Create [src/main/services/ai/AIContextBuilder.js](src/main/services/ai/AIContextBuilder.js):
   - `buildSystemPrompt(projectId)` — assembles a rich system prompt:
     - DevBox Pro environment block: running services + ports, PHP versions installed, web server type
     - Project block (if `projectId` provided): `project.name`, `type`, `phpVersion`, `webServer`, `domain`, `services`, `environment` object
     - Recent PHP error log lines from `managers.log.getProjectLogs(projectId, 50)`
     - Recent Nginx/Apache service log tail from `managers.log.getServiceLogs(serviceName, 30)`
     - PHP extensions for project's PHP version via `managers.php.getExtensions(phpVersion)`
     - `.env` key-value pairs (sanitized — strips passwords) via `managers.project.readEnvFile(projectId)` → only keys + non-sensitive values
     - Current `php.ini` relevant settings (memory_limit, upload_max_filesize, max_execution_time, xdebug settings) from `managers.binaries.getPhpIni(phpVersion)`
     - Current generated vhost file content via `managers.project.getVhostContent(projectId)` — gives AI full visibility of the active web server config
     - Currently persisted custom directives: `project.customNginxDirectives`, `project.customNginxLocationDirectives`, `project.customApacheDirectives`
   - `buildContextSummary(projectId)` → shorter version for the "Analyze Environment" auto-prompt

5. Create [src/main/services/ai/AIActionExecutor.js](src/main/services/ai/AIActionExecutor.js):
   - `parseActions(responseText, context)` → scans AI response text for actionable patterns, returns `[{ label, execute }]`
   - Pattern registry maps regex matches to `managers.*` calls:
     - `/set memory_limit to ([0-9]+M)/i` → `managers.binaries.savePhpIni(phpVersion, updatedIni)`
     - `/enable ([a-z_]+) extension/i` → `managers.php.toggleExtension(phpVersion, ext, true)`
     - `/update ([A-Z_]+) to ([^\s]+) in \.env/i` → `managers.project.updateEnvValue(projectId, key, value)`
     - `/restart (nginx|apache|mysql|redis)/i` → `managers.service.restartService(name)`
     - `/run composer ([^\n]+)/i` → `managers.binaries.runComposer(projectPath, command, phpVersion)`
     - PHP code fix block (fenced ` ```php ` diff) → `managers.system.writeFile(filePath, patchedContent)` after applying the diff
     - Nginx/Apache directive suggestions → `managers.project.updateProject(id, { customNginxDirectives, customNginxLocationDirectives, customApacheDirectives })` + `managers.project.regenerateVhost(id)` — **never** writes vhost files directly via `fs.writeFile`
   - `executeAction(action, context)` → runs the matched execute function, returns `{ success, message }`
   - `context` shape: `{ projectId, phpVersion, projectPath, webServer }` — passed in from the IPC handler

**Phase 4 — Vhost & Web Server Config Safety**

6. **Extend project schema** in `ProjectManager` — add three new optional fields to every project object stored in `ConfigStore`:
   ```javascript
   customNginxDirectives: "",         // injected inside the server {} block
   customNginxLocationDirectives: "",  // injected inside location / {}
   customApacheDirectives: "",         // injected inside <VirtualHost>
   ```
   These persist across restarts, project moves, and web server switches.

7. **Update `createVirtualHost()` templates** in `ProjectManager` to inject the custom directive fields at clearly marked injection points:
   - Nginx template: add `# BEGIN DevBox AI Directives\n{{ customNginxDirectives }}\n# END DevBox AI Directives` at the bottom of the `server {}` block, and the same pattern for `location /`
   - Apache template: add `# BEGIN DevBox AI Directives\n{{ customApacheDirectives }}\n# END DevBox AI Directives` before `</VirtualHost>`
   - If the field is empty/null the injection point renders as a blank line — no visible effect

8. **Add `getVhostContent(projectId)`** method to `ProjectManager` → reads and returns the current generated vhost file content as a string — used by `AIContextBuilder` to give AI full visibility of the active config

9. **Add new IPC handlers** in [src/main/ipc/handlers.js](src/main/ipc/handlers.js):
   - `projects:getVhostConfig` → `project.getVhostContent(id)` → returns raw vhost file string
   - `projects:updateCustomDirectives` → `project.updateProject(id, { customNginxDirectives, customNginxLocationDirectives, customApacheDirectives })` + `project.regenerateVhost(id)` — single atomic call for AI to apply web server changes safely

10. **Expose in preload** under `window.devbox.projects.getVhostConfig(id)` and `window.devbox.projects.updateCustomDirectives(id, directives)`

11. **Show in AI tab UI:** Below the chat, a collapsible "Applied Web Server Directives" panel (read-only code block) shows `project.customNginxDirectives` + `project.customApacheDirectives` currently in effect — so the dev can see what the AI has persisted. A "Clear All" button resets them to empty and regenerates the vhost.

**Phase 5 — IPC Handlers**

12. Register `managers.ai = new AIManager(resourcePath, configStore, managers)` in `initializeManagers()` in [src/main/main.js](src/main/main.js), add `await managers.ai.initialize()` in the deferred init block alongside other managers

13. Add `ai:*` handlers in [src/main/ipc/handlers.js](src/main/ipc/handlers.js). Destructure `ai` from managers. Add:
   - `ai:getStatus` → `ai.getStatus()`
   - `ai:getInstalledModels` → `ai.getInstalledModels()` (Ollama only)
   - `ai:pullModel` → `ai.pullModel(model)` — pushes `ai:modelProgress` events
   - `ai:deleteModel` → `ai.deleteModel(model)` (Ollama only)
   - `ai:startServer` → `ai.startServer()` (Ollama only)
   - `ai:stopServer` → `ai.stopServer()` (Ollama only)
   - `ai:setApiKey` → `ai.setApiKey(provider, plainKey)` — encrypts + stores; never returns the key
   - `ai:testApiKey` → `ai.testApiKey(provider, plainKey)` → `{ valid, error }`
   - `ai:chat` → builds context with `AIContextBuilder`, resolves actions with `AIActionExecutor.parseActions`, calls `ai.chat(projectId, messages, systemPrompt, chunk => mainWindow.webContents.send('ai:chunk', { projectId, content: chunk.content, done: chunk.done, actions: chunk.done ? parsedActions : [] }))`
   - `ai:cancelChat` → `ai.cancelChat(projectId)`
   - `ai:executeAction` → `AIActionExecutor.executeAction(action, context)` → `{ success, message }`
   - `ai:getHistory` → `configStore.get('aiChats.' + projectId, [])`
   - `ai:saveHistory` → `configStore.set('aiChats.' + projectId, messages)`
   - `ai:clearHistory` → `configStore.delete('aiChats.' + projectId)`
   - `ai:getSettings` → `configStore.get('settings.ai', defaultAiSettings)` — never includes raw API keys
   - `ai:updateSettings` → `configStore.set('settings.ai', settings)` + reinitialize affected provider
   - `ai:analyzeEnvironment` → builds full context, sends auto-prompt *"Analyze this project environment and identify any issues or misconfigurations"*, streams same as `ai:chat`

14. Add push event channels `ai:chunk`, `ai:modelProgress`, `ai:errorDetected` to the `validChannels` array in [src/main/preload.js](src/main/preload.js) and expose `window.devbox.ai` namespace with all the methods above

**Phase 6 — Error Watcher**

15. In `AIManager.initialize()`, attach a log watcher using `managers.log.streamLogs(projectId, callback)` for each running project. When a line matches PHP fatal/error patterns (`PHP Fatal error`, `PHP Parse error`, `Uncaught`, `[error]`), emit `ai:errorDetected` push event: `{ projectId, message, logLine }` to the renderer. Stop watcher on project stop via `project:statusChanged` events from `managers.service`

**Phase 7 — React UI (AI Chat Tab)**

16. Add `{ id: 'ai', label: 'AI Assistant', icon: Bot }` to the `tabs` array in [src/renderer/src/pages/ProjectDetail.jsx](src/renderer/src/pages/ProjectDetail.jsx) — `Bot` from `lucide-react`

17. Add `AiTab` sub-component (in same file, following pattern of existing `LogsTab`, `EnvironmentTab`):
    - **State:** `messages` (loaded from `ai:getHistory`), `inputValue`, `isStreaming`, `aiStatus` (from `ai:getStatus`), `hasError` (error badge)
    - **Chat bubble layout:** user messages right-aligned, AI messages left-aligned with markdown rendering via `react-markdown` (install if not present) — code blocks rendered with syntax highlighting
    - **Toolbar:**
      - "Analyze Environment" button → calls `window.devbox.ai.analyzeEnvironment(projectId)`, streams response
      - Active provider badge (e.g. "Ollama · llama3.2:3b" or "Claude · haiku") — clicking opens provider quick-switch popover
      - Clear history button
    - **Streaming:** subscribes to `window.devbox.on('ai:chunk', handler)` — appends content to last assistant message per chunk, sets `isStreaming=false` when `done=true`
    - **Action Buttons:** when `chunk.done === true` and `chunk.actions` is non-empty, render each action as a pill button below the message. Clicking calls `window.devbox.ai.executeAction(action, context)`, shows inline success/error toast
    - **Code Fix Flow:** if AI response includes a fenced PHP diff block, render a "Apply Fix" button that calls `ai:executeAction` with the patch — shows a before/after diff preview in a small modal before confirming
    - **Error badge:** subscribes to `ai:errorDetected`, sets `hasError=true`, shows red dot on tab label; clicking the tab auto-sends *"I detected an error in your logs. Here it is: [logLine]. How do I fix it?"*

18. Add `AISetupModal` component (`src/renderer/src/components/AISetupModal.jsx`): shown when `ai:getStatus` returns `ollamaInstalled: false` and provider is `ollama` — three-step wizard: (1) download Ollama binary via `BinaryDownloadManager` with progress bar, (2) pull default model with a progress bar, (3) done. For cloud providers shown only when API key is missing, with a key input + Test button

**Phase 8 — Settings Page Integration**

19. Add an "AI Assistant" section to [src/renderer/src/pages/Settings.jsx](src/renderer/src/pages/Settings.jsx):

    **Provider selector** — tab/radio between Local and Cloud:

    *Local (Ollama)*
    - Toggle: auto-start Ollama with DevBox Pro
    - Model selector with RAM requirement + speed label per option
    - Ollama server status indicator + Start/Stop button
    - Installed models list with size + delete button
    - "Download Model" button (opens pull modal with progress)

    *Claude (Anthropic)*
    - API Key input (masked, stored encrypted) + "Test Connection" button → shows green check or error
    - Model selector: `claude-3-5-haiku-20241022` (fast/cheap) · `claude-sonnet-4-5` (best)
    - Link to Anthropic console for key creation

    *OpenAI*
    - API Key input (masked, stored encrypted) + "Test Connection" button
    - Model selector: `gpt-4o-mini` · `gpt-4o` · `o1-mini`
    - Link to OpenAI platform for key creation

---

**Verification**

- Start app → check Ollama server starts (if configured) via `window.devbox.ai.getStatus()`
- Open a project → navigate to AI tab → type *"Is my environment configured correctly?"* → verify streaming response with project context
- Introduce a PHP fatal error in the project → verify red badge appears on AI tab and auto-prompt fires
- Click "Analyze Environment" → verify response references actual project settings (PHP version, extensions, `.env` values)
- Test action buttons: ask AI to enable an extension → verify "Enable extension" button appears → click → verify `php.ini` updated
- Test code fix: paste a PHP error → verify AI returns a diff block → click "Apply Fix" → verify file updated on disk
- Ask AI to add an Nginx directive (e.g. `client_max_body_size 100M`) → verify action button appears → click → verify directive appears in the generated vhost file and in the "Applied Web Server Directives" panel
- Restart the project → verify the custom directive is still present in the regenerated vhost file
- Ask AI to fix a web server issue while a project is stopped → verify it uses `updateCustomDirectives` not direct file write
- Click "Clear All" on the directives panel → verify vhost regenerates cleanly
- Test Claude provider: enter API key → Test Connection → send a chat message → verify streaming works
- Test OpenAI provider: same as Claude
- Verify API keys never appear in plain text in `configStore` JSON file on disk
- Test model download flow from scratch (no Ollama installed) via setup wizard
- Test on both Windows and macOS for binary path and `safeStorage` differences

---

**Decisions**

- Chat history stored in `ConfigStore` under `aiChats.{projectId}` — same electron-store as all project data; auto-deleted when project is deleted
- API keys encrypted with `safeStorage.encryptString()` — never stored as plain text; `ai:getSettings` returns only non-sensitive fields (provider name, model selection, flags)
- Provider abstraction (`BaseAIProvider`) means adding future providers (e.g. Gemini, Mistral API) requires only a new provider file + entry in `AI_CONFIG` — no changes to IPC layer or UI
- Streaming via `mainWindow.webContents.send('ai:chunk')` push events — consistent with existing `terminal:output` and `log:newEntry` push pattern
- Ollama binary managed by existing `BinaryDownloadManager` download flow — no new download infrastructure needed
- `AIActionExecutor` lives in main process so it has direct access to all managers without going through IPC — actions execute atomically
- Per-project tab (not global page) — context is always project-specific; aligned with logs, terminal, workers tabs
- `llama3.2:3b` as default local model — works on 8GB RAM; `claude-3-5-haiku` recommended for cloud — fast and cheap for environment Q&A
- `npm install @anthropic-ai/sdk openai react-markdown` required — add to renderer `package.json`
- AI **never writes vhost/Apache config files directly** — `ProjectManager.createVirtualHost()` fully regenerates config files on every project start/restart, so any direct file edits would be wiped; the `customNginxDirectives` / `customApacheDirectives` fields on the project object are the only safe persistence mechanism for AI-suggested web server changes
- `getVhostContent()` is read-only — gives AI full context of the active config without risk of the AI modifying it through a different path
- The `# BEGIN / # END DevBox AI Directives` comment markers make AI-injected directives clearly identifiable by developers inspecting the files directly
