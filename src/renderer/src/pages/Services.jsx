import React, { useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import clsx from 'clsx';

function Services() {
  const { services, resourceUsage, startService, stopService, refreshServices, projects } = useApp();
  const [loading, setLoading] = useState(false);

  // Auto-refresh services when component mounts and set up polling interval
  useEffect(() => {
    // Refresh immediately when the tab is shown
    refreshServices();

    // Set up polling interval for real-time updates (every 3 seconds)
    const intervalId = setInterval(() => {
      refreshServices();
    }, 3000);

    // Cleanup interval on unmount
    return () => clearInterval(intervalId);
  }, [refreshServices]);

  // Get running projects
  const runningProjects = useMemo(() => {
    return projects.filter(p => p.isRunning);
  }, [projects]);

  // Determine required services based on running projects
  const requiredServices = useMemo(() => {
    const required = new Set();
    
    for (const project of runningProjects) {
      // Web server
      const webServer = project.webServer || 'nginx';
      required.add(webServer);
      
      // Database
      if (project.services?.mysql) required.add('mysql');
      if (project.services?.mariadb) required.add('mariadb');
      
      // Other services
      if (project.services?.redis) required.add('redis');
      
      // Always include mailpit and phpmyadmin if any project is running
      required.add('mailpit');
      if (project.services?.mysql || project.services?.mariadb) {
        required.add('phpmyadmin');
      }
    }
    
    return required;
  }, [runningProjects]);

  const serviceInfo = {
    nginx: {
      name: 'Nginx',
      description: 'High-performance web server',
      icon: Globe,
      color: 'green',
      defaultPort: 80,
    },
    apache: {
      name: 'Apache',
      description: 'Full-featured web server',
      icon: Box,
      color: 'red',
      defaultPort: 80,
    },
    mysql: {
      name: 'MySQL',
      description: 'Relational database server',
      icon: Database,
      color: 'blue',
      defaultPort: 3306,
    },
    mariadb: {
      name: 'MariaDB',
      description: 'MySQL-compatible database server',
      icon: Database,
      color: 'teal',
      defaultPort: 3306,
    },
    redis: {
      name: 'Redis',
      description: 'In-memory data store and cache',
      icon: HardDrive,
      color: 'red',
      defaultPort: 6379,
    },
    mailpit: {
      name: 'Mailpit',
      description: 'Email testing and capture',
      icon: Mail,
      color: 'green',
      defaultPort: 8025,
      webUrl: 'http://localhost:8025',
    },
    phpmyadmin: {
      name: 'phpMyAdmin',
      description: 'Database management interface',
      icon: Server,
      color: 'orange',
      defaultPort: 8080,
      webUrl: 'http://localhost:8080',
    },
  };

  // Filter services to show only those required by running projects
  // If no projects are running, show all available services
  // Always base on serviceInfo (static definition) and merge with backend status
  const filteredServices = useMemo(() => {
    const result = {};
    
    if (runningProjects.length === 0) {
      // No running projects - show core services (without web server)
      for (const [name, info] of Object.entries(serviceInfo)) {
        // Don't show web servers when no projects are running
        if (name === 'nginx' || name === 'apache') continue;
        // Merge static info with backend status
        result[name] = {
          ...info,
          ...(services[name] || { status: 'stopped' }),
        };
      }
    } else {
      // Show only services required by running projects
      for (const name of requiredServices) {
        if (serviceInfo[name]) {
          // Merge static info with backend status
          result[name] = {
            ...serviceInfo[name],
            ...(services[name] || { status: 'stopped' }),
          };
        }
      }
    }
    
    return result;
  }, [serviceInfo, services, runningProjects, requiredServices]);

  const handleStartAll = async () => {
    setLoading(true);
    try {
      await window.devbox?.services.startAll();
      await refreshServices();
    } finally {
      setLoading(false);
    }
  };

  const handleStopAll = async () => {
    setLoading(true);
    try {
      await window.devbox?.services.stopAll();
      await refreshServices();
    } finally {
      setLoading(false);
    }
  };

  const handleToggleService = async (name, isRunning) => {
    setLoading(true);
    try {
      if (isRunning) {
        await stopService(name);
      } else {
        await startService(name);
      }
    } finally {
      setLoading(false);
    }
  };

  const runningCount = Object.values(filteredServices).filter((s) => s.status === 'running').length;
  const totalCount = Object.keys(filteredServices).length;

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
            disabled={loading || runningCount === totalCount}
            className="btn-success"
          >
            <Play className="w-4 h-4" />
            Start All
          </button>
          <button
            onClick={handleStopAll}
            disabled={loading || runningCount === 0}
            className="btn-danger"
          >
            <Square className="w-4 h-4" />
            Stop All
          </button>
          <button onClick={refreshServices} disabled={loading} className="btn-secondary">
            <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {Object.entries(filteredServices).map(([name, service]) => {
          const info = serviceInfo[name] || {
            name: service.name || name,
            description: 'Service',
            icon: Server,
            color: 'gray',
          };
          const isRunning = service.status === 'running';

          return (
            <ServiceCard
              key={name}
              name={name}
              info={info}
              service={service}
              isRunning={isRunning}
              resourceUsage={resourceUsage.services?.[name]}
              loading={loading}
              onToggle={() => handleToggleService(name, isRunning)}
            />
          );
        })}
      </div>

      {Object.keys(filteredServices).length === 0 && (
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

function ServiceCard({ name, info, service, isRunning, resourceUsage, loading, onToggle }) {
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
    <div className="card overflow-hidden">
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className={clsx('p-3 rounded-xl', colorClasses[info.color])}>
              <Icon className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {info.name}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {info.description}
              </p>
            </div>
          </div>
          <span className={clsx('badge', isRunning ? 'badge-success' : 'badge-neutral')}>
            {service.status}
          </span>
        </div>

        {/* Service Info */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Port</p>
            <p className="font-medium text-gray-900 dark:text-white">
              {service.port || info.defaultPort}
            </p>
          </div>
          {isRunning && (
            <>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">PID</p>
                <p className="font-medium text-gray-900 dark:text-white">
                  {service.pid || '-'}
                </p>
              </div>
              {service.uptime && (
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Uptime</p>
                  <p className="font-medium text-gray-900 dark:text-white">
                    {formatUptime(service.uptime)}
                  </p>
                </div>
              )}
              {resourceUsage && (
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Memory</p>
                  <p className="font-medium text-gray-900 dark:text-white">
                    {formatBytes(resourceUsage.memory)}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <button
          onClick={onToggle}
          disabled={loading}
          className={clsx(isRunning ? 'btn-danger' : 'btn-success', 'btn-sm')}
        >
          {isRunning ? (
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
