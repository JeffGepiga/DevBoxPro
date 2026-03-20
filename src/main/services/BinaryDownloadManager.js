const { app } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { getResourcesPath, getAppCachePath } = require('../utils/PathResolver');
const binaryCatalog = require('./binary/catalog');
const binaryConfig = require('./binary/config');
const binaryDownload = require('./binary/download');
const binaryExtraction = require('./binary/extraction');
const binaryImports = require('./binary/imports');
const binaryInstalled = require('./binary/installed');
const binaryMetadata = require('./binary/metadata');
const binaryPhp = require('./binary/php');
const binaryPlatformServices = require('./binary/platformServices');
const binaryProgress = require('./binary/progress');
const binaryRuntimeTools = require('./binary/runtimeTools');
const binaryServiceDownloads = require('./binary/serviceDownloads');
const { SERVICE_VERSIONS, VERSION_PORT_OFFSETS, DEFAULT_PORTS } = require('../../shared/serviceConfig');

function getBundledBinaryConfigPath() {
  const candidateRoots = [];
  const appPath = typeof app.getAppPath === 'function' ? app.getAppPath() : '';

  if (appPath) {
    candidateRoots.push(appPath);
  }

  candidateRoots.push(path.resolve(__dirname, '../../..'));

  for (const rootPath of candidateRoots) {
    const configPath = path.join(rootPath, 'config', 'binaries.json');
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }

  return path.join(candidateRoots[0] || process.cwd(), 'config', 'binaries.json');
}

function loadBundledBinaryConfigSync() {
  const configPath = getBundledBinaryConfigPath();
  return fs.readJsonSync(configPath);
}

const bundledBinaryConfig = loadBundledBinaryConfigSync();

function cloneConfig(value) {
  return JSON.parse(JSON.stringify(value));
}

function getVersionDefaultPort(serviceName, version) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_PORTS, serviceName)) {
    return null;
  }

  const offset = VERSION_PORT_OFFSETS[serviceName]?.[version] || 0;
  return DEFAULT_PORTS[serviceName] + offset;
}

function buildDefaultDownloads() {
  const downloads = {};

  for (const [serviceName, serviceData] of Object.entries(bundledBinaryConfig)) {
    if (serviceName === 'version' || serviceName === 'lastUpdated') {
      continue;
    }

    const serviceDownloads = cloneConfig(serviceData.downloads || {});
    downloads[serviceName] = serviceDownloads;

    for (const [version, versionData] of Object.entries(serviceDownloads)) {
      const computedPort = getVersionDefaultPort(serviceName, version);
      if (computedPort !== null && versionData.defaultPort == null) {
        versionData.defaultPort = computedPort;
      }
    }
  }

  if (downloads.mailpit?.latest) {
    downloads.mailpit = downloads.mailpit.latest;
  }

  if (downloads.phpmyadmin?.latest?.all) {
    downloads.phpmyadmin = { all: downloads.phpmyadmin.latest.all };
  }

  if (downloads.composer?.latest?.all) {
    downloads.composer = { all: downloads.composer.latest.all };
  }

  if (downloads.apache?.['2.4']?.win) {
    downloads.apache['2.4'].win = {
      ...downloads.apache['2.4'].win,
      url: 'https://www.apachelounge.com/download/VS17/binaries/httpd-2.4.62-240904-win64-VS17.zip',
      filename: 'httpd-2.4.62-240904-win64-VS17.zip',
      fallbackUrls: [
        'https://www.apachelounge.com/download/VS17/binaries/httpd-2.4.61-240703-win64-VS17.zip',
      ],
      manualDownloadUrl: downloads.apache['2.4'].win.downloadPage || 'https://www.apachelounge.com/download/',
      manualDownloadNote: 'If automated download fails, download the Apache Lounge ZIP manually and import it from the Binary Manager.',
    };
  }

  return downloads;
}

function buildVersionMeta() {
  const meta = {};

  for (const [serviceName, versions] of Object.entries(SERVICE_VERSIONS)) {
    meta[serviceName] = [...versions];
  }

  meta.mailpit = ['latest'];
  meta.phpmyadmin = ['latest'];
  meta.composer = ['latest'];
  meta.git = ['portable'];
  meta.mongosh = ['latest'];

  return meta;
}

class BinaryDownloadManager {
  constructor() {
    this.resourcesPath = getResourcesPath(app);
    this.localConfigPath = getAppCachePath(app, 'binaries-config.json');
    this.downloadProgress = new Map();
    this.listeners = new Set();
    this.lastProgressEmit = new Map();
    this.progressThrottleMs = 200;
    this.progressMinDelta = 2;
    this.activeDownloads = new Map();
    this.activeWorkers = new Map();
    this.cancelledDownloads = new Set();
    this.downloads = buildDefaultDownloads();
    this.versionMeta = buildVersionMeta();
    this.configVersion = bundledBinaryConfig.version || 'built-in';
    this.remoteConfig = null;
    this.lastRemoteCheck = null;
    this.managers = null;
  }

  getPlatform() {
    if (process.platform === 'win32') {
      return 'win';
    }

    if (process.platform === 'darwin') {
      return 'mac';
    }

    return 'linux';
  }

  async initialize() {
    const resourceDirs = [
      'php',
      'mysql',
      'mariadb',
      'redis',
      'mailpit',
      'phpmyadmin',
      'nginx',
      'apache',
      'nodejs',
      'composer',
      'git',
      'postgresql',
      'python',
      'mongodb',
      'sqlite',
      'minio',
      'memcached',
      'downloads',
    ];

    await fs.ensureDir(this.resourcesPath);
    for (const dirName of resourceDirs) {
      await fs.ensureDir(path.join(this.resourcesPath, dirName));
    }

    await this.loadBundledConfig();
    await this.loadCachedConfig();

    setImmediate(() => {
      this.enablePhpExtensions().catch((error) => {
        this.managers?.log?.systemWarn('Error enabling PHP extensions', { error: error.message });
      });
    });
  }
}

Object.assign(
  BinaryDownloadManager.prototype,
  binaryCatalog,
  binaryConfig,
  binaryDownload,
  binaryExtraction,
  binaryImports,
  binaryInstalled,
  binaryMetadata,
  binaryPhp,
  binaryPlatformServices,
  binaryProgress,
  binaryRuntimeTools,
  binaryServiceDownloads
);

module.exports = BinaryDownloadManager;
