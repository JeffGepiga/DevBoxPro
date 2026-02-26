import React, { useMemo, useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  Play,
  Square,
  RefreshCw,
  ExternalLink,
  Folder,
  Code,
  MoreVertical,
  Globe,
  Cpu,
  HardDrive,
  Activity,
  Database,
  Mail,
  Server,
  Box,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';

// Service icons mapping (ports and versions come from backend)
const SERVICE_ICONS = {
  mysql: Database,
  mariadb: Database,
  redis: HardDrive,
  nginx: Globe,
  apache: Box,
  mailpit: Mail,
  phpmyadmin: Server,
};

function Dashboard() {
  const { projects, services, resourceUsage, loading, startProject, stopProject, refreshServices, refreshProjects } = useApp();
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

  // Auto-refresh on mount and set up polling for real-time updates
  useEffect(() => {
    refreshServices();
    refreshProjects();

    const intervalId = setInterval(() => {
      refreshServices();
      refreshProjects();
    }, 5000);

    return () => clearInterval(intervalId);
  }, [refreshServices, refreshProjects]);

  // Load binaries status
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

  // Load running versions
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
    const intervalId = setInterval(loadRunningVersions, 5000);
    return () => clearInterval(intervalId);
  }, []);

  // Build SERVICE_INFO dynamically from config
  const SERVICE_INFO = useMemo(() => ({
    mysql: { name: 'MySQL', icon: SERVICE_ICONS.mysql, color: 'blue', defaultPort: serviceConfig.defaultPorts.mysql || 3306 },
    mariadb: { name: 'MariaDB', icon: SERVICE_ICONS.mariadb, color: 'teal', defaultPort: serviceConfig.defaultPorts.mariadb || 3306 },
    redis: { name: 'Redis', icon: SERVICE_ICONS.redis, color: 'red', defaultPort: serviceConfig.defaultPorts.redis || 6379 },
    nginx: { name: 'Nginx', icon: SERVICE_ICONS.nginx, color: 'green', defaultPort: serviceConfig.defaultPorts.nginx || 80 },
    apache: { name: 'Apache', icon: SERVICE_ICONS.apache, color: 'orange', defaultPort: serviceConfig.defaultPorts.apache || 8081 },
    mailpit: { name: 'Mailpit', icon: SERVICE_ICONS.mailpit, color: 'green', defaultPort: serviceConfig.defaultPorts.mailpit || 8025 },
    phpmyadmin: { name: 'phpMyAdmin', icon: SERVICE_ICONS.phpmyadmin, color: 'orange', defaultPort: serviceConfig.defaultPorts.phpmyadmin || 8080 },
  }), [serviceConfig.defaultPorts]);

  // Helper to get installed versions for a service
  const getInstalledVersions = (serviceName) => {
    const serviceStatus = binariesStatus?.[serviceName];
    if (!serviceStatus || typeof serviceStatus !== 'object') return [];
    return Object.entries(serviceStatus)
      .filter(([v, status]) => status?.installed === true)
      .map(([v]) => v);
  };

  // Get the port for a service version
  const getServicePort = (serviceName, version) => {
    const info = SERVICE_INFO[serviceName];
    if (!info) return null;

    const basePort = info.defaultPort;
    const offset = serviceConfig.portOffsets[serviceName]?.[version] || 0;
    return basePort + offset;
  };

  // Get running projects
  const runningProjects = useMemo(() => {
    return projects.filter(p => p.isRunning);
  }, [projects]);

  // Build service cards for dashboard
  const serviceCards = useMemo(() => {
    const cards = [];
    const versionedServices = ['mysql', 'mariadb', 'redis'];
    const simpleServices = ['mailpit', 'phpmyadmin'];

    // Add versioned service cards
    for (const name of versionedServices) {
      const installedVersions = getInstalledVersions(name);
      const serviceRunningVersions = runningVersions[name] || [];

      for (const version of installedVersions) {
        const isRunning = serviceRunningVersions.includes(version);
        cards.push({
          type: 'version',
          serviceName: name,
          version,
          isRunning,
          port: getServicePort(name, version),
        });
      }
    }

    // Add simple service cards
    for (const name of simpleServices) {
      const isRunning = services[name]?.status === 'running';
      cards.push({
        type: 'simple',
        serviceName: name,
        isRunning,
        port: services[name]?.port || SERVICE_INFO[name]?.defaultPort,
      });
    }

    return cards;
  }, [binariesStatus, runningVersions, services]);

  const runningServices = serviceCards.filter(c => c.isRunning);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Overview of your development environment
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Total Projects"
          value={projects.length}
          icon={Folder}
          color="blue"
        />
        <StatCard
          title="Running Projects"
          value={runningProjects.length}
          icon={Activity}
          color="green"
        />
        <StatCard
          title="Active Services"
          value={runningServices.length}
          icon={HardDrive}
          color="purple"
        />
        <StatCard
          title="CPU Usage"
          value={`${Math.round(resourceUsage.total?.cpu || 0)}%`}
          icon={Cpu}
          color="orange"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Projects */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Recent Projects
            </h2>
            <Link to="/projects" className="text-sm text-primary-600 hover:text-primary-700">
              View all
            </Link>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {projects.slice(0, 5).map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                onStart={() => startProject(project.id)}
                onStop={() => stopProject(project.id)}
              />
            ))}
            {projects.length === 0 && (
              <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                <p>No projects yet</p>
                <Link to="/projects/new" className="text-primary-600 hover:text-primary-700 mt-2 inline-block">
                  Create your first project
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Services Status */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Services
            </h2>
            <Link to="/services" className="text-sm text-primary-600 hover:text-primary-700">
              Manage
            </Link>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {serviceCards.slice(0, 6).map((card) => (
              <ServiceRow
                key={card.type === 'version' ? `${card.serviceName}-${card.version}` : card.serviceName}
                serviceName={card.serviceName}
                version={card.type === 'version' ? card.version : null}
                isRunning={card.isRunning}
                port={card.port}
                serviceInfo={SERVICE_INFO}
              />
            ))}
            {serviceCards.length === 0 && (
              <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                <p>No services installed</p>
                <Link to="/binaries" className="text-primary-600 hover:text-primary-700 mt-2 inline-block">
                  Install services from Binaries
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>


    </div>
  );
}

function StatCard({ title, value, icon: Icon, color }) {
  const colorClasses = {
    blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    green: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
    purple: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
    orange: 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
  };

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{value}</p>
        </div>
        <div className={clsx('p-3 rounded-xl', colorClasses[color])}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}

function ProjectRow({ project, onStart, onStop }) {
  const { projectLoadingStates, setProjectLoading } = useApp();
  const loadingState = projectLoadingStates[project.id];
  const isStarting = loadingState === 'starting';
  const isStopping = loadingState === 'stopping';

  const handleStart = async () => {
    setProjectLoading(project.id, 'starting');
    try {
      await onStart();
    } finally {
      setProjectLoading(project.id, null);
    }
  };

  const handleStop = async () => {
    setProjectLoading(project.id, 'stopping');
    try {
      await onStop();
    } finally {
      setProjectLoading(project.id, null);
    }
  };

  const statusColors = {
    running: 'status-running',
    stopped: 'status-stopped',
    error: 'status-error',
    starting: 'status-starting',
  };

  return (
    <div className="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
      <div className="flex items-center gap-3">
        <div className={statusColors[isStarting ? 'starting' : (project.isRunning ? 'running' : 'stopped')]} />
        <div>
          <Link
            to={`/projects/${project.id}`}
            className="font-medium text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400"
          >
            {project.name}
          </Link>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {project.type === 'nodejs'
              ? `Node.js v${project.services?.nodejsVersion || project.nodeVersion || '?'}${project.nodeFramework ? ` • ${{
                express: 'Express', fastify: 'Fastify', nestjs: 'NestJS', nextjs: 'Next.js',
                nuxtjs: 'Nuxt.js', koa: 'Koa', hapi: 'Hapi', adonisjs: 'AdonisJS',
                remix: 'Remix', sveltekit: 'SvelteKit', strapi: 'Strapi', elysia: 'Elysia',
              }[project.nodeFramework] || project.nodeFramework}` : ''}`
              : [
                project.phpVersion ? `PHP ${project.phpVersion}` : null,
                project.type || null,
              ].filter(Boolean).join(' • ') || 'No runtime info'}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {project.isRunning ? (
          <>
            <button
              onClick={() => window.devbox?.projects.openInBrowser(project.id)}
              className="btn-ghost btn-sm btn-icon"
              title="Open in browser"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
            <button
              onClick={handleStop}
              disabled={isStopping}
              className="btn-ghost btn-sm btn-icon text-red-500 hover:text-red-600"
              title="Stop"
            >
              {isStopping ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Square className="w-4 h-4" />
              )}
            </button>
          </>
        ) : (
          <button
            onClick={handleStart}
            disabled={isStarting}
            className="btn-ghost btn-sm btn-icon text-green-500 hover:text-green-600"
            title="Start"
          >
            {isStarting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function ServiceRow({ serviceName, version, isRunning, port, serviceInfo }) {
  const info = serviceInfo?.[serviceName];
  const Icon = info?.icon || Server;
  const displayName = version ? `${info?.name || serviceName} v${version}` : (info?.name || serviceName);

  return (
    <div className="p-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={isRunning ? 'status-running' : 'status-stopped'} />
        <div>
          <p className="font-medium text-gray-900 dark:text-white">{displayName}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Port: {port}
          </p>
        </div>
      </div>
      <span className={clsx('badge', isRunning ? 'badge-success' : 'badge-neutral')}>
        {isRunning ? 'running' : 'stopped'}
      </span>
    </div>
  );
}



export default Dashboard;
