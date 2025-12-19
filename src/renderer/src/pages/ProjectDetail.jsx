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
  Server,
  Layers,
} from 'lucide-react';
import clsx from 'clsx';

function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { projects, startProject, stopProject, deleteProject, refreshProjects } = useApp();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'overview');
  const [project, setProject] = useState(null);
  const [logs, setLogs] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [actionError, setActionError] = useState(null);

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

  const handleStart = async () => {
    setIsStarting(true);
    setActionError(null);
    try {
      const result = await startProject(id);
      if (result && !result.success) {
        setActionError(result.error || 'Failed to start project');
      }
    } catch (err) {
      setActionError(err.message || 'Failed to start project');
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    setIsStopping(true);
    setActionError(null);
    try {
      const result = await stopProject(id);
      if (result && !result.success) {
        setActionError(result.error || 'Failed to stop project');
      }
    } catch (err) {
      setActionError(err.message || 'Failed to stop project');
    } finally {
      setIsStopping(false);
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
                <button
                  onClick={() => window.devbox?.projects.openInBrowser(project.id)}
                  className="btn-secondary"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open
                </button>
                <button 
                  onClick={handleStop} 
                  disabled={isStopping}
                  className="btn-danger"
                >
                  {isStopping ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                  {isStopping ? 'Stopping...' : 'Stop'}
                </button>
              </>
            ) : (
              <button 
                onClick={handleStart} 
                disabled={isStarting}
                className="btn-success"
              >
                {isStarting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {isStarting ? 'Starting...' : 'Start'}
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

        {/* Error message */}
        {actionError && (
          <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-700 dark:text-red-400">
              <strong>Error:</strong> {actionError}
            </p>
          </div>
        )}
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
        <OverviewTab project={project} processes={processes} refreshProjects={refreshProjects} />
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

function OverviewTab({ project, processes, refreshProjects }) {
  const runningProcesses = processes.filter((p) => p.isRunning);
  const [phpVersions, setPhpVersions] = useState([]);
  const [binariesStatus, setBinariesStatus] = useState({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [pendingChanges, setPendingChanges] = useState({});
  
  // Load available PHP versions and binaries status
  useEffect(() => {
    const loadData = async () => {
      try {
        const versions = await window.devbox?.php.getVersions();
        setPhpVersions(versions || []);
        
        const status = await window.devbox?.binaries.getStatus();
        setBinariesStatus(status || {});
      } catch (error) {
        console.error('Error loading data:', error);
      }
    };
    loadData();
  }, []);
  
  // Check if there are pending changes
  const hasPendingChanges = Object.keys(pendingChanges).length > 0;
  
  // Get effective value (pending change or current project value)
  const getEffectiveValue = (key) => {
    if (key in pendingChanges) return pendingChanges[key];
    if (key === 'services') return project.services || {};
    return project[key];
  };
  
  const handlePhpVersionChange = (newVersion) => {
    if (newVersion === project.phpVersion) {
      const { phpVersion, ...rest } = pendingChanges;
      setPendingChanges(rest);
    } else {
      setPendingChanges({ ...pendingChanges, phpVersion: newVersion });
    }
  };
  
  const handleServiceToggle = (serviceName) => {
    const currentServices = getEffectiveValue('services');
    let newServices = { ...currentServices };
    
    // For databases, make them mutually exclusive
    if (serviceName === 'mysql' || serviceName === 'mariadb') {
      const isEnabling = !currentServices[serviceName];
      if (isEnabling) {
        // Disable the other database
        newServices.mysql = serviceName === 'mysql';
        newServices.mariadb = serviceName === 'mariadb';
      } else {
        // Just disable this one
        newServices[serviceName] = false;
      }
    } else {
      // For other services, just toggle
      newServices[serviceName] = !currentServices[serviceName];
    }
    
    // Check if services match original
    const originalServices = project.services || {};
    const hasServiceChanges = Object.keys(newServices).some(
      key => newServices[key] !== (originalServices[key] || false)
    );
    
    if (!hasServiceChanges) {
      const { services, ...rest } = pendingChanges;
      setPendingChanges(rest);
    } else {
      setPendingChanges({ ...pendingChanges, services: newServices });
    }
  };
  
  const handleWebServerChange = (newServer) => {
    if (newServer === project.webServer) {
      const { webServer, ...rest } = pendingChanges;
      setPendingChanges(rest);
    } else {
      setPendingChanges({ ...pendingChanges, webServer: newServer });
    }
  };
  
  const handleSaveChanges = async () => {
    if (!hasPendingChanges) return;
    
    setSavingSettings(true);
    try {
      // If web server is changing, use switchWebServer API
      if (pendingChanges.webServer) {
        await window.devbox?.projects.switchWebServer(project.id, pendingChanges.webServer);
      }
      
      // Update other project settings
      const { webServer, ...otherChanges } = pendingChanges;
      if (Object.keys(otherChanges).length > 0) {
        await window.devbox?.projects.update(project.id, otherChanges);
      }
      
      // Clear pending changes
      setPendingChanges({});
      
      // Refresh projects to get updated data
      await refreshProjects?.();
      
      // If project is running, ask to restart
      if (project.isRunning) {
        if (window.confirm('Settings saved! Do you want to restart the project to apply changes?')) {
          await window.devbox?.projects.restart(project.id);
        }
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Failed to save settings: ' + error.message);
    } finally {
      setSavingSettings(false);
    }
  };
  
  const handleDiscardChanges = () => {
    setPendingChanges({});
  };

  // Service definitions - databases first (mutually exclusive), then others
  const serviceDefinitions = [
    { id: 'mysql', name: 'MySQL', icon: '🗄️', installed: binariesStatus?.mysql, isDatabase: true },
    { id: 'mariadb', name: 'MariaDB', icon: '🗃️', installed: binariesStatus?.mariadb, isDatabase: true },
    { id: 'redis', name: 'Redis', icon: '⚡', installed: binariesStatus?.redis },
    { id: 'queue', name: 'Queue Worker', icon: '📋', installed: true }, // Always available for Laravel
  ];

  return (
    <div className="space-y-6">
      {/* Pending Changes Banner */}
      {hasPendingChanges && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-yellow-600 dark:text-yellow-400">⚠️</span>
            <span className="text-sm text-yellow-700 dark:text-yellow-300">
              You have unsaved changes
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDiscardChanges}
              className="btn-secondary text-sm py-1 px-3"
            >
              Discard
            </button>
            <button
              onClick={handleSaveChanges}
              disabled={savingSettings}
              className="btn-primary text-sm py-1 px-3"
            >
              {savingSettings ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
      
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
          <div className="flex justify-between items-center">
            <dt className="text-gray-500 dark:text-gray-400">PHP Version</dt>
            <dd>
              <select
                value={getEffectiveValue('phpVersion')}
                onChange={(e) => handlePhpVersionChange(e.target.value)}
                className="input py-1 px-2 text-sm w-24"
              >
                {phpVersions.map((v) => (
                  <option key={v.version} value={v.version}>{v.version}</option>
                ))}
              </select>
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
          {['nginx', 'apache'].map((server) => {
            const effectiveServer = getEffectiveValue('webServer');
            const isSelected = effectiveServer === server;
            const isChanged = pendingChanges.webServer && pendingChanges.webServer !== project.webServer;
            
            return (
              <button
                key={server}
                onClick={() => handleWebServerChange(server)}
                className={clsx(
                  'p-4 rounded-lg border-2 text-left transition-all',
                  isSelected
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                )}
              >
                <div className="flex items-center gap-2">
                  {server === 'nginx' ? (
                    <Server className="w-5 h-5 text-green-500" />
                  ) : (
                    <Layers className="w-5 h-5 text-orange-500" />
                  )}
                  <span className="font-medium text-gray-900 dark:text-white capitalize">{server}</span>
                </div>
                {isSelected && (
                  <span className={clsx(
                    'text-xs mt-1 block',
                    isChanged && effectiveServer === server
                      ? 'text-yellow-600 dark:text-yellow-400'
                      : 'text-primary-600 dark:text-primary-400'
                  )}>
                    {isChanged && effectiveServer === server ? 'Will switch to this' : 'Active'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {pendingChanges.webServer && (
          <p className="mt-3 text-xs text-yellow-600 dark:text-yellow-400">
            Web server will change after saving
          </p>
        )}
      </div>

      {/* Services - Now with toggle buttons */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Services
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Note: Only one database (MySQL or MariaDB) can be active at a time
        </p>
        <div className="space-y-3">
          {serviceDefinitions.map((service) => {
            const effectiveServices = getEffectiveValue('services');
            const isEnabled = effectiveServices[service.id] || false;
            const isInstalled = service.installed;
            const isChanged = pendingChanges.services && 
              pendingChanges.services[service.id] !== (project.services?.[service.id] || false);
            
            return (
              <button
                key={service.id}
                onClick={() => isInstalled && handleServiceToggle(service.id)}
                disabled={!isInstalled}
                className={clsx(
                  'w-full p-3 rounded-lg border-2 text-left transition-all flex items-center justify-between',
                  isEnabled
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    : 'border-gray-200 dark:border-gray-700',
                  !isInstalled && 'opacity-50 cursor-not-allowed',
                  isInstalled && 'hover:border-gray-300 dark:hover:border-gray-600'
                )}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">{service.icon}</span>
                  <div>
                    <span className={clsx(
                      'font-medium',
                      isEnabled ? 'text-green-700 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'
                    )}>
                      {service.name}
                    </span>
                    {!isInstalled && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 block">
                        Not installed
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isChanged && (
                    <span className="text-xs text-yellow-600 dark:text-yellow-400">Modified</span>
                  )}
                  <div className={clsx(
                    'w-10 h-6 rounded-full transition-colors relative',
                    isEnabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                  )}>
                    <div className={clsx(
                      'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                      isEnabled ? 'translate-x-5' : 'translate-x-1'
                    )} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Click to toggle services. Changes will take effect after saving and restarting.
        </p>
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
