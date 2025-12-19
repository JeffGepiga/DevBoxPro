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
  
  console.log('Window icon path:', iconPath, 'exists:', fs.existsSync(iconPath));
  
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
    console.log('Loading dev URL: http://localhost:3000');
    await mainWindow.loadURL('http://localhost:3000');
    console.log('Dev URL loaded');
    // Uncomment the line below to open DevTools automatically in dev mode
    // mainWindow.webContents.openDevTools();
  } else {
    // In production, renderer is at /renderer/index.html in the asar
    const rendererPath = path.join(app.getAppPath(), 'renderer', 'index.html');
    console.log('Loading renderer from:', rendererPath);
    await mainWindow.loadFile(rendererPath);
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
    let iconPath;
    
    if (isDev) {
      iconPath = path.join(__dirname, '../../build/icon.png');
    } else {
      // In production, icon is in the app directory (extraFiles)
      iconPath = path.join(path.dirname(app.getPath('exe')), 'icon.png');
    }
    
    console.log('Tray icon path:', iconPath, 'exists:', fs.existsSync(iconPath));
    
    // Check if tray icon exists, skip tray if not
    if (!fs.existsSync(iconPath)) {
      console.log('Tray icon not found at:', iconPath);
      return;
    }
    
    // Create native image for better Windows support - resize for tray
    let icon = nativeImage.createFromPath(iconPath);
    // Resize icon to appropriate tray size (16x16 on Windows)
    icon = icon.resize({ width: 16, height: 16 });
    
    console.log('Creating tray with icon, isEmpty:', icon.isEmpty());
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

    // Auto-start projects that have autoStart enabled
    try {
      const projects = managers.project.getAllProjects();
      const autoStartProjects = projects.filter(p => p.autoStart);
      if (autoStartProjects.length > 0) {
        console.log(`Auto-starting ${autoStartProjects.length} project(s)...`);
        for (const project of autoStartProjects) {
          try {
            console.log(`Auto-starting project: ${project.name}`);
            await managers.project.startProject(project.id);
          } catch (err) {
            console.error(`Failed to auto-start project ${project.name}:`, err.message);
          }
        }
      }
    } catch (err) {
      console.error('Error auto-starting projects:', err);
    }

    console.log('DevBox Pro started successfully!');
  } catch (error) {
    console.error('Failed to start DevBox Pro:', error);
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
