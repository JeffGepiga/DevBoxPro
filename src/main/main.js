const { app, BrowserWindow, ipcMain, Menu, Tray, nativeTheme, dialog } = require('electron');
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
      mainWindow.focus();
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
  // Try logo.png first, then fallback to build/icon.png
  let iconPath = path.join(__dirname, '../../logo.png');
  if (!fs.existsSync(iconPath)) {
    iconPath = path.join(__dirname, '../../build/icon.png');
  }
  
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'DevBox Pro',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    center: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a2e' : '#ffffff',
    show: true,
  });

  // Load the app
  if (isDev) {
    console.log('Loading dev URL: http://localhost:3000');
    await mainWindow.loadURL('http://localhost:3000');
    console.log('Dev URL loaded');
    // Uncomment the line below to open DevTools automatically in dev mode
    // mainWindow.webContents.openDevTools();
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/dist/index.html'));
  }

  // Log renderer console messages
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message}`);
  });

  // Log renderer errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`Failed to load: ${errorDescription} (${errorCode})`);
  });

  mainWindow.once('ready-to-show', () => {
    console.log('Window ready to show');
    mainWindow.show();
  });

  // Show window immediately in dev mode for debugging
  if (isDev) {
    mainWindow.show();
  }

  // Fallback: show window after timeout if ready-to-show doesn't fire
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      console.log('Forcing window to show after timeout');
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
    // Try logo.png first, then fallback to tray-icon.png
    let iconPath = path.join(__dirname, '../../logo.png');
    if (!fs.existsSync(iconPath)) {
      iconPath = path.join(__dirname, '../../build/tray-icon.png');
    }
    
    // Check if tray icon exists, skip tray if not
    if (!fs.existsSync(iconPath)) {
      console.log('Tray icon not found, skipping tray creation');
      return;
    }
    
    tray = new Tray(iconPath);

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
    console.error('Failed to create tray:', error.message);
  }
}

async function initializeManagers() {
  const resourcePath = getResourcePath();
  const configStore = new ConfigStore();

  // Initialize managers in order
  managers.config = configStore;
  managers.log = new LogManager(configStore);
  managers.php = new PhpManager(resourcePath, configStore);
  managers.ssl = new SslManager(resourcePath, configStore);
  managers.database = new DatabaseManager(resourcePath, configStore, managers);
  managers.supervisor = new SupervisorManager(resourcePath, configStore);
  managers.service = new ServiceManager(resourcePath, configStore, managers);
  managers.project = new ProjectManager(configStore, managers);
  managers.binaryDownload = new BinaryDownloadManager();
  managers.webServer = new WebServerManager(configStore, managers);
  managers.cli = new CliManager(configStore, managers);

  // Initialize all managers
  await managers.log.initialize();
  await managers.php.initialize();
  await managers.ssl.initialize();
  await managers.database.initialize();
  await managers.supervisor.initialize();
  await managers.project.initialize();
  await managers.service.initialize();
  await managers.binaryDownload.initialize();
  await managers.webServer.initialize();
  await managers.cli.initialize(resourcePath);

  return managers;
}

async function startup() {
  try {
    console.log('DevBox Pro starting...');

    // Initialize all managers
    await initializeManagers();

    // Create main window
    await createWindow();

    // Create system tray
    createTray();

    // Setup IPC handlers
    setupIpcHandlers(ipcMain, managers, mainWindow);

    // Auto-start services if enabled
    const settings = managers.config.get('settings', {});
    if (settings.autoStartServices) {
      console.log('Auto-starting services...');
      await managers.service.startCoreServices();
    }

    console.log('DevBox Pro started successfully!');
  } catch (error) {
    console.error('Failed to start DevBox Pro:', error);
  }
}

// App event handlers
app.whenReady().then(startup);

app.on('window-all-closed', () => {
  // Don't quit on macOS when all windows are closed
  if (process.platform !== 'darwin') {
    // Keep app running in tray
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
 * Gracefully shutdown all services and projects
 */
async function gracefulShutdown() {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  
  console.log('Shutting down DevBox Pro...');
  
  try {
    // Stop all running projects first
    if (managers.project) {
      console.log('Stopping all projects...');
      await managers.project.stopAllProjects();
    }
    
    // Then stop all services
    if (managers.service) {
      console.log('Stopping all services...');
      await managers.service.stopAllServices();
    }
    
    console.log('DevBox Pro shutdown complete.');
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
}

app.on('before-quit', async (event) => {
  if (!isShuttingDown) {
    event.preventDefault();
    app.isQuitting = true;
    
    await gracefulShutdown();
    
    // Now quit the app
    app.quit();
  }
});

// Handle window close on Windows - ensure cleanup
app.on('window-all-closed', async () => {
  // On macOS, apps typically stay active until explicitly quit
  if (process.platform !== 'darwin') {
    // Windows/Linux: perform cleanup when all windows are closed
    await gracefulShutdown();
    app.quit();
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  managers.log?.error('Uncaught exception', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  managers.log?.error('Unhandled rejection', { reason, promise });
});

module.exports = { managers };
