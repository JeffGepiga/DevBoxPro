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
  Play,
  Square,
} from 'lucide-react';
import clsx from 'clsx';

function Databases() {
  const [databases, setDatabases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [newDbName, setNewDbName] = useState('');
  const [selectedDatabase, setSelectedDatabase] = useState(null); // { type: 'mysql', version: '8.4' }
  const [dbInfo, setDbInfo] = useState(null);
  const [binariesStatus, setBinariesStatus] = useState(null);
  const [servicesStatus, setServicesStatus] = useState({});
  const [resetForm, setResetForm] = useState({ user: 'root', password: '' });
  const [resetting, setResetting] = useState(false);
  const [startingVersion, setStartingVersion] = useState(null); // 'mysql-8.4' or null
  const [stoppingVersion, setStoppingVersion] = useState(null);
  const [serviceError, setServiceError] = useState(null);

  useEffect(() => {
    loadInitialData();
    // Poll service status every 3 seconds
    const interval = setInterval(loadServicesStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedDatabase) {
      loadDatabases();
    }
  }, [selectedDatabase, servicesStatus]);

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
      const [status, info, services] = await Promise.all([
        window.devbox?.binaries.getStatus(),
        window.devbox?.database.getDatabaseInfo(),
        window.devbox?.services.getStatus(),
      ]);
      setBinariesStatus(status);
      setDbInfo(info);
      setServicesStatus(services || {});
      setResetForm({ user: info?.user || 'root', password: '' });
      
      // Auto-select first running database, or first installed one
      const mysqlRunning = services?.mysql?.status === 'running' ? services.mysql.version : null;
      const mariadbRunning = services?.mariadb?.status === 'running' ? services.mariadb.version : null;
      
      if (mysqlRunning) {
        setSelectedDatabase({ type: 'mysql', version: mysqlRunning });
      } else if (mariadbRunning) {
        setSelectedDatabase({ type: 'mariadb', version: mariadbRunning });
      } else {
        // Select first installed version
        const mysqlVersions = status?.mysql ? Object.entries(status.mysql).filter(([_, v]) => v?.installed).map(([ver]) => ver) : [];
        const mariadbVersions = status?.mariadb ? Object.entries(status.mariadb).filter(([_, v]) => v?.installed).map(([ver]) => ver) : [];
        if (mysqlVersions.length > 0) {
          setSelectedDatabase({ type: 'mysql', version: mysqlVersions[0] });
        } else if (mariadbVersions.length > 0) {
          setSelectedDatabase({ type: 'mariadb', version: mariadbVersions[0] });
        }
      }
    } catch (error) {
      console.error('Error loading initial data:', error);
    }
    setLoading(false);
  };

  const loadDatabases = async () => {
    if (!selectedDatabase) {
      setDatabases([]);
      setLoading(false);
      return;
    }
    
    // Check if the selected database version is running
    const serviceStatus = servicesStatus[selectedDatabase.type];
    const isRunning = serviceStatus?.status === 'running' && serviceStatus?.version === selectedDatabase.version;
    
    if (!isRunning) {
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

  const handleSelectDatabase = async (type, version) => {
    setSelectedDatabase({ type, version });
    // Update active database type for queries
    try {
      await window.devbox?.database.setActiveDatabaseType(type);
      setServiceError(null);
    } catch (error) {
      console.error('Error switching database:', error);
    }
  };

  const handleStartVersion = async (type, version) => {
    const key = `${type}-${version}`;
    setStartingVersion(key);
    setServiceError(null);
    try {
      await window.devbox?.services.start(type, version);
      await new Promise(resolve => setTimeout(resolve, 1500));
      await loadServicesStatus();
      // Auto-select this database after starting
      setSelectedDatabase({ type, version });
      await window.devbox?.database.setActiveDatabaseType(type);
    } catch (error) {
      console.error('Error starting service:', error);
      setServiceError(`Failed to start ${type} ${version}: ${error.message}`);
    } finally {
      setStartingVersion(null);
    }
  };

  const handleStopVersion = async (type, version) => {
    const key = `${type}-${version}`;
    setStoppingVersion(key);
    try {
      await window.devbox?.services.stop(type, version);
      await new Promise(resolve => setTimeout(resolve, 500));
      await loadServicesStatus();
    } catch (error) {
      console.error('Error stopping service:', error);
      setServiceError(`Failed to stop ${type} ${version}: ${error.message}`);
    } finally {
      setStoppingVersion(null);
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

  // Get installed versions for each database type
  const getInstalledVersions = (service) => {
    if (!binariesStatus?.[service]) return [];
    return Object.entries(binariesStatus[service])
      .filter(([_, v]) => v?.installed)
      .map(([version]) => version)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  };
  
  const mysqlVersions = getInstalledVersions('mysql');
  const mariadbVersions = getInstalledVersions('mariadb');
  
  // Build list of all installed database versions
  const installedDatabases = [
    ...mysqlVersions.map(v => ({ type: 'mysql', version: v, label: `MySQL ${v}` })),
    ...mariadbVersions.map(v => ({ type: 'mariadb', version: v, label: `MariaDB ${v}` })),
  ];
  
  // Check if selected database version is running
  const isSelectedRunning = selectedDatabase && 
    servicesStatus[selectedDatabase.type]?.status === 'running' &&
    servicesStatus[selectedDatabase.type]?.version === selectedDatabase.version;
  
  const selectedLabel = selectedDatabase 
    ? `${selectedDatabase.type === 'mysql' ? 'MySQL' : 'MariaDB'} ${selectedDatabase.version}`
    : 'No database installed';

  if (loading && !binariesStatus) {
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
            Manage your MySQL and MariaDB databases
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={openPhpMyAdmin} 
            className="btn-secondary"
            disabled={!isSelectedRunning}
          >
            <ExternalLink className="w-4 h-4" />
            phpMyAdmin
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="btn-primary"
            disabled={!isSelectedRunning}
          >
            <Plus className="w-4 h-4" />
            New Database
          </button>
        </div>
      </div>

      {/* Installed Database Versions */}
      {installedDatabases.length === 0 ? (
        <div className="card p-12 text-center mb-6">
          <Database className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            No Database Installed
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            Install MySQL or MariaDB from the Binary Manager to get started.
          </p>
        </div>
      ) : (
        <div className="card p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Installed Database Engines
            </span>
            <button
              onClick={() => setShowResetModal(true)}
              className="btn-ghost btn-sm"
              disabled={!isSelectedRunning}
            >
              <Key className="w-4 h-4" />
              Reset Credentials
            </button>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {installedDatabases.map((db) => {
              const serviceStatus = servicesStatus[db.type];
              const isRunning = serviceStatus?.status === 'running' && serviceStatus?.version === db.version;
              const isSelected = selectedDatabase?.type === db.type && selectedDatabase?.version === db.version;
              const versionKey = `${db.type}-${db.version}`;
              const isStarting = startingVersion === versionKey;
              const isStopping = stoppingVersion === versionKey;
              const port = isRunning ? serviceStatus?.port : null;
              
              return (
                <div
                  key={versionKey}
                  onClick={() => handleSelectDatabase(db.type, db.version)}
                  className={clsx(
                    'p-3 rounded-lg border-2 cursor-pointer transition-all',
                    isSelected
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Database className={clsx(
                        'w-5 h-5',
                        db.type === 'mysql' ? 'text-blue-500' : 'text-teal-500'
                      )} />
                      <span className="font-medium text-gray-900 dark:text-white">
                        {db.label}
                      </span>
                    </div>
                    {isRunning && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300">
                        Running
                      </span>
                    )}
                  </div>
                  
                  <div className="flex items-center justify-between">
                    {isRunning ? (
                      <>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          Port: {port}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStopVersion(db.type, db.version);
                          }}
                          disabled={isStopping}
                          className="btn-ghost btn-sm text-red-500 hover:text-red-600"
                        >
                          {isStopping ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <Square className="w-3 h-3" />
                          )}
                          <span className="text-xs">Stop</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          Stopped
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartVersion(db.type, db.version);
                          }}
                          disabled={isStarting}
                          className="btn-ghost btn-sm text-green-500 hover:text-green-600"
                        >
                          {isStarting ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <Play className="w-3 h-3" />
                          )}
                          <span className="text-xs">Start</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          
          {/* Connection info for selected running database */}
          {isSelectedRunning && dbInfo && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-6 text-sm text-gray-600 dark:text-gray-400">
                <span><strong>Host:</strong> {dbInfo.host}</span>
                <span><strong>Port:</strong> {dbInfo.port}</span>
                <span><strong>User:</strong> {dbInfo.user}</span>
                <span><strong>Password:</strong> {dbInfo.password ? '••••••' : '(empty)'}</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                <HardDrive className="w-3 h-3 inline mr-1" />
                Each version has its own isolated data directory.
              </p>
            </div>
          )}
          
          {serviceError && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-3">
              {serviceError}
            </p>
          )}
        </div>
      )}

      {/* Not Running Notice */}
      {selectedDatabase && !isSelectedRunning && installedDatabases.length > 0 && (
        <div className="card p-6 mb-6 border-2 border-yellow-400 dark:border-yellow-600 bg-yellow-50 dark:bg-yellow-900/20">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-yellow-100 dark:bg-yellow-800 rounded-full flex items-center justify-center">
              <Database className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {selectedLabel} is not running
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Click the Start button on the database version above to view and manage its databases.
              </p>
            </div>
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
              {!isSelectedRunning
                ? `Start ${selectedLabel} to view databases.`
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
              Create Database in {selectedLabel}
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
              Reset {selectedLabel} Credentials
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
