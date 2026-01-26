import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { useModal } from '../context/ModalContext';
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
  FolderPlus,
  FolderOutput,
  Download,
  X,
  ChevronDown,
  ChevronUp,
  ChevronRight,
} from 'lucide-react';
import clsx from 'clsx';
import ImportProjectModal from '../components/ImportProjectModal';

function Projects() {
  const { projects, loading, startProject, stopProject, deleteProject, refreshProjects, settings } = useApp();
  const { showAlert } = useModal();
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
  const [moveModal, setMoveModal] = useState({ open: false, project: null });
  const [isMoving, setIsMoving] = useState(false);

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
      // Failed to delete project
      await showAlert({ title: 'Error', message: 'Failed to delete project: ' + error.message, type: 'error' });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteModal({ open: false, project: null });
    setDeleteConfirmText('');
    setDeleteFiles(false);
  };

  const handleMoveClick = (project) => {
    setMoveModal({ open: true, project });
  };

  const handleMoveConfirm = async () => {
    if (!moveModal.project) return;

    try {
      // Open folder picker dialog
      const newFolderPath = await window.devbox?.system.selectDirectory();
      if (!newFolderPath) {
        return; // User cancelled
      }

      // The new path should be the selected folder + project folder name
      const projectFolderName = moveModal.project.path.split(/[\\/]/).pop();
      const newPath = `${newFolderPath}${newFolderPath.endsWith('\\') || newFolderPath.endsWith('/') ? '' : '\\'}${projectFolderName}`;

      setIsMoving(true);
      
      await window.devbox?.projects.move(moveModal.project.id, newPath);
      
      setMoveModal({ open: false, project: null });
      refreshProjects?.();
      
      await showAlert({ 
        title: 'Project Moved', 
        message: `Project "${moveModal.project.name}" has been moved to:\n${newPath}`, 
        type: 'success' 
      });
    } catch (error) {
      await showAlert({ 
        title: 'Error', 
        message: 'Failed to move project: ' + error.message, 
        type: 'error' 
      });
    } finally {
      setIsMoving(false);
    }
  };

  const handleMoveCancel = () => {
    setMoveModal({ open: false, project: null });
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
      // Failed to scan for projects
    } finally {
      setIsScanning(false);
    }
  };

  const handleImportFolder = async () => {
    try {
      // Open folder picker dialog
      const folderPath = await window.devbox?.system.selectDirectory();
      if (!folderPath) return; // User cancelled

      // Check if project is already registered
      const existingProject = projects.find(p => p.path === folderPath);
      if (existingProject) {
        await showAlert({ title: 'Already Registered', message: `This folder is already registered as project "${existingProject.name}"`, type: 'warning' });
        return;
      }

      // Detect project type from folder contents
      const projectInfo = await window.devbox?.projects.detectType(folderPath);

      // Open import modal with detected info
      setImportModal({
        open: true,
        project: projectInfo || {
          name: folderPath.split(/[\\/]/).pop(),
          path: folderPath,
          type: 'custom'
        }
      });
    } catch (error) {
      // Failed to import folder
      console.error('Failed to import folder:', error);
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
      // Failed to import project
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
            onClick={handleImportFolder}
            className="btn-secondary"
            title="Import an existing project folder"
          >
            <FolderPlus className="w-4 h-4" />
            Import Project
          </button>
          <button
            onClick={handleScanProjects}
            disabled={isScanning}
            className="btn-secondary"
            title="Scan projects directory for unregistered projects"
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
              onMove={() => handleMoveClick(project)}
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

      {/* Move Project Modal */}
      {moveModal.open && moveModal.project && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <FolderOutput className="w-5 h-5 text-primary-500" />
                Move Project
              </h3>
            </div>

            {/* Content */}
            <div className="p-6">
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                Move <strong className="text-gray-900 dark:text-white">{moveModal.project.name}</strong> to a different location?
              </p>

              <div className="p-3 mb-4 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Current location:</p>
                <p className="text-sm font-mono text-gray-700 dark:text-gray-300 break-all">
                  {moveModal.project.path}
                </p>
              </div>

              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  ⚠️ All project files will be moved to the new location. The project will be stopped during the move if it's running.
                </p>
              </div>

              {moveModal.project.type === 'laravel' && (
                <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <p className="text-sm text-blue-700 dark:text-blue-400">
                    💡 <strong>Laravel Note:</strong> After moving, run <code className="px-1 py-0.5 bg-blue-100 dark:bg-blue-800 rounded">composer dump-autoload</code> to update autoload paths.
                  </p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
              <button
                onClick={handleMoveCancel}
                className="btn-secondary"
                disabled={isMoving}
              >
                Cancel
              </button>
              <button
                onClick={handleMoveConfirm}
                disabled={isMoving}
                className="btn-primary"
              >
                {isMoving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Moving...
                  </>
                ) : (
                  <>
                    <FolderOutput className="w-4 h-4" />
                    Choose Destination
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

function ProjectCard({ project, onStart, onStop, onDelete, onMove, defaultEditor }) {
  const { projectLoadingStates, setProjectLoading } = useApp();
  const loadingState = projectLoadingStates[project.id];
  const isStarting = loadingState === 'starting';
  const isStopping = loadingState === 'stopping';

  const [showMenu, setShowMenu] = useState(false);
  const [error, setError] = useState(null);
  const [isHovered, setIsHovered] = useState(false);

  const handleStart = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    setProjectLoading(project.id, 'starting');
    setError(null);
    try {
      const result = await onStart();
      if (result && !result.success) {
        setError(result.error || 'Failed to start project');
      }
    } catch (err) {
      setError(err.message || 'Failed to start project');
    } finally {
      setProjectLoading(project.id, null);
    }
  };

  const handleStop = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    setProjectLoading(project.id, 'stopping');
    setError(null);
    try {
      const result = await onStop();
      if (result && !result.success) {
        setError(result.error || 'Failed to stop project');
      }
    } catch (err) {
      setError(err.message || 'Failed to stop project');
    } finally {
      setProjectLoading(project.id, null);
    }
  };

  const handleMenuClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    setShowMenu(!showMenu);
  };

  const typeColors = {
    laravel: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    symfony: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    wordpress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    custom: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  };

  return (
    <Link
      to={`/projects/${project.id}`}
      className={clsx(
        'card overflow-hidden block transition-all duration-200 cursor-pointer',
        'hover:shadow-lg hover:border-primary-300 dark:hover:border-primary-600',
        'hover:scale-[1.02] active:scale-[0.99]',
        isHovered && 'ring-2 ring-primary-200 dark:ring-primary-700'
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setShowMenu(false);
      }}
    >
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={project.isRunning ? 'status-running' : 'status-stopped'} />
            <span className="text-lg font-semibold text-gray-900 dark:text-white">
              {project.name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* View Details indicator on hover */}
            <span className={clsx(
              'text-xs text-primary-500 dark:text-primary-400 flex items-center gap-1 transition-opacity duration-200',
              isHovered ? 'opacity-100' : 'opacity-0'
            )}>
              View Details
              <ChevronRight className="w-3 h-3" />
            </span>
            <div className="relative">
              <button
                onClick={handleMenuClick}
                className="btn-ghost btn-icon"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              {showMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-10">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      window.devbox?.projects.openFolder(project.id);
                      setShowMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                  >
                    <Folder className="w-4 h-4" />
                    Open Folder
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setShowMenu(false);
                      onMove();
                    }}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                  >
                    <FolderOutput className="w-4 h-4" />
                    Move Project
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      e.preventDefault();
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
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
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
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              window.devbox?.projects.openInBrowser(project.id);
            }}
            className="btn-ghost btn-sm"
          >
            <ExternalLink className="w-4 h-4" />
            Open
          </button>
        )}
      </div>
    </Link>
  );
}

export default Projects;
