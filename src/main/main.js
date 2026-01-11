const { app, BrowserWindow, ipcMain, Menu, Tray, nativeTheme, dialog, nativeImage } = require('electron');
const path = require('path');
const { ServiceManager } = require('./services/ServiceManager');
const { ProjectManager } = require('./services/ProjectManager');
const { PhpManager } = require('./services/PhpManager');
const { SslManager } = require('./services/SslManager');
const { SupervisorManager } = require('./services/SupervisorManager');
const { DatabaseManager } = require('./services/DatabaseManager');
const { LogManager } = require('./services/LogManager');
const BinaryDownloadManager = require('./services/BinaryDownloadManager');
const { WebServerManager } = require('./services/WebServerManager');
const CliManager = require('./services/CliManager');
const { GitManager } = require('./services/GitManager');
const { UpdateManager } = require('./services/UpdateManager');
const { ConfigStore } = require('./utils/ConfigStore');
const { setupIpcHandlers } = require('./ipc/handlers');

// Single instance lock - prevent multiple instances of the app
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one
  app.quit();
} else {
  // This is the first instance - set up handler for second instance attempts
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    } else {
      // Window was destroyed, recreate it
      createWindow();
    }
  });
}

// Keep references to prevent garbage collection
let mainWindow = null;
let tray = null;

// Manager instances
const managers = {};

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function getResourcePath() {
  // Always use userData path for resources to match BinaryDownloadManager
  return path.join(app.getPath('userData'), 'resources');
}

async function createWindow() {
  const fs = require('fs');
  // Get icon path that works in both dev and production
  let iconPath;
  if (isDev) {
    iconPath = path.join(__dirname, '../../build/icon.png');
  } else {
    // In production, icon is in the app directory (extraFiles)
    iconPath = path.join(path.dirname(app.getPath('exe')), 'icon.png');
  }

  // Create native image for better Windows support
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'DevBox Pro',
    icon: icon,
    center: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a2e' : '#ffffff',
    show: false,
  });

  // Load the app
  if (isDev) {
    await mainWindow.loadURL('http://localhost:3000');
    // Uncomment to open DevTools in dev mode
    // mainWindow.webContents.openDevTools();
  } else {
    // In production, renderer is at /renderer/index.html in the asar
    const rendererPath = path.join(app.getAppPath(), 'renderer', 'index.html');
    await mainWindow.loadFile(rendererPath);
  }

  // Update managers with new window reference
  if (managers.supervisor) managers.supervisor.setMainWindow(mainWindow);
  if (managers.update) managers.update.setMainWindow(mainWindow);

  // Log renderer errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    managers.log?.systemError(`Failed to load: ${errorDescription} (${errorCode})`);
  });

  // Disable browser shortcuts that don't make sense for a desktop app
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Block Ctrl/Cmd+R (reload), Ctrl/Cmd+Shift+R (hard reload)
    if ((input.control || input.meta) && input.key.toLowerCase() === 'r') {
      event.preventDefault();
    }
    // Block Ctrl/Cmd+Shift+I in production (DevTools) - allow in dev
    if (!isDev && (input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault();
    }
    // Block Ctrl/Cmd+U (view source)
    if ((input.control || input.meta) && input.key.toLowerCase() === 'u') {
      event.preventDefault();
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Show window immediately in dev mode for debugging
  if (isDev) {
    mainWindow.show();
  }

  // Fallback: show window after timeout if ready-to-show doesn't fire
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 3000);

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function createTray() {
  try {
    const fs = require('fs');
    let iconPath;

    // Try multiple possible icon locations
    const possiblePaths = [];
    const isWindows = process.platform === 'win32';

    // On Windows, prefer .ico format for tray
    const iconFile = isWindows ? 'icon.ico' : 'icon.png';
    const fallbackFile = 'icon.png';

    if (isDev) {
      possiblePaths.push(path.join(__dirname, '../../build', iconFile));
      possiblePaths.push(path.join(__dirname, '../../build', fallbackFile));
      possiblePaths.push(path.join(__dirname, '../../logo.ico'));
      possiblePaths.push(path.join(__dirname, '../../resources/icons', iconFile));
    } else {
      // In production, try several locations
      possiblePaths.push(path.join(path.dirname(app.getPath('exe')), iconFile));
      possiblePaths.push(path.join(path.dirname(app.getPath('exe')), fallbackFile));
      possiblePaths.push(path.join(process.resourcesPath, iconFile));
      possiblePaths.push(path.join(process.resourcesPath, fallbackFile));
      possiblePaths.push(path.join(app.getAppPath(), '..', iconFile));
      possiblePaths.push(path.join(app.getAppPath(), '..', fallbackFile));
    }

    // Find first existing icon
    iconPath = possiblePaths.find(p => fs.existsSync(p));

    // Check if tray icon exists, skip tray if not
    if (!iconPath) {
      return;
    }

    // Create native image for better Windows support - resize for tray
    let icon = nativeImage.createFromPath(iconPath);

    // Check if icon loaded successfully
    if (icon.isEmpty()) {
      return;
    }

    // Resize icon to appropriate tray size (16x16 on Windows, can be larger on macOS)
    const traySize = isWindows ? 16 : 22;
    icon = icon.resize({ width: traySize, height: traySize });

    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open DevBox Pro',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Start All Services',
        click: () => managers.service?.startAllServices(),
      },
      {
        label: 'Stop All Services',
        click: () => managers.service?.stopAllServices(),
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]);

    tray.setToolTip('DevBox Pro');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
      }
    });
  } catch (error) {
    managers.log?.systemError('Failed to create tray', { error: error.message });
  }
}

