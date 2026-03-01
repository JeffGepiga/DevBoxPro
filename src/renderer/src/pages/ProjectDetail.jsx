import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useModal } from '../context/ModalContext';
import XTerminal from '../components/XTerminal';
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
  Pencil,
  Check,
  Share2,
  Download,
} from 'lucide-react';
import clsx from 'clsx';

// Node.js icon SVG component
const NodeJsIcon = ({ className }) => (
  <svg viewBox="0 0 448 512" className={className} fill="currentColor">
    <path d="M224 508c-6.7 0-13.5-1.8-19.4-5.2l-61.7-36.5c-9.2-5.2-4.7-7-1.7-8 12.3-4.3 14.8-5.2 27.9-12.7 1.4-.8 3.2-.5 4.6.4l47.4 28.1c1.7 1 4.1 1 5.7 0l184.7-106.6c1.7-1 2.8-3 2.8-5V149.3c0-2.1-1.1-4-2.9-5.1L226.8 37.7c-1.7-1-4-1-5.7 0L36.6 144.3c-1.8 1-2.9 3-2.9 5.1v213.1c0 2 1.1 4 2.9 4.9l50.6 29.2c27.5 13.7 44.3-2.4 44.3-18.7V167.5c0-3 2.4-5.3 5.4-5.3h23.4c2.9 0 5.4 2.3 5.4 5.3V378c0 36.6-20 57.6-54.7 57.6-10.7 0-19.1 0-42.5-11.6l-48.4-27.9C8.1 389.2.7 376.3.7 362.4V149.3c0-13.8 7.4-26.8 19.4-33.7L204.6 8.9c11.7-6.6 27.2-6.6 38.8 0l184.7 106.7c12 6.9 19.4 19.8 19.4 33.7v213.1c0 13.8-7.4 26.7-19.4 33.7L243.4 502.8c-5.9 3.4-12.6 5.2-19.4 5.2zm149.1-210.1c0-39.9-27-50.5-83.7-58-57.4-7.6-63.2-11.5-63.2-24.9 0-11.1 4.9-25.9 47.4-25.9 37.9 0 51.9 8.2 57.7 33.8.5 2.4 2.7 4.2 5.2 4.2h24c1.5 0 2.9-.6 3.9-1.7s1.5-2.6 1.4-4.1c-3.7-44.1-33-64.6-92.2-64.6-52.7 0-84.1 22.2-84.1 59.5 0 40.4 31.3 51.6 81.8 56.6 60.5 5.9 65.2 14.8 65.2 26.7 0 20.6-16.6 29.4-55.5 29.4-48.9 0-59.6-12.3-63.2-36.6-.4-2.6-2.6-4.5-5.3-4.5h-23.9c-3 0-5.3 2.4-5.3 5.3 0 31.1 16.9 68.2 97.8 68.2 58.4-.1 92-23.2 92-63.4z" />
  </svg>
);

