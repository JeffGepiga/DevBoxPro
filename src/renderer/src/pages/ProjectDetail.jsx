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
  AlertTriangle,
  X,
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
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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

  const handleDeleteClick = () => {
    setShowDeleteModal(true);
    setDeleteConfirmText('');
    setDeleteFiles(false);
  };

  const handleDeleteConfirm = async () => {
    if (deleteConfirmText !== 'delete') return;
    
    setIsDeleting(true);
    try {
      await deleteProject(id, deleteFiles);
      navigate('/projects');
    } catch (err) {
      setActionError(err.message || 'Failed to delete project');
      setShowDeleteModal(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteModal(false);
    setDeleteConfirmText('');
    setDeleteFiles(false);
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
      {activeTab === 'environment' && <EnvironmentTab project={project} onRefresh={refreshProjects} />}

      {/* Danger Zone */}
      <div className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-red-600 mb-4">Danger Zone</h3>
        <div className="card border-red-200 dark:border-red-900/50 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Delete Project</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Remove the project from DevBox Pro. You can optionally delete the project files.
              </p>
            </div>
            <button onClick={handleDeleteClick} className="btn-danger">
              <Trash2 className="w-4 h-4" />
              Delete Project
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 rounded-full bg-red-100 dark:bg-red-900/30">
                  <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Delete Project
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    This action cannot be undone
                  </p>
                </div>
              </div>

              <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  <strong>Project:</strong> {project.name}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {project.path}
                </p>
              </div>

              {/* Delete files option */}
              <label className="flex items-start gap-3 p-3 mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteFiles}
                  onChange={(e) => setDeleteFiles(e.target.checked)}
                  className="mt-0.5 rounded border-red-300 text-red-600 focus:ring-red-500"
                />
                <div>
                  <p className="font-medium text-red-700 dark:text-red-400">
                    Also delete project files
                  </p>
                  <p className="text-xs text-red-600 dark:text-red-500 mt-1">
                    ⚠️ This will permanently delete all files in the project folder!
                  </p>
                </div>
              </label>

              {/* Confirmation input */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Type <span className="font-mono bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">delete</span> to confirm:
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value.toLowerCase())}
                  placeholder="delete"
                  className="input w-full"
                  autoFocus
                />
              </div>
            </div>

            {/* Actions */}
            <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
              <button
                onClick={handleDeleteCancel}
                className="btn-secondary"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleteConfirmText !== 'delete' || isDeleting}
                className={clsx(
                  'btn-danger',
                  deleteConfirmText !== 'delete' && 'opacity-50 cursor-not-allowed'
                )}
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    {deleteFiles ? 'Delete Project & Files' : 'Delete Project'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OverviewTab({ project, processes, refreshProjects }) {
  const runningProcesses = processes.filter((p) => p.isRunning);
  const [phpVersions, setPhpVersions] = useState([]);
  const [binariesStatus, setBinariesStatus] = useState({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [pendingChanges, setPendingChanges] = useState({});
  const [versionOptions, setVersionOptions] = useState({
    mysql: [],
    mariadb: [],
    redis: [],
    nodejs: [],
  });
  
  // Load available PHP versions, binaries status, and service config
  useEffect(() => {
    const loadData = async () => {
      try {
        const versions = await window.devbox?.php.getVersions();
        // Only show installed PHP versions
        const installedVersions = (versions || []).filter(v => v.available);
        setPhpVersions(installedVersions);
        
        const status = await window.devbox?.binaries.getStatus();
        setBinariesStatus(status || {});
        
        // Load service config and filter to only installed versions
        const config = await window.devbox?.binaries.getServiceConfig();
        if (config?.versions && status) {
          // Filter to only installed versions for each service
          const getInstalledVersions = (service) => {
            if (!status[service]) return [];
            return Object.entries(status[service])
              .filter(([_, v]) => v?.installed)
              .map(([version]) => version)
              .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
          };
          
          setVersionOptions({
            mysql: getInstalledVersions('mysql'),
            mariadb: getInstalledVersions('mariadb'),
            redis: getInstalledVersions('redis'),
            nodejs: getInstalledVersions('nodejs'),
          });
        }
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
  
  const handleServiceVersionChange = (serviceName, version) => {
    const currentServices = getEffectiveValue('services');
    const versionKey = `${serviceName}Version`;
    const originalVersion = project.services?.[versionKey];
    
    let newServices = { ...currentServices, [versionKey]: version };
    
    // Check if version matches original
    if (version === originalVersion) {
      // Remove from pending if it matches original
      const hasOtherServiceChanges = Object.keys(newServices).some(key => {
        if (key === versionKey) return false;
        return newServices[key] !== (project.services?.[key] || false);
      });
      
      if (!hasOtherServiceChanges && !pendingChanges.services) {
        return; // No changes needed
      }
    }
    
    setPendingChanges({ ...pendingChanges, services: newServices });
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

  // Helper to check if any version of a service is installed
  const isAnyVersionInstalled = (serviceStatus) => {
    if (!serviceStatus || typeof serviceStatus !== 'object') return false;
    return Object.values(serviceStatus).some(v => v?.installed === true);
  };

  // Service definitions - databases first (mutually exclusive), then others
  const serviceDefinitions = [
    { id: 'mysql', name: 'MySQL', icon: '🗄️', installed: isAnyVersionInstalled(binariesStatus?.mysql), isDatabase: true, hasVersions: true },
    { id: 'mariadb', name: 'MariaDB', icon: '🗃️', installed: isAnyVersionInstalled(binariesStatus?.mariadb), isDatabase: true, hasVersions: true },
    { id: 'redis', name: 'Redis', icon: '⚡', installed: isAnyVersionInstalled(binariesStatus?.redis), hasVersions: true },
    { id: 'nodejs', name: 'Node.js', icon: '🟢', installed: isAnyVersionInstalled(binariesStatus?.nodejs), hasVersions: true },
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
            <dd className="flex items-center gap-2">
              {(() => {
                const currentVersion = getEffectiveValue('phpVersion');
                const isCurrentInstalled = phpVersions.some(v => v.version === currentVersion);
                const displayVersions = isCurrentInstalled 
                  ? phpVersions 
                  : [{ version: currentVersion, notInstalled: true }, ...phpVersions];
                
                return (
                  <>
                    <select
                      value={currentVersion}
                      onChange={(e) => handlePhpVersionChange(e.target.value)}
                      className={clsx(
                        "input py-1 px-2 text-sm w-24",
                        !isCurrentInstalled && "border-red-500 dark:border-red-500"
                      )}
                    >
                      {displayVersions.map((v) => (
                        <option 
                          key={v.version} 
                          value={v.version}
                          className={v.notInstalled ? 'text-red-500' : ''}
                        >
                          {v.version}{v.notInstalled ? ' (not installed)' : ''}
                        </option>
                      ))}
                    </select>
                    {!isCurrentInstalled && (
                      <AlertTriangle className="w-4 h-4 text-red-500" title="PHP version not installed" />
                    )}
                  </>
                );
              })()}
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

      {/* Services - Now with toggle buttons and version selectors */}
      <div className="card p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Services
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Note: Only one database (MySQL or MariaDB) can be active at a time. Select specific versions for legacy app compatibility.
        </p>
        <div className="space-y-3">
          {serviceDefinitions.map((service) => {
            const effectiveServices = getEffectiveValue('services');
            const isEnabled = effectiveServices[service.id] || false;
            const isInstalled = service.installed;
            const isChanged = pendingChanges.services && 
              pendingChanges.services[service.id] !== (project.services?.[service.id] || false);
            const currentVersion = effectiveServices[`${service.id}Version`] || versionOptions[service.id]?.[0];
            const versionChanged = pendingChanges.services?.[`${service.id}Version`] !== undefined &&
              pendingChanges.services[`${service.id}Version`] !== project.services?.[`${service.id}Version`];
            
            return (
              <div
                key={service.id}
                className={clsx(
                  'p-3 rounded-lg border-2 transition-all',
                  isEnabled
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    : 'border-gray-200 dark:border-gray-700',
                  !isInstalled && 'opacity-50'
                )}
              >
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => isInstalled && handleServiceToggle(service.id)}
                    disabled={!isInstalled}
                    className="flex items-center gap-3 text-left flex-1"
                  >
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
                  </button>
                  <div className="flex items-center gap-3">
                    {(isChanged || versionChanged) && (
                      <span className="text-xs text-yellow-600 dark:text-yellow-400">Modified</span>
                    )}
                    {/* Version selector for services that support it */}
                    {service.hasVersions && isEnabled && (
                      <select
                        value={currentVersion}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleServiceVersionChange(service.id, e.target.value);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="input py-1 px-2 text-xs w-20"
                      >
                        {versionOptions[service.id]?.map((v) => {
                          // Check installed status from binariesStatus (not availableVersions)
                          const isVersionInstalled = binariesStatus?.[service.id]?.[v]?.installed === true;
                          return (
                            <option key={v} value={v} disabled={!isVersionInstalled}>
                              {v} {!isVersionInstalled ? '(not installed)' : ''}
                            </option>
                          );
                        })}
                      </select>
                    )}
                    <button
                      onClick={() => isInstalled && handleServiceToggle(service.id)}
                      disabled={!isInstalled}
                      className={clsx(
                        'w-10 h-6 rounded-full transition-colors relative',
                        isEnabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600',
                        !isInstalled && 'cursor-not-allowed'
                      )}
                    >
                      <div className={clsx(
                        'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                        isEnabled ? 'translate-x-5' : 'translate-x-1'
                      )} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Click to toggle services. Select version for legacy app support. Changes will take effect after saving and restarting.
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
            onClick={async () => {
              await window.devbox?.logs.clearProjectLogs(projectId);
              onRefresh();
            }}
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

function EnvironmentTab({ project, onRefresh }) {
  const [environment, setEnvironment] = useState({});
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saveMessage, setSaveMessage] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalEnv, setOriginalEnv] = useState({});

  // Load environment from .env file on mount
  useEffect(() => {
    const loadEnvFile = async () => {
      setIsLoading(true);
      try {
        const envFromFile = await window.devbox?.projects.readEnv(project.id);
        if (envFromFile && Object.keys(envFromFile).length > 0) {
          setEnvironment(envFromFile);
          setOriginalEnv(envFromFile);
        } else {
          // Fallback to project.environment if .env file doesn't exist
          setEnvironment(project.environment || {});
          setOriginalEnv(project.environment || {});
        }
      } catch (error) {
        console.error('Failed to load .env file:', error);
        // Fallback to project.environment
        setEnvironment(project.environment || {});
        setOriginalEnv(project.environment || {});
      } finally {
        setIsLoading(false);
      }
    };
    loadEnvFile();
  }, [project.id]);

  // Check if there are unsaved changes
  useEffect(() => {
    const hasChanged = JSON.stringify(environment) !== JSON.stringify(originalEnv);
    setHasChanges(hasChanged);
  }, [environment, originalEnv]);

  const handleValueChange = (key, value) => {
    setEnvironment((prev) => ({ ...prev, [key]: value }));
  };

  const handleAddVariable = () => {
    if (!newKey.trim()) return;
    setEnvironment((prev) => ({ ...prev, [newKey.trim()]: newValue }));
    setNewKey('');
    setNewValue('');
  };

  const handleRemoveVariable = (key) => {
    setEnvironment((prev) => {
      const updated = { ...prev };
      delete updated[key];
      return updated;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      // Update project with new environment
      await window.devbox?.projects.update(project.id, { environment });
      
      // For Laravel projects, run optimize to apply changes
      if (project.type === 'laravel') {
        setIsOptimizing(true);
        setSaveMessage({ type: 'info', text: 'Running Laravel cache optimization...' });
        
        try {
          // Clear and rebuild all caches
          await window.devbox?.php.runArtisan(project.id, 'config:clear');
          await window.devbox?.php.runArtisan(project.id, 'cache:clear');
          await window.devbox?.php.runArtisan(project.id, 'config:cache');
          setSaveMessage({ type: 'success', text: 'Environment saved and Laravel caches refreshed!' });
        } catch (optimizeError) {
          console.warn('Cache optimization failed:', optimizeError);
          setSaveMessage({ type: 'warning', text: 'Environment saved, but cache optimization failed. You may need to run "php artisan config:cache" manually.' });
        }
        setIsOptimizing(false);
      } else {
        setSaveMessage({ type: 'success', text: 'Environment variables saved!' });
      }
      
      // Refresh project data
      onRefresh?.();
      setOriginalEnv(environment);
      setHasChanges(false);
    } catch (error) {
      console.error('Failed to save environment:', error);
      setSaveMessage({ type: 'error', text: `Failed to save: ${error.message}` });
    } finally {
      setIsSaving(false);
    }
  };

  const messageColors = {
    info: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400',
    success: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400',
    warning: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400',
    error: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400',
  };

  if (isLoading) {
    return (
      <div className="card p-6">
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-500 dark:text-gray-400">Loading environment variables...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Environment Variables
          </h3>
          {project.type === 'laravel' && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Changes will automatically run Laravel cache optimization
            </p>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={!hasChanges || isSaving || isOptimizing}
          className={clsx(
            'btn-primary',
            (!hasChanges || isSaving || isOptimizing) && 'opacity-50 cursor-not-allowed'
          )}
        >
          {isSaving || isOptimizing ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              {isOptimizing ? 'Optimizing...' : 'Saving...'}
            </>
          ) : (
            'Save Changes'
          )}
        </button>
      </div>

      {/* Save Message */}
      {saveMessage && (
        <div className={clsx('p-3 rounded-lg mb-4', messageColors[saveMessage.type])}>
          {saveMessage.text}
        </div>
      )}

      {/* Existing Variables */}
      <div className="space-y-3 mb-6">
        {Object.entries(environment).map(([key, value]) => (
          <div key={key} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <span className="font-mono text-sm font-medium text-gray-700 dark:text-gray-300 min-w-[180px]">
              {key}
            </span>
            <input
              type="text"
              value={value || ''}
              onChange={(e) => handleValueChange(key, e.target.value)}
              className="input flex-1 font-mono text-sm"
              placeholder="(empty)"
            />
            <button
              onClick={() => handleRemoveVariable(key)}
              className="btn-ghost btn-icon text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
              title="Remove variable"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {Object.keys(environment).length === 0 && (
          <p className="text-gray-500 dark:text-gray-400 p-3">No environment variables configured</p>
        )}
      </div>

      {/* Add New Variable */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          Add New Variable
        </h4>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value.toUpperCase())}
            placeholder="VARIABLE_NAME"
            className="input font-mono text-sm w-48"
          />
          <input
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="value"
            className="input font-mono text-sm flex-1"
          />
          <button
            onClick={handleAddVariable}
            disabled={!newKey.trim()}
            className="btn-secondary"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
      </div>

      {/* Unsaved Changes Warning */}
      {hasChanges && (
        <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-amber-700 dark:text-amber-400 text-sm">
          You have unsaved changes. Click "Save Changes" to apply.
        </div>
      )}
    </div>
  );
}

export default ProjectDetail;
