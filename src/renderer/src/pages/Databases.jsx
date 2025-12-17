import React, { useState, useEffect } from 'react';
import {
  Database,
  Plus,
  Trash2,
  Download,
  Upload,
  RefreshCw,
  ExternalLink,
  Search,
  Table,
  HardDrive,
} from 'lucide-react';
import clsx from 'clsx';

function Databases() {
  const [databases, setDatabases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newDbName, setNewDbName] = useState('');

  useEffect(() => {
    loadDatabases();
  }, []);

  const loadDatabases = async () => {
    setLoading(true);
    try {
      const dbs = await window.devbox?.database.getDatabases();
      setDatabases(dbs || []);
    } catch (error) {
      console.error('Error loading databases:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDatabase = async () => {
    if (!newDbName.trim()) return;

    try {
      await window.devbox?.database.createDatabase(newDbName);
      setShowCreateModal(false);
      setNewDbName('');
      loadDatabases();
    } catch (error) {
      console.error('Error creating database:', error);
      alert('Failed to create database: ' + error.message);
    }
  };

  const handleDeleteDatabase = async (name) => {
    if (!window.confirm(`Are you sure you want to delete "${name}"? This cannot be undone.`)) {
      return;
    }

    try {
      await window.devbox?.database.deleteDatabase(name);
      loadDatabases();
    } catch (error) {
      console.error('Error deleting database:', error);
      alert('Failed to delete database: ' + error.message);
    }
  };

  const handleExportDatabase = async (name) => {
    try {
      const filePath = await window.devbox?.system.selectFile([
        { name: 'SQL Files', extensions: ['sql'] },
      ]);

      if (filePath) {
        await window.devbox?.database.exportDatabase(name, filePath);
        alert('Database exported successfully!');
      }
    } catch (error) {
      console.error('Error exporting database:', error);
      alert('Failed to export database: ' + error.message);
    }
  };

  const handleImportDatabase = async (name) => {
    try {
      const filePath = await window.devbox?.system.selectFile([
        { name: 'SQL Files', extensions: ['sql'] },
      ]);

      if (filePath) {
        await window.devbox?.database.importDatabase(name, filePath);
        alert('Database imported successfully!');
      }
    } catch (error) {
      console.error('Error importing database:', error);
      alert('Failed to import database: ' + error.message);
    }
  };

  const openPhpMyAdmin = async () => {
    const url = await window.devbox?.database.getPhpMyAdminUrl();
    if (url) {
      window.devbox?.system.openExternal(url);
    }
  };

  const filteredDatabases = databases.filter((db) =>
    db.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const userDatabases = filteredDatabases.filter((db) => !db.isSystem);
  const systemDatabases = filteredDatabases.filter((db) => db.isSystem);

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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Databases</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Manage your MySQL databases
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openPhpMyAdmin} className="btn-secondary">
            <ExternalLink className="w-4 h-4" />
            phpMyAdmin
          </button>
          <button onClick={() => setShowCreateModal(true)} className="btn-primary">
            <Plus className="w-4 h-4" />
            New Database
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="card p-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search databases..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input pl-10"
          />
        </div>
      </div>

      {/* User Databases */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Your Databases ({userDatabases.length})
        </h2>
        {userDatabases.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {userDatabases.map((db) => (
              <DatabaseCard
                key={db.name}
                database={db}
                onDelete={() => handleDeleteDatabase(db.name)}
                onExport={() => handleExportDatabase(db.name)}
                onImport={() => handleImportDatabase(db.name)}
              />
            ))}
          </div>
        ) : (
          <div className="card p-12 text-center">
            <Database className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">
              {databases.length === 0
                ? 'No databases found. Make sure MySQL is running.'
                : 'No user databases yet'}
            </p>
          </div>
        )}
      </div>

      {/* System Databases */}
      {systemDatabases.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            System Databases ({systemDatabases.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {systemDatabases.map((db) => (
              <div key={db.name} className="card p-4 opacity-60">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
                    <HardDrive className="w-5 h-5 text-gray-500" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{db.name}</p>
                    <p className="text-xs text-gray-500">System database</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="card p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Create Database
            </h3>
            <div className="mb-4">
              <label className="label">Database Name</label>
              <input
                type="text"
                value={newDbName}
                onChange={(e) => setNewDbName(e.target.value)}
                className="input"
                placeholder="my_database"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">
                Use lowercase letters, numbers, and underscores only
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewDbName('');
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateDatabase}
                disabled={!newDbName.trim()}
                className="btn-primary"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DatabaseCard({ database, onDelete, onExport, onImport }) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
            <Database className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="font-medium text-gray-900 dark:text-white">{database.name}</p>
            <p className="text-xs text-gray-500">User database</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onExport}
          className="btn-ghost btn-sm flex-1"
          title="Export database"
        >
          <Download className="w-4 h-4" />
          Export
        </button>
        <button
          onClick={onImport}
          className="btn-ghost btn-sm flex-1"
          title="Import into database"
        >
          <Upload className="w-4 h-4" />
          Import
        </button>
        <button
          onClick={onDelete}
          className="btn-ghost btn-sm btn-icon text-red-500 hover:text-red-600"
          title="Delete database"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default Databases;