function ProjectDetail({ projectId: propProjectId, onCloseTerminal }) {
  const params = useParams();
  const id = propProjectId || params.id;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { projects, startProject, stopProject, deleteProject, refreshProjects, settings, projectLoadingStates, setProjectLoading } = useApp();
  const loadingState = projectLoadingStates[id];
  const isStarting = loadingState === 'starting';
  const isStopping = loadingState === 'stopping';

  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'overview');
  const [project, setProject] = useState(null);
  const [logs, setLogs] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [webServerPorts, setWebServerPorts] = useState({ httpPort: 80, sslPort: 443 });
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);

  // Update tab from URL params
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && ['overview', 'terminal', 'logs', 'workers', 'environment'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  const loadLogs = useCallback(async () => {
    try {
      const projectLogs = await window.devbox?.logs.getProjectLogs(id, 100);
      setLogs(projectLogs || []);
    } catch (error) {
      // Error loading logs
    }
  }, [id]);

  const loadProcesses = useCallback(async () => {
    try {
      const supervisorProcesses = await window.devbox?.supervisor.getProcesses(id);
      setProcesses(supervisorProcesses || []);
    } catch (error) {
      // Error loading processes
    }
  }, [id]);

  useEffect(() => {
    const foundProject = projects.find((p) => p.id === id);
    setProject(foundProject);
    setLoading(false);
  }, [id, projects]);

  useEffect(() => {
    const foundProject = projects.find((p) => p.id === id);
    if (foundProject) {
      loadLogs();
      loadProcesses();
      // Fetch actual web server ports for network access URLs
      const fetchWebServerPorts = async () => {
        try {
          const webServer = foundProject.webServer || 'nginx';
          const ports = await window.devbox?.services?.getWebServerPorts(webServer);
          if (ports) {
            setWebServerPorts(ports);
          }
        } catch (e) {
          // Ignore errors, keep default values
        }
      };
      fetchWebServerPorts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loadLogs, loadProcesses]);

  const handleStart = async () => {
    setProjectLoading(id, 'starting');
    setActionError(null);
    try {
      const result = await startProject(id);
      if (result && !result.success) {
        setActionError(result.error || 'Failed to start project');
      }
    } catch (err) {
      setActionError(err.message || 'Failed to start project');
    } finally {
      setProjectLoading(id, null);
    }
  };

  const handleStop = async () => {
    setProjectLoading(id, 'stopping');
    setActionError(null);
    try {
      const result = await stopProject(id);
      if (result && !result.success) {
        setActionError(result.error || 'Failed to stop project');
      }
    } catch (err) {
      setActionError(err.message || 'Failed to stop project');
    } finally {
      setProjectLoading(id, null);
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteModal(true);
    setDeleteConfirmText('');
    setDeleteFiles(false);
  };

  const handleOpenInEditor = async () => {
    setActionError(null);
    try {
      await window.devbox?.projects.openInEditor(id, settings?.settings?.defaultEditor || 'vscode');
    } catch (err) {
      setActionError(err.message || 'Failed to open in editor');
    }
  };

  const handleExportConfig = async () => {
    setActionError(null);
    try {
      const result = await window.devbox?.projects.exportConfig(id);
      if (result && result.success) {
        // Optional: show a success toast or alert
      }
    } catch (err) {
      setActionError(err.message || 'Failed to export configuration');
    }
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

  const handleSaveName = async () => {
    if (!editedName.trim() || editedName.trim() === project.name) {
      setIsEditingName(false);
      return;
    }

    setIsSavingName(true);
    try {
      await window.devbox?.projects.update(id, { name: editedName.trim() });
      await refreshProjects();
      setIsEditingName(false);
    } catch (err) {
      setActionError(err.message || 'Failed to update project name');
    } finally {
      setIsSavingName(false);
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
    <div className="p-6">
      {/* Header */}
      <div className="mb-4">
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
              {isEditingName ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSaveName();
                      } else if (e.key === 'Escape') {
                        setIsEditingName(false);
                        setEditedName(project.name);
                      }
                    }}
                    autoFocus
                    className="text-2xl font-bold text-gray-900 dark:text-white bg-transparent border-b-2 border-primary-500 outline-none px-1"
                  />
                  <button
                    onClick={handleSaveName}
                    disabled={isSavingName || !editedName.trim()}
                    className="p-1 text-green-600 hover:text-green-700 disabled:opacity-50"
                    title="Save"
                  >
                    {isSavingName ? (
                      <RefreshCw className="w-5 h-5 animate-spin" />
                    ) : (
                      <Check className="w-5 h-5" />
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setIsEditingName(false);
                      setEditedName(project.name);
                    }}
                    className="p-1 text-gray-500 hover:text-gray-700"
                    title="Cancel"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2 group">
                  {project.name}
                  <button
                    onClick={() => {
                      setEditedName(project.name);
                      setIsEditingName(true);
                    }}
                    className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Edit project name"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </h1>
              )}
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
              onClick={handleOpenInEditor}
              className="btn-secondary"
            >
              <Code className="w-4 h-4" />
              Open in Editor
            </button>
            <button
              onClick={handleExportConfig}
              className="btn-secondary"
              title="Export Project Configuration"
            >
              <Share2 className="w-4 h-4" />
              Export
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
      {/* Terminal is always mounted but hidden when not active to preserve state */}
      {activeTab === 'overview' && (
        <OverviewTab project={project} processes={processes} refreshProjects={refreshProjects} />
      )}
      <div className="h-[500px]" style={{ display: activeTab === 'terminal' ? 'block' : 'none' }}>
        <XTerminal
          projectId={id}
          projectPath={project.path}
          className="h-full"
          isVisible={activeTab === 'terminal'}
        />
      </div>
      {activeTab === 'logs' && <LogsTab logs={logs} onRefresh={loadLogs} projectId={id} />}
      {activeTab === 'workers' && (
        <WorkersTab processes={processes} projectId={id} onRefresh={loadProcesses} isRunning={project.isRunning} />
      )}
      {activeTab === 'environment' && <EnvironmentTab project={project} onRefresh={refreshProjects} />}

      {/* Danger Zone */}
      <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="card border-red-200 dark:border-red-900/50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-red-600">Danger Zone</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Remove the project from DevBox Pro. You can optionally delete the project files.
              </p>
            </div>
            <button onClick={handleDeleteClick} className="btn-danger btn-sm">
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
  const { showConfirm, showAlert } = useModal();
  const navigate = useNavigate();
  const runningProcesses = processes.filter((p) => p.isRunning);
  const [phpVersions, setPhpVersions] = useState([]);
  const [binariesStatus, setBinariesStatus] = useState({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [pendingChanges, setPendingChanges] = useState({});
  const [localIpAddresses, setLocalIpAddresses] = useState([]);
  const [otherNetworkProjectsCount, setOtherNetworkProjectsCount] = useState(0);
  const [webServerPorts, setWebServerPorts] = useState({ httpPort: 80, sslPort: 443 });
  const [phpMyAdminLoading, setPhpMyAdminLoading] = useState(null);
  const [versionOptions, setVersionOptions] = useState({
    mysql: [],
    mariadb: [],
    redis: [],
    nodejs: [],
    nginx: [],
    apache: [],
    postgresql: [],
    mongodb: [],
    python: [],
    memcached: [],
  });

  // Load available PHP versions, binaries status, and service config
  useEffect(() => {
    const loadData = async () => {
      try {
        const status = await window.devbox?.binaries.getStatus();
        setBinariesStatus(status || {});

        // Get installed PHP versions from binaries status (real-time disk check)
        const getInstalledVersions = (service) => {
          if (!status[service]) return [];
          return Object.entries(status[service])
            .filter(([_, v]) => v?.installed)
            .map(([version]) => version)
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        };

        // Set PHP versions from binaries status
        const installedPhpVersions = getInstalledVersions('php').map(version => ({
          version,
          available: true,
        }));
        setPhpVersions(installedPhpVersions);

        // Set version options directly from status (installed versions only)
        setVersionOptions({
          mysql: getInstalledVersions('mysql'),
          mariadb: getInstalledVersions('mariadb'),
          redis: getInstalledVersions('redis'),
          nodejs: getInstalledVersions('nodejs'),
          nginx: getInstalledVersions('nginx'),
          apache: getInstalledVersions('apache'),
          postgresql: getInstalledVersions('postgresql'),
          mongodb: getInstalledVersions('mongodb'),
          python: getInstalledVersions('python'),
          memcached: getInstalledVersions('memcached'),
        });
      } catch (error) {
        // Error loading data
      }
    };
    loadData();
  }, []);

  // Load local IP addresses for network access feature
  useEffect(() => {
    const loadLocalIps = async () => {
      try {
        const ips = await window.devbox?.system.getLocalIpAddresses();
        setLocalIpAddresses(ips || []);

        // Check other projects for network access to determine port 80 usage
        const allProjects = await window.devbox?.projects.getAll();
        const others = allProjects?.filter(p => p.id !== project?.id && p.networkAccess) || [];
        setOtherNetworkProjectsCount(others.length);

        // Fetch actual network port for THIS project (considers per-project port 80 ownership)
        if (project?.id) {
          const ports = await window.devbox?.services?.getProjectNetworkPort(project.id);
          if (ports) {
            setWebServerPorts(ports);
          }
        }
      } catch (error) {
        // Error loading local IPs or projects
      }
    };
    loadLocalIps();
  }, [project?.id, project?.webServer, project?.networkAccess]);

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
    const databaseServices = ['mysql', 'mariadb', 'postgresql', 'mongodb'];
    if (databaseServices.includes(serviceName)) {
      const isEnabling = !currentServices[serviceName];
      if (isEnabling) {
        // Disable all other databases
        databaseServices.forEach(db => {
          newServices[db] = db === serviceName;
        });
        // Set default version for the enabled database if not already set
        const versionKey = `${serviceName}Version`;
        if (!newServices[versionKey]) {
          newServices[versionKey] = versionOptions[serviceName]?.[0] || '';
        }
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

  const handleWebServerVersionChange = (newVersion) => {
    if (newVersion === project.webServerVersion) {
      const { webServerVersion, ...rest } = pendingChanges;
      setPendingChanges(rest);
    } else {
      setPendingChanges({ ...pendingChanges, webServerVersion: newVersion });
    }
  };

  const openPhpMyAdmin = async (dbType, version) => {
    setPhpMyAdminLoading(dbType);
    try {
      // getPhpMyAdminUrl already polls until phpMyAdmin is ready before returning
      const url = await window.devbox?.database.getPhpMyAdminUrl(dbType, version);
      if (url) {
        window.devbox?.system.openExternal(url);
      }
    } finally {
      setPhpMyAdminLoading(null);
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
        const shouldRestart = await showConfirm({
          title: 'Restart Project?',
          message: 'Settings saved! Do you want to restart the project to apply changes?',
          confirmText: 'Restart',
          type: 'question'
        });
        if (shouldRestart) {
          await window.devbox?.projects.restart(project.id);
        }
      }
    } catch (error) {
      // Error saving settings
      await showAlert({ title: 'Error', message: 'Failed to save settings: ' + error.message, type: 'error' });
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

  // Port config mirrored from shared/serviceConfig.js
  const SERVICE_DEFAULT_PORTS = { mysql: 3306, mariadb: 3310, redis: 6379, postgresql: 5432, mongodb: 27017, memcached: 11211 };
  const SERVICE_VERSION_PORT_OFFSETS = {
    mysql: { '8.4': 0, '8.0': 1, '5.7': 2 },
    mariadb: { '11.4': 0, '10.11': 1, '10.6': 2 },
    redis: { '7.4': 0, '7.2': 1, '6.2': 2 },
    postgresql: { '17': 0, '16': 1, '15': 2, '14': 3 },
    mongodb: { '8.0': 0, '7.0': 1, '6.0': 2 },
    memcached: { '1.6': 0, '1.5': 1 },
  };
  const getServicePort = (serviceId, version) => {
    const base = SERVICE_DEFAULT_PORTS[serviceId];
    if (!base) return null;
    const offset = SERVICE_VERSION_PORT_OFFSETS[serviceId]?.[version] ?? 0;
    return base + offset;
  };

  // Service definitions - databases first (mutually exclusive), then others
  const serviceDefinitions = [
    { id: 'mysql', name: 'MySQL', icon: '🗄️', installed: isAnyVersionInstalled(binariesStatus?.mysql), isDatabase: true, hasVersions: true },
    { id: 'mariadb', name: 'MariaDB', icon: '🗃️', installed: isAnyVersionInstalled(binariesStatus?.mariadb), isDatabase: true, hasVersions: true },
    { id: 'postgresql', name: 'PostgreSQL', icon: '🐘', installed: isAnyVersionInstalled(binariesStatus?.postgresql), hasVersions: true },
    { id: 'mongodb', name: 'MongoDB', icon: '🍃', installed: isAnyVersionInstalled(binariesStatus?.mongodb), hasVersions: true },
    { id: 'redis', name: 'Redis', icon: '⚡', installed: isAnyVersionInstalled(binariesStatus?.redis), hasVersions: true },
    { id: 'memcached', name: 'Memcached', icon: '💾', installed: isAnyVersionInstalled(binariesStatus?.memcached), hasVersions: true },
    { id: 'python', name: 'Python', icon: '🐍', installed: isAnyVersionInstalled(binariesStatus?.python), hasVersions: true },
    { id: 'minio', name: 'MinIO', icon: '🪣', installed: binariesStatus?.minio?.installed === true },
    { id: 'nodejs', name: 'Node.js', icon: <NodeJsIcon className="w-5 h-5 text-green-600" />, installed: isAnyVersionInstalled(binariesStatus?.nodejs), hasVersions: true },
    { id: 'queue', name: 'Queue Worker', icon: '📋', installed: true }, // Always available for Laravel
  ];

  return (
    <div className="space-y-4">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* Project Info */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Project Information</h3>

          {/* Stat tiles */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-3">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Type</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-white capitalize">{project.type}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-3">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Status</p>
              <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', project.isRunning ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400')}>
                {project.isRunning ? 'Running' : 'Stopped'}
              </span>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-3">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Port</p>
              <p className="text-sm font-mono font-semibold text-gray-900 dark:text-white">{project.port}<span className="text-gray-400 dark:text-gray-500 font-normal"> / {project.sslPort || '—'}</span></p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-3">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">SSL</p>
              <p className={clsx('text-sm font-semibold', project.ssl ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500')}>
                {project.ssl ? '🔒 Enabled' : 'Disabled'}
              </p>
            </div>
          </div>

          {/* PHP version - PHP projects only */}
          {project.type !== 'nodejs' && (
            <div className="flex items-center justify-between py-2 border-t border-gray-100 dark:border-gray-700/60">
              <span className="text-sm text-gray-600 dark:text-gray-400">PHP Version</span>
              <div className="flex items-center gap-1.5">
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
                        className={clsx('input py-1 px-2 text-sm w-24', !isCurrentInstalled && 'border-red-500 dark:border-red-500')}
                      >
                        {displayVersions.map((v) => (
                          <option key={v.version} value={v.version} className={v.notInstalled ? 'text-red-500' : ''}>
                            {v.version}{v.notInstalled ? ' (not installed)' : ''}
                          </option>
                        ))}
                      </select>
                      {!isCurrentInstalled && <AlertTriangle className="w-4 h-4 text-red-500" title="PHP version not installed" />}
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Node.js info */}
          {project.type === 'nodejs' && (
            <div className="border-t border-gray-100 dark:border-gray-700/60 pt-2 space-y-2">
              {project.nodeFramework && (
                <div className="flex items-center justify-between py-1">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Framework</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {({ express: 'Express', fastify: 'Fastify', nestjs: 'NestJS', nextjs: 'Next.js', nuxtjs: 'Nuxt.js', koa: 'Koa', hapi: 'Hapi', adonisjs: 'AdonisJS', remix: 'Remix', sveltekit: 'SvelteKit', strapi: 'Strapi', elysia: 'Elysia' })[project.nodeFramework] || project.nodeFramework}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-gray-600 dark:text-gray-400">Node.js Version</span>
                <span className="text-sm font-medium font-mono text-gray-900 dark:text-white">v{project.services?.nodejsVersion || '20'}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-gray-600 dark:text-gray-400">App Port</span>
                <span className="text-sm font-medium font-mono text-gray-900 dark:text-white">{project.nodePort || 3000}</span>
              </div>
              {project.nodeStartCommand && (
                <div className="flex items-center justify-between py-1">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Start Command</span>
                  <span className="text-sm font-mono text-gray-900 dark:text-white">{project.nodeStartCommand}</span>
                </div>
              )}
            </div>
          )}

          {/* Toggles */}
          <div className="border-t border-gray-100 dark:border-gray-700/60 mt-2 pt-2 space-y-1">
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">Auto-start</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={getEffectiveValue('autoStart') || false}
                  onChange={(e) => {
                    const newValue = e.target.checked;
                    if (newValue === (project.autoStart || false)) { const { autoStart, ...rest } = pendingChanges; setPendingChanges(rest); }
                    else { setPendingChanges({ ...pendingChanges, autoStart: newValue }); }
                  }} className="sr-only peer" />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
              </label>
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm text-gray-600 dark:text-gray-400">Share on Local Network</span>
                {!getEffectiveValue('networkAccess') && (
                  <p className="text-xs text-gray-400 dark:text-gray-500">Allow LAN access via IP address</p>
                )}
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={getEffectiveValue('networkAccess') || false}
                  onChange={(e) => {
                    const newValue = e.target.checked;
                    if (newValue === (project.networkAccess || false)) { const { networkAccess, ...rest } = pendingChanges; setPendingChanges(rest); }
                    else { setPendingChanges({ ...pendingChanges, networkAccess: newValue }); }
                  }} className="sr-only peer" />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
              </label>
            </div>
          </div>

          {getEffectiveValue('networkAccess') && localIpAddresses.length > 0 && (
            <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-1.5">🌐 Network Access URLs</p>
              <div className="space-y-1">
                {localIpAddresses.map((ip, index) => {
                  const httpPort = webServerPorts?.httpPort || 80;
                  const displayPort = httpPort === 80 ? '' : `:${httpPort}`;
                  return <p key={index} className="text-xs text-blue-600 dark:text-blue-400 font-mono">http://{ip}{displayPort}</p>;
                })}
              </div>
              <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">⚠️ Allow port {webServerPorts?.httpPort || 80} in Windows Firewall.</p>
            </div>
          )}
        </div>

        {/* Domains + Web Server — middle column */}
        <div className="flex flex-col gap-4">

          {/* Domains */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
              Domains
            </h3>

            <DomainManager
              domains={getEffectiveValue('domains') || (project.domain ? [project.domain] : [])}
              onChange={(newDomains) => {
                const original = project.domains || (project.domain ? [project.domain] : []);
                const sameAsOriginal =
                  newDomains.length === original.length &&
                  [...newDomains].sort().join(',') === [...original].sort().join(',');
                if (sameAsOriginal) {
                  const { domains, ...rest } = pendingChanges;
                  setPendingChanges(rest);
                } else {
                  setPendingChanges({ ...pendingChanges, domains: newDomains });
                }
              }}
            />

            {project.ssl && (
              <p className="mt-3 text-sm text-green-600 dark:text-green-400">
                🔒 HTTPS enabled for all domains
              </p>
            )}

            <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
              Subdomains like <span className="font-mono">api.{project.domain}</span> are automatically routed to this project.
            </p>

            {/* Document Root */}
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/60">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                Document Root
              </label>
              <input
                type="text"
                value={getEffectiveValue('documentRoot') || ''}
                onChange={(e) => {
                  const newValue = e.target.value;
                  if (newValue === (project.documentRoot || '')) {
                    const { documentRoot, ...rest } = pendingChanges;
                    setPendingChanges(rest);
                  } else {
                    setPendingChanges({ ...pendingChanges, documentRoot: newValue });
                  }
                }}
                placeholder={
                  project.type === 'wordpress' ? 'Default: project root' :
                    project.type === 'laravel' || project.type === 'symfony' ? 'Default: public' :
                      'Default: auto-detect (public, www, web)'
                }
                className="input text-sm w-full"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                The folder web server points to. Leave empty to use default based on project type.
              </p>
            </div>
          </div>

          {/* Web Server */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
              Web Server
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {['nginx', 'apache'].map((server) => {
                const effectiveServer = getEffectiveValue('webServer');
                const effectiveVersion = getEffectiveValue('webServerVersion');
                const isSelected = effectiveServer === server;
                const isChanged = pendingChanges.webServer && pendingChanges.webServer !== project.webServer;
                const versionChanged = pendingChanges.webServerVersion && pendingChanges.webServerVersion !== project.webServerVersion;
                const serverVersions = versionOptions[server] || [];
                const isInstalled = serverVersions.length > 0;

                return (
                  <button
                    key={server}
                    onClick={() => isInstalled && handleWebServerChange(server)}
                    disabled={!isInstalled}
                    className={clsx(
                      'p-4 rounded-lg border-2 text-left transition-all',
                      !isInstalled && 'opacity-50 cursor-not-allowed',
                      isSelected
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {server === 'nginx' ? (
                          <Server className="w-5 h-5 text-green-500" />
                        ) : (
                          <Layers className="w-5 h-5 text-orange-500" />
                        )}
                        <span className="font-medium text-gray-900 dark:text-white capitalize">{server}</span>
                      </div>
                      {/* Version selector */}
                      {isSelected && serverVersions.length > 0 && (
                        <select
                          value={effectiveVersion || serverVersions[0]}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleWebServerVersionChange(e.target.value);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="input py-1 px-2 text-xs w-16"
                        >
                          {serverVersions.map((v) => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    {!isInstalled ? (
                      <span className="text-xs mt-1 block text-gray-500 dark:text-gray-400">
                        Not installed
                      </span>
                    ) : isSelected ? (
                      <span className={clsx(
                        'text-xs mt-1 block',
                        (isChanged || versionChanged) && effectiveServer === server
                          ? 'text-yellow-600 dark:text-yellow-400'
                          : 'text-primary-600 dark:text-primary-400'
                      )}>
                        {(isChanged || versionChanged) && effectiveServer === server ? 'Modified' : 'Active'}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {(pendingChanges.webServer || pendingChanges.webServerVersion) && (
              <p className="mt-3 text-xs text-yellow-600 dark:text-yellow-400">
                Web server configuration will change after saving
              </p>
            )}
          </div>

        </div>{/* end middle column */}

        {/* Services — full width below */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Services</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Only one database can be active at a time. Changes take effect after saving.
              </p>
            </div>
          </div>

          {(() => {
            const DB_IDS = ['mysql', 'mariadb', 'postgresql', 'mongodb'];
            const dbServices = serviceDefinitions.filter(s => DB_IDS.includes(s.id));
            const otherServices = serviceDefinitions.filter(s => !DB_IDS.includes(s.id));

            const renderRow = (service) => {
              const effectiveServices = getEffectiveValue('services');
              const isEnabled = effectiveServices[service.id] || false;
              const isInstalled = service.installed;
              const isChanged = pendingChanges.services &&
                pendingChanges.services[service.id] !== (project.services?.[service.id] || false);
              const currentVersion = effectiveServices[`${service.id}Version`] || versionOptions[service.id]?.[0];
              const versionChanged = pendingChanges.services?.[`${service.id}Version`] !== undefined &&
                pendingChanges.services[`${service.id}Version`] !== project.services?.[`${service.id}Version`];
              const servicePort = isEnabled ? getServicePort(service.id, currentVersion) : null;

              return (
                <div
                  key={service.id}
                  className={clsx(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all',
                    isEnabled
                      ? 'border-green-400 bg-green-50 dark:bg-green-900/20'
                      : isInstalled
                        ? 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                        : 'border-dashed border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/20'
                  )}
                >
                  {/* Icon */}
                  <span className={clsx('text-lg shrink-0 leading-none', !isInstalled && 'opacity-30')}>
                    {service.icon}
                  </span>

                  {/* Name + port */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={clsx(
                        'text-sm font-medium',
                        isEnabled
                          ? 'text-green-700 dark:text-green-400'
                          : !isInstalled
                            ? 'text-gray-400 dark:text-gray-500'
                            : 'text-gray-800 dark:text-gray-200'
                      )}>
                        {service.name}
                      </span>
                      {isEnabled && servicePort && (
                        <span className="text-xs font-mono text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/40 px-1.5 py-0.5 rounded">
                          :{servicePort}
                        </span>
                      )}
                      {(isChanged || versionChanged) && (
                        <span className="text-xs text-yellow-500 font-bold">•</span>
                      )}
                    </div>
                  </div>

                  {/* Right side: version + toggle OR install */}
                  <div className="flex items-center gap-2 shrink-0">
                    {service.hasVersions && isEnabled && isInstalled && (
                      <select
                        value={currentVersion}
                        onChange={(e) => handleServiceVersionChange(service.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="input py-0.5 px-1.5 text-xs w-16"
                      >
                        {versionOptions[service.id]?.map((v) => (
                          <option key={v} value={v} disabled={binariesStatus?.[service.id]?.[v]?.installed !== true}>
                            {v}
                          </option>
                        ))}
                      </select>
                    )}

                    {!isInstalled ? (
                      <button
                        onClick={() => navigate('/binaries')}
                        className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium border border-primary-200 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/40 px-2 py-1 rounded transition-colors"
                      >
                        <Download className="w-3 h-3" />
                        Install
                      </button>
                    ) : (
                      <button
                        onClick={() => handleServiceToggle(service.id)}
                        className={clsx(
                          'w-9 h-5 rounded-full transition-colors relative shrink-0',
                          isEnabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                        )}
                      >
                        <div className={clsx(
                          'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform',
                          isEnabled ? 'translate-x-4' : 'translate-x-0.5'
                        )} />
                      </button>
                    )}
                  </div>
                </div>
              );
            };

            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                {/* Databases */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
                    Databases
                  </p>
                  {dbServices.map(renderRow)}
                </div>

                {/* Other services */}
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
                    Services
                  </p>
                  {otherServices.map(renderRow)}
                </div>
              </div>
            );
          })()}

          {/* phpMyAdmin quick-launch — only for MySQL / MariaDB */}
          {(() => {
            const effectiveServices = getEffectiveValue('services');
            const activeDb = ['mysql', 'mariadb'].find(db => effectiveServices[db]);
            if (!activeDb) return null;
            const activeVersion = effectiveServices[`${activeDb}Version`] || versionOptions[activeDb]?.[0];
            const isLoading = phpMyAdminLoading === activeDb;
            return (
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => openPhpMyAdmin(activeDb, activeVersion)}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Starting phpMyAdmin...
                    </>
                  ) : (
                    <>
                      <ExternalLink className="w-4 h-4" />
                      Open phpMyAdmin
                      <span className="text-xs opacity-60 capitalize">({activeDb} {activeVersion})</span>
                    </>
                  )}
                </button>
              </div>
            );
          })()}
        </div>

      </div>
    </div >
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

function WorkersTab({ processes, projectId, onRefresh, isRunning }) {
  const { showConfirm } = useModal();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProcess, setNewProcess] = useState({
    name: '',
    command: '',
    numprocs: 1,
    autostart: true,
    autorestart: true,
  });
  const [expandedLogs, setExpandedLogs] = useState({});
  const [workerLogs, setWorkerLogs] = useState({});
  const [autoRefresh, setAutoRefresh] = useState(!!isRunning);

  // Sync autoRefresh with project running state
  useEffect(() => {
    setAutoRefresh(!!isRunning);
  }, [isRunning]);

  // Auto-expand logs for running processes on mount
  useEffect(() => {
    if (processes.length > 0) {
      const runningProcesses = processes.filter(p => p.isRunning);
      if (runningProcesses.length > 0) {
        // Auto-expand the first running process
        const firstRunning = runningProcesses[0];
        setExpandedLogs(prev => ({ ...prev, [firstRunning.name]: true }));
        loadWorkerLogs(firstRunning.name);
      }
    }
  }, [processes.length]); // Only run when process count changes

  // Load logs for expanded workers
  const loadWorkerLogs = async (processName) => {
    try {
      const logs = await window.devbox?.supervisor?.getWorkerLogs?.(projectId, processName, 200);
      setWorkerLogs(prev => ({ ...prev, [processName]: logs || [] }));
    } catch (error) {
      console.error('Error loading worker logs:', error);
    }
  };

  // Subscribe to real-time output (only when project is running)
  useEffect(() => {
    if (!isRunning) return;
    const unsubscribe = window.devbox?.supervisor?.onOutput?.((data) => {
      // Use strict equality and ensure both are strings for comparison
      if (String(data.projectId) === String(projectId)) {
        const timestamp = data.timestamp; // Match file log format (ISO)
        const prefix = data.type === 'stderr' ? '[ERR]' : '[OUT]';

        setWorkerLogs(prev => {
          const currentLogs = prev[data.processName] || [];
          const newLogs = [...currentLogs];
          // Split by newlines and add each line
          data.output.split('\n').filter(line => line.trim()).forEach(line => {
            newLogs.push(`[${timestamp}] ${prefix} ${line}`);
          });
          // Keep last 500 lines
          return { ...prev, [data.processName]: newLogs.slice(-500) };
        });
      }
    });

    return () => unsubscribe?.();
  }, [projectId, isRunning]);

  // Auto-refresh logs for expanded workers (only when project is running)
  useEffect(() => {
    if (!autoRefresh || !isRunning) return;

    const expandedNames = Object.keys(expandedLogs).filter(name => expandedLogs[name]);
    if (expandedNames.length === 0) return;

    const interval = setInterval(() => {
      expandedNames.forEach(loadWorkerLogs);
    }, 3000);

    return () => clearInterval(interval);
  }, [expandedLogs, autoRefresh, projectId]);

  const toggleLogs = async (processName) => {
    const isExpanding = !expandedLogs[processName];
    setExpandedLogs(prev => ({ ...prev, [processName]: isExpanding }));

    if (isExpanding) {
      await loadWorkerLogs(processName);
    }
  };

  const clearWorkerLogs = async (processName) => {
    try {
      await window.devbox?.supervisor?.clearWorkerLogs?.(projectId, processName);
      setWorkerLogs(prev => ({ ...prev, [processName]: [] }));
    } catch (error) {
      console.error('Error clearing worker logs:', error);
    }
  };

  const handleAddProcess = async () => {
    try {
      await window.devbox?.supervisor.addProcess(projectId, newProcess);
      setShowAddForm(false);
      const processName = newProcess.name;
      setNewProcess({ name: '', command: '', numprocs: 1, autostart: true, autorestart: true });
      await onRefresh();
      // Auto-expand logs for the newly added process
      setTimeout(() => {
        setExpandedLogs(prev => ({ ...prev, [processName]: true }));
        loadWorkerLogs(processName);
      }, 500); // Small delay to ensure process is started
    } catch (error) {
      // Error adding process
    }
  };

  const handleStartProcess = async (name) => {
    await window.devbox?.supervisor.startProcess(projectId, name);
    await onRefresh();
    // Auto-expand logs when starting a process
    setTimeout(() => {
      setExpandedLogs(prev => ({ ...prev, [name]: true }));
      loadWorkerLogs(name);
    }, 300);
  };

  const handleStopProcess = async (name) => {
    await window.devbox?.supervisor.stopProcess(projectId, name);
    onRefresh();
  };

  const handleRemoveProcess = async (name) => {
    const confirmed = await showConfirm({
      title: 'Remove Process',
      message: `Remove process "${name}"?`,
      confirmText: 'Remove',
      confirmStyle: 'danger',
      type: 'warning'
    });
    if (confirmed) {
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
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            Auto-refresh
          </label>
          <button onClick={() => setShowAddForm(true)} className="btn-primary btn-sm">
            <Plus className="w-4 h-4" />
            Add Worker
          </button>
        </div>
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
        {Array.isArray(processes) && processes.map((process) => (
          <div key={process.name} className="card overflow-hidden">
            <div className="p-4">
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
                  <button
                    onClick={() => toggleLogs(process.name)}
                    className={clsx(
                      'btn-ghost btn-sm',
                      expandedLogs[process.name] && 'bg-gray-100 dark:bg-gray-700'
                    )}
                    title="View logs"
                  >
                    <Terminal className="w-4 h-4" />
                    Logs
                  </button>
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

            {/* Expandable Logs Section */}
            {expandedLogs[process.name] && (
              <div className="border-t border-gray-200 dark:border-gray-700">
                <div className="p-2 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {(workerLogs[process.name] || []).length} log entries
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => loadWorkerLogs(process.name)}
                      className="btn-ghost btn-xs"
                      title="Refresh logs"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => clearWorkerLogs(process.name)}
                      className="btn-ghost btn-xs text-red-500"
                      title="Clear logs"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div
                  className="p-3 bg-gray-900 max-h-64 overflow-auto font-mono text-xs"
                  style={{ scrollBehavior: 'smooth' }}
                  ref={(el) => {
                    // Auto-scroll to bottom on new content
                    if (el && autoRefresh) {
                      el.scrollTop = el.scrollHeight;
                    }
                  }}
                >
                  {(workerLogs[process.name] || []).length > 0 ? (
                    (workerLogs[process.name] || []).map((line, index) => (
                      <div
                        key={index}
                        className={clsx(
                          'py-0.5 hover:bg-gray-800',
                          line.includes('[ERR]') ? 'text-red-400' : 'text-gray-300'
                        )}
                      >
                        {line}
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-500 space-y-2">
                      {process.isRunning ? (
                        <>
                          <p>⏳ Waiting for output...</p>
                          <p className="text-xs text-gray-600 mt-2">
                            💡 <strong>Tip:</strong> Laravel queue workers may not show output until a job is processed.
                            <br />Add <code className="bg-gray-800 px-1 rounded text-gray-300">--verbose</code> or <code className="bg-gray-800 px-1 rounded text-gray-300">-vvv</code> flag to see detailed logs.
                          </p>
                        </>
                      ) : (
                        <p>No logs available. Start the worker to begin logging.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        {processes.length === 0 && (
          <div className="card p-12 text-center">
            <Cpu className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No workers configured</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
              Add a worker to run background processes like queue workers, schedulers, or Horizon.
            </p>
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
        // Failed to load .env file
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
          // Cache optimization failed - non-critical
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
      // Failed to save environment
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

// Domain management sub-component
function DomainManager({ domains, onChange }) {
  const [addingDomain, setAddingDomain] = useState(false);
  const [newDomain, setNewDomain] = useState('');

  const handleRemove = (index) => {
    if (domains.length <= 1) return; // Must keep at least one domain
    onChange(domains.filter((_, i) => i !== index));
  };

  const handleAdd = () => {
    const trimmed = newDomain.trim().toLowerCase();
    if (!trimmed || domains.includes(trimmed)) return;
    onChange([...domains, trimmed]);
    setNewDomain('');
    setAddingDomain(false);
  };

  return (
    <div className="space-y-1.5">
      {domains.map((domain, index) => (
        <div key={index} className="flex items-center gap-2 group">
          <Globe className="w-4 h-4 text-gray-400 shrink-0" />
          <span className="text-sm text-gray-900 dark:text-white flex-1 font-mono break-all">{domain}</span>
          {index === 0 && (
            <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">primary</span>
          )}
          {domains.length > 1 && (
            <button
              onClick={() => handleRemove(index)}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-gray-400 hover:text-red-500"
              title="Remove domain"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ))}
      {addingDomain ? (
        <div className="flex items-center gap-2 mt-2">
          <input
            type="text"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') { setAddingDomain(false); setNewDomain(''); }
            }}
            placeholder="api.myproject.test or myproject.site"
            className="input text-sm flex-1 py-1"
            autoFocus
          />
          <button onClick={handleAdd} className="p-1 text-green-600 hover:text-green-700" title="Confirm">
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setAddingDomain(false); setNewDomain(''); }}
            className="p-1 text-gray-400 hover:text-gray-600"
            title="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAddingDomain(true)}
          className="mt-1 flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
        >
          <Plus className="w-3.5 h-3.5" />
          Add domain / subdomain
        </button>
      )}
    </div>
  );
}

export default ProjectDetail;
