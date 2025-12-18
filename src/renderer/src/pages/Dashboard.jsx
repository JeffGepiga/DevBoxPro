import React, { useMemo } from 'react';
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
} from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';

function Dashboard() {
  const { projects, services, resourceUsage, loading, startProject, stopProject } = useApp();

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

  // Filter services to show only those required by running projects
  const filteredServices = useMemo(() => {
    const result = {};
    
    if (runningProjects.length === 0) {
      // No running projects - show core services (without web server)
      for (const [name, service] of Object.entries(services)) {
        if (name === 'nginx' || name === 'apache') continue;
        result[name] = service;
      }
    } else {
      // Show only services required by running projects
      for (const [name, service] of Object.entries(services)) {
        if (requiredServices.has(name)) {
          result[name] = service;
        }
      }
    }
    
    return result;
  }, [services, runningProjects, requiredServices]);

  const runningServices = Object.values(filteredServices).filter((s) => s.status === 'running');

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
            {Object.entries(filteredServices).map(([name, service]) => (
              <ServiceRow key={name} name={name} service={service} />
            ))}
            {Object.keys(filteredServices).length === 0 && (
              <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                <p>No services configured</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <QuickAction
            icon={Play}
            label="Start All"
            onClick={() => window.devbox?.services.startAll()}
          />
          <QuickAction
            icon={Square}
            label="Stop All"
            onClick={() => window.devbox?.services.stopAll()}
          />
          <QuickAction
            icon={Globe}
            label="Open phpMyAdmin"
            onClick={async () => {
              const url = await window.devbox?.database.getPhpMyAdminUrl();
              if (url) window.devbox?.system.openExternal(url);
            }}
          />
          <QuickAction
            icon={ExternalLink}
            label="Open Mailpit"
            onClick={() => window.devbox?.system.openExternal('http://localhost:8025')}
          />
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
  const statusColors = {
    running: 'status-running',
    stopped: 'status-stopped',
    error: 'status-error',
    starting: 'status-starting',
  };

  return (
    <div className="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
      <div className="flex items-center gap-3">
        <div className={statusColors[project.isRunning ? 'running' : 'stopped']} />
        <div>
          <Link
            to={`/projects/${project.id}`}
            className="font-medium text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400"
          >
            {project.name}
          </Link>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            PHP {project.phpVersion} • {project.type}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {project.isRunning ? (
          <>
            <a
              href={`http://localhost:${project.port}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost btn-sm btn-icon"
              title="Open in browser"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              onClick={onStop}
              className="btn-ghost btn-sm btn-icon text-red-500 hover:text-red-600"
              title="Stop"
            >
              <Square className="w-4 h-4" />
            </button>
          </>
        ) : (
          <button
            onClick={onStart}
            className="btn-ghost btn-sm btn-icon text-green-500 hover:text-green-600"
            title="Start"
          >
            <Play className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function ServiceRow({ name, service }) {
  const isRunning = service.status === 'running';

  return (
    <div className="p-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={isRunning ? 'status-running' : 'status-stopped'} />
        <div>
          <p className="font-medium text-gray-900 dark:text-white">{service.name}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Port: {service.port}
          </p>
        </div>
      </div>
      <span className={clsx('badge', isRunning ? 'badge-success' : 'badge-neutral')}>
        {service.status}
      </span>
    </div>
  );
}

function QuickAction({ icon: Icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="card p-4 flex flex-col items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
    >
      <Icon className="w-6 h-6 text-gray-600 dark:text-gray-400" />
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
    </button>
  );
}

export default Dashboard;
