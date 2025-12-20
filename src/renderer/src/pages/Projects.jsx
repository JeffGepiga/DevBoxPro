import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { Link } from 'react-router-dom';
import {
  Plus,
  Search,
  Play,
  Square,
  Trash2,
  ExternalLink,
  Folder,
  MoreVertical,
  Code,
  Filter,
  RefreshCw,
  FolderSearch,
  Download,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import clsx from 'clsx';

function Projects() {
  const { projects, loading, startProject, stopProject, deleteProject, refreshProjects, settings } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [discoveredProjects, setDiscoveredProjects] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [showDiscovered, setShowDiscovered] = useState(true);
  const [importModal, setImportModal] = useState({ open: false, project: null });
  const [deleteModal, setDeleteModal] = useState({ open: false, project: null });
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const filteredProjects = projects.filter((project) => {
    const matchesSearch = project.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || project.type === filterType;
    const matchesStatus =
      filterStatus === 'all' ||
      (filterStatus === 'running' && project.isRunning) ||
      (filterStatus === 'stopped' && !project.isRunning);

    return matchesSearch && matchesType && matchesStatus;
  });

  const handleDeleteClick = (project) => {
    setDeleteModal({ open: true, project });
    setDeleteConfirmText('');
    setDeleteFiles(false);
  };

  const handleDeleteConfirm = async () => {
    if (deleteConfirmText !== 'delete' || !deleteModal.project) return;
    
    setIsDeleting(true);
    try {
      await deleteProject(deleteModal.project.id, deleteFiles);
      setDeleteModal({ open: false, project: null });
      setDeleteConfirmText('');
      setDeleteFiles(false);
    } catch (error) {
      console.error('Failed to delete project:', error);
      alert('Failed to delete project: ' + error.message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteModal({ open: false, project: null });
    setDeleteConfirmText('');
    setDeleteFiles(false);
  };

  const handleScanProjects = async () => {
    setIsScanning(true);
    try {
      const discovered = await window.devbox?.projects.scanUnregistered();
      setDiscoveredProjects(discovered || []);
      if (discovered?.length > 0) {
        setShowDiscovered(true);
      }
    } catch (error) {
      console.error('Failed to scan for projects:', error);
    } finally {
      setIsScanning(false);
    }
  };

  const handleImportProject = async (config) => {
    try {
      await window.devbox?.projects.registerExisting(config);
      // Remove from discovered list
      setDiscoveredProjects((prev) => prev.filter((p) => p.path !== config.path));
      setImportModal({ open: false, project: null });
      // Refresh projects list
      refreshProjects?.();
    } catch (error) {
      console.error('Failed to import project:', error);
    }
  };

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
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Projects</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Manage your development projects
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleScanProjects}
            disabled={isScanning}
            className="btn-secondary"
          >
            {isScanning ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <FolderSearch className="w-4 h-4" />
            )}
            {isScanning ? 'Scanning...' : 'Scan for Projects'}
          </button>
          <Link to="/projects/new" className="btn-primary">
            <Plus className="w-4 h-4" />
            New Project
          </Link>
        </div>
      </div>

      {/* Discovered Projects Section */}
      {discoveredProjects.length > 0 && (
        <div className="mb-6">
          <div
            className="card border-2 border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20"
          >
            <button
              onClick={() => setShowDiscovered(!showDiscovered)}
              className="w-full px-4 py-3 flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-3">
                <FolderSearch className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                <span className="font-medium text-amber-800 dark:text-amber-300">
                  Discovered Projects ({discoveredProjects.length})
                </span>
                <span className="text-sm text-amber-600 dark:text-amber-400">
                  Found in your projects directory
                </span>
              </div>
              {showDiscovered ? (
                <ChevronUp className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              )}
            </button>
            
            {showDiscovered && (
              <div className="px-4 pb-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {discoveredProjects.map((project) => (
                    <DiscoveredProjectCard
                      key={project.path}
                      project={project}
                      onImport={() => setImportModal({ open: true, project })}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-10"
            />
          </div>

          {/* Type filter */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="select w-40"
          >
            <option value="all">All Types</option>
            <option value="laravel">Laravel</option>
            <option value="symfony">Symfony</option>
            <option value="wordpress">WordPress</option>
            <option value="custom">Custom PHP</option>
          </select>

          {/* Status filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="select w-40"
          >
            <option value="all">All Status</option>
            <option value="running">Running</option>
            <option value="stopped">Stopped</option>
          </select>
        </div>
      </div>

      {/* Projects Grid */}
      {filteredProjects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onStart={() => startProject(project.id)}
              onStop={() => stopProject(project.id)}
              onDelete={() => handleDeleteClick(project)}
              defaultEditor={settings?.settings?.defaultEditor}
            />
          ))}
        </div>
      ) : (
        <div className="card p-12 text-center">
          <Folder className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            {projects.length === 0 ? 'No projects yet' : 'No projects match your filters'}
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            {projects.length === 0
              ? 'Create your first project to get started'
              : 'Try adjusting your search or filters'}
          </p>
          {projects.length === 0 && (
            <Link to="/projects/new" className="btn-primary">
              <Plus className="w-4 h-4" />
              Create Project
            </Link>
          )}
        </div>
      )}

      {/* Import Project Modal */}
      {importModal.open && importModal.project && (
        <ImportProjectModal
          project={importModal.project}
          onClose={() => setImportModal({ open: false, project: null })}
          onImport={handleImportProject}
        />
      )}

      {/* Delete Project Modal */}
      {deleteModal.open && deleteModal.project && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-500" />
                Delete Project
              </h3>
            </div>

            {/* Content */}
            <div className="p-6">
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                Are you sure you want to delete <strong className="text-gray-900 dark:text-white">{deleteModal.project.name}</strong>?
              </p>

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

function DiscoveredProjectCard({ project, onImport }) {
  const typeColors = {
    laravel: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    symfony: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    wordpress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    custom: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-amber-200 dark:border-amber-700">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <Folder className="w-5 h-5 text-amber-500" />
          <span className="font-medium text-gray-900 dark:text-white">{project.name}</span>
        </div>
        <span className={clsx('badge text-xs', typeColors[project.type])}>
          {project.type}
        </span>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 truncate mb-3" title={project.path}>
        {project.path}
      </p>
      <button
        onClick={onImport}
        className="w-full btn-sm bg-amber-500 hover:bg-amber-600 text-white"
      >
        <Download className="w-4 h-4" />
        Import Project
      </button>
    </div>
  );
}

function ImportProjectModal({ project, onClose, onImport }) {
  const [config, setConfig] = useState({
    name: project.name,
    path: project.path,
    type: project.type,
    phpVersion: '8.3',
    webServer: 'nginx',
    database: 'none',
  });
  const [isImporting, setIsImporting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsImporting(true);
    try {
      await onImport(config);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Import Project
          </h3>
          <button
            onClick={onClose}
            className="btn-ghost btn-icon"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Project Name (read-only, using folder name) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Project Name
            </label>
            <input
              type="text"
              value={config.name}
              disabled
              className="input bg-gray-100 dark:bg-gray-700"
            />
            <p className="text-xs text-gray-500 mt-1">Using folder name</p>
          </div>

          {/* Path (read-only) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Path
            </label>
            <input
              type="text"
              value={config.path}
              disabled
              className="input bg-gray-100 dark:bg-gray-700 text-sm"
            />
          </div>

          {/* Project Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Project Type
            </label>
            <select
              value={config.type}
              onChange={(e) => setConfig({ ...config, type: e.target.value })}
              className="select"
            >
              <option value="laravel">Laravel</option>
              <option value="symfony">Symfony</option>
              <option value="wordpress">WordPress</option>
              <option value="custom">Custom PHP</option>
            </select>
          </div>

          {/* PHP Version */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              PHP Version
            </label>
            <select
              value={config.phpVersion}
              onChange={(e) => setConfig({ ...config, phpVersion: e.target.value })}
              className="select"
            >
              <option value="8.4">PHP 8.4</option>
              <option value="8.3">PHP 8.3</option>
              <option value="8.2">PHP 8.2</option>
              <option value="8.1">PHP 8.1</option>
              <option value="8.0">PHP 8.0</option>
              <option value="7.4">PHP 7.4</option>
            </select>
          </div>

          {/* Web Server */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Web Server
            </label>
            <select
              value={config.webServer}
              onChange={(e) => setConfig({ ...config, webServer: e.target.value })}
              className="select"
            >
              <option value="nginx">Nginx</option>
              <option value="apache">Apache</option>
            </select>
          </div>

          {/* Database */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Database
            </label>
            <select
              value={config.database}
              onChange={(e) => setConfig({ ...config, database: e.target.value })}
              className="select"
            >
              <option value="none">None</option>
              <option value="mysql">MySQL</option>
              <option value="mariadb">MariaDB</option>
            </select>
            {config.database !== 'none' && (
              <p className="text-xs text-gray-500 mt-1">
                A database named "{config.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}" will be created
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isImporting}
              className="btn-primary"
            >
              {isImporting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Import Project
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProjectCard({ project, onStart, onStop, onDelete, defaultEditor }) {
  const [showMenu, setShowMenu] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState(null);

  const handleStart = async () => {
    setIsStarting(true);
    setError(null);
    try {
      const result = await onStart();
      if (result && !result.success) {
        setError(result.error || 'Failed to start project');
      }
    } catch (err) {
      setError(err.message || 'Failed to start project');
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    setIsStopping(true);
    setError(null);
    try {
      const result = await onStop();
      if (result && !result.success) {
        setError(result.error || 'Failed to stop project');
      }
    } catch (err) {
      setError(err.message || 'Failed to stop project');
    } finally {
      setIsStopping(false);
    }
  };

  const typeColors = {
    laravel: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    symfony: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    wordpress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    custom: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  };

  return (
    <div className="card overflow-hidden">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={project.isRunning ? 'status-running' : 'status-stopped'} />
            <Link
              to={`/projects/${project.id}`}
              className="text-lg font-semibold text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400"
            >
              {project.name}
            </Link>
          </div>
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="btn-ghost btn-icon"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            {showMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-10">
                <button
                  onClick={() => {
                    window.devbox?.projects.openFolder(project.id);
                    setShowMenu(false);
                  }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                >
                  <Folder className="w-4 h-4" />
                  Open Folder
                </button>
                <button
                  onClick={async () => {
                    setError(null);
                    try {
                      await window.devbox?.projects.openInEditor(project.id, defaultEditor || 'vscode');
                    } catch (err) {
                      setError(err.message || 'Failed to open in editor');
                    }
                    setShowMenu(false);
                  }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                >
                  <Code className="w-4 h-4" />
                  Open in Editor
                </button>
                <hr className="my-1 border-gray-200 dark:border-gray-700" />
                <button
                  onClick={() => {
                    onDelete();
                    setShowMenu(false);
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-2">
            <span className={clsx('badge', typeColors[project.type])}>
              {project.type}
            </span>
            <span className="badge badge-neutral">PHP {project.phpVersion}</span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate" title={project.path}>
            {project.path}
          </p>
          {project.domains && project.domains.length > 0 && (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {project.domains[0]}
            </p>
          )}
        </div>

        {/* Port & URL */}
        {project.isRunning && (
          <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
            <p className="text-sm text-green-700 dark:text-green-400">
              Running on port <strong>{project.port}</strong>
            </p>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {project.isRunning ? (
            <button 
              onClick={handleStop} 
              disabled={isStopping}
              className="btn-secondary btn-sm"
            >
              {isStopping ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Square className="w-4 h-4" />
              )}
              {isStopping ? 'Stopping...' : 'Stop'}
            </button>
          ) : (
            <button 
              onClick={handleStart} 
              disabled={isStarting}
              className="btn-success btn-sm"
            >
              {isStarting ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              {isStarting ? 'Starting...' : 'Start'}
            </button>
          )}
        </div>
        {project.isRunning && (
          <button
            onClick={() => window.devbox?.projects.openInBrowser(project.id)}
            className="btn-ghost btn-sm"
          >
            <ExternalLink className="w-4 h-4" />
            Open
          </button>
        )}
      </div>
    </div>
  );
}

export default Projects;