async function initializeManagers() {
  const startTime = Date.now();

  const resourcePath = getResourcePath();
  const configStore = new ConfigStore();

  // Initialize managers - create instances first (fast)
  managers.config = configStore;
  managers.log = new LogManager(configStore);
  managers.php = new PhpManager(resourcePath, configStore, managers);
  managers.ssl = new SslManager(resourcePath, configStore, managers);
  managers.database = new DatabaseManager(resourcePath, configStore, managers);
  managers.supervisor = new SupervisorManager(resourcePath, configStore, managers);
  managers.service = new ServiceManager(resourcePath, configStore, managers);
  managers.project = new ProjectManager(configStore, managers);
  managers.binaryDownload = new BinaryDownloadManager();
  managers.webServer = new WebServerManager(configStore, managers);
  managers.cli = new CliManager(configStore, managers);
  managers.git = new GitManager(configStore, managers);
  managers.update = new UpdateManager(managers);

  // Critical initializations (must complete before UI)
  await Promise.all([
    managers.log.initialize(),
    managers.ssl.initialize(),
  ]);

  return managers;
}

// Non-critical initializations that can happen after window is shown
async function initializeManagersDeferred() {
  const startTime = Date.now();
  const resourcePath = getResourcePath();

  try {
    // These can run in parallel
    await Promise.all([
      managers.php.initialize(),
      managers.database.initialize(),
      managers.supervisor.initialize(),
      managers.project.initialize(),
      managers.service.initialize(),
      managers.webServer.initialize(),
    ]);

    // These depend on others or are slower
    await managers.binaryDownload.initialize();
    await managers.cli.initialize(resourcePath);
    await managers.git.initialize();
  } catch (error) {
    managers.log?.systemError('Error in deferred initialization', { error: error.message });
  }
}

