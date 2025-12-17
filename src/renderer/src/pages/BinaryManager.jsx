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
} from 'lucide-react';
import clsx from 'clsx';

const PHP_VERSIONS = ['8.3', '8.2', '8.1', '8.0', '7.4'];
const NODE_VERSIONS = ['22', '20', '18'];

function BinaryManager() {
  const [installed, setInstalled] = useState({
    php: {},
    mysql: false,
    redis: false,
    mailpit: false,
    phpmyadmin: false,
    nginx: false,
    apache: false,
    nodejs: {},
    composer: false,
  });
  const [downloadUrls, setDownloadUrls] = useState({});
  const [downloading, setDownloading] = useState({});
  const [progress, setProgress] = useState({});
  const [loading, setLoading] = useState(true);
  const [webServerType, setWebServerType] = useState('nginx');

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

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadInstalled(), loadDownloadUrls()]);
      // Load web server preference
      const serverType = await window.devbox?.webServer.getServerType();
      if (serverType) setWebServerType(serverType);
      setLoading(false);
    };
    init();

    // Listen for download progress
    const unsubscribe = window.devbox?.binaries.onProgress((id, progressData) => {
      setProgress((prev) => ({ ...prev, [id]: progressData }));

      if (progressData.status === 'completed' || progressData.status === 'error') {
        setDownloading((prev) => ({ ...prev, [id]: false }));
        if (progressData.status === 'completed') {
          loadInstalled();
        }
      }
    });

    return () => unsubscribe?.();
  }, [loadInstalled, loadDownloadUrls]);

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
    setDownloading((prev) => ({ ...prev, [id]: true }));
    setProgress((prev) => ({ ...prev, [id]: { status: 'starting', progress: 0 } }));

    try {
      await window.devbox?.binaries.downloadPhp(version);
    } catch (error) {
      console.error(`Error downloading PHP ${version}:`, error);
      setProgress((prev) => ({ ...prev, [id]: { status: 'error', error: error.message } }));
      setDownloading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleDownloadService = async (service) => {
    setDownloading((prev) => ({ ...prev, [service]: true }));
    setProgress((prev) => ({ ...prev, [service]: { status: 'starting', progress: 0 } }));

    try {
      switch (service) {
        case 'mysql':
          await window.devbox?.binaries.downloadMysql();
          break;
        case 'redis':
          await window.devbox?.binaries.downloadRedis();
          break;
        case 'mailpit':
          await window.devbox?.binaries.downloadMailpit();
          break;
        case 'phpmyadmin':
          await window.devbox?.binaries.downloadPhpMyAdmin();
          break;
        case 'nginx':
          await window.devbox?.binaries.downloadNginx();
          break;
        case 'apache':
          await window.devbox?.binaries.downloadApache();
          break;
        case 'composer':
          await window.devbox?.binaries.downloadComposer();
          break;
      }
    } catch (error) {
      console.error(`Error downloading ${service}:`, error);
      setProgress((prev) => ({ ...prev, [service]: { status: 'error', error: error.message } }));
      setDownloading((prev) => ({ ...prev, [service]: false }));
    }
  };

  const handleDownloadNodejs = async (version) => {
    const id = `nodejs-${version}`;
    setDownloading((prev) => ({ ...prev, [id]: true }));
    setProgress((prev) => ({ ...prev, [id]: { status: 'starting', progress: 0 } }));

    try {
      await window.devbox?.binaries.downloadNodejs(version);
    } catch (error) {
      console.error(`Error downloading Node.js ${version}:`, error);
      setProgress((prev) => ({ ...prev, [id]: { status: 'error', error: error.message } }));
      setDownloading((prev) => ({ ...prev, [id]: false }));
    }
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

  const services = [
    {
      id: 'mysql',
      name: 'MySQL',
      description: 'MySQL 8.0 database server',
      icon: Database,
      installed: installed.mysql,
      url: downloadUrls.mysql?.url,
      size: '~280 MB',
      category: 'database',
    },
    {
      id: 'redis',
      name: 'Redis',
      description: 'Redis in-memory data store',
      icon: Server,
      installed: installed.redis,
      url: downloadUrls.redis?.url,
      size: '~5 MB',
      category: 'cache',
    },
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
      installed: installed.nginx,
      url: downloadUrls.nginx?.url,
      size: '~2 MB',
    },
    {
      id: 'apache',
      name: 'Apache',
      description: 'Most popular web server with mod_php support',
      icon: Globe,
      installed: installed.apache,
      url: downloadUrls.apache?.url,
      size: '~60 MB',
    },
  ];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Binary Manager</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Download and manage required binaries for DevBox Pro
        </p>
      </div>

      {/* PHP Versions */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
            <span className="text-purple-600 dark:text-purple-400 font-bold text-sm">PHP</span>
          </span>
          PHP Versions
        </h2>
        <div className="grid gap-3">
          {PHP_VERSIONS.map((version) => {
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
            const isDownloading = downloading[server.id];
            const isSelected = webServerType === server.id;

            return (
              <div
                key={server.id}
                className={clsx(
                  'card p-4 flex items-center justify-between',
                  isSelected && 'ring-2 ring-green-500 ring-offset-2 dark:ring-offset-gray-900'
                )}
              >
                <div className="flex items-center gap-4">
                  <div
                    className={clsx(
                      'w-12 h-12 rounded-lg flex items-center justify-center',
                      server.installed
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
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {server.description} • {server.size}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {isDownloading ? (
                    getProgressDisplay(server.id)
                  ) : server.installed ? (
                    <>
                      <span className="badge-success flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        Installed
                      </span>
                      <button
                        onClick={() => handleRemove(server.id)}
                        className="btn-icon text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Remove"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      {server.url && (
                        <a
                          href={server.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-icon text-gray-400 hover:text-gray-600"
                          title="View download source"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                      <button
                        onClick={() => handleDownloadService(server.id)}
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

      {/* Services */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Server className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </span>
          Services
        </h2>
        <div className="grid gap-3">
          {services.map((service) => {
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
          {NODE_VERSIONS.map((version) => {
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
              Download PHP 8.3, {webServerType === 'nginx' ? 'Nginx' : 'Apache'}, MySQL, Redis, Mailpit, phpMyAdmin, Node.js 20, and Composer
            </p>
          </div>
          <button
            onClick={async () => {
              // Download essentials
              if (!installed.php['8.3']) handleDownloadPhp('8.3');
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
