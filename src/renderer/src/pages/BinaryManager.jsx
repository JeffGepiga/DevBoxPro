import React, { useState, useEffect, useCallback } from 'react';
import {
  Download,
  Check,
  X,
  RefreshCw,
  Trash2,
  HardDrive,
  Server,
  Database,
  Mail,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Globe,
  Zap,
  FolderOpen,
  FileText,
  Settings,
  Upload,
  ChevronDown,
  ChevronUp,
  CloudCog,
} from 'lucide-react';
import clsx from 'clsx';
import PhpIniEditor from '../components/PhpIniEditor';
import { useApp } from '../context/AppContext';
import { useModal } from '../context/ModalContext';

// ── Module-level sub-components (must NOT be defined inside BinaryManager) ──

const VersionRow = ({ id, name, version, isInstalled, isDownloading, size, isLatest, isCustom, requiresManual, onDownload, onRemove, onManualOpen, onImport, isPhp, getProgressDisplay, setPhpIniEditor }) => (
  <div className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/40 border-b last:border-b-0 border-gray-100 dark:border-gray-700/50">
    <div className="flex items-center gap-2.5 min-w-0">
      <span className={clsx(
        'shrink-0 px-2 py-0.5 rounded font-mono text-xs font-semibold',
        isInstalled
          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
      )}>
        {version}
      </span>
      <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{name} {version}</span>
      {isCustom && <span className="shrink-0 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-1.5 py-0.5 rounded">Custom</span>}
      {!isCustom && isLatest && <span className="shrink-0 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">Latest</span>}
      {size && <span className="shrink-0 text-xs text-gray-400">{size}</span>}
    </div>
    <div className="flex items-center gap-1.5 ml-3 shrink-0">
      {isDownloading ? (
        getProgressDisplay(id)
      ) : isInstalled ? (
        <>
          <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
            <Check className="w-3 h-3" /> Installed
          </span>
          {isPhp && (
            <button onClick={() => setPhpIniEditor({ open: true, version })} className="btn-icon text-gray-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20" title="Edit php.ini">
              <Settings className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={onRemove} className="btn-icon text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" title="Remove">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </>
      ) : requiresManual ? (
        <>
          <button onClick={onManualOpen} className="btn-secondary text-xs px-2 py-1 flex items-center gap-1" title="Open download page">
            <ExternalLink className="w-3 h-3" /> Get
          </button>
          <button onClick={onImport} className="btn-primary text-xs px-2 py-1 flex items-center gap-1" title="Import ZIP">
            <Upload className="w-3 h-3" /> Import
          </button>
        </>
      ) : (
        <div className="flex items-center gap-1">
          <button onClick={onDownload} className="btn-primary text-xs px-2.5 py-1 flex items-center gap-1">
            <Download className="w-3 h-3" /> Download
          </button>
        </div>
      )}
    </div>
  </div>
);

const ServiceCard = ({ service, onDownload, onRemove, onImport, onManualOpen, isPhp, isNodejs, installed, downloading, expandedSections, toggleSection, downloadSources, getProgressDisplay, setPhpIniEditor, handleImportApache, getInstalledVersionsCount }) => {
  const installedCount = getInstalledVersionsCount(service.id);
  const hasInstalled = installedCount > 0;
  const isExpanded = expandedSections[service.id];
  const hasSource = !!downloadSources[service.id]?.url;
  const hasImport = !service.noImport;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-800/50">
      {/* Card header — click to expand */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60 select-none"
        onClick={() => toggleSection(service.id)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={clsx(
            'w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-sm font-bold',
            hasInstalled
              ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
          )}>
            {service.emoji ? service.emoji : <service.icon className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm text-gray-900 dark:text-white">{service.name}</span>
              {hasInstalled && (
                <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded-full">
                  {installedCount} installed
                </span>
              )}
              {/* Show version pills inline when collapsed */}
              {!isExpanded && service.versions && (
                <div className="flex gap-1 flex-wrap">
                  {service.versions.slice(0, 6).map(v => {
                    const inst = installed[service.id]?.[v];
                    return inst ? (
                      <span key={v} className="text-xs bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded border border-green-200 dark:border-green-800">{v}</span>
                    ) : null;
                  })}
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{service.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 ml-2 shrink-0" onClick={e => e.stopPropagation()}>
          {hasSource && (
            <button onClick={() => window.devbox?.system.openExternal(downloadSources[service.id]?.url)} className="btn-icon text-gray-400 hover:text-gray-600" title={downloadSources[service.id]?.note}>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
          {hasImport && (
            <button onClick={() => onImport(service.id)} className="btn-secondary text-xs px-2 py-1 flex items-center gap-1" title={`Import ${service.name} from a local ZIP file`}>
              <Upload className="w-3 h-3" /> Import ZIP
            </button>
          )}
          {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400 ml-1" /> : <ChevronDown className="w-4 h-4 text-gray-400 ml-1" />}
        </div>
      </div>

      {/* Version rows */}
      {isExpanded && (
        <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30">
          {(service.versions || []).map((version) => {
            const id = `${service.id}-${version}`;
            const isInstalled = installed[service.id]?.[version];
            const isDownloading = downloading[id];
            const isCustom = service.predefinedVersions && !service.predefinedVersions.includes(version);

            return (
              <VersionRow
                key={version}
                id={id}
                name={service.name}
                version={version}
                isInstalled={isInstalled}
                isDownloading={isDownloading}
                size={service.sizes?.[version]}
                isLatest={!isCustom && version === service.defaultVersion}
                isCustom={isCustom}
                requiresManual={service.requiresManualDownload}
                onDownload={() => onDownload(service.id, version)}
                onRemove={() => onRemove(service.id, version)}
                onManualOpen={() => onManualOpen?.(service.id, version)}
                onImport={() => handleImportApache(version)}
                isPhp={isPhp}
                getProgressDisplay={getProgressDisplay}
                setPhpIniEditor={setPhpIniEditor}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

const SimpleRow = ({ id, name, description, icon: Icon, emoji, isInstalled: inst, size, onDownload, onRemove, onImport, sourceKey, importLabel, downloading, downloadSources, getProgressDisplay }) => {
  const isDownloading = downloading[id];
  const hasSource = !!downloadSources[sourceKey]?.url;

  return (
    <div className="flex items-center justify-between px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800/50">
      <div className="flex items-center gap-3 min-w-0">
        <div className={clsx(
          'w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-sm font-bold',
          inst
            ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
            : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
        )}>
          {emoji ? emoji : <Icon className="w-4 h-4" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-white">{name}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{description}{size ? ` · ${size}` : ''}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 ml-3 shrink-0">
        {isDownloading ? getProgressDisplay(id) : inst ? (
          <>
            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium"><Check className="w-3 h-3" /> Installed</span>
            <button onClick={onRemove} className="btn-icon text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
          </>
        ) : (
          <>
            {hasSource && <button onClick={() => window.devbox?.system.openExternal(downloadSources[sourceKey]?.url)} className="btn-icon text-gray-400 hover:text-gray-600" title={downloadSources[sourceKey]?.note}><ExternalLink className="w-3.5 h-3.5" /></button>}
            {onImport && <button onClick={onImport} className="btn-secondary text-xs px-2 py-1 flex items-center gap-1" title={`Import ${name}`}><Upload className="w-3 h-3" />{importLabel || 'Import'}</button>}
            {onDownload && <button onClick={onDownload} className="btn-primary text-xs px-2.5 py-1 flex items-center gap-1"><Download className="w-3 h-3" /> Download</button>}
          </>
        )}
      </div>
    </div>
  );
};

function BinaryManager() {
  // Use global state for download progress (persists across navigation)
  const {
    downloadProgress: progress,
    downloading,
    setDownloading: setDownloadingGlobal,
    setDownloadProgress: setProgressGlobal,
    clearDownload,
  } = useApp();
  const { showAlert, showConfirm } = useModal();

  const [installed, setInstalled] = useState({
    php: {},
    mysql: {},
    mariadb: {},
    redis: {},
    mailpit: false,
    phpmyadmin: false,
    nginx: {},
    apache: {},
    nodejs: {},
    composer: false,
    postgresql: {},
    python: {},
    mongodb: {},
    sqlite: false,
    minio: false,
    memcached: {},
  });
  const [downloadUrls, setDownloadUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [phpIniEditor, setPhpIniEditor] = useState({ open: false, version: null });
  const [expandedSections, setExpandedSections] = useState({
    php: false,
    mysql: false,
    mariadb: false,
    redis: false,
    nginx: false,
    apache: false,
    nodejs: false,
    postgresql: false,
    python: false,
    mongodb: false,
    memcached: false,
  });

  // Service versions from backend config (with defaults)
  const [serviceVersions, setServiceVersions] = useState({
    php: ['8.5', '8.4', '8.3', '8.2', '8.1', '8.0', '7.4'],
    mysql: ['8.4', '8.0'],
    mariadb: ['11.4', '10.11', '10.6'],
    redis: ['7.4', '7.2'],
    nginx: ['1.28', '1.26'],
    apache: ['2.4'],
    nodejs: ['24', '22', '20', '18'],
    postgresql: ['17', '16', '15', '14'],
    python: ['3.13', '3.12', '3.11', '3.10'],
    mongodb: ['8.0', '7.0', '6.0'],
    memcached: ['1.6', '1.5'],
  });

  // Helper to merge predefined versions with any custom installed versions
  const getMergedVersions = useCallback((service) => {
    const predefined = serviceVersions[service] || [];
    const installedVersions = installed[service];

    if (!installedVersions || typeof installedVersions !== 'object') {
      return predefined;
    }

    // Get all installed version keys
    const installedKeys = Object.keys(installedVersions).filter(v => installedVersions[v]);

    // Merge: predefined first, then any custom versions not in predefined
    const customVersions = installedKeys.filter(v => !predefined.includes(v));

    // Sort custom versions in descending order
    customVersions.sort((a, b) => {
      const aNum = parseFloat(a) || 0;
      const bNum = parseFloat(b) || 0;
      return bNum - aNum;
    });

    // Insert custom versions at the beginning (they're likely newer)
    return [...customVersions, ...predefined];
  }, [serviceVersions, installed]);

  // Check for updates state
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateResult, setUpdateResult] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  // Import modal state
  const [importModal, setImportModal] = useState({
    open: false,
    service: null,
    filePath: null,
    fileName: null,
    detectedVersion: null,
    customVersion: '',
    availableVersions: [],
  });

  const loadInstalled = useCallback(async () => {
    try {
      const result = await window.devbox?.binaries.getInstalled();
      if (result) {
        setInstalled(result);
      }
    } catch (error) {
      // Error loading installed binaries
    }
  }, []);

  const loadDownloadUrls = useCallback(async () => {
    try {
      const urls = await window.devbox?.binaries.getDownloadUrls();
      if (urls) {
        setDownloadUrls(urls);
      }
    } catch (error) {
      // Error loading download URLs
    }
  }, []);

  const loadServiceConfig = useCallback(async () => {
    try {
      const config = await window.devbox?.binaries.getServiceConfig();
      if (config?.versions) {
        setServiceVersions(config.versions);
      }
    } catch (error) {
      // Error loading service config
    }
  }, []);

  // Force refresh installed binaries (always re-check from disk)
  const forceRefreshInstalled = useCallback(async () => {
    try {
      // This calls getInstalledBinaries which checks if files exist on disk
      const result = await window.devbox?.binaries.getInstalled();
      if (result) {
        setInstalled(result);
      }
      return result;
    } catch (error) {
      // Error refreshing installed binaries
      return null;
    }
  }, []);

  // Clean up stale downloads when installed state changes
  // This handles cases where the 'completed' event was missed
  useEffect(() => {
    if (Object.keys(downloading).length === 0) return;

    // Check each downloading item against installed binaries
    Object.entries(downloading).forEach(([id, isDownloading]) => {
      if (!isDownloading) return;

      const [type, version] = id.split('-');
      let isInstalled = false;

      if (version) {
        // Versioned binary (e.g., php-8.4, nodejs-20)
        isInstalled = installed[type]?.[version] === true;
      } else {
        // Non-versioned binary (e.g., composer, mailpit)
        isInstalled = installed[type] === true;
      }

      // If binary is installed but still showing as downloading, clear it
      if (isInstalled) {
        // Clearing stale download - already installed
        clearDownload(id);
      }
    });
  }, [installed, downloading, clearDownload]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);

      // Always force refresh installed binaries when Binary tab is visited
      // This ensures we detect if user manually deleted binaries
      await forceRefreshInstalled();

      try {
        await loadDownloadUrls();
      } catch (error) {
        // Error loading download URLs
      }

      try {
        await loadServiceConfig();
      } catch (error) {
        // Error loading service config
      }

      setLoading(false);
    };
    init();

    // Download progress is now handled by AppContext - just refresh installed list on complete, and alert on error
    const unsubscribe = window.devbox?.binaries.onProgress((id, progressData) => {
      if (progressData.status === 'completed') {
        forceRefreshInstalled();
      } else if (progressData.status === 'error') {
        const label = id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        showAlert({
          title: 'Download Failed',
          message: `Failed to download ${label}`,
          detail: progressData.error || 'An unknown error occurred. Please check your internet connection and try again.',
          type: 'error',
        });
      }
    });

    return () => unsubscribe?.();
  }, [forceRefreshInstalled, loadDownloadUrls, loadServiceConfig]); // showAlert is intentionally omitted — it's a stable context function

  const handleDownloadPhp = async (version) => {
    const id = `php-${version}`;

    // Don't start if already downloading
    if (downloading[id]) return;

    setDownloadingGlobal(id, true);
    setProgressGlobal(id, { status: 'starting', progress: 0 });

    // Fire and forget - don't await, let progress events handle updates
    window.devbox?.binaries.downloadPhp(version).catch((error) => {
      // Error downloading PHP
      setProgressGlobal(id, { status: 'error', error: error.message });
      setDownloadingGlobal(id, false);
    });
  };

  const handleDownloadService = async (service, version = null) => {
    const id = version ? `${service}-${version}` : service;

    // Don't start if already downloading
    if (downloading[id]) return;

    setDownloadingGlobal(id, true);
    setProgressGlobal(id, { status: 'starting', progress: 0 });

    // Fire and forget - don't await, let progress events handle updates
    let downloadPromise;
    switch (service) {
      case 'mysql':
        downloadPromise = window.devbox?.binaries.downloadMysql(version);
        break;
      case 'mariadb':
        downloadPromise = window.devbox?.binaries.downloadMariadb(version);
        break;
      case 'redis':
        downloadPromise = window.devbox?.binaries.downloadRedis(version);
        break;
      case 'mailpit':
        downloadPromise = window.devbox?.binaries.downloadMailpit();
        break;
      case 'phpmyadmin':
        downloadPromise = window.devbox?.binaries.downloadPhpMyAdmin();
        break;
      case 'nginx':
        downloadPromise = window.devbox?.binaries.downloadNginx(version);
        break;
      case 'apache':
        downloadPromise = window.devbox?.binaries.downloadApache(version);
        break;
      case 'composer':
        downloadPromise = window.devbox?.binaries.downloadComposer();
        break;
      case 'postgresql':
        downloadPromise = window.devbox?.binaries.downloadPostgresql(version);
        break;
      case 'python':
        downloadPromise = window.devbox?.binaries.downloadPython(version);
        break;
      case 'mongodb':
        downloadPromise = window.devbox?.binaries.downloadMongodb(version);
        break;
      case 'sqlite':
        downloadPromise = window.devbox?.binaries.downloadSqlite(version);
        break;
      case 'minio':
        downloadPromise = window.devbox?.binaries.downloadMinio();
        break;
      case 'memcached':
        downloadPromise = window.devbox?.binaries.downloadMemcached(version);
        break;
    }

    downloadPromise?.catch((error) => {
      // Error downloading service
      setProgressGlobal(id, { status: 'error', error: error.message });
      setDownloadingGlobal(id, false);
    });
  };

  const toggleSection = (section) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Cancel an active download
  const handleCancelDownload = async (id) => {
    try {
      await window.devbox?.binaries.cancelDownload(id);
      clearDownload(id);
    } catch (error) {
      // Error cancelling download
    }
  };

  // Check for binary updates from GitHub
  const handleCheckForUpdates = async () => {
    setCheckingUpdates(true);
    setUpdateResult(null);

    try {
      const result = await window.devbox?.binaries.checkForUpdates();
      setUpdateResult(result);

      if (result?.success) {
        setShowUpdateModal(true);
      }
    } catch (error) {
      // Error checking for updates
      setUpdateResult({ success: false, error: error.message });
    } finally {
      setCheckingUpdates(false);
    }
  };

  // Apply updates from remote config
  const handleApplyUpdates = async () => {
    try {
      const result = await window.devbox?.binaries.applyUpdates();
      if (result?.success) {
        // Reload download URLs and service config
        await Promise.all([loadDownloadUrls(), loadServiceConfig()]);
        setShowUpdateModal(false);
        setUpdateResult(null);
      }
    } catch (error) {
      // Error applying updates
    }
  };

  const handleOpenApacheDownloadPage = async () => {
    try {
      await window.devbox?.binaries.openApacheDownloadPage();
    } catch (error) {
      // Error opening Apache download page
    }
  };

  // Download source URLs for manual download
  const downloadSources = {
    php: {
      url: 'https://windows.php.net/download/',
      name: 'windows.php.net',
      note: 'Download the "Non Thread Safe" (NTS) x64 ZIP version',
    },
    mysql: {
      url: 'https://dev.mysql.com/downloads/mysql/',
      name: 'dev.mysql.com',
      note: 'Download the ZIP Archive (not MSI installer)',
    },
    mariadb: {
      url: 'https://mariadb.org/download/',
      name: 'mariadb.org',
      note: 'Download the ZIP package for Windows',
    },
    redis: {
      url: 'https://github.com/redis-windows/redis-windows/releases',
      name: 'GitHub (redis-windows)',
      note: 'Download the Windows x64 ZIP release',
    },
    nginx: {
      url: 'https://nginx.org/en/download.html',
      name: 'nginx.org',
      note: 'Download the Windows ZIP package',
    },
    apache: {
      url: 'https://www.apachelounge.com/download/',
      name: 'Apache Lounge',
      note: 'Download the Win64 ZIP (VS17 recommended)',
    },
    nodejs: {
      url: 'https://nodejs.org/en/download/',
      name: 'nodejs.org',
      note: 'Download the Windows Binary (.zip) x64 version',
    },
    mailpit: {
      url: 'https://github.com/axllent/mailpit/releases',
      name: 'GitHub (axllent/mailpit)',
      note: 'Download mailpit-windows-amd64.zip',
    },
    phpmyadmin: {
      url: 'https://www.phpmyadmin.net/downloads/',
      name: 'phpmyadmin.net',
      note: 'Download the "all-languages" ZIP file',
    },
    composer: {
      url: 'https://getcomposer.org/download/',
      name: 'getcomposer.org',
      note: 'Download composer.phar file',
    },
  };

  // Version detection patterns for different services
  const versionPatterns = {
    php: /php-?(\d+\.\d+)(?:\.\d+)?/i,
    mysql: /mysql-?(\d+\.\d+)(?:\.\d+)?/i,
    mariadb: /mariadb-?(\d+\.\d+)(?:\.\d+)?/i,
    redis: /redis-?(\d+\.\d+)(?:\.\d+)?/i,
    nginx: /nginx-?(\d+\.\d+)(?:\.\d+)?/i,
    apache: /(?:httpd|apache)-?(\d+\.\d+)(?:\.\d+)?/i,
    nodejs: /node-?v?(\d+)(?:\.\d+)?/i,
  };

  // Detect version from filename
  const detectVersionFromFilename = (service, filename) => {
    const pattern = versionPatterns[service];
    if (!pattern) return null;

    const match = filename.match(pattern);
    if (match) {
      // For Node.js, we only want major version (22, 20, 18, etc.)
      if (service === 'nodejs') {
        return match[1];
      }
      // For others, return major.minor (8.4, 1.28, etc.)
      return match[1];
    }
    return null;
  };

  // Generic import handler - opens file picker and detects/prompts for version
  const handleImportBinary = async (service, acceptedExtensions = '.zip,.tar.gz') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = acceptedExtensions;
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const filePath = file.path;
      if (!filePath) {
        showAlert({ title: 'Error', message: 'Could not get file path. Please try again.', type: 'error' });
        return;
      }

      const fileName = file.name;
      const detectedVersion = detectVersionFromFilename(service, fileName);

      // Get available versions for this service
      const availableVersions = serviceVersions[service] || [];

      // If version detected and matches available versions, import directly
      if (detectedVersion && availableVersions.includes(detectedVersion)) {
        await executeImport(service, detectedVersion, filePath);
      } else if (detectedVersion) {
        // Version detected but not in predefined list - ask user to confirm or use custom
        setImportModal({
          open: true,
          service,
          filePath,
          fileName,
          detectedVersion,
          customVersion: detectedVersion,
          availableVersions,
        });
      } else {
        // No version detected - prompt user
        setImportModal({
          open: true,
          service,
          filePath,
          fileName,
          detectedVersion: null,
          customVersion: '',
          availableVersions,
        });
      }
    };
    input.click();
  };

  // Execute the actual import
  const executeImport = async (service, version, filePath) => {
    const id = version ? `${service}-${version}` : service;
    setDownloadingGlobal(id, true);
    setProgressGlobal(id, { status: 'starting', progress: 0 });

    try {
      await window.devbox?.binaries.importBinary(service, version || 'default', filePath);
    } catch (error) {
      // Error importing service
      setProgressGlobal(id, { status: 'error', error: error.message });
      setDownloadingGlobal(id, false);
    }
  };

  // Handle import modal confirmation
  const handleConfirmImport = async () => {
    const { service, filePath, customVersion } = importModal;
    if (!customVersion.trim()) {
      await showAlert({ title: 'Validation Error', message: 'Please enter or select a version.', type: 'warning' });
      return;
    }
    setImportModal({ ...importModal, open: false });
    await executeImport(service, customVersion.trim(), filePath);
  };

  // Simple import for non-versioned services (Mailpit, phpMyAdmin, Composer)
  const handleImportSimple = async (service, acceptedExtensions = '.zip,.tar.gz') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = acceptedExtensions;
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const filePath = file.path;
      if (!filePath) {
        showAlert({ title: 'Error', message: 'Could not get file path. Please try again.', type: 'error' });
        return;
      }

      await executeImport(service, null, filePath);
    };
    input.click();
  };

  const handleImportApache = async (version = '2.4') => {
    // Use file input to select a file
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const id = `apache-${version}`;
      setDownloadingGlobal(id, true);
      setProgressGlobal(id, { status: 'starting', progress: 0 });

      try {
        // Get the file path - we need to use the path property
        const filePath = file.path;
        if (!filePath) {
          throw new Error('Could not get file path. Please try again.');
        }
        await window.devbox?.binaries.importApache(filePath, version);
      } catch (error) {
        // Error importing Apache
        setProgressGlobal(id, { status: 'error', error: error.message });
        setDownloadingGlobal(id, false);
      }
    };
    input.click();
  };

  const handleDownloadNodejs = async (version) => {
    const id = `nodejs-${version}`;

    // Don't start if already downloading
    if (downloading[id]) return;

    setDownloadingGlobal(id, true);
    setProgressGlobal(id, { status: 'starting', progress: 0 });

    // Fire and forget - don't await, let progress events handle updates
    window.devbox?.binaries.downloadNodejs(version).catch((error) => {
      // Error downloading Node.js
      setProgressGlobal(id, { status: 'error', error: error.message });
      setDownloadingGlobal(id, false);
    });
  };

  const handleRemove = async (type, version = null) => {
    const confirmMsg = version
      ? `Remove ${type} ${version}?`
      : `Remove ${type}?`;

    const confirmed = await showConfirm({
      title: 'Remove Binary',
      message: confirmMsg,
      detail: "You'll need to re-download it to use it again.",
      confirmText: 'Remove',
      confirmStyle: 'danger',
      type: 'warning'
    });
    if (!confirmed) return;

    try {
      await window.devbox?.binaries.remove(type, version);
      await loadInstalled();
    } catch (error) {
      // Error removing binary
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const getProgressDisplay = (id) => {
    const p = progress[id];
    if (!p) return null;

    const cancelButton = (
      <button
        onClick={() => handleCancelDownload(id)}
        className="ml-2 p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
        title="Cancel download"
      >
        <X className="w-4 h-4" />
      </button>
    );

    switch (p.status) {
      case 'starting':
        return (
          <span className="text-blue-600 dark:text-blue-400 flex items-center gap-1">
            <Loader2 className="w-4 h-4 animate-spin" />
            Starting...
            {cancelButton}
          </span>
        );
      case 'downloading':
        return (
          <div className="flex items-center gap-2">
            <div className="w-32 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${p.progress}%` }}
              />
            </div>
            <span className="text-sm text-gray-500">
              {p.progress}% {p.total > 0 && `(${formatBytes(p.downloaded)}/${formatBytes(p.total)})`}
            </span>
            {cancelButton}
          </div>
        );
      case 'extracting':
        return (
          <span className="text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
            <Loader2 className="w-4 h-4 animate-spin" />
            Extracting... {p.progress > 0 && `(${p.progress}%)`}
            {cancelButton}
          </span>
        );
      case 'completed':
        return (
          <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4" />
            Installed
          </span>
        );
      case 'error':
        return (
          <div className="flex flex-col">
            <span className="text-red-600 dark:text-red-400 flex items-center gap-1">
              <AlertCircle className="w-4 h-4" />
              Download Failed
            </span>
            {p.error && (
              <span className="text-xs text-red-500 dark:text-red-400/80 mt-0.5 max-w-xs">
                {p.error}
              </span>
            )}
          </div>
        );
      case 'cancelled':
        return (
          <span className="text-orange-600 dark:text-orange-400 flex items-center gap-1">
            <AlertCircle className="w-4 h-4" />
            Cancelled
          </span>
        );
      default:
        return null;
    }
  };

  // ── Tab state (must be before any early return) ────────
  const [activeTab, setActiveTab] = useState('language');

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  // Helper to check if any version of a service is installed
  const hasAnyVersionInstalled = (service) => {
    const versions = installed[service];
    if (typeof versions === 'boolean') return versions;
    return Object.values(versions || {}).some(Boolean);
  };

  // Helper to get installed versions count
  const getInstalledVersionsCount = (service) => {
    const versions = installed[service];
    if (typeof versions === 'boolean') return versions ? 1 : 0;
    return Object.values(versions || {}).filter(Boolean).length;
  };

  // ── Data definitions ───────────────────────────────────
  const versionedServices = [
    {
      id: 'mysql',
      name: 'MySQL',
      description: 'MySQL database server',
      icon: Database,
      versions: getMergedVersions('mysql'),
      predefinedVersions: serviceVersions.mysql,
      defaultVersion: serviceVersions.mysql[0] || '8.4',
      sizes: { '8.4': '~290 MB', '8.0': '~280 MB', '5.7': '~250 MB' },
      category: 'database',
    },
    {
      id: 'mariadb',
      name: 'MariaDB',
      description: 'MariaDB database server (MySQL compatible)',
      icon: Database,
      versions: getMergedVersions('mariadb'),
      predefinedVersions: serviceVersions.mariadb,
      defaultVersion: serviceVersions.mariadb[0] || '11.4',
      sizes: { '11.4': '~90 MB', '10.11': '~85 MB', '10.6': '~80 MB' },
      category: 'database',
    },
    {
      id: 'redis',
      name: 'Redis',
      description: 'Redis in-memory data store',
      icon: Server,
      versions: getMergedVersions('redis'),
      predefinedVersions: serviceVersions.redis,
      defaultVersion: serviceVersions.redis[0] || '7.4',
      sizes: { '7.4': '~5 MB', '7.2': '~5 MB', '6.2': '~4 MB' },
      category: 'cache',
    },
    {
      id: 'postgresql',
      name: 'PostgreSQL',
      description: 'Advanced open-source relational database',
      icon: Database,
      versions: getMergedVersions('postgresql'),
      predefinedVersions: serviceVersions.postgresql,
      defaultVersion: serviceVersions.postgresql[0] || '17',
      sizes: { '17': '~250 MB', '16': '~240 MB', '15': '~230 MB', '14': '~225 MB' },
      category: 'database',
    },
    {
      id: 'mongodb',
      name: 'MongoDB',
      description: 'NoSQL document database',
      icon: Database,
      versions: getMergedVersions('mongodb'),
      predefinedVersions: serviceVersions.mongodb,
      defaultVersion: serviceVersions.mongodb[0] || '8.0',
      sizes: { '8.0': '~130 MB', '7.0': '~120 MB', '6.0': '~110 MB' },
      category: 'database',
    },
    {
      id: 'python',
      name: 'Python',
      description: 'General-purpose programming language runtime',
      icon: Server,
      versions: getMergedVersions('python'),
      predefinedVersions: serviceVersions.python,
      defaultVersion: serviceVersions.python[0] || '3.13',
      sizes: { '3.13': '~15 MB', '3.12': '~14 MB', '3.11': '~14 MB', '3.10': '~13 MB' },
      category: 'runtime',
    },
    {
      id: 'memcached',
      name: 'Memcached',
      description: 'Distributed memory caching system',
      icon: Server,
      versions: getMergedVersions('memcached'),
      predefinedVersions: serviceVersions.memcached,
      defaultVersion: serviceVersions.memcached[0] || '1.6',
      sizes: { '1.6': '~2 MB', '1.5': '~2 MB' },
      category: 'cache',
    },
  ];

  const simpleServices = [
    {
      id: 'mailpit',
      name: 'Mailpit',
      description: 'Email testing tool with SMTP server',
      icon: Mail,
      installed: installed.mailpit,
      url: downloadUrls.mailpit?.url,
      size: '~15 MB',
      category: 'mail',
    },
    {
      id: 'phpmyadmin',
      name: 'phpMyAdmin',
      description: 'Web-based MySQL administration',
      icon: HardDrive,
      installed: installed.phpmyadmin,
      url: downloadUrls.phpmyadmin?.url,
      size: '~15 MB',
      category: 'tool',
    },
    {
      id: 'sqlite',
      name: 'SQLite',
      description: 'Embedded SQL database engine (CLI tools)',
      icon: Database,
      installed: !!installed.sqlite,
      size: '~2 MB',
      category: 'database',
    },
    {
      id: 'minio',
      name: 'MinIO',
      description: 'S3-compatible object storage server',
      icon: HardDrive,
      installed: !!installed.minio,
      size: '~100 MB',
      category: 'storage',
    },
  ];

  const webServers = [
    {
      id: 'nginx',
      name: 'Nginx',
      description: 'High-performance web server & reverse proxy',
      icon: Zap,
      versions: getMergedVersions('nginx'),
      predefinedVersions: serviceVersions.nginx,
      defaultVersion: serviceVersions.nginx[0] || '1.28',
      sizes: { '1.28': '~2 MB', '1.26': '~2 MB', '1.24': '~2 MB' },
    },
    {
      id: 'apache',
      name: 'Apache',
      description: 'Web server (manual download for Windows)',
      icon: Globe,
      versions: getMergedVersions('apache'),
      predefinedVersions: serviceVersions.apache,
      defaultVersion: serviceVersions.apache[0] || '2.4',
      sizes: { '2.4': '~60 MB' },
      requiresManualDownload: true,
    },
  ];

  // ── Tabs definition ────────────────────────────────────
  const tabs = [
    { id: 'language', label: 'Language', icon: '{ }' },
    { id: 'webserver', label: 'Web Servers', icon: '⬡' },
    { id: 'database', label: 'Databases', icon: '🗄' },
    { id: 'cache', label: 'Cache', icon: '⚡' },
    { id: 'tools', label: 'Tools', icon: '🔧' },
  ];

  // Count active downloads
  const activeDownloads = Object.entries(downloading).filter(([_, isDownloading]) => isDownloading);
  const activeDownloadCount = activeDownloads.length;

  // Shared props for module-level sub-components
  const sharedCardProps = {
    installed,
    downloading,
    expandedSections,
    toggleSection,
    downloadSources,
    getProgressDisplay,
    setPhpIniEditor,
    handleImportApache,
    getInstalledVersionsCount,
  };
  const sharedSimpleProps = { downloading, downloadSources, getProgressDisplay };

  return (
    <div className="p-8">
      {/* PHP.ini Editor Modal */}
      <PhpIniEditor
        version={phpIniEditor.version}
        isOpen={phpIniEditor.open}
        onClose={() => setPhpIniEditor({ open: false, version: null })}
      />

      {/* Update Available Modal */}
      {showUpdateModal && updateResult?.success && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full mx-4 overflow-hidden">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <CloudCog className="w-5 h-5 text-blue-500" />
                Binary Updates Available
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Config version: {updateResult.configVersion} • Last updated: {updateResult.lastUpdated}
              </p>
            </div>

            <div className="p-6 max-h-80 overflow-y-auto">
              {updateResult.hasUpdates ? (
                <div className="space-y-3">
                  {updateResult.updates.map((update, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                    >
                      <div>
                        <span className="font-medium text-gray-900 dark:text-white capitalize">
                          {update.service} {update.version}
                        </span>
                        {update.label && (
                          <span className="ml-2 text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                            {update.label}
                          </span>
                        )}
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {update.type === 'new_version' ? 'New version available' : `Updated: ${update.newFilename}`}
                        </p>
                      </div>
                      <span className={clsx(
                        "text-xs px-2 py-1 rounded",
                        update.type === 'new_version'
                          ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                          : "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                      )}>
                        {update.type === 'new_version' ? 'NEW' : 'UPDATE'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
                  <p className="text-gray-600 dark:text-gray-300">All binaries are up to date!</p>
                </div>
              )}
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-700/50 flex justify-end gap-3">
              <button
                onClick={() => setShowUpdateModal(false)}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                Close
              </button>
              {updateResult.hasUpdates && (
                <button
                  onClick={handleApplyUpdates}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Apply Updates
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Import Version Modal */}
      {importModal.open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Upload className="w-5 h-5 text-blue-500" />
                Import {importModal.service?.charAt(0).toUpperCase() + importModal.service?.slice(1)}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                File: {importModal.fileName}
              </p>
            </div>

            <div className="p-6">
              {importModal.detectedVersion ? (
                <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <p className="text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Detected version: <strong>{importModal.detectedVersion}</strong>
                  </p>
                </div>
              ) : (
                <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                  <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    Could not detect version from filename
                  </p>
                </div>
              )}

              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Version to install as:
              </label>

              {/* Quick select from available versions */}
              {importModal.availableVersions.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {importModal.availableVersions.map((v) => (
                    <button
                      key={v}
                      onClick={() => setImportModal({ ...importModal, customVersion: v })}
                      className={clsx(
                        'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                        importModal.customVersion === v
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      )}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">or custom:</span>
                <input
                  type="text"
                  value={importModal.customVersion}
                  onChange={(e) => setImportModal({ ...importModal, customVersion: e.target.value })}
                  placeholder="e.g., 8.4, 22, 1.28"
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                Enter the major.minor version (e.g., 8.4 for PHP 8.4.x, 22 for Node.js 22.x)
              </p>
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-700/50 flex justify-end gap-3">
              <button
                onClick={() => setImportModal({ ...importModal, open: false })}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmImport}
                disabled={!importModal.customVersion.trim()}
                className={clsx(
                  'px-4 py-2 rounded-lg transition-colors flex items-center gap-2',
                  importModal.customVersion.trim()
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-gray-300 dark:bg-gray-600 text-gray-500 cursor-not-allowed'
                )}
              >
                <Upload className="w-4 h-4" />
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Binary Manager</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Download and manage service binaries for DevBox Pro
          </p>
        </div>
        <button
          onClick={handleCheckForUpdates}
          disabled={checkingUpdates}
          className="btn-secondary"
        >
          {checkingUpdates ? <><Loader2 className="w-4 h-4 animate-spin" />Checking...</> : <><CloudCog className="w-4 h-4" />Check Updates</>}
        </button>
      </div>

      {/* ── Update Check Error ─────────────────────────────── */}
      {updateResult && !updateResult.success && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2 text-sm">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <span className="text-red-800 dark:text-red-200">Failed to check for updates: {updateResult.error}</span>
        </div>
      )}

      {/* ── Active Downloads Banner ────────────────────────── */}
      {activeDownloadCount > 0 && (
        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            {activeDownloadCount} download{activeDownloadCount > 1 ? 's' : ''} in progress
          </div>
          <div className="flex flex-col gap-1.5">
            {activeDownloads.map(([id]) => {
              const p = progress[id];
              return (
                <div key={id} className="flex items-center gap-2 text-xs">
                  <span className="text-gray-600 dark:text-gray-400 w-28 truncate capitalize">{id.replace('-', ' ')}</span>
                  {p?.status === 'downloading' && (
                    <>
                      <div className="flex-1 h-1.5 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-600 dark:bg-blue-400 transition-all duration-300" style={{ width: `${p.progress || 0}%` }} />
                      </div>
                      <span className="text-gray-500 dark:text-gray-400 w-10 text-right">{Math.round(p.progress || 0)}%</span>
                    </>
                  )}
                  {p?.status === 'extracting' && <span className="text-amber-600 dark:text-amber-400">Extracting…</span>}
                  {p?.status === 'starting' && <span className="text-gray-500 dark:text-gray-400">Starting…</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Category Tabs ──────────────────────────────────── */}
      <div className="flex gap-1 mb-5 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors',
              activeTab === tab.id
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            )}
          >
            <span className="text-base leading-none">{tab.icon}</span>
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ── Tab Content ────────────────────────────────────── */}

      {/* Language Tab: PHP + Node.js + Python */}
      {activeTab === 'language' && (
        <div className="space-y-3">
          {/* PHP */}
          <ServiceCard
            service={{
              id: 'php',
              name: 'PHP',
              description: 'PHP scripting language for web development · ~40 MB/version',
              emoji: 'PHP',
              versions: getMergedVersions('php'),
              predefinedVersions: serviceVersions.php,
              defaultVersion: serviceVersions.php?.[0],
              sizes: {},
            }}
            {...sharedCardProps}
            onDownload={(_, v) => handleDownloadPhp(v)}
            onRemove={(_, v) => handleRemove('php', v)}
            onImport={() => handleImportBinary('php')}
            isPhp
          />

          {/* Node.js */}
          <ServiceCard
            service={{
              id: 'nodejs',
              name: 'Node.js',
              description: 'JavaScript runtime for frontend builds (npm & npx) · ~35 MB/version',
              emoji: '⬢',
              versions: getMergedVersions('nodejs'),
              predefinedVersions: serviceVersions.nodejs,
              defaultVersion: serviceVersions.nodejs?.[0],
              sizes: {},
            }}
            {...sharedCardProps}
            onDownload={(_, v) => handleDownloadNodejs(v)}
            onRemove={(_, v) => handleRemove('nodejs', v)}
            onImport={() => handleImportBinary('nodejs')}
            isNodejs
          />

          {/* Python */}
          <ServiceCard
            service={{
              id: 'python',
              name: 'Python',
              description: 'General-purpose programming language runtime · ~15 MB/version',
              icon: Server,
              versions: getMergedVersions('python'),
              predefinedVersions: serviceVersions.python,
              defaultVersion: serviceVersions.python?.[0],
              sizes: { '3.13': '~15 MB', '3.12': '~14 MB', '3.11': '~14 MB', '3.10': '~13 MB' },
            }}
            {...sharedCardProps}
            onDownload={(s, v) => handleDownloadService(s, v)}
            onRemove={(s, v) => handleRemove(s, v)}
            onImport={(s) => handleImportBinary(s)}
          />

          {/* Composer */}
          <SimpleRow
            id="composer"
            name="Composer 2.x"
            description="PHP dependency manager — requires PHP to be installed"
            icon={FileText}
            emoji="🎼"
            isInstalled={installed.composer}
            size="~2.5 MB"
            sourceKey="composer"
            {...sharedSimpleProps}
            onDownload={() => handleDownloadService('composer')}
            onRemove={() => handleRemove('composer')}
            onImport={() => handleImportSimple('composer', '.phar')}
            importLabel=".phar"
          />
        </div>
      )}

      {/* Web Servers Tab */}
      {activeTab === 'webserver' && (
        <div className="space-y-3">
          {webServers.map(server => (
            <ServiceCard
              key={server.id}
              service={server}
              {...sharedCardProps}
              onDownload={(s, v) => handleDownloadService(s, v)}
              onRemove={(s, v) => handleRemove(s, v)}
              onImport={(s) => s === 'apache' ? null : handleImportBinary(s)}
              onManualOpen={() => handleOpenApacheDownloadPage()}
            />
          ))}
        </div>
      )}

      {/* Databases Tab */}
      {activeTab === 'database' && (
        <div className="space-y-3">
          {/* MySQL */}
          <ServiceCard
            service={{
              id: 'mysql', name: 'MySQL', description: 'MySQL database server',
              icon: Database, versions: getMergedVersions('mysql'), predefinedVersions: serviceVersions.mysql,
              defaultVersion: serviceVersions.mysql?.[0], sizes: { '8.4': '~290 MB', '8.0': '~280 MB' },
            }}
            {...sharedCardProps}
            onDownload={(s, v) => handleDownloadService(s, v)}
            onRemove={(s, v) => handleRemove(s, v)}
            onImport={(s) => handleImportBinary(s)}
          />
          {/* MariaDB */}
          <ServiceCard
            service={{
              id: 'mariadb', name: 'MariaDB', description: 'MySQL-compatible database server',
              icon: Database, versions: getMergedVersions('mariadb'), predefinedVersions: serviceVersions.mariadb,
              defaultVersion: serviceVersions.mariadb?.[0], sizes: { '11.4': '~90 MB', '10.11': '~85 MB', '10.6': '~80 MB' },
            }}
            {...sharedCardProps}
            onDownload={(s, v) => handleDownloadService(s, v)}
            onRemove={(s, v) => handleRemove(s, v)}
            onImport={(s) => handleImportBinary(s)}
          />
          {/* PostgreSQL */}
          <ServiceCard
            service={{
              id: 'postgresql', name: 'PostgreSQL', description: 'Advanced open-source relational database',
              icon: Database, versions: getMergedVersions('postgresql'), predefinedVersions: serviceVersions.postgresql,
              defaultVersion: serviceVersions.postgresql?.[0], sizes: { '17': '~250 MB', '16': '~240 MB', '15': '~230 MB', '14': '~225 MB' },
            }}
            {...sharedCardProps}
            onDownload={(s, v) => handleDownloadService(s, v)}
            onRemove={(s, v) => handleRemove(s, v)}
            onImport={(s) => handleImportBinary(s)}
          />
          {/* MongoDB */}
          <ServiceCard
            service={{
              id: 'mongodb', name: 'MongoDB', description: 'NoSQL document database',
              icon: Database, versions: getMergedVersions('mongodb'), predefinedVersions: serviceVersions.mongodb,
              defaultVersion: serviceVersions.mongodb?.[0], sizes: { '8.0': '~130 MB', '7.0': '~120 MB', '6.0': '~110 MB' },
            }}
            {...sharedCardProps}
            onDownload={(s, v) => handleDownloadService(s, v)}
            onRemove={(s, v) => handleRemove(s, v)}
            onImport={(s) => handleImportBinary(s)}
          />
          {/* SQLite */}
          <SimpleRow
            id="sqlite"
            name="SQLite"
            description="Embedded SQL database engine (CLI tools)"
            icon={Database}
            isInstalled={!!installed.sqlite}
            size="~2 MB"
            sourceKey="sqlite"
            {...sharedSimpleProps}
            onDownload={() => handleDownloadService('sqlite')}
            onRemove={() => handleRemove('sqlite')}
          />
          {/* phpMyAdmin */}
          <SimpleRow
            id="phpmyadmin"
            name="phpMyAdmin"
            description="Web-based MySQL/MariaDB administration interface"
            icon={HardDrive}
            isInstalled={installed.phpmyadmin}
            size="~15 MB"
            sourceKey="phpmyadmin"
            {...sharedSimpleProps}
            onDownload={() => handleDownloadService('phpmyadmin')}
            onRemove={() => handleRemove('phpmyadmin')}
            onImport={() => handleImportSimple('phpmyadmin')}
          />
        </div>
      )}

      {/* Cache Tab */}
      {activeTab === 'cache' && (
        <div className="space-y-3">
          {/* Redis */}
          <ServiceCard
            service={{
              id: 'redis', name: 'Redis', description: 'In-memory key-value data store',
              icon: Server, versions: getMergedVersions('redis'), predefinedVersions: serviceVersions.redis,
              defaultVersion: serviceVersions.redis?.[0], sizes: { '7.4': '~5 MB', '7.2': '~5 MB' },
            }}
            {...sharedCardProps}
            onDownload={(s, v) => handleDownloadService(s, v)}
            onRemove={(s, v) => handleRemove(s, v)}
            onImport={(s) => handleImportBinary(s)}
          />
          {/* Memcached */}
          <ServiceCard
            service={{
              id: 'memcached', name: 'Memcached', description: 'Distributed memory caching system (Windows: 1.6.8 mingw build)',
              icon: Server, versions: getMergedVersions('memcached'), predefinedVersions: serviceVersions.memcached,
              defaultVersion: serviceVersions.memcached?.[0], sizes: { '1.6': '~6 MB' },
            }}
            {...sharedCardProps}
            onDownload={(s, v) => handleDownloadService(s, v)}
            onRemove={(s, v) => handleRemove(s, v)}
            onImport={(s) => handleImportBinary(s)}
          />
        </div>
      )}

      {/* Tools Tab */}
      {activeTab === 'tools' && (
        <div className="space-y-3">
          {/* Mailpit */}
          <SimpleRow
            id="mailpit"
            name="Mailpit"
            description="Email testing tool with built-in SMTP server and web UI"
            icon={Mail}
            isInstalled={installed.mailpit}
            size="~15 MB"
            sourceKey="mailpit"
            {...sharedSimpleProps}
            onDownload={() => handleDownloadService('mailpit')}
            onRemove={() => handleRemove('mailpit')}
            onImport={() => handleImportSimple('mailpit')}
          />
          {/* MinIO */}
          <SimpleRow
            id="minio"
            name="MinIO"
            description="S3-compatible object storage server"
            icon={HardDrive}
            emoji="☁️"
            isInstalled={!!installed.minio}
            size="~100 MB"
            sourceKey="minio"
            {...sharedSimpleProps}
            onDownload={() => handleDownloadService('minio')}
            onRemove={() => handleRemove('minio')}
          />
        </div>
      )}

      {/* ── Quick Download All ──────────────────────────────── */}
      <div className="mt-6 p-4 rounded-xl border border-blue-200 dark:border-blue-800 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 flex items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold text-sm text-gray-900 dark:text-white">Download Core Stack</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">PHP 8.5, Nginx 1.28, MySQL 8.4, Redis 7.4, Mailpit, phpMyAdmin, Node.js 24 & Composer</p>
        </div>
        <button
          onClick={() => {
            if (!installed.php?.['8.5']) handleDownloadPhp('8.5');
            if (!installed.nginx?.['1.28']) handleDownloadService('nginx', '1.28');
            if (!installed.mysql?.['8.4']) handleDownloadService('mysql', '8.4');
            if (!installed.redis?.['7.4']) handleDownloadService('redis', '7.4');
            if (!installed.mailpit) handleDownloadService('mailpit');
            if (!installed.phpmyadmin) handleDownloadService('phpmyadmin');
            if (!installed.nodejs?.['24']) handleDownloadNodejs('24');
            if (!installed.composer) handleDownloadService('composer');
          }}
          className="shrink-0 btn-primary bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-sm"
        >
          <Download className="w-4 h-4" />
          Download All
        </button>
      </div>
    </div>
  );
}

export default BinaryManager;