async function startup() {
  try {
    const startTime = Date.now();

    // Initialize critical managers only (fast)
    await initializeManagers();

    // Create main window immediately so user sees the app
    await createWindow();

    // Create system tray
    createTray();

    // Setup IPC handlers
    setupIpcHandlers(ipcMain, managers, mainWindow);

    // Set mainWindow on supervisor for real-time output events
    managers.supervisor.setMainWindow(mainWindow);

    // Set mainWindow on update manager for update progress events
    managers.update.setMainWindow(mainWindow);

    // Initialize remaining managers in background (don't block UI)
    initializeManagersDeferred().then(() => {
      // Auto-start services if enabled (after deferred init)
      const settings = managers.config.get('settings', {});
      if (settings.autoStartServices) {
        managers.service.startCoreServices().catch(err => {
          managers.log?.systemError('Error auto-starting services', { error: err.message });
        });
      }
    });

    // Auto-start projects that have autoStart enabled
    try {
      const projects = managers.project.getAllProjects();
      const autoStartProjects = projects.filter(p => p.autoStart);
      if (autoStartProjects.length > 0) {
        for (const project of autoStartProjects) {
          try {
            // Notify frontend that this project is starting (for loading state)
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('project:autoStarting', {
                projectId: project.id,
                projectName: project.name
              });
            }

            await managers.project.startProject(project.id);

            // Notify frontend that project started successfully
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('project:autoStarted', {
                projectId: project.id,
                success: true
              });
            }
          } catch (err) {
            managers.log?.systemError(`Failed to auto-start project ${project.name}`, { error: err.message });
            // Notify frontend about failure
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('project:autoStarted', {
                projectId: project.id,
                success: false,
                error: err.message
              });
            }
          }
        }
      }
    } catch (err) {
      managers.log?.systemError('Error auto-starting projects', { error: err.message });
    }
  } catch (error) {
  }
}

// App event handlers
app.whenReady().then(startup);

app.on('window-all-closed', async () => {
  // Don't quit when window is closed - keep app running in tray
  // The app will only quit when user clicks "Quit" from tray or we set app.isQuitting = true
  if (process.platform === 'darwin') {
    // On macOS, apps typically stay active until explicitly quit
    return;
  }

  // On Windows/Linux, only quit if user explicitly requested it
  if (app.isQuitting) {
    await gracefulShutdown();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow) {
    mainWindow.show();
  }
});

// Track if we're already shutting down to prevent multiple cleanup attempts
let isShuttingDown = false;

/**
 * Force kill all DevBox processes on Windows
 */
async function forceKillAllProcesses() {
  if (process.platform !== 'win32') return;

  const { killProcessByName, killProcessesByPath } = require('./utils/SpawnUtils');

  // Processes that are safe to kill globally (DevBox-specific)
  const processesToKill = [
    'php-cgi.exe',
    'nginx.exe',
    'httpd.exe',
    'mysqld.exe',
    'mariadbd.exe',
    'redis-server.exe',
    'mailpit.exe',
  ];

  for (const processName of processesToKill) {
    try {
      await killProcessByName(processName, true);
    } catch (e) {
      // Ignore - process might not be running
    }
  }

  // Kill PHP and Node processes running from our resources path only
  const userDataPath = app.getPath('userData');

  try {
    await killProcessesByPath('php.exe', userDataPath);
  } catch (e) {
    // Ignore
  }

  try {
    await killProcessesByPath('node.exe', userDataPath);
  } catch (e) {
    // Ignore
  }
}

/**
 * Gracefully shutdown all services and projects
 */
async function gracefulShutdown() {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  try {
    // Stop all running projects first
    if (managers.project) {
      await managers.project.stopAllProjects();
    }

    // Then stop all services
    if (managers.service) {
      await managers.service.stopAllServices();
    }

    // Final force kill to ensure no orphan processes remain
    await forceKillAllProcesses();
  } catch (error) {
    managers.log?.systemError('Error during shutdown', { error: error.message });
    // Even if there's an error, still try to force kill
    await forceKillAllProcesses();
  }
}

app.on('before-quit', async (event) => {
  // Already shutting down, don't prevent - let it quit
  if (isShuttingDown) {
    return;
  }

  // First time - prevent quit, do graceful shutdown, then quit again
  event.preventDefault();
  app.isQuitting = true;

  await gracefulShutdown();

  // Now quit the app - isShuttingDown is true so this will go through
  app.quit();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  managers.log?.systemError('Uncaught exception', { error: error.message, stack: error.stack });
});

process.on('unhandledRejection', (reason, promise) => {
  managers.log?.systemError('Unhandled rejection', { reason: String(reason) });
});

module.exports = { managers };
