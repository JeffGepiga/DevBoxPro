import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { Link } from 'react-router-dom';
import {
  Play,
  Square,
  RefreshCw,
  Server,
  Database,
  Mail,
  Gauge,
  HardDrive,
  Cpu,
  MemoryStick,
  ExternalLink,
  Globe,
  Box,
  AlertTriangle,
  ChevronDown,
  Layers,
  Download,
} from 'lucide-react';
import clsx from 'clsx';

function Services() {
  const { services, resourceUsage, startService, stopService, refreshServices, projects } = useApp();
  const [loadingServices, setLoadingServices] = useState(new Set());
  const [binariesStatus, setBinariesStatus] = useState({});
  const [runningVersions, setRunningVersions] = useState({});
  const [serviceConfig, setServiceConfig] = useState({
    versions: {},
    portOffsets: {},
    defaultPorts: {},
    serviceInfo: {},
  });

  // Load service configuration from backend
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await window.devbox?.binaries.getServiceConfig();
        if (config) {
          setServiceConfig(config);
        }
      } catch (err) {
        // Error loading service config
      }
    };
    loadConfig();
  }, []);

  // Helper to check if a specific service is loading
  const isServiceLoading = useCallback((serviceName, version = null) => {
    const key = version ? `${serviceName}-${version}` : serviceName;
    return loadingServices.has(key);
  }, [loadingServices]);

  // Helper to set loading state for a specific service
  const setServiceLoading = useCallback((serviceName, version, isLoading) => {
    const key = version ? `${serviceName}-${version}` : serviceName;
    setLoadingServices(prev => {
      const newSet = new Set(prev);
      if (isLoading) {
        newSet.add(key);
      } else {
        newSet.delete(key);
      }
      return newSet;
    });
  }, []);

  // Auto-refresh services when component mounts and set up polling interval
  useEffect(() => {
    refreshServices();
    const intervalId = setInterval(() => {
      refreshServices();
    }, 3000);
    return () => clearInterval(intervalId);
  }, [refreshServices]);

  // Load binaries status (installed versions)
  useEffect(() => {
    const loadBinariesStatus = async () => {
      try {
        const status = await window.devbox?.binaries.getStatus();
        setBinariesStatus(status || {});
      } catch (err) {
        // Error loading binaries status
      }
    };

    loadBinariesStatus();
    const intervalId = setInterval(loadBinariesStatus, 5000);
    return () => clearInterval(intervalId);
  }, []);

  // Load running versions periodically
  useEffect(() => {
    const loadRunningVersions = async () => {
      try {
        const running = await window.devbox?.services.getRunningVersions();
        setRunningVersions(running || {});
      } catch (err) {
        // Failed to get running versions
      }
    };

    loadRunningVersions();
    const intervalId = setInterval(loadRunningVersions, 3000);
    return () => clearInterval(intervalId);
  }, []);

  // Helper to check if a specific version is installed
  const isVersionInstalled = useCallback((serviceName, version) => {
    return binariesStatus?.[serviceName]?.[version]?.installed === true;
  }, [binariesStatus]);

  // Helper to get all installed versions for a service
  const getInstalledVersions = useCallback((serviceName) => {
    const serviceStatus = binariesStatus?.[serviceName];
    if (!serviceStatus || typeof serviceStatus !== 'object') return [];
    return Object.entries(serviceStatus)
      .filter(([v, status]) => status?.installed === true)
      .map(([v]) => v);
  }, [binariesStatus]);

  // Get running projects
  const runningProjects = useMemo(() => {
    return projects.filter(p => p.isRunning);
  }, [projects]);

  // Determine required services based on running projects
  const requiredServices = useMemo(() => {
    const required = new Set();

    for (const project of runningProjects) {
      const webServer = project.webServer || 'nginx';
      required.add(webServer);

      if (project.services?.mysql) required.add('mysql');
      if (project.services?.mariadb) required.add('mariadb');
      if (project.services?.redis) required.add('redis');

      required.add('mailpit');
      if (project.services?.mysql || project.services?.mariadb) {
        required.add('phpmyadmin');
      }
    }

    return required;
  }, [runningProjects]);

  // Service info with icons (use config for versions/ports)
  const serviceInfo = useMemo(() => ({
    mysql: {
      name: 'MySQL',
      description: 'Relational database server',
      icon: Database,
      color: 'blue',
      defaultPort: serviceConfig.defaultPorts.mysql || 3306,
      versioned: true,
      versions: serviceConfig.versions.mysql || [],
    },
    mariadb: {
      name: 'MariaDB',
      description: 'MySQL-compatible database server',
      icon: Database,
      color: 'teal',
      defaultPort: serviceConfig.defaultPorts.mariadb || 3306,
      versioned: true,
      versions: serviceConfig.versions.mariadb || [],
    },
    redis: {
      name: 'Redis',
      description: 'In-memory data store and cache',
      icon: HardDrive,
      color: 'red',
      defaultPort: serviceConfig.defaultPorts.redis || 6379,
      versioned: true,
      versions: serviceConfig.versions.redis || [],
    },
    nginx: {
      name: 'Nginx',
      description: 'High-performance web server',
      icon: Globe,
      color: 'green',
      defaultPort: serviceConfig.defaultPorts.nginx || 80,
      versioned: true,
      versions: serviceConfig.versions.nginx || [],
    },
    apache: {
      name: 'Apache',
      description: 'Full-featured web server',
      icon: Box,
      color: 'orange',
      defaultPort: serviceConfig.defaultPorts.apache || 8081,
      versioned: true,
      versions: serviceConfig.versions.apache || [],
    },
    mailpit: {
      name: 'Mailpit',
      description: 'Email testing and capture',
      icon: Mail,
      color: 'green',
      defaultPort: serviceConfig.defaultPorts.mailpit || 8025,
      webUrl: `http://localhost:${serviceConfig.defaultPorts.mailpit || 8025}`,
    },
    phpmyadmin: {
      name: 'phpMyAdmin',
      description: 'Database management interface',
      icon: Server,
      color: 'orange',
      defaultPort: serviceConfig.defaultPorts.phpmyadmin || 8080,
      webUrl: `http://localhost:${serviceConfig.defaultPorts.phpmyadmin || 8080}`,
    },
  }), [serviceConfig]);

  // Get the port for a service version
  const getServicePort = useCallback((serviceName, version) => {
    const info = serviceInfo[serviceName];
    if (!info) return null;

    const basePort = info.defaultPort;
    const offset = serviceConfig.portOffsets[serviceName]?.[version] || 0;
    return basePort + offset;
  }, [serviceInfo, serviceConfig.portOffsets]);

  // Build list of service cards to display (including individual version cards)
  const serviceCards = useMemo(() => {
    const cards = [];
    const servicesToShow = runningProjects.length === 0
      ? Object.keys(serviceInfo).filter(n => n !== 'nginx' && n !== 'apache')
      : Array.from(requiredServices);

    for (const name of servicesToShow) {
      const info = serviceInfo[name];
      if (!info) continue;

      if (info.versioned) {
        const installedVersions = getInstalledVersions(name);

        if (installedVersions.length === 0) {
          // No versions installed - show placeholder card
          cards.push({
            type: 'placeholder',
            serviceName: name,
            info,
            allVersions: info.versions,
          });
        } else {
          // Add a card for each installed version
          for (const version of installedVersions) {
            const isRunning = runningVersions[name]?.includes(version);
            cards.push({
              type: 'version',
              serviceName: name,
              version,
              info,
              isRunning,
              port: getServicePort(name, version),
            });
          }
        }
      } else {
        // Non-versioned service (mailpit, phpmyadmin)
        // Check if installed first
        const isInstalled = binariesStatus?.[name]?.installed === true;

        if (!isInstalled) {
          // Not installed - show placeholder card
          cards.push({
            type: 'placeholder',
            serviceName: name,
            info,
            allVersions: [], // No versions for simple services
          });
        } else {
          const isRunning = services[name]?.status === 'running';
          cards.push({
            type: 'simple',
            serviceName: name,
            info,
            service: services[name] || { status: 'stopped' },
            isRunning,
          });
        }
      }
    }

    return cards;
  }, [services, runningProjects, requiredServices, getInstalledVersions, runningVersions, getServicePort, binariesStatus]);

  const handleStartAll = async () => {
    // Mark all services as loading
    const allKeys = serviceCards
      .filter(c => c.type !== 'placeholder')
      .map(c => c.type === 'version' ? `${c.serviceName}-${c.version}` : c.serviceName);
    setLoadingServices(new Set(allKeys));
    try {
      await window.devbox?.services.startAll();
      await refreshServices();
    } finally {
      setLoadingServices(new Set());
    }
  };

  const handleStopAll = async () => {
    // Mark all running services as loading
    const runningKeys = serviceCards
      .filter(c => c.isRunning)
      .map(c => c.type === 'version' ? `${c.serviceName}-${c.version}` : c.serviceName);
    setLoadingServices(new Set(runningKeys));
    try {
      await window.devbox?.services.stopAll();
      await refreshServices();
    } finally {
      setLoadingServices(new Set());
    }
  };

  const handleToggleService = async (name, isRunning, version = null) => {
    setServiceLoading(name, version, true);
    try {
      if (isRunning) {
        await stopService(name, version);
      } else {
        await startService(name, version);
      }
    } finally {
      setServiceLoading(name, version, false);
    }
  };

  const runningCount = serviceCards.filter(c => c.isRunning).length;
  const totalCount = serviceCards.filter(c => c.type !== 'placeholder').length;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Services</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Manage your development services
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleStartAll}
            disabled={loadingServices.size > 0 || runningCount === totalCount}
            className="btn-success"
          >
            <Play className="w-4 h-4" />
            Start All
          </button>
          <button
            onClick={handleStopAll}
            disabled={loadingServices.size > 0 || runningCount === 0}
            className="btn-danger"
          >
            <Square className="w-4 h-4" />
            Stop All
          </button>
          <button onClick={refreshServices} disabled={loadingServices.size > 0} className="btn-secondary">
            <RefreshCw className={clsx('w-4 h-4', loadingServices.size > 0 && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Resource Usage */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <ResourceCard
          icon={Cpu}
          label="CPU Usage"
          value={`${Math.round(resourceUsage.total?.cpu || 0)}%`}
          color="blue"
        />
        <ResourceCard
          icon={MemoryStick}
          label="Memory Usage"
          value={formatBytes(resourceUsage.total?.memory || 0)}
          color="green"
        />
        <ResourceCard
          icon={Gauge}
          label="Services Running"
          value={`${runningCount}/${totalCount}`}
          color="purple"
        />
      </div>

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {serviceCards.map((card, index) => {
          if (card.type === 'placeholder') {
            return (
              <PlaceholderCard
                key={`${card.serviceName}-placeholder`}
                serviceName={card.serviceName}
                info={card.info}
                allVersions={card.allVersions}
              />
            );
          } else if (card.type === 'version') {
            return (
              <VersionServiceCard
                key={`${card.serviceName}-${card.version}`}
                serviceName={card.serviceName}
                version={card.version}
                info={card.info}
                isRunning={card.isRunning}
                port={card.port}
                loading={isServiceLoading(card.serviceName, card.version)}
                onToggle={() => handleToggleService(card.serviceName, card.isRunning, card.version)}
                resourceUsage={resourceUsage.services?.[`${card.serviceName}-${card.version}`]}
              />
            );
          } else {
            return (
              <SimpleServiceCard
                key={card.serviceName}
                serviceName={card.serviceName}
                info={card.info}
                service={card.service}
                isRunning={card.isRunning}
                loading={isServiceLoading(card.serviceName)}
                onToggle={() => handleToggleService(card.serviceName, card.isRunning)}
                resourceUsage={resourceUsage.services?.[card.serviceName]}
              />
            );
          }
        })}
      </div>

      {serviceCards.length === 0 && (
        <div className="card p-12 text-center">
          <Server className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No services active
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            {runningProjects.length === 0
              ? 'Start a project to see its required services here'
              : 'No services configured for running projects'}
          </p>
          {runningProjects.length === 0 && (
            <Link to="/projects" className="btn-primary inline-flex">
              Go to Projects
            </Link>
          )}
        </div>
      )}

      {/* Running Projects Summary */}
      {runningProjects.length > 0 && (
        <div className="mt-8 card p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
          <div className="flex items-center gap-2 text-blue-800 dark:text-blue-200">
            <AlertTriangle className="w-5 h-5" />
            <span className="font-medium">
              {runningProjects.length} project{runningProjects.length > 1 ? 's' : ''} running:
            </span>
            <span className="text-blue-600 dark:text-blue-300">
              {runningProjects.map(p => p.name).join(', ')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function ResourceCard({ icon: Icon, label, value, color }) {
  const colorClasses = {
    blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    green: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
    purple: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
  };

  return (
    <div className="card p-6">
      <div className="flex items-center gap-4">
        <div className={clsx('p-3 rounded-xl', colorClasses[color])}>
          <Icon className="w-6 h-6" />
        </div>
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
        </div>
      </div>
    </div>
  );
}

// Card for versioned service with specific version
function VersionServiceCard({
  serviceName,
  version,
  info,
  isRunning,
  port,
  loading,
  onToggle,
  resourceUsage
}) {
  const Icon = info.icon;

  const colorClasses = {
    blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    red: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
    green: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
    orange: 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
    teal: 'bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400',
    gray: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  };

  return (
    <div className={clsx(
      'card overflow-hidden transition-all',
      isRunning && 'ring-2 ring-green-500 dark:ring-green-400'
    )}>
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={clsx('p-2.5 rounded-xl', colorClasses[info.color])}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                {info.name}
                <span className="text-sm font-normal px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded-md">
                  v{version}
                </span>
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {info.description}
              </p>
            </div>
          </div>
          <span className={clsx('badge text-xs', isRunning ? 'badge-success' : 'badge-neutral')}>
            {isRunning ? 'running' : 'stopped'}
          </span>
        </div>

        {/* Service Info */}
        <div className="flex items-center gap-4 text-sm mb-3">
          <div>
            <span className="text-gray-500 dark:text-gray-400">Port: </span>
            <span className="font-medium text-gray-900 dark:text-white">{port}</span>
          </div>
          {isRunning && resourceUsage && (
            <div>
              <span className="text-gray-500 dark:text-gray-400">Memory: </span>
              <span className="font-medium text-gray-900 dark:text-white">
                {formatBytes(resourceUsage.memory)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <button
          onClick={onToggle}
          disabled={loading}
          className={clsx(isRunning ? 'btn-danger' : 'btn-success', 'btn-sm')}
        >
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              {isRunning ? 'Stopping...' : 'Starting...'}
            </>
          ) : isRunning ? (
            <>
              <Square className="w-4 h-4" />
              Stop
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Start
            </>
          )}
        </button>

        {isRunning && info.webUrl && (
          <a
            href={info.webUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost btn-sm"
          >
            <ExternalLink className="w-4 h-4" />
            Open
          </a>
        )}
      </div>
    </div>
  );
}

// Card for non-versioned services (mailpit, phpmyadmin)
function SimpleServiceCard({
  serviceName,
  info,
  service,
  isRunning,
  loading,
  onToggle,
  resourceUsage
}) {
  const Icon = info.icon;

  const colorClasses = {
    blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    red: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
    green: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
    orange: 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
    teal: 'bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400',
    gray: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  };

  return (
    <div className={clsx(
      'card overflow-hidden transition-all',
      isRunning && 'ring-2 ring-green-500 dark:ring-green-400'
    )}>
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={clsx('p-2.5 rounded-xl', colorClasses[info.color])}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {info.name}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {info.description}
              </p>
            </div>
          </div>
          <span className={clsx('badge text-xs', isRunning ? 'badge-success' : 'badge-neutral')}>
            {isRunning ? 'running' : 'stopped'}
          </span>
        </div>

        {/* Service Info */}
        <div className="flex items-center gap-4 text-sm mb-3">
          <div>
            <span className="text-gray-500 dark:text-gray-400">Port: </span>
            <span className="font-medium text-gray-900 dark:text-white">
              {service.port || info.defaultPort}
            </span>
          </div>
          {isRunning && resourceUsage && (
            <div>
              <span className="text-gray-500 dark:text-gray-400">Memory: </span>
              <span className="font-medium text-gray-900 dark:text-white">
                {formatBytes(resourceUsage.memory)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <button
          onClick={onToggle}
          disabled={loading}
          className={clsx(isRunning ? 'btn-danger' : 'btn-success', 'btn-sm')}
        >
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              {isRunning ? 'Stopping...' : 'Starting...'}
            </>
          ) : isRunning ? (
            <>
              <Square className="w-4 h-4" />
              Stop
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Start
            </>
          )}
        </button>

        {isRunning && info.webUrl && (
          <a
            href={info.webUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost btn-sm"
          >
            <ExternalLink className="w-4 h-4" />
            Open
          </a>
        )}
      </div>
    </div>
  );
}

// Placeholder card when no versions are installed
function PlaceholderCard({ serviceName, info, allVersions }) {
  const Icon = info.icon;

  const colorClasses = {
    blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    red: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
    green: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
    orange: 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
    teal: 'bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400',
    gray: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  };

  return (
    <div className="card overflow-hidden opacity-60">
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={clsx('p-2.5 rounded-xl', colorClasses[info.color])}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {info.name}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {info.description}
              </p>
            </div>
          </div>
          <span className="badge badge-neutral text-xs">not installed</span>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
          Available versions: {allVersions.join(', ')}
        </p>
      </div>

      <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700">
        <Link
          to="/binaries"
          className="btn-primary btn-sm inline-flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          Install from Binaries
        </Link>
      </div>
    </div>
  );
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export default Services;
