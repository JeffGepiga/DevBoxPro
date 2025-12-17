import React, { useState } from 'react';
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
} from 'lucide-react';
import clsx from 'clsx';

function Projects() {
  const { projects, loading, startProject, stopProject, deleteProject } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const filteredProjects = projects.filter((project) => {
    const matchesSearch = project.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || project.type === filterType;
    const matchesStatus =
      filterStatus === 'all' ||
      (filterStatus === 'running' && project.isRunning) ||
      (filterStatus === 'stopped' && !project.isRunning);

    return matchesSearch && matchesType && matchesStatus;
  });

  const handleDelete = async (id, name) => {
    if (window.confirm(`Are you sure you want to delete "${name}"?`)) {
      await deleteProject(id);
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
        <Link to="/projects/new" className="btn-primary">
          <Plus className="w-4 h-4" />
          New Project
        </Link>
      </div>

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
              onDelete={() => handleDelete(project.id, project.name)}
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
    </div>
  );
}

function ProjectCard({ project, onStart, onStop, onDelete }) {
  const [showMenu, setShowMenu] = useState(false);

  const typeColors = {
    laravel: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
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
                  onClick={() => {
                    window.devbox?.projects.openInEditor(project.id, 'vscode');
                    setShowMenu(false);
                  }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                >
                  <Code className="w-4 h-4" />
                  Open in VS Code
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
      </div>

      {/* Actions */}
      <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {project.isRunning ? (
            <button onClick={onStop} className="btn-secondary btn-sm">
              <Square className="w-4 h-4" />
              Stop
            </button>
          ) : (
            <button onClick={onStart} className="btn-success btn-sm">
              <Play className="w-4 h-4" />
              Start
            </button>
          )}
        </div>
        {project.isRunning && (
          <a
            href={`http://${project.domains?.[0] || `localhost:${project.port}`}`}
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

export default Projects;
