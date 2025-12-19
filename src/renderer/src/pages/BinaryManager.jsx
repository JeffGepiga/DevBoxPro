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

function BinaryManager() {
  // Use global state for download progress (persists across navigation)
  const { 
    downloadProgress: progress, 
    downloading, 
    setDownloading: setDownloadingGlobal,
    setDownloadProgress: setProgressGlobal,
  } = useApp();
  
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
  });
  const [downloadUrls, setDownloadUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [webServerType, setWebServerType] = useState('nginx');
  const [phpIniEditor, setPhpIniEditor] = useState({ open: false, version: null });
  const [expandedSections, setExpandedSections] = useState({
    mysql: false,
    mariadb: false,
    redis: false,
    nginx: false,
    apache: false,
  });
  
  // Service versions from backend config (with defaults)
  const [serviceVersions, setServiceVersions] = useState({
    php: ['8.4', '8.3', '8.2', '8.1', '8.0', '7.4'],
    mysql: ['8.4', '8.0'],
    mariadb: ['11.4', '10.11', '10.6'],
    redis: ['7.4', '7.2'],
    nginx: ['1.28', '1.26'],
    apache: ['2.4'],
    nodejs: ['22', '20', '18'],
  });

  // Check for updates state
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateResult, setUpdateResult] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  const loadInstalled = useCallback(async () => {
    try {
      const result = await window.devbox?.binaries.getInstalled();
      if (result) {
        setInstalled(result);
      }
    } catch (error) {
      console.error('Error loading installed binaries:', error);
    }
  }, []);

  const loadDownloadUrls = useCallback(async () => {
    try {
      const urls = await window.devbox?.binaries.getDownloadUrls();
      if (urls) {
        setDownloadUrls(urls);
      }
    } catch (error) {
      console.error('Error loading download URLs:', error);
    }
  }, []);

  const loadServiceConfig = useCallback(async () => {
    try {
      const config = await window.devbox?.binaries.getServiceConfig();
      if (config?.versions) {
        setServiceVersions(config.versions);
      }
    } catch (error) {
      console.error('Error loading service config:', error);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      
      // Load each independently to prevent one failure from blocking all
      try {
        await loadInstalled();
      } catch (error) {
        console.error('Error loading installed binaries:', error);
      }
      
      try {
        await loadDownloadUrls();
      } catch (error) {
        console.error('Error loading download URLs:', error);
      }
      
      try {
        await loadServiceConfig();
      } catch (error) {
        console.error('Error loading service config:', error);
      }
      
      // Load web server preference
      try {
        const serverType = await window.devbox?.webServer.getServerType();
        if (serverType) setWebServerType(serverType);
      } catch (error) {
        console.error('Error loading web server type:', error);
      }
      
      setLoading(false);
    };
    init();

    // Download progress is now handled by AppContext - just refresh installed list on complete
    const unsubscribe = window.devbox?.binaries.onProgress((id, progressData) => {
      if (progressData.status === 'completed') {
        loadInstalled();
      }
    });

    return () => unsubscribe?.();
  }, [loadInstalled, loadDownloadUrls, loadServiceConfig]);

  const handleSetWebServer = async (type) => {
    try {
      await window.devbox?.webServer.setServerType(type);
      setWebServerType(type);
    } catch (error) {
      console.error('Error setting web server type:', error);
    }
  };

  const handleDownloadPhp = async (version) => {
    const id = `php-${version}`;
    
    // Don't start if already downloading
    if (downloading[id]) return;
    
    setDownloadingGlobal(id, true);
    setProgressGlobal(id, { status: 'starting', progress: 0 });

    // Fire and forget - don't await, let progress events handle updates
    window.devbox?.binaries.downloadPhp(version).catch((error) => {
      console.error(`Error downloading PHP ${version}:`, error);
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
    }
    
    downloadPromise?.catch((error) => {
      console.error(`Error downloading ${service}${version ? ' ' + version : ''}:`, error);
      setProgressGlobal(id, { status: 'error', error: error.message });
      setDownloadingGlobal(id, false);
    });
  };

  const toggleSection = (section) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
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
      console.error('Error checking for updates:', error);
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
      console.error('Error applying updates:', error);
    }
  };

  const handleOpenApacheDownloadPage = async () => {
    try {
      await window.devbox?.binaries.openApacheDownloadPage();
    } catch (error) {
      console.error('Error opening Apache download page:', error);
    }
  };

  const handleImportApache = async () => {
    // Use file input to select a file
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setDownloadingGlobal('apache', true);
      setProgressGlobal('apache', { status: 'starting', progress: 0 });

      try {
        // Get the file path - we need to use the path property
        const filePath = file.path;
        if (!filePath) {
          throw new Error('Could not get file path. Please try again.');
        }
        await window.devbox?.binaries.importApache(filePath);
      } catch (error) {
        console.error('Error importing Apache:', error);
        setProgressGlobal('apache', { status: 'error', error: error.message });
        setDownloadingGlobal('apache', false);
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
      console.error(`Error downloading Node.js ${version}:`, error);
      setProgressGlobal(id, { status: 'error', error: error.message });
      setDownloadingGlobal(id, false);
    });
  };

  const handleRemove = async (type, version = null) => {
    const confirmMsg = version
      ? `Remove PHP ${version}? You'll need to re-download it to use it again.`
      : `Remove ${type}? You'll need to re-download it to use it again.`;

    if (!window.confirm(confirmMsg)) return;

    try {
      await window.devbox?.binaries.remove(type, version);
      await loadInstalled();
    } catch (error) {
      console.error(`Error removing ${type}:`, error);
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

    switch (p.status) {
      case 'starting':
        return (
          <span className="text-blue-600 dark:text-blue-400 flex items-center gap-1">
            <Loader2 className="w-4 h-4 animate-spin" />
            Starting...
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
          </div>
        );
      case 'extracting':
        return (
          <span className="text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
            <Loader2 className="w-4 h-4 animate-spin" />
            Extracting...
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
          <span className="text-red-600 dark:text-red-400 flex items-center gap-1" title={p.error}>
            <AlertCircle className="w-4 h-4" />
            Failed
          </span>
        );
      default:
        return null;
    }
  };

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

  const versionedServices = [
    {
      id: 'mysql',
      name: 'MySQL',
      description: 'MySQL database server',
      icon: Database,
      versions: serviceVersions.mysql,
      defaultVersion: serviceVersions.mysql[0] || '8.4',
      sizes: { '8.4': '~290 MB', '8.0': '~280 MB', '5.7': '~250 MB' },
      category: 'database',
    },
    {
      id: 'mariadb',
      name: 'MariaDB',
      description: 'MariaDB database server (MySQL compatible)',
      icon: Database,
      versions: serviceVersions.mariadb,
      defaultVersion: serviceVersions.mariadb[0] || '11.4',
      sizes: { '11.4': '~90 MB', '10.11': '~85 MB', '10.6': '~80 MB' },
      category: 'database',
    },
    {
      id: 'redis',
      name: 'Redis',
      description: 'Redis in-memory data store',
      icon: Server,
      versions: serviceVersions.redis,
      defaultVersion: serviceVersions.redis[0] || '7.4',
      sizes: { '7.4': '~5 MB', '7.2': '~5 MB', '6.2': '~4 MB' },
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
  ];

  const webServers = [
    {
      id: 'nginx',
      name: 'Nginx',
      description: 'High-performance web server & reverse proxy',
      icon: Zap,
      versions: serviceVersions.nginx,
      defaultVersion: serviceVersions.nginx[0] || '1.28',
      sizes: { '1.28': '~2 MB', '1.26': '~2 MB', '1.24': '~2 MB' },
    },
    {
      id: 'apache',
      name: 'Apache',
      description: 'Web server (manual download for Windows)',
      icon: Globe,
      versions: serviceVersions.apache,
      defaultVersion: serviceVersions.apache[0] || '2.4',
      sizes: { '2.4': '~60 MB' },
      requiresManualDownload: true,
    },
  ];

  // Count active downloads
  const activeDownloads = Object.entries(downloading).filter(([_, isDownloading]) => isDownloading);
  const activeDownloadCount = activeDownloads.length;

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

      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Binary Manager</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Download and manage required binaries for DevBox Pro
          </p>
        </div>
        <button
          onClick={handleCheckForUpdates}
          disabled={checkingUpdates}
          className={clsx(
            "flex items-center gap-2 px-4 py-2 rounded-lg transition-colors",
            checkingUpdates
              ? "bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed"
              : "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50"
          )}
        >
          {checkingUpdates ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Checking...
            </>
          ) : (
            <>
              <CloudCog className="w-4 h-4" />
              Check for Updates
            </>
          )}
        </button>
      </div>

      {/* Update Check Error */}
      {updateResult && !updateResult.success && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
            <span className="text-red-800 dark:text-red-200">
              Failed to check for updates: {updateResult.error}
            </span>
          </div>
        </div>
      )}

      {/* Active Downloads Banner */}
      {activeDownloadCount > 0 && (
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-blue-600 dark:text-blue-400" />
            <span className="font-medium text-blue-800 dark:text-blue-200">
              {activeDownloadCount} download{activeDownloadCount > 1 ? 's' : ''} in progress
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {activeDownloads.map(([id]) => {
              const p = progress[id];
              return (
                <div key={id} className="flex items-center gap-3 text-sm">
                  <span className="text-gray-600 dark:text-gray-400 w-24 truncate capitalize">
                    {id.replace('-', ' ')}
                  </span>
                  {p?.status === 'downloading' && (
                    <>
                      <div className="flex-1 h-2 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-600 dark:bg-blue-400 transition-all duration-300"
                          style={{ width: `${p.progress || 0}%` }}
                        />
                      </div>
                      <span className="text-gray-500 dark:text-gray-400 w-12 text-right">
                        {Math.round(p.progress || 0)}%
                      </span>
                    </>
                  )}
                  {p?.status === 'extracting' && (
                    <span className="text-amber-600 dark:text-amber-400">Extracting...</span>
                  )}
                  {p?.status === 'starting' && (
                    <span className="text-gray-500 dark:text-gray-400">Starting...</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* PHP Versions */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
            <span className="text-purple-600 dark:text-purple-400 font-bold text-sm">PHP</span>
          </span>
          PHP Versions
        </h2>
        <div className="grid gap-3">
          {(serviceVersions.php || []).map((version) => {
            const id = `php-${version}`;
            const isInstalled = installed.php[version];
            const isDownloading = downloading[id];
            const url = downloadUrls.php?.[version]?.url;

            return (
              <div
                key={version}
                className="card p-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={clsx(
                      'w-12 h-12 rounded-lg flex items-center justify-center font-bold',
                      isInstalled
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
                    )}
                  >
                    {version}
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-white">
                      PHP {version}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {isInstalled ? 'Installed' : 'Not installed'} • ~40 MB
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {isDownloading ? (
                    getProgressDisplay(id)
                  ) : isInstalled ? (
                    <>
                      <span className="badge-success flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        Installed
                      </span>
                      <button
                        onClick={() => setPhpIniEditor({ open: true, version })}
                        className="btn-icon text-gray-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20"
                        title="Edit php.ini"
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleRemove('php', version)}
                        className="btn-icon text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Remove"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-icon text-gray-400 hover:text-gray-600"
                          title="View download source"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                      <button
                        onClick={() => handleDownloadPhp(version)}
                        className="btn-primary"
                      >
                        <Download className="w-4 h-4" />
                        Download
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Web Servers */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <Globe className="w-4 h-4 text-green-600 dark:text-green-400" />
          </span>
          Web Servers
          <span className="text-xs font-normal text-gray-500 ml-2">
            (Required for serving PHP projects)
          </span>
        </h2>
        
        {/* Web Server Selection */}
        <div className="mb-4 p-4 card bg-gray-50 dark:bg-gray-800/50">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            Select your preferred web server for PHP projects:
          </p>
          <div className="flex gap-4">
            <button
              onClick={() => handleSetWebServer('nginx')}
              className={clsx(
                'flex-1 p-4 rounded-lg border-2 transition-all',
                webServerType === 'nginx'
                  ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
              )}
            >
              <div className="flex items-center gap-3">
                <Zap className={clsx(
                  'w-6 h-6',
                  webServerType === 'nginx' ? 'text-green-600' : 'text-gray-400'
                )} />
                <div className="text-left">
                  <p className={clsx(
                    'font-medium',
                    webServerType === 'nginx' ? 'text-green-700 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'
                  )}>Nginx</p>
                  <p className="text-xs text-gray-500">Recommended • Fast & lightweight</p>
                </div>
              </div>
            </button>
            <button
              onClick={() => handleSetWebServer('apache')}
              className={clsx(
                'flex-1 p-4 rounded-lg border-2 transition-all',
                webServerType === 'apache'
                  ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
              )}
            >
              <div className="flex items-center gap-3">
                <Globe className={clsx(
                  'w-6 h-6',
                  webServerType === 'apache' ? 'text-green-600' : 'text-gray-400'
                )} />
                <div className="text-left">
                  <p className={clsx(
                    'font-medium',
                    webServerType === 'apache' ? 'text-green-700 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'
                  )}>Apache</p>
                  <p className="text-xs text-gray-500">.htaccess support • mod_rewrite</p>
                </div>
              </div>
            </button>
          </div>
        </div>

        <div className="grid gap-3">
          {webServers.map((server) => {
            const installedCount = getInstalledVersionsCount(server.id);
            const hasInstalled = installedCount > 0;
            const isSelected = webServerType === server.id;
            const isExpanded = expandedSections[server.id];

            return (
              <div
                key={server.id}
                className={clsx(
                  'card overflow-hidden',
                  isSelected && 'ring-2 ring-green-500 ring-offset-2 dark:ring-offset-gray-900'
                )}
              >
                {/* Server Header */}
                <div
                  className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  onClick={() => toggleSection(server.id)}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={clsx(
                        'w-12 h-12 rounded-lg flex items-center justify-center',
                        hasInstalled
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
                      )}
                    >
                      <server.icon className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                        {server.name}
                        {isSelected && (
                          <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full">
                            Active
                          </span>
                        )}
                        {hasInstalled && (
                          <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full">
                            {installedCount} version{installedCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {server.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isExpanded ? (
                      <ChevronUp className="w-5 h-5 text-gray-400" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-gray-400" />
                    )}
                  </div>
                </div>

                {/* Version List (Expandable) */}
                {isExpanded && (
                  <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30">
                    {server.versions.map((version) => {
                      const id = `${server.id}-${version}`;
                      const isInstalled = installed[server.id]?.[version];
                      const isDownloading = downloading[id];
                      const isDefault = version === server.defaultVersion;

                      return (
                        <div
                          key={version}
                          className="p-3 flex items-center justify-between border-b last:border-b-0 border-gray-200 dark:border-gray-700"
                        >
                          <div className="flex items-center gap-3">
                            <span className={clsx(
                              'w-10 h-8 rounded flex items-center justify-center font-mono text-sm',
                              isInstalled
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                            )}>
                              {version}
                            </span>
                            <div>
                              <span className="text-sm text-gray-700 dark:text-gray-300">
                                {server.name} {version}
                              </span>
                              {isDefault && (
                                <span className="ml-2 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full">
                                  Latest
                                </span>
                              )}
                              <span className="ml-2 text-xs text-gray-500">
                                {server.sizes?.[version] || '~50 MB'}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {isDownloading ? (
                              getProgressDisplay(id)
                            ) : isInstalled ? (
                              <>
                                <span className="badge-success flex items-center gap-1 text-xs">
                                  <Check className="w-3 h-3" />
                                  Installed
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleRemove(server.id, version); }}
                                  className="btn-icon text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                                  title="Remove"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            ) : server.requiresManualDownload ? (
                              <>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleOpenApacheDownloadPage(); }}
                                  className="btn-secondary text-sm px-2 py-1 flex items-center gap-1"
                                  title="Open Apache Lounge download page"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  Download
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleImportApache(); }}
                                  className="btn-primary text-sm px-2 py-1 flex items-center gap-1"
                                  title="Import downloaded Apache ZIP"
                                >
                                  <Upload className="w-3 h-3" />
                                  Import
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDownloadService(server.id, version); }}
                                className="btn-primary text-sm px-3 py-1"
                              >
                                <Download className="w-3 h-3" />
                                Download
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Services (Versioned) */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Server className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </span>
          Services
          <span className="text-xs font-normal text-gray-500 ml-2">
            (Multiple versions can be installed)
          </span>
        </h2>
        <div className="grid gap-3">
          {/* Versioned Services (MySQL, MariaDB, Redis) */}
          {versionedServices.map((service) => {
            const installedCount = getInstalledVersionsCount(service.id);
            const hasInstalled = installedCount > 0;
            const isExpanded = expandedSections[service.id];

            return (
              <div key={service.id} className="card overflow-hidden">
                {/* Service Header */}
                <div
                  className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  onClick={() => toggleSection(service.id)}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={clsx(
                        'w-12 h-12 rounded-lg flex items-center justify-center',
                        hasInstalled
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
                      )}
                    >
                      <service.icon className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                        {service.name}
                        {hasInstalled && (
                          <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full">
                            {installedCount} version{installedCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {service.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isExpanded ? (
                      <ChevronUp className="w-5 h-5 text-gray-400" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-gray-400" />
                    )}
                  </div>
                </div>

                {/* Version List (Expandable) */}
                {isExpanded && (
                  <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30">
                    {service.versions.map((version) => {
                      const id = `${service.id}-${version}`;
                      const isInstalled = installed[service.id]?.[version];
                      const isDownloading = downloading[id];
                      const isDefault = version === service.defaultVersion;

                      return (
                        <div
                          key={version}
                          className="p-3 flex items-center justify-between border-b last:border-b-0 border-gray-200 dark:border-gray-700"
                        >
                          <div className="flex items-center gap-3">
                            <span className={clsx(
                              'w-8 h-8 rounded flex items-center justify-center font-mono text-sm',
                              isInstalled
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                            )}>
                              {version}
                            </span>
                            <div>
                              <span className="text-sm text-gray-700 dark:text-gray-300">
                                {service.name} {version}
                              </span>
                              {isDefault && (
                                <span className="ml-2 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full">
                                  Latest
                                </span>
                              )}
                              <span className="ml-2 text-xs text-gray-500">
                                {service.sizes?.[version] || '~50 MB'}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {isDownloading ? (
                              getProgressDisplay(id)
                            ) : isInstalled ? (
                              <>
                                <span className="badge-success flex items-center gap-1 text-xs">
                                  <Check className="w-3 h-3" />
                                  Installed
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleRemove(service.id, version); }}
                                  className="btn-icon text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                                  title="Remove"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDownloadService(service.id, version); }}
                                className="btn-primary text-sm px-3 py-1"
                              >
                                <Download className="w-3 h-3" />
                                Download
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Simple Services (Mailpit, phpMyAdmin) */}
          {simpleServices.map((service) => {
            const isDownloading = downloading[service.id];

            return (
              <div
                key={service.id}
                className="card p-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={clsx(
                      'w-12 h-12 rounded-lg flex items-center justify-center',
                      service.installed
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
                    )}
                  >
                    <service.icon className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-white">
                      {service.name}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {service.description} • {service.size}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {isDownloading ? (
                    getProgressDisplay(service.id)
                  ) : service.installed ? (
                    <>
                      <span className="badge-success flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        Installed
                      </span>
                      <button
                        onClick={() => handleRemove(service.id)}
                        className="btn-icon text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Remove"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      {service.url && (
                        <a
                          href={service.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-icon text-gray-400 hover:text-gray-600"
                          title="View download source"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                      <button
                        onClick={() => handleDownloadService(service.id)}
                        className="btn-primary"
                      >
                        <Download className="w-4 h-4" />
                        Download
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Node.js Versions */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <span className="text-lg">⬢</span>
          </span>
          Node.js
          <span className="text-xs font-normal text-gray-500 ml-2">
            (For npm/Vite/Frontend builds)
          </span>
        </h2>
        <div className="grid gap-3">
          {(serviceVersions.nodejs || []).map((version) => {
            const id = `nodejs-${version}`;
            const isInstalled = installed.nodejs?.[version];
            const isDownloading = downloading[id];
            const url = downloadUrls.nodejs?.[version]?.url;

            return (
              <div
                key={version}
                className="card p-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={clsx(
                      'w-12 h-12 rounded-lg flex items-center justify-center text-xl',
                      isInstalled
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
                    )}
                  >
                    ⬢
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-white">
                      Node.js {version}
                      {version === '22' && (
                        <span className="ml-2 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full">
                          Current
                        </span>
                      )}
                      {version === '20' && (
                        <span className="ml-2 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full">
                          LTS
                        </span>
                      )}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {isInstalled ? 'Installed' : 'Not installed'} • ~35 MB • Includes npm & npx
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {isDownloading ? (
                    getProgressDisplay(id)
                  ) : isInstalled ? (
                    <>
                      <span className="badge-success flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        Installed
                      </span>
                      <button
                        onClick={() => handleRemove('nodejs', version)}
                        className="btn-icon text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Remove"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-icon text-gray-400 hover:text-gray-600"
                          title="View download source"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                      <button
                        onClick={() => handleDownloadNodejs(version)}
                        className="btn-primary"
                      >
                        <Download className="w-4 h-4" />
                        Download
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Composer */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
            <span className="text-lg">🎼</span>
          </span>
          Composer
          <span className="text-xs font-normal text-gray-500 ml-2">
            (PHP dependency manager)
          </span>
        </h2>
        <div className="grid gap-3">
          <div className="card p-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div
                className={clsx(
                  'w-12 h-12 rounded-lg flex items-center justify-center text-xl',
                  installed.composer
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
                )}
              >
                🎼
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">
                  Composer 2.x
                  <span className="ml-2 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded-full">
                    Latest
                  </span>
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {installed.composer ? 'Installed' : 'Not installed'} • ~2.5 MB • Requires PHP to be installed
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {downloading.composer ? (
                getProgressDisplay('composer')
              ) : installed.composer ? (
                <>
                  <span className="badge-success flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Installed
                  </span>
                  <button
                    onClick={() => handleRemove('composer')}
                    className="btn-icon text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <a
                    href="https://getcomposer.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-icon text-gray-400 hover:text-gray-600"
                    title="View download source"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                  <button
                    onClick={() => handleDownloadService('composer')}
                    className="btn-primary"
                  >
                    <Download className="w-4 h-4" />
                    Download
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Download All */}
      <div className="mt-8 p-6 card bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-blue-200 dark:border-blue-800">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">
              Download Full Stack Environment
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Download PHP 8.4, {webServerType === 'nginx' ? 'Nginx' : 'Apache'}, MySQL, Redis, Mailpit, phpMyAdmin, Node.js 20, and Composer
            </p>
          </div>
          <button
            onClick={async () => {
              // Download essentials
              if (!installed.php['8.4']) handleDownloadPhp('8.4');
              if (!installed[webServerType]) handleDownloadService(webServerType);
              if (!installed.mysql) handleDownloadService('mysql');
              if (!installed.redis) handleDownloadService('redis');
              if (!installed.mailpit) handleDownloadService('mailpit');
              if (!installed.phpmyadmin) handleDownloadService('phpmyadmin');
              if (!installed.nodejs?.['20']) handleDownloadNodejs('20');
              if (!installed.composer) handleDownloadService('composer');
            }}
            className="btn-primary bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
          >
            <Download className="w-4 h-4" />
            Download All
          </button>
        </div>
      </div>
    </div>
  );
}

export default BinaryManager;
