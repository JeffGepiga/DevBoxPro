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
  Settings,
  ChevronDown,
  Play,
  Square,
  X,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '../context/AppContext';
import { useModal } from '../context/ModalContext';

function Databases() {
  const { databaseOperation, setDatabaseOperation, clearDatabaseOperation } = useApp();
  const { showAlert, showConfirm } = useModal();
  const [databases, setDatabases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newDbName, setNewDbName] = useState('');
  const [selectedDatabase, setSelectedDatabase] = useState(null); // { type: 'mysql', version: '8.4' }
  const [dbInfo, setDbInfo] = useState(null);
  const [binariesStatus, setBinariesStatus] = useState(null);
  const [servicesStatus, setServicesStatus] = useState({});
  const [startingVersion, setStartingVersion] = useState(null); // 'mysql-8.4' or null
  const [stoppingVersion, setStoppingVersion] = useState(null);
  const [serviceError, setServiceError] = useState(null);
  const [showImportModal, setShowImportModal] = useState(null); // { dbName, filePath } or null

  useEffect(() => {
    loadInitialData();
    // Poll service status every 3 seconds
    const interval = setInterval(loadServicesStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  // Note: Don't auto-load databases on selectedDatabase change alone
  // because the active database type/version needs to be set first (via setActiveDatabaseType)
  // Databases are loaded explicitly after setActiveDatabaseType completes in handleSelectDatabase
  useEffect(() => {
    // Only reload if services status changes (e.g. a service starts/stops)
    // This handles the case where user starts a stopped database version
    if (selectedDatabase) {
      // Check if we need to reload due to running state change
      const serviceStatus = servicesStatus[selectedDatabase.type];
      const isRunning = !!serviceStatus?.runningVersions?.[selectedDatabase.version];
      if (isRunning) {
        // Add a small delay to ensure database has fully initialized
        // (especially after credential changes when init-file needs to be processed)
        const timeout = setTimeout(() => {
          loadDatabases();
        }, 1000);
        return () => clearTimeout(timeout);
      }
    }
  }, [servicesStatus]);

  const loadServicesStatus = async () => {
    try {
      const status = await window.devbox?.services.getStatus();
      setServicesStatus(status || {});
    } catch (error) {
      // Error loading services status
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

      // Auto-select first running database, or first installed one
      // Get first running MySQL version from runningVersions
      const mysqlRunningVersions = services?.mysql?.runningVersions ? Object.keys(services.mysql.runningVersions) : [];
      const mariadbRunningVersions = services?.mariadb?.runningVersions ? Object.keys(services.mariadb.runningVersions) : [];

      let autoSelectedType = null;
      let autoSelectedVersion = null;

      if (mysqlRunningVersions.length > 0) {
        autoSelectedType = 'mysql';
        autoSelectedVersion = mysqlRunningVersions[0];
      } else if (mariadbRunningVersions.length > 0) {
        autoSelectedType = 'mariadb';
        autoSelectedVersion = mariadbRunningVersions[0];
      } else {
        // Select first installed version
        const mysqlVersions = status?.mysql ? Object.entries(status.mysql).filter(([_, v]) => v?.installed).map(([ver]) => ver) : [];
        const mariadbVersions = status?.mariadb ? Object.entries(status.mariadb).filter(([_, v]) => v?.installed).map(([ver]) => ver) : [];
        if (mysqlVersions.length > 0) {
          autoSelectedType = 'mysql';
          autoSelectedVersion = mysqlVersions[0];
        } else if (mariadbVersions.length > 0) {
          autoSelectedType = 'mariadb';
          autoSelectedVersion = mariadbVersions[0];
        }
      }

      // Set active type/version in backend (but don't query databases yet)
      // Databases will be loaded when user explicitly clicks on a version or starts one
      if (autoSelectedType && autoSelectedVersion) {
        setSelectedDatabase({ type: autoSelectedType, version: autoSelectedVersion });
        await window.devbox?.database.setActiveDatabaseType(autoSelectedType, autoSelectedVersion);
        // Don't auto-query databases on startup - wait for user interaction
        // This avoids credential mismatch errors on startup
      }
    } catch (error) {
      // Error loading initial data
    }
    setLoading(false);
  };

  const loadDatabases = async () => {
    if (!selectedDatabase) {
      setDatabases([]);
      setLoading(false);
      return;
    }

    // Check if the selected database version is running (using runningVersions)
    const serviceStatus = servicesStatus[selectedDatabase.type];
    const isRunning = !!serviceStatus?.runningVersions?.[selectedDatabase.version];

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
      // Error loading databases
      setServiceError(error.message);
      setDatabases([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectDatabase = async (type, version) => {
    setSelectedDatabase({ type, version });
    // Update active database type AND version for queries
    try {
      await window.devbox?.database.setActiveDatabaseType(type, version);
      setServiceError(null);
      // Now load databases for this specific version
      // Check if running first
      const serviceStatus = servicesStatus[type];
      const isRunning = !!serviceStatus?.runningVersions?.[version];
      if (isRunning) {
        await loadDatabases();
      }
    } catch (error) {
      // Error switching database
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
      await window.devbox?.database.setActiveDatabaseType(type, version);
      // Load databases for the newly started version
      await loadDatabases();
    } catch (error) {
      // Error starting service
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
      // Error stopping service
      setServiceError(`Failed to stop ${type} ${version}: ${error.message}`);
    } finally {
      setStoppingVersion(null);
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
      // Error creating database
      await showAlert({ title: 'Error', message: 'Failed to create database: ' + error.message, type: 'error' });
    }
  };

  const handleDeleteDatabase = async (name) => {
    const confirmed = await showConfirm({
      title: 'Delete Database',
      message: `Are you sure you want to delete "${name}"?`,
      detail: 'This action cannot be undone.',
      confirmText: 'Delete',
      confirmStyle: 'danger',
      type: 'danger'
    });
    if (!confirmed) {
      return;
    }

    try {
      await window.devbox?.database.deleteDatabase(name);
      loadDatabases();
    } catch (error) {
      // Error deleting database
      await showAlert({ title: 'Error', message: 'Failed to delete database: ' + error.message, type: 'error' });
    }
  };

  const handleExportDatabase = async (name) => {
    try {
      // Sanitize database name for use in filename (trim and remove invalid characters)
      const safeName = name.trim().replace(/[<>:"/\\|?*\r\n]/g, '_');
      // Use save dialog for export
      const filePath = await window.devbox?.system.saveFile({
        defaultPath: `${safeName}_backup_${new Date().toISOString().slice(0, 10)}.sql.gz`,
        filters: [
          { name: 'Compressed SQL', extensions: ['sql.gz', 'gz'] },
          { name: 'SQL Files', extensions: ['sql'] },
        ],
      });

      if (filePath) {
        setDatabaseOperation({ type: 'export', status: 'starting', message: 'Starting export...', dbName: name });
        await window.devbox?.database.exportDatabase(name, filePath);
        // Progress will be updated via the global context listener
      }
    } catch (error) {
      // Error exporting database
      setDatabaseOperation({ type: 'export', status: 'error', message: error.message, dbName: name });
    }
  };

  const handleImportDatabase = async (name) => {
    try {
      const filePath = await window.devbox?.system.selectFile([
        { name: 'SQL Files', extensions: ['sql', 'gz'] },
      ]);

      if (filePath) {
        // Show import options modal
        setShowImportModal({ dbName: name, filePath });
      }
    } catch (error) {
      // Error selecting import file
    }
  };

  const executeImport = async (mode) => {
    if (!showImportModal) return;

    const { dbName, filePath } = showImportModal;
    setShowImportModal(null);

    try {
      setDatabaseOperation({ type: 'import', status: 'starting', message: 'Starting import...', dbName });
      await window.devbox?.database.importDatabase(dbName, filePath, mode);
      // Progress will be updated via the global context listener
      loadDatabases();
    } catch (error) {
      // Error importing database
      setDatabaseOperation({ type: 'import', status: 'error', message: error.message, dbName });
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

  // Check if selected database version is running (using runningVersions)
  const isSelectedRunning = selectedDatabase &&
    !!servicesStatus[selectedDatabase.type]?.runningVersions?.[selectedDatabase.version];

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

      {/* Operation Progress Notification */}
      {databaseOperation && (
        <div className={clsx(
          'card p-4 mb-6 border-2 flex items-center justify-between',
          databaseOperation.status === 'error'
            ? 'border-red-400 bg-red-50 dark:bg-red-900/20'
            : databaseOperation.status === 'complete'
              ? 'border-green-400 bg-green-50 dark:bg-green-900/20'
              : 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
        )}>
          <div className="flex items-center gap-3">
            {databaseOperation.status === 'error' ? (
              <AlertCircle className="w-5 h-5 text-red-500" />
            ) : databaseOperation.status === 'complete' ? (
              <CheckCircle className="w-5 h-5 text-green-500" />
            ) : (
              <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />
            )}
            <div>
              <p className="font-medium text-gray-900 dark:text-white">
                {databaseOperation.type === 'export' ? 'Exporting' : 'Importing'} {databaseOperation.dbName}
              </p>
              <p className={clsx(
                'text-sm',
                databaseOperation.status === 'error'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-gray-500 dark:text-gray-400'
              )}>
                {databaseOperation.message}
              </p>
            </div>
          </div>
          {(databaseOperation.status === 'complete' || databaseOperation.status === 'error') && (
            <button
              onClick={clearDatabaseOperation}
              className="btn-ghost btn-sm"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

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
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Manage credentials in Settings → Network
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {installedDatabases.map((db) => {
              const serviceStatus = servicesStatus[db.type];
              // Check if this specific version is running using runningVersions
              const versionInfo = serviceStatus?.runningVersions?.[db.version];
              const isRunning = !!versionInfo;
              const isSelected = selectedDatabase?.type === db.type && selectedDatabase?.version === db.version;
              const versionKey = `${db.type}-${db.version}`;
              const isStarting = startingVersion === versionKey;
              const isStopping = stoppingVersion === versionKey;
              const port = isRunning ? versionInfo?.port : null;

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

      {/* Import Options Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Import Options
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              Choose how to import into <span className="font-medium text-gray-900 dark:text-white">{showImportModal.dbName}</span>
            </p>

            <div className="space-y-3">
              <button
                onClick={() => executeImport('clean')}
                className="w-full p-4 border-2 border-gray-200 dark:border-gray-700 rounded-lg hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left group"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg group-hover:bg-red-200 dark:group-hover:bg-red-900/50">
                    <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">Clean Import</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Drop all existing tables first, then import. Use for full database restore.
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => executeImport('merge')}
                className="w-full p-4 border-2 border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-left group"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-900/50">
                    <RefreshCw className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">Merge / Update</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Keep existing tables and data. Import will update/insert records.
                    </p>
                  </div>
                </div>
              </button>
            </div>

            <div className="flex justify-end mt-6">
              <button
                onClick={() => setShowImportModal(null)}
                className="btn-secondary"
              >
                Cancel
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
