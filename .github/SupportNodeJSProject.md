# Make DevBoxPro support pure Node.js projects

To support pure Node.js applications as a first-class citizen in DevBoxPro, we will modify the frontend project creation wizard, update the ProjectManager to handle Node.js specific setups, and modify the WebServerManager to use a reverse proxy instead of FastCGI for Node apps.

## User Review Required

Please review the proposed architectural changes. 
> [!NOTE]
> Currently, DevBoxPro treats Node.js as an optional "service" for PHP projects (mainly for `npm install`/`npm run dev` for Laravel Vite). We will elevate it to a standard `projectType` alongside Laravel, Symfony, etc.
> 
> The common binaries needed for a Node project are simply Node.js itself (which bundles npm and npx). DevBoxPro already manages downloading Node.js through the `BinaryDownloadManager`, so no new binary types need to be created.

## Proposed Changes

### Frontend Modifications

#### [MODIFY] src/renderer/src/pages/CreateProject.jsx
- Add `{ id: 'nodejs', name: 'Node.js', description: 'Pure Node.js application (Express, Next.js, etc.)', icon: NodeJsIcon, ... }` to `PROJECT_TYPES`.
- In [hasRequiredBinaries()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/renderer/src/pages/CreateProject.jsx#411-415) and [canProceed()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/renderer/src/pages/CreateProject.jsx#437-456), adjust logic so that if the selected `type` is `nodejs`, we check for `binariesStatus.nodejs.length > 0` instead of `binariesStatus.php.length > 0`.
- In the Details step, if `type` is `nodejs`, show the Node.js version selector instead of PHP. Add input fields for the **Application Port** (e.g., 3000) and **Start Command** (e.g., `npm start` or `npm run dev`).
- Ensure the `nodejs` service is force-enabled in the background when `type === 'nodejs'`.

#### [MODIFY] src/renderer/src/pages/ProjectDetail.jsx
- In the "OverviewTab", if `project.type === 'nodejs'`:
  - Show the Node.js version prominently instead of PHP version.
  - Show the Node.js Application Port.

### Backend Configurations

#### [MODIFY] src/main/services/ProjectManager.js
- In [createProject()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/ProjectManager.js#189-439), skip the PHP installation check if `type === 'nodejs'`.
- Assign a unique internal `nodePort` for the project if one is not provided, so Nginx/Apache knows where to route traffic.
- Generate a `supervisor` process automatically for Node.js projects using the user's provided start command (e.g., `npm start`) with the correct Node.js `PATH` environment variable.

#### [MODIFY] src/main/services/WebServerManager.js
- In [generateNginxConfig()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/WebServerManager.js#133-307), if `project.type === 'nodejs'`, replace the `location ~ \.php$` block and `try_files` with a reverse proxy setup to the project's internal Node port:
  ```nginx
  location / {
      proxy_pass http://127.0.0.1:${project.nodePort};
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection 'upgrade';
      proxy_set_header Host $host;
      proxy_cache_bypass $http_upgrade;
  }
  ```
- Make equivalent updates to [generateApacheConfig()](file:///c:/Users/Jeffrey/Documents/devboxpro/src/main/services/WebServerManager.js#308-434) using `ProxyPass / http://127.0.0.1:${project.nodePort}/` and `ProxyPassReverse`.

## Verification Plan

### Automated Tests
Run playwright E2E tests using `npm run test:e2e` to ensure the project creation wizard still works for PHP projects and tests pass.

### Manual Verification
1. Open DevBoxPro and click "New Project".
2. Select the new "Node.js" project type and configure an empty directory.
3. Observe that it generates the project without demanding PHP.
4. Go to the Project Detail view, and see Node.js stats instead of PHP stats.
5. Manually add a simple `server.js` listening on the chosen `nodePort`, run `node server.js`, and access the `.test` domain locally to see Nginx successfully proxy the request.
