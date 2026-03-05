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
  MemoryStick,
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
  postgresql: Database,
  mongodb: Database,
  memcached: MemoryStick,
  minio: HardDrive,
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

      {/* Stats Grid - Bento Box Style */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="md:col-span-2">
          <StatCard
            title="Total Projects"
            value={projects.length}
            icon={Folder}
            color="blue"
            description="Active codebases"
          />
        </div>
        <div className="md:col-span-1">
          <StatCard
            title="Running"
            value={runningProjects.length}
            icon={Activity}
            color="green"
            description="Projects"
          />
        </div>
        <div className="md:col-span-1">
          <StatCard
            title="Active"
            value={runningServices.length}
            icon={HardDrive}
            color="purple"
            description="Services"
          />
        </div>
      </div>

      {/* Main Content Bento Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Recent Projects */}
        <div className="card lg:col-span-7 flex flex-col h-full">
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
        <div className="card lg:col-span-5 flex flex-col h-full">
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

function StatCard({ title, value, icon: Icon, color, description }) {
  const colorStyles = {
    blue: {
      bg: 'from-blue-500/10 to-blue-500/5 dark:from-blue-500/20 dark:to-blue-500/10',
      iconBg: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
      border: 'border-blue-500/20 dark:border-blue-500/10',
    },
    green: {
      bg: 'from-green-500/10 to-green-500/5 dark:from-green-500/20 dark:to-green-500/10',
      iconBg: 'bg-green-500/20 text-green-600 dark:text-green-400',
      border: 'border-green-500/20 dark:border-green-500/10',
    },
    purple: {
      bg: 'from-purple-500/10 to-purple-500/5 dark:from-purple-500/20 dark:to-purple-500/10',
      iconBg: 'bg-purple-500/20 text-purple-600 dark:text-purple-400',
      border: 'border-purple-500/20 dark:border-purple-500/10',
    },
    orange: {
      bg: 'from-orange-500/10 to-orange-500/5 dark:from-orange-500/20 dark:to-orange-500/10',
      iconBg: 'bg-orange-500/20 text-orange-600 dark:text-orange-400',
      border: 'border-orange-500/20 dark:border-orange-500/10',
    },
  };

  const style = colorStyles[color];

  return (
    <div className={clsx("card h-full p-6 bg-gradient-to-br border relative overflow-hidden group", style.bg, style.border)}>
      {/* Decorative background glow */}
      <div className="absolute -right-8 -top-8 w-32 h-32 bg-white/20 dark:bg-white/5 rounded-full blur-3xl group-hover:bg-white/30 dark:group-hover:bg-white/10 transition-colors duration-500" />

      <div className="flex flex-col h-full justify-between relative z-10">
        <div className="flex items-start justify-between">
          <div className={clsx('p-3 rounded-2xl backdrop-blur-md', style.iconBg)}>
            <Icon className="w-6 h-6" />
          </div>
        </div>

        <div className="mt-4">
          <p className="text-4xl font-black tracking-tight text-gray-900 dark:text-white drop-shadow-sm">{value}</p>
          <div className="mt-1 flex items-baseline gap-2">
            <p className="text-base font-semibold text-gray-800 dark:text-gray-200">{title}</p>
            {description && <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{description}</p>}
          </div>
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
    <div className="p-4 flex items-center justify-between hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors group">
      <div className="flex items-center gap-4">
        <div className={statusColors[isStarting ? 'starting' : (project.isRunning ? 'running' : 'stopped')]} />
        <div>
          <Link
            to={`/projects/${project.id}`}
            className="font-semibold text-gray-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors"
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
    <div className="p-4 flex items-center justify-between hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors">
      <div className="flex items-center gap-4">
        <div className={isRunning ? 'status-running' : 'status-stopped'} />
        <div>
          <p className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Icon className="w-4 h-4 text-gray-400" />
            {displayName}
          </p>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Port: <span className="text-gray-900 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-md">{port}</span>
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
