import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import ProjectTerminal from '../components/ProjectTerminal';
import {
  ArrowLeft,
  Play,
  Square,
  RefreshCw,
  ExternalLink,
  Folder,
  Code,
  Settings,
  Terminal,
  Database,
  Activity,
  Clock,
  Globe,
  FileText,
  Cpu,
  Plus,
  Trash2,
} from 'lucide-react';
import clsx from 'clsx';

function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { projects, startProject, stopProject, deleteProject } = useApp();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'overview');
  const [project, setProject] = useState(null);
  const [logs, setLogs] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [loading, setLoading] = useState(true);

  // Update tab from URL params
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && ['overview', 'terminal', 'logs', 'workers', 'environment'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  useEffect(() => {
    const foundProject = projects.find((p) => p.id === id);
    setProject(foundProject);
    setLoading(false);

    if (foundProject) {
      loadLogs();
      loadProcesses();
    }
  }, [id, projects]);

  const loadLogs = async () => {
    try {
      const projectLogs = await window.devbox?.logs.getProjectLogs(id, 100);
      setLogs(projectLogs || []);
    } catch (error) {
      console.error('Error loading logs:', error);
    }
  };

  const loadProcesses = async () => {
    try {
      const supervisorProcesses = await window.devbox?.supervisor.getProcesses(id);
      setProcesses(supervisorProcesses || []);
    } catch (error) {
      console.error('Error loading processes:', error);
    }
  };

  const handleDelete = async () => {
    if (window.confirm(`Are you sure you want to delete "${project.name}"?`)) {
      await deleteProject(id);
      navigate('/projects');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-8">
        <div className="card p-12 text-center">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            Project not found
          </h3>
          <Link to="/projects" className="btn-primary mt-4">
            Back to Projects
          </Link>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'terminal', label: 'Terminal', icon: Terminal },
    { id: 'logs', label: 'Logs', icon: FileText },
    { id: 'workers', label: 'Workers', icon: Cpu },
    { id: 'environment', label: 'Environment', icon: Settings },
  ];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          to="/projects"
          className="inline-flex items-center gap-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Projects
        </Link>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className={project.isRunning ? 'status-running w-4 h-4' : 'status-stopped w-4 h-4'} />
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {project.name}
              </h1>
              <p className="text-gray-500 dark:text-gray-400">{project.path}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {project.isRunning ? (
              <>
                <a
                  href={`http://localhost:${project.port}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open
                </a>
                <button onClick={() => stopProject(id)} className="btn-danger">
                  <Square className="w-4 h-4" />
                  Stop
                </button>
              </>
            ) : (
              <button onClick={() => startProject(id)} className="btn-success">
                <Play className="w-4 h-4" />
                Start
              </button>
            )}
            <button
              onClick={() => window.devbox?.projects.openInEditor(id, 'vscode')}
              className="btn-secondary"
            >
              <Code className="w-4 h-4" />
              VS Code
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
        <nav className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'flex items-center gap-2 pb-3 text-sm font-medium border-b-2 -mb-px transition-colors',
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <OverviewTab project={project} processes={processes} />
      )}
      {activeTab === 'terminal' && (
        <div className="h-[500px]">
          <ProjectTerminal 
            projectId={id} 
            projectPath={project.path} 
            phpVersion={project.phpVersion}
            autoFocus={true}
          />
        </div>
      )}
      {activeTab === 'logs' && <LogsTab logs={logs} onRefresh={loadLogs} projectId={id} />}
      {activeTab === 'workers' && (
        <WorkersTab processes={processes} projectId={id} onRefresh={loadProcesses} />
      )}
      {activeTab === 'environment' && <EnvironmentTab project={project} />}

      {/* Danger Zone */}
      <div className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-red-600 mb-4">Danger Zone</h3>
        <div className="card border-red-200 dark:border-red-900/50 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Delete Project</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                This will remove the project from DevBox Pro (files will not be deleted)
              </p>
            </div>
            <button onClick={handleDelete} className="btn-danger">
              <Trash2 className="w-4 h-4" />
              Delete Project
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ project, processes }) {
  const runningProcesses = processes.filter((p) => p.isRunning);
  const [switchingServer, setSwitchingServer] = useState(false);

  const handleSwitchWebServer = async (newServer) => {
    if (project.webServer === newServer) return;
    
    setSwitchingServer(true);
    try {
      await window.devbox?.projects.switchWebServer(project.id, newServer);
    } catch (error) {
      console.error('Error switching web server:', error);
      alert('Failed to switch web server: ' + error.message);
    } finally {
      setSwitchingServer(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Project Info */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Project Information
        </h3>
        <dl className="space-y-4">
          <div className="flex justify-between">
            <dt className="text-gray-500 dark:text-gray-400">Type</dt>
            <dd className="font-medium text-gray-900 dark:text-white capitalize">
              {project.type}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500 dark:text-gray-400">PHP Version</dt>
            <dd className="font-medium text-gray-900 dark:text-white">
              {project.phpVersion}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500 dark:text-gray-400">Port</dt>
            <dd className="font-medium text-gray-900 dark:text-white">
              {project.port} (HTTP) / {project.sslPort || 'N/A'} (HTTPS)
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500 dark:text-gray-400">SSL</dt>
            <dd className="font-medium text-gray-900 dark:text-white">
              {project.ssl ? 'Enabled' : 'Disabled'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500 dark:text-gray-400">Status</dt>
            <dd>
              <span className={clsx('badge', project.isRunning ? 'badge-success' : 'badge-neutral')}>
                {project.isRunning ? 'Running' : 'Stopped'}
              </span>
            </dd>
          </div>
        </dl>
      </div>

      {/* Domains */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Domains
        </h3>
        <ul className="space-y-2">
          {project.domains?.map((domain, index) => (
            <li key={index} className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-gray-400" />
              <span className="text-gray-900 dark:text-white">{domain}</span>
            </li>
          ))}
          {project.domain && !project.domains?.includes(project.domain) && (
            <li className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-gray-400" />
              <span className="text-gray-900 dark:text-white">{project.domain}</span>
            </li>
          )}
        </ul>
        {project.ssl && (
          <p className="mt-3 text-sm text-green-600 dark:text-green-400">
            🔒 HTTPS enabled for all domains
          </p>
        )}
      </div>

      {/* Web Server */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Web Server
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => handleSwitchWebServer('nginx')}
            disabled={switchingServer}
            className={clsx(
              'p-4 rounded-lg border-2 text-left transition-all',
              project.webServer === 'nginx'
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-xl">🟢</span>
              <span className="font-medium text-gray-900 dark:text-white">Nginx</span>
            </div>
            {project.webServer === 'nginx' && (
              <span className="text-xs text-primary-600 dark:text-primary-400 mt-1 block">Active</span>
            )}
          </button>
          <button
            onClick={() => handleSwitchWebServer('apache')}
            disabled={switchingServer}
            className={clsx(
              'p-4 rounded-lg border-2 text-left transition-all',
              project.webServer === 'apache'
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-xl">🔴</span>
              <span className="font-medium text-gray-900 dark:text-white">Apache</span>
            </div>
            {project.webServer === 'apache' && (
              <span className="text-xs text-primary-600 dark:text-primary-400 mt-1 block">Active</span>
            )}
          </button>
        </div>
        {switchingServer && (
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
            Switching web server...
          </p>
        )}
      </div>

      {/* Services */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Enabled Services
        </h3>
        <div className="grid grid-cols-2 gap-4">
          {Object.entries(project.services || {}).map(([service, enabled]) => (
            <div
              key={service}
              className={clsx(
                'p-3 rounded-lg border',
                enabled
                  ? 'border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-900/20'
                  : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800'
              )}
            >
              <div className="flex items-center gap-2">
                <Database className={clsx('w-4 h-4', enabled ? 'text-green-600' : 'text-gray-400')} />
                <span
                  className={clsx(
                    'text-sm font-medium capitalize',
                    enabled ? 'text-green-700 dark:text-green-400' : 'text-gray-500'
                  )}
                >
                  {service}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Workers Summary */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Workers
        </h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-3xl font-bold text-gray-900 dark:text-white">
              {runningProcesses.length}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              of {processes.length} running
            </p>
          </div>
          <Cpu className="w-12 h-12 text-gray-300 dark:text-gray-600" />
        </div>
      </div>
    </div>
  );
}

function LogsTab({ logs, onRefresh, projectId }) {
  const [autoRefresh, setAutoRefresh] = useState(false);

  useEffect(() => {
    let interval;
    if (autoRefresh) {
      interval = setInterval(onRefresh, 2000);
    }
    return () => clearInterval(interval);
  }, [autoRefresh, onRefresh]);

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white">Project Logs</h3>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            Auto-refresh
          </label>
          <button onClick={onRefresh} className="btn-secondary btn-sm">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={() => window.devbox?.logs.clearProjectLogs(projectId)}
            className="btn-ghost btn-sm"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="p-4 bg-gray-900 rounded-b-xl max-h-96 overflow-auto font-mono text-sm">
        {logs.length > 0 ? (
          logs.map((line, index) => (
            <div key={index} className="text-gray-300 py-0.5 hover:bg-gray-800">
              {line}
            </div>
          ))
        ) : (
          <p className="text-gray-500">No logs available</p>
        )}
      </div>
    </div>
  );
}

function WorkersTab({ processes, projectId, onRefresh }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProcess, setNewProcess] = useState({
    name: '',
    command: '',
    numprocs: 1,
    autostart: true,
    autorestart: true,
  });

  const handleAddProcess = async () => {
    try {
      await window.devbox?.supervisor.addProcess(projectId, newProcess);
      setShowAddForm(false);
      setNewProcess({ name: '', command: '', numprocs: 1, autostart: true, autorestart: true });
      onRefresh();
    } catch (error) {
      console.error('Error adding process:', error);
    }
  };

  const handleStartProcess = async (name) => {
    await window.devbox?.supervisor.startProcess(projectId, name);
    onRefresh();
  };

  const handleStopProcess = async (name) => {
    await window.devbox?.supervisor.stopProcess(projectId, name);
    onRefresh();
  };

  const handleRemoveProcess = async (name) => {
    if (window.confirm(`Remove process "${name}"?`)) {
      await window.devbox?.supervisor.removeProcess(projectId, name);
      onRefresh();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Supervisor Processes
        </h3>
        <button onClick={() => setShowAddForm(true)} className="btn-primary btn-sm">
          <Plus className="w-4 h-4" />
          Add Worker
        </button>
      </div>

      {showAddForm && (
        <div className="card p-6">
          <h4 className="font-medium text-gray-900 dark:text-white mb-4">Add New Process</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Name</label>
              <input
                type="text"
                value={newProcess.name}
                onChange={(e) => setNewProcess({ ...newProcess, name: e.target.value })}
                className="input"
                placeholder="queue-worker"
              />
            </div>
            <div>
              <label className="label">Workers</label>
              <input
                type="number"
                value={newProcess.numprocs}
                onChange={(e) => setNewProcess({ ...newProcess, numprocs: parseInt(e.target.value) })}
                className="input"
                min="1"
                max="10"
              />
            </div>
            <div className="col-span-2">
              <label className="label">Command</label>
              <input
                type="text"
                value={newProcess.command}
                onChange={(e) => setNewProcess({ ...newProcess, command: e.target.value })}
                className="input"
                placeholder="php artisan queue:work"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setShowAddForm(false)} className="btn-secondary">
              Cancel
            </button>
            <button onClick={handleAddProcess} className="btn-primary">
              Add Process
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {processes.map((process) => (
          <div key={process.name} className="card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={process.isRunning ? 'status-running' : 'status-stopped'} />
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{process.name}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{process.command}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {process.instances || process.numprocs} worker(s)
                </span>
                {process.isRunning ? (
                  <button
                    onClick={() => handleStopProcess(process.name)}
                    className="btn-secondary btn-sm"
                  >
                    <Square className="w-4 h-4" />
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={() => handleStartProcess(process.name)}
                    className="btn-success btn-sm"
                  >
                    <Play className="w-4 h-4" />
                    Start
                  </button>
                )}
                <button
                  onClick={() => handleRemoveProcess(process.name)}
                  className="btn-ghost btn-sm text-red-500"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {processes.length === 0 && (
          <div className="card p-12 text-center">
            <Cpu className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No workers configured</p>
          </div>
        )}
      </div>
    </div>
  );
}

function EnvironmentTab({ project }) {
  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Environment Variables
      </h3>
      <div className="space-y-3">
        {Object.entries(project.environment || {}).map(([key, value]) => (
          <div key={key} className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <span className="font-mono text-sm font-medium text-gray-700 dark:text-gray-300 min-w-[200px]">
              {key}
            </span>
            <span className="font-mono text-sm text-gray-500 dark:text-gray-400 truncate">
              {value || '(empty)'}
            </span>
          </div>
        ))}
        {Object.keys(project.environment || {}).length === 0 && (
          <p className="text-gray-500 dark:text-gray-400">No environment variables configured</p>
        )}
      </div>
    </div>
  );
}

export default ProjectDetail;
