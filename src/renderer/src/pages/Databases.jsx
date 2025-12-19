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
  Key,
  Settings,
  ChevronDown,
} from 'lucide-react';
import clsx from 'clsx';

function Databases() {
  const [databases, setDatabases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [newDbName, setNewDbName] = useState('');
  const [activeDatabaseType, setActiveDatabaseType] = useState('mysql');
  const [dbInfo, setDbInfo] = useState(null);
  const [binariesStatus, setBinariesStatus] = useState(null);
  const [servicesStatus, setServicesStatus] = useState({});
  const [resetForm, setResetForm] = useState({ user: 'root', password: '' });
  const [resetting, setResetting] = useState(false);
  const [startingService, setStartingService] = useState(false);
  const [serviceError, setServiceError] = useState(null);

  useEffect(() => {
    loadInitialData();
    // Poll service status every 3 seconds
    const interval = setInterval(loadServicesStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeDatabaseType) {
      loadDatabases();
    }
  }, [activeDatabaseType, servicesStatus]);

  const loadServicesStatus = async () => {
    try {
      const status = await window.devbox?.services.getStatus();
      setServicesStatus(status || {});
    } catch (error) {
      console.error('Error loading services status:', error);
    }
  };

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const [dbType, status, info, services] = await Promise.all([
        window.devbox?.database.getActiveDatabaseType(),
        window.devbox?.binaries.getStatus(),
        window.devbox?.database.getDatabaseInfo(),
        window.devbox?.services.getStatus(),
      ]);
      setActiveDatabaseType(dbType || 'mysql');
      setBinariesStatus(status);
      setDbInfo(info);
      setServicesStatus(services || {});
      setResetForm({ user: info?.user || 'root', password: '' });
    } catch (error) {
      console.error('Error loading initial data:', error);
    }
    await loadDatabases();
  };

  const loadDatabases = async () => {
    // Check if the active database service is running
    const serviceStatus = servicesStatus[activeDatabaseType];
    if (serviceStatus?.status !== 'running') {
      setDatabases([]);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setServiceError(null);
    try {
      const dbs = await window.devbox?.database.getDatabases();
      setDatabases(dbs || []);
    } catch (error) {
      console.error('Error loading databases:', error);
      setServiceError(error.message);
      setDatabases([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchDatabase = async (dbType) => {
    if (dbType === activeDatabaseType) return;
    
    try {
      await window.devbox?.database.setActiveDatabaseType(dbType);
      setActiveDatabaseType(dbType);
      setServiceError(null);
      // Reload databases after switching
      await loadDatabases();
    } catch (error) {
      console.error('Error switching database:', error);
      alert('Failed to switch database type: ' + error.message);
    }
  };

  const handleStartService = async () => {
    setStartingService(true);
    setServiceError(null);
    try {
      await window.devbox?.services.start(activeDatabaseType);
      // Wait a moment for service to fully start
      await new Promise(resolve => setTimeout(resolve, 1500));
      await loadServicesStatus();
      await loadDatabases();
    } catch (error) {
      console.error('Error starting service:', error);
      setServiceError(`Failed to start ${activeDatabaseType}: ${error.message}`);
    } finally {
      setStartingService(false);
    }
  };

  const handleResetCredentials = async () => {
    if (!resetForm.user.trim()) {
      alert('Username is required');
      return;
    }

    setResetting(true);
    try {
      await window.devbox?.database.resetCredentials(resetForm.user, resetForm.password);
      setShowResetModal(false);
      alert('Database credentials reset successfully!');
      // Reload database info
      const info = await window.devbox?.database.getDatabaseInfo();
      setDbInfo(info);
    } catch (error) {
      console.error('Error resetting credentials:', error);
      alert('Failed to reset credentials: ' + error.message);
    } finally {
      setResetting(false);
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

  const mysqlInstalled = binariesStatus?.mysql?.installed;
  const mariadbInstalled = binariesStatus?.mariadb?.installed;
  const dbTypeLabel = activeDatabaseType === 'mysql' ? 'MySQL' : 'MariaDB';
  const currentServiceStatus = servicesStatus[activeDatabaseType];
  const isServiceRunning = currentServiceStatus?.status === 'running';

  if (loading && !databases.length && isServiceRunning) {
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
            Manage your {dbTypeLabel} databases
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={openPhpMyAdmin} 
            className="btn-secondary"
            disabled={!isServiceRunning}
          >
            <ExternalLink className="w-4 h-4" />
            phpMyAdmin
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="btn-primary"
            disabled={!isServiceRunning}
          >
            <Plus className="w-4 h-4" />
            New Database
          </button>
        </div>
      </div>

      {/* Database Type Switcher & Credentials */}
      <div className="card p-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Database Engine:</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSwitchDatabase('mysql')}
                disabled={!mysqlInstalled}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  activeDatabaseType === 'mysql'
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600',
                  !mysqlInstalled && 'opacity-50 cursor-not-allowed'
                )}
              >
                MySQL
                {!mysqlInstalled && <span className="text-xs ml-1">(not installed)</span>}
              </button>
              <button
                onClick={() => handleSwitchDatabase('mariadb')}
                disabled={!mariadbInstalled}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  activeDatabaseType === 'mariadb'
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600',
                  !mariadbInstalled && 'opacity-50 cursor-not-allowed'
                )}
              >
                MariaDB
                {!mariadbInstalled && <span className="text-xs ml-1">(not installed)</span>}
              </button>
            </div>
          </div>
          <button
            onClick={() => setShowResetModal(true)}
            className="btn-secondary"
          >
            <Key className="w-4 h-4" />
            Reset Credentials
          </button>
        </div>
        {dbInfo && (
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 flex items-center gap-6 text-sm text-gray-600 dark:text-gray-400">
            <span><strong>Host:</strong> {dbInfo.host}</span>
            <span><strong>Port:</strong> {dbInfo.port}</span>
            <span><strong>User:</strong> {dbInfo.user}</span>
            <span><strong>Password:</strong> {dbInfo.password ? '••••••' : '(empty)'}</span>
          </div>
        )}
      </div>

      {/* Service Not Running Warning */}
      {!isServiceRunning && (
        <div className="card p-6 mb-6 border-2 border-yellow-400 dark:border-yellow-600 bg-yellow-50 dark:bg-yellow-900/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-yellow-100 dark:bg-yellow-800 rounded-full flex items-center justify-center">
                <Database className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  {dbTypeLabel} is not running
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Start the {dbTypeLabel} service to view and manage databases
                </p>
                {serviceError && (
                  <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                    {serviceError}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={handleStartService}
              disabled={startingService}
              className="btn-primary"
            >
              {startingService ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Database className="w-4 h-4" />
                  Start {dbTypeLabel}
                </>
              )}
            </button>
          </div>
        </div>
      )}

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
                ? `No databases found. Make sure ${dbTypeLabel} is running.`
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

      {/* Reset Credentials Modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="card p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Reset {dbTypeLabel} Credentials
            </h3>
            <div className="space-y-4">
              <div>
                <label className="label">Username</label>
                <input
                  type="text"
                  value={resetForm.user}
                  onChange={(e) => setResetForm({ ...resetForm, user: e.target.value })}
                  className="input"
                  placeholder="root"
                />
              </div>
              <div>
                <label className="label">New Password</label>
                <input
                  type="password"
                  value={resetForm.password}
                  onChange={(e) => setResetForm({ ...resetForm, password: e.target.value })}
                  className="input"
                  placeholder="Leave empty for no password"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Leave empty to set no password (default for local development)
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => {
                  setShowResetModal(false);
                  setResetForm({ user: dbInfo?.user || 'root', password: '' });
                }}
                className="btn-secondary"
                disabled={resetting}
              >
                Cancel
              </button>
              <button
                onClick={handleResetCredentials}
                disabled={!resetForm.user.trim() || resetting}
                className="btn-primary"
              >
                {resetting ? 'Resetting...' : 'Reset Credentials'}
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
