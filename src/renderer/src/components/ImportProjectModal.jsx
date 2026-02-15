import React, { useState, useEffect } from 'react';
import { X, Download, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Shared Import Project Modal Component
 * Used by both Projects.jsx and CreateProject.jsx
 */
function ImportProjectModal({ project, onClose, onImport }) {
    const [config, setConfig] = useState({
        name: project.name || '',
        path: project.path,
        type: project.type || 'custom',
        phpVersion: '',
        webServer: 'nginx',
        documentRoot: '', // Custom document root
        ssl: true,
        domain: '',
        services: {
            mysql: false,
            mysqlVersion: '',
            mariadb: false,
            mariadbVersion: '',
            redis: false,
            redisVersion: '',
            nodejs: false,
            nodejsVersion: '',
            queue: false,
        },
    });
    const [isImporting, setIsImporting] = useState(false);
    const [installedPhpVersions, setInstalledPhpVersions] = useState([]);
    const [installedWebServers, setInstalledWebServers] = useState({ nginx: [], apache: [] });
    const [installedDatabases, setInstalledDatabases] = useState({ mysql: [], mariadb: [] });
    const [installedRedis, setInstalledRedis] = useState([]);
    const [installedNodejs, setInstalledNodejs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showServices, setShowServices] = useState(false);

    // Generate suggested domain from name
    const suggestedDomain = config.name
        ? `${config.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}.test`
        : '';

    // Fetch installed binaries on mount
    useEffect(() => {
        const fetchBinaries = async () => {
            try {
                const status = await window.devbox?.binaries.getStatus();
                if (status) {
                    // Get installed PHP versions (sorted descending - newest first)
                    const phpVersions = Object.entries(status.php || {})
                        .filter(([_, info]) => info.installed)
                        .map(([version]) => version)
                        .sort((a, b) => parseFloat(b) - parseFloat(a));

                    // Get installed web servers
                    const nginxVersions = Object.entries(status.nginx || {})
                        .filter(([_, info]) => info.installed)
                        .map(([version]) => version);
                    const apacheVersions = Object.entries(status.apache || {})
                        .filter(([_, info]) => info.installed)
                        .map(([version]) => version);

                    // Get installed databases
                    const mysqlVersions = Object.entries(status.mysql || {})
                        .filter(([_, info]) => info.installed)
                        .map(([version]) => version);
                    const mariadbVersions = Object.entries(status.mariadb || {})
                        .filter(([_, info]) => info.installed)
                        .map(([version]) => version);

                    // Get installed Redis
                    const redisVersions = Object.entries(status.redis || {})
                        .filter(([_, info]) => info.installed)
                        .map(([version]) => version);

                    // Get installed Node.js
                    const nodejsVersions = Object.entries(status.nodejs || {})
                        .filter(([_, info]) => info.installed)
                        .map(([version]) => version);

                    setInstalledPhpVersions(phpVersions);
                    setInstalledWebServers({ nginx: nginxVersions, apache: apacheVersions });
                    setInstalledDatabases({ mysql: mysqlVersions, mariadb: mariadbVersions });
                    setInstalledRedis(redisVersions);
                    setInstalledNodejs(nodejsVersions);

                    // Set default PHP version to first available
                    if (phpVersions.length > 0) {
                        setConfig(prev => ({ ...prev, phpVersion: phpVersions[0] }));
                    }

                    // Set default web server based on what's installed
                    if (nginxVersions.length === 0 && apacheVersions.length > 0) {
                        setConfig(prev => ({ ...prev, webServer: 'apache' }));
                    }

                    // Set default versions for optional services
                    if (mysqlVersions.length > 0) {
                        setConfig(prev => ({
                            ...prev,
                            services: { ...prev.services, mysqlVersion: mysqlVersions[0] }
                        }));
                    }
                    if (mariadbVersions.length > 0) {
                        setConfig(prev => ({
                            ...prev,
                            services: { ...prev.services, mariadbVersion: mariadbVersions[0] }
                        }));
                    }
                    if (redisVersions.length > 0) {
                        setConfig(prev => ({
                            ...prev,
                            services: { ...prev.services, redisVersion: redisVersions[0] }
                        }));
                    }
                    if (nodejsVersions.length > 0) {
                        setConfig(prev => ({
                            ...prev,
                            services: { ...prev.services, nodejsVersion: nodejsVersions[0] }
                        }));
                    }
                }
            } catch (error) {
                console.error('Error fetching binaries:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchBinaries();
    }, []);

    const toggleService = (service) => {
        // Handle mutually exclusive databases
        if (service === 'mysql' && !config.services.mysql) {
            setConfig(prev => ({
                ...prev,
                services: {
                    ...prev.services,
                    mysql: true,
                    mariadb: false, // Turn off MariaDB
                },
            }));
        } else if (service === 'mariadb' && !config.services.mariadb) {
            setConfig(prev => ({
                ...prev,
                services: {
                    ...prev.services,
                    mariadb: true,
                    mysql: false, // Turn off MySQL
                },
            }));
        } else {
            setConfig(prev => ({
                ...prev,
                services: {
                    ...prev.services,
                    [service]: !prev.services[service],
                },
            }));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsImporting(true);
        try {
            await onImport({
                ...config,
                domain: config.domain || suggestedDomain,
                installFresh: false, // Importing existing project
            });
        } finally {
            setIsImporting(false);
        }
    };

    const hasNoPhpInstalled = installedPhpVersions.length === 0;
    const hasNoWebServer = installedWebServers.nginx.length === 0 && installedWebServers.apache.length === 0;

    // Count available optional services
    const hasMysql = installedDatabases.mysql.length > 0;
    const hasMariadb = installedDatabases.mariadb.length > 0;
    const hasRedis = installedRedis.length > 0;
    const hasNodejs = installedNodejs.length > 0;
    const isLaravel = config.type === 'laravel';
    const hasAnyOptionalService = hasMysql || hasMariadb || hasRedis || hasNodejs || isLaravel;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
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

                <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                            <span className="ml-3 text-gray-600 dark:text-gray-400">Loading binaries...</span>
                        </div>
                    ) : (
                        <>
                            {/* Basic Info Section */}
                            <div className="grid grid-cols-2 gap-4">
                                {/* Project Name */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Project Name
                                    </label>
                                    <input
                                        type="text"
                                        value={config.name}
                                        onChange={(e) => setConfig({ ...config, name: e.target.value })}
                                        className="input text-sm"
                                        placeholder="My Project"
                                    />
                                </div>

                                {/* Project Type */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Type
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
                                    className="input bg-gray-100 dark:bg-gray-700 text-xs"
                                />
                            </div>

                            {/* Domain */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Domain
                                </label>
                                <input
                                    type="text"
                                    value={config.domain}
                                    onChange={(e) => setConfig({ ...config, domain: e.target.value })}
                                    placeholder={suggestedDomain}
                                    className="input"
                                />
                            </div>

                            {/* Document Root */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Document Root (Optional)
                                </label>
                                <input
                                    type="text"
                                    value={config.documentRoot}
                                    onChange={(e) => setConfig({ ...config, documentRoot: e.target.value })}
                                    placeholder={
                                        config.type === 'wordpress' ? 'Default: project root' :
                                            config.type === 'laravel' || config.type === 'symfony' ? 'Default: public' :
                                                'Default: auto-detect'
                                    }
                                    className="input"
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    The folder the web server points to. Leave empty for auto-detection.
                                </p>
                            </div>

                            {/* PHP & Web Server Row */}
                            <div className="grid grid-cols-2 gap-4">
                                {/* PHP Version */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        PHP Version
                                    </label>
                                    {hasNoPhpInstalled ? (
                                        <div className="p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                                            <p className="text-xs text-amber-700 dark:text-amber-300">No PHP installed</p>
                                        </div>
                                    ) : (
                                        <select
                                            value={config.phpVersion}
                                            onChange={(e) => setConfig({ ...config, phpVersion: e.target.value })}
                                            className="select"
                                        >
                                            {installedPhpVersions.map((version) => (
                                                <option key={version} value={version}>PHP {version}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>

                                {/* Web Server */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Web Server
                                    </label>
                                    {hasNoWebServer ? (
                                        <div className="p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                                            <p className="text-xs text-amber-700 dark:text-amber-300">No web server</p>
                                        </div>
                                    ) : (
                                        <select
                                            value={config.webServer}
                                            onChange={(e) => setConfig({ ...config, webServer: e.target.value })}
                                            className="select"
                                        >
                                            {installedWebServers.nginx.length > 0 && <option value="nginx">Nginx</option>}
                                            {installedWebServers.apache.length > 0 && <option value="apache">Apache</option>}
                                        </select>
                                    )}
                                </div>
                            </div>

                            {/* Optional Services Section */}
                            {hasAnyOptionalService && (
                                <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
                                    <button
                                        type="button"
                                        onClick={() => setShowServices(!showServices)}
                                        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                    >
                                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                            Optional Services
                                        </span>
                                        {showServices ? (
                                            <ChevronUp className="w-4 h-4 text-gray-500" />
                                        ) : (
                                            <ChevronDown className="w-4 h-4 text-gray-500" />
                                        )}
                                    </button>

                                    {showServices && (
                                        <div className="p-4 space-y-4">
                                            {/* Database Section */}
                                            {(hasMysql || hasMariadb) && (
                                                <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
                                                    <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-3">Database (choose one)</p>
                                                    <div className="space-y-3">
                                                        {/* MySQL */}
                                                        {hasMysql && (
                                                            <div className="space-y-2">
                                                                <label className="flex items-center gap-3 cursor-pointer">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={config.services.mysql}
                                                                        onChange={() => toggleService('mysql')}
                                                                        className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                                                    />
                                                                    <div className="flex-1">
                                                                        <span className="text-sm font-medium text-gray-900 dark:text-white">MySQL</span>
                                                                        <p className="text-xs text-gray-500">Relational database</p>
                                                                    </div>
                                                                </label>
                                                                {config.services.mysql && (
                                                                    <select
                                                                        value={config.services.mysqlVersion}
                                                                        onChange={(e) => setConfig(prev => ({
                                                                            ...prev,
                                                                            services: { ...prev.services, mysqlVersion: e.target.value }
                                                                        }))}
                                                                        className="select text-sm ml-7"
                                                                    >
                                                                        {installedDatabases.mysql.map((version) => (
                                                                            <option key={version} value={version}>MySQL {version}</option>
                                                                        ))}
                                                                    </select>
                                                                )}
                                                            </div>
                                                        )}

                                                        {/* MariaDB */}
                                                        {hasMariadb && (
                                                            <div className="space-y-2">
                                                                <label className="flex items-center gap-3 cursor-pointer">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={config.services.mariadb}
                                                                        onChange={() => toggleService('mariadb')}
                                                                        className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                                                    />
                                                                    <div className="flex-1">
                                                                        <span className="text-sm font-medium text-gray-900 dark:text-white">MariaDB</span>
                                                                        <p className="text-xs text-gray-500">MySQL-compatible database</p>
                                                                    </div>
                                                                </label>
                                                                {config.services.mariadb && (
                                                                    <select
                                                                        value={config.services.mariadbVersion}
                                                                        onChange={(e) => setConfig(prev => ({
                                                                            ...prev,
                                                                            services: { ...prev.services, mariadbVersion: e.target.value }
                                                                        }))}
                                                                        className="select text-sm ml-7"
                                                                    >
                                                                        {installedDatabases.mariadb.map((version) => (
                                                                            <option key={version} value={version}>MariaDB {version}</option>
                                                                        ))}
                                                                    </select>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Redis */}
                                            {hasRedis && (
                                                <div className="space-y-2">
                                                    <label className="flex items-center gap-3 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={config.services.redis}
                                                            onChange={() => toggleService('redis')}
                                                            className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                                        />
                                                        <div className="flex-1">
                                                            <span className="text-sm font-medium text-gray-900 dark:text-white">Redis</span>
                                                            <p className="text-xs text-gray-500">Cache & session storage</p>
                                                        </div>
                                                    </label>
                                                    {config.services.redis && (
                                                        <select
                                                            value={config.services.redisVersion}
                                                            onChange={(e) => setConfig(prev => ({
                                                                ...prev,
                                                                services: { ...prev.services, redisVersion: e.target.value }
                                                            }))}
                                                            className="select text-sm ml-7"
                                                        >
                                                            {installedRedis.map((version) => (
                                                                <option key={version} value={version}>Redis {version}</option>
                                                            ))}
                                                        </select>
                                                    )}
                                                </div>
                                            )}

                                            {/* Node.js */}
                                            {hasNodejs && (
                                                <div className="space-y-2">
                                                    <label className="flex items-center gap-3 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={config.services.nodejs}
                                                            onChange={() => toggleService('nodejs')}
                                                            className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                                        />
                                                        <div className="flex-1">
                                                            <span className="text-sm font-medium text-gray-900 dark:text-white">Node.js</span>
                                                            <p className="text-xs text-gray-500">For npm/frontend builds</p>
                                                        </div>
                                                    </label>
                                                    {config.services.nodejs && (
                                                        <select
                                                            value={config.services.nodejsVersion}
                                                            onChange={(e) => setConfig(prev => ({
                                                                ...prev,
                                                                services: { ...prev.services, nodejsVersion: e.target.value }
                                                            }))}
                                                            className="select text-sm ml-7"
                                                        >
                                                            {installedNodejs.map((version) => (
                                                                <option key={version} value={version}>Node {version}</option>
                                                            ))}
                                                        </select>
                                                    )}
                                                </div>
                                            )}

                                            {/* Queue Worker (Laravel only) */}
                                            {isLaravel && (
                                                <label className="flex items-center gap-3 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={config.services.queue}
                                                        onChange={() => toggleService('queue')}
                                                        className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                                    />
                                                    <div className="flex-1">
                                                        <span className="text-sm font-medium text-gray-900 dark:text-white">Queue Worker</span>
                                                        <p className="text-xs text-gray-500">Background job processing</p>
                                                    </div>
                                                </label>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="btn-secondary"
                                    disabled={isImporting}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isImporting || hasNoPhpInstalled || hasNoWebServer || !config.name}
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
                        </>
                    )}
                </form>
            </div>
        </div>
    );
}

export default ImportProjectModal;
