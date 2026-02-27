import React, { useState, useEffect, useMemo } from 'react';
import { X, Download, RefreshCw } from 'lucide-react';

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
        webServerVersion: '',
        documentRoot: '', // Custom document root
        ssl: true,
        domain: '',
        nodePort: 3000,
        nodeStartCommand: 'npm start',
        nodeFramework: '',
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
            postgresql: false,
            postgresqlVersion: '',
            mongodb: false,
            mongodbVersion: '',
            minio: false,
            memcached: false,
            memcachedVersion: '',
            python: false,
            pythonVersion: '',
        },
    });
    const [isImporting, setIsImporting] = useState(false);
    const [installedPhpVersions, setInstalledPhpVersions] = useState([]);
    const [installedWebServers, setInstalledWebServers] = useState({ nginx: [], apache: [] });
    const [installedDatabases, setInstalledDatabases] = useState({ mysql: [], mariadb: [], postgresql: [], mongodb: [] });
    const [installedRedis, setInstalledRedis] = useState([]);
    const [installedNodejs, setInstalledNodejs] = useState([]);
    const [installedMinio, setInstalledMinio] = useState(false);
    const [installedMemcached, setInstalledMemcached] = useState([]);
    const [installedPython, setInstalledPython] = useState([]);
    const [loading, setLoading] = useState(true);

    const missingBinaries = useMemo(() => {
        if (!project.isConfigImport || loading) return [];
        const missing = [];

        // Check PHP
        if (project.phpVersion && !installedPhpVersions.includes(project.phpVersion)) {
            missing.push(`PHP ${project.phpVersion}`);
        }

        // Check Web Server
        if (project.webServer === 'nginx' && project.webServerVersion && !installedWebServers.nginx.includes(project.webServerVersion)) {
            missing.push(`Nginx ${project.webServerVersion}`);
        } else if (project.webServer === 'apache' && project.webServerVersion && !installedWebServers.apache.includes(project.webServerVersion)) {
            missing.push(`Apache ${project.webServerVersion}`);
        }

        // Check Database
        if (project.services?.mysql && project.services?.mysqlVersion && !installedDatabases.mysql.includes(project.services.mysqlVersion)) {
            missing.push(`MySQL ${project.services.mysqlVersion}`);
        }
        if (project.services?.mariadb && project.services?.mariadbVersion && !installedDatabases.mariadb.includes(project.services.mariadbVersion)) {
            missing.push(`MariaDB ${project.services.mariadbVersion}`);
        }
        if (project.services?.postgresql && project.services?.postgresqlVersion && !installedDatabases.postgresql.includes(project.services.postgresqlVersion)) {
            missing.push(`PostgreSQL ${project.services.postgresqlVersion}`);
        }
        if (project.services?.mongodb && project.services?.mongodbVersion && !installedDatabases.mongodb.includes(project.services.mongodbVersion)) {
            missing.push(`MongoDB ${project.services.mongodbVersion}`);
        }

        // Check Redis
        if (project.services?.redis && project.services?.redisVersion && !installedRedis.includes(project.services.redisVersion)) {
            missing.push(`Redis ${project.services.redisVersion}`);
        }

        // Check Node.js
        if (project.nodeVersion && !installedNodejs.includes(project.nodeVersion)) {
            missing.push(`Node.js ${project.nodeVersion}`);
        }

        return missing;
    }, [project, loading, installedPhpVersions, installedWebServers, installedDatabases, installedRedis, installedNodejs]);

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
                    const postgresqlVersions = Object.entries(status.postgresql || {})
                        .filter(([_, info]) => info.installed)
                        .map(([version]) => version);
                    const mongodbVersions = Object.entries(status.mongodb || {})
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

                    // Get Minio (single binary)
                    const minioInstalled = status.minio?.installed === true;

                    // Get Memcached
                    const memcachedVersions = Object.entries(status.memcached || {})
                        .filter(([_, info]) => info.installed)
                        .map(([version]) => version);

                    // Get Python
                    const pythonVersions = Object.entries(status.python || {})
                        .filter(([_, info]) => info.installed)
                        .map(([version]) => version);

                    setInstalledPhpVersions(phpVersions);
                    setInstalledWebServers({ nginx: nginxVersions, apache: apacheVersions });
                    setInstalledDatabases({ mysql: mysqlVersions, mariadb: mariadbVersions, postgresql: postgresqlVersions, mongodb: mongodbVersions });
                    setInstalledRedis(redisVersions);
                    setInstalledNodejs(nodejsVersions);
                    setInstalledMinio(minioInstalled);
                    setInstalledMemcached(memcachedVersions);
                    setInstalledPython(pythonVersions);

                    // Set default PHP version to first available
                    if (phpVersions.length > 0) {
                        setConfig(prev => ({ ...prev, phpVersion: phpVersions[0] }));
                    }

                    // Set default web server based on what's installed
                    if (nginxVersions.length === 0 && apacheVersions.length > 0) {
                        setConfig(prev => ({ ...prev, webServer: 'apache', webServerVersion: apacheVersions[0] || '' }));
                    } else if (nginxVersions.length > 0) {
                        setConfig(prev => ({ ...prev, webServerVersion: nginxVersions[0] || '' }));
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
                    if (postgresqlVersions.length > 0) {
                        setConfig(prev => ({
                            ...prev,
                            services: { ...prev.services, postgresqlVersion: postgresqlVersions[0] }
                        }));
                    }
                    if (mongodbVersions.length > 0) {
                        setConfig(prev => ({
                            ...prev,
                            services: { ...prev.services, mongodbVersion: mongodbVersions[0] }
                        }));
                    }
                    if (memcachedVersions.length > 0) {
                        setConfig(prev => ({
                            ...prev,
                            services: { ...prev.services, memcachedVersion: memcachedVersions[0] }
                        }));
                    }
                    if (nodejsVersions.length > 0) {
                        setConfig(prev => ({
                            ...prev,
                            services: { ...prev.services, nodejsVersion: nodejsVersions[0] }
                        }));
                    }
                    if (pythonVersions.length > 0) {
                        setConfig(prev => ({
                            ...prev,
                            services: { ...prev.services, pythonVersion: pythonVersions[0] }
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

    const DB_SERVICES = ['mysql', 'mariadb', 'postgresql', 'mongodb'];

    const toggleService = (service) => {
        const isDatabase = DB_SERVICES.includes(service);
        const isEnabling = !config.services[service];

        if (isDatabase && isEnabling) {
            // Deselect all other databases when enabling one
            const exclusions = DB_SERVICES.reduce((acc, db) => {
                if (db !== service) acc[db] = false;
                return acc;
            }, {});
            setConfig(prev => ({
                ...prev,
                services: { ...prev.services, ...exclusions, [service]: true },
            }));
        } else {
            setConfig(prev => ({
                ...prev,
                services: { ...prev.services, [service]: !prev.services[service] },
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
    const isNodejs = config.type === 'nodejs';

    // Count available optional services
    const hasMysql = installedDatabases.mysql.length > 0;
    const hasMariadb = installedDatabases.mariadb.length > 0;
    const hasPostgresql = installedDatabases.postgresql.length > 0;
    const hasMongodb = installedDatabases.mongodb.length > 0;
    const hasRedis = installedRedis.length > 0;
    const hasMemcached = installedMemcached.length > 0;
    const hasMinio = installedMinio;
    const hasNodejs = installedNodejs.length > 0;
    const hasPython = installedPython.length > 0;
    const isLaravel = config.type === 'laravel';
    const hasDatabaseOptions = hasMysql || hasMariadb || hasPostgresql || hasMongodb;
    const hasAnyOptionalService = hasDatabaseOptions || hasRedis || hasMemcached || hasMinio || hasPython || (!isNodejs && hasNodejs) || isLaravel;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col">
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

                <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
                    {loading ? (
                        <div className="flex items-center justify-center py-16">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                            <span className="ml-3 text-gray-600 dark:text-gray-400">Loading binaries...</span>
                        </div>
                    ) : (
                        <>
                            {/* Missing Binaries Warning */}
                            {missingBinaries.length > 0 && (
                                <div className="px-6 pt-4">
                                    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                                        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Missing Required Binaries</p>
                                        <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                                            Requires: <strong>{missingBinaries.join(', ')}</strong>. Install via Binary Manager before starting.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Two-column body */}
                            <div className="flex flex-1 overflow-hidden">
                                {/* Left: Project Config */}
                                <div className="flex-1 overflow-y-auto p-6 space-y-3 border-r border-gray-200 dark:border-gray-700">
                                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Project</p>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name</label>
                                            <input
                                                type="text"
                                                value={config.name}
                                                onChange={(e) => setConfig({ ...config, name: e.target.value })}
                                                className="input text-sm"
                                                placeholder="My Project"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Type</label>
                                            <select value={config.type} onChange={(e) => setConfig({ ...config, type: e.target.value })} className="select text-sm">
                                                <option value="laravel">Laravel</option>
                                                <option value="symfony">Symfony</option>
                                                <option value="wordpress">WordPress</option>
                                                <option value="nodejs">Node.js</option>
                                                <option value="custom">Custom PHP</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Path</label>
                                        <input type="text" value={config.path} disabled className="input bg-gray-100 dark:bg-gray-700 text-xs" />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Domain</label>
                                        <input
                                            type="text"
                                            value={config.domain}
                                            onChange={(e) => setConfig({ ...config, domain: e.target.value })}
                                            placeholder={suggestedDomain}
                                            className="input text-sm"
                                        />
                                    </div>

                                    {!isNodejs && (
                                        <>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Document Root <span className="font-normal text-gray-400">(optional)</span></label>
                                                <input
                                                    type="text"
                                                    value={config.documentRoot}
                                                    onChange={(e) => setConfig({ ...config, documentRoot: e.target.value })}
                                                    placeholder={
                                                        config.type === 'wordpress' ? 'Default: project root' :
                                                        config.type === 'laravel' || config.type === 'symfony' ? 'Default: public' :
                                                        'Default: auto-detect'
                                                    }
                                                    className="input text-sm"
                                                />
                                            </div>

                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">PHP Version</label>
                                                    {hasNoPhpInstalled ? (
                                                        <div className="p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-lg">
                                                            <p className="text-xs text-amber-700 dark:text-amber-300">No PHP installed</p>
                                                        </div>
                                                    ) : (
                                                        <select value={config.phpVersion} onChange={(e) => setConfig({ ...config, phpVersion: e.target.value })} className="select text-sm">
                                                            {installedPhpVersions.map((v) => <option key={v} value={v}>PHP {v}</option>)}
                                                        </select>
                                                    )}
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Web Server</label>
                                                    {hasNoWebServer ? (
                                                        <div className="p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-lg">
                                                            <p className="text-xs text-amber-700 dark:text-amber-300">No web server</p>
                                                        </div>
                                                    ) : (
                                                        <select
                                                            value={config.webServer}
                                                            onChange={(e) => {
                                                                const ws = e.target.value;
                                                                const versions = ws === 'nginx' ? installedWebServers.nginx : installedWebServers.apache;
                                                                setConfig({ ...config, webServer: ws, webServerVersion: versions[0] || '' });
                                                            }}
                                                            className="select text-sm"
                                                        >
                                                            {installedWebServers.nginx.length > 0 && <option value="nginx">Nginx</option>}
                                                            {installedWebServers.apache.length > 0 && <option value="apache">Apache</option>}
                                                        </select>
                                                    )}
                                                </div>
                                            </div>

                                            {!hasNoWebServer && (() => {
                                                const versions = config.webServer === 'nginx' ? installedWebServers.nginx : installedWebServers.apache;
                                                return versions.length > 1 ? (
                                                    <div>
                                                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{config.webServer === 'nginx' ? 'Nginx' : 'Apache'} Version</label>
                                                        <select value={config.webServerVersion} onChange={(e) => setConfig({ ...config, webServerVersion: e.target.value })} className="select text-sm">
                                                            {versions.map((v) => <option key={v} value={v}>{v}</option>)}
                                                        </select>
                                                    </div>
                                                ) : null;
                                            })()}
                                        </>
                                    )}

                                    {isNodejs && (
                                        <>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Framework</label>
                                                <select
                                                    value={config.nodeFramework}
                                                    onChange={(e) => {
                                                        const framework = e.target.value;
                                                        const defaultCommands = { '': 'npm start', express: 'node index.js', fastify: 'node index.js', nestjs: 'npm run start:dev', nextjs: 'npm run dev', nuxtjs: 'npm run dev', koa: 'node index.js', hapi: 'node index.js', adonisjs: 'node ace serve --watch', remix: 'npm run dev', sveltekit: 'npm run dev', strapi: 'npm run develop', elysia: 'bun run dev' };
                                                        const defaultPorts = { '': 3000, express: 3000, fastify: 3000, nestjs: 3000, nextjs: 3000, nuxtjs: 3000, koa: 3000, hapi: 3000, adonisjs: 3333, remix: 3000, sveltekit: 5173, strapi: 1337, elysia: 3000 };
                                                        setConfig(prev => ({ ...prev, nodeFramework: framework, nodeStartCommand: defaultCommands[framework] || 'npm start', nodePort: defaultPorts[framework] || 3000 }));
                                                    }}
                                                    className="select text-sm"
                                                >
                                                    <option value="">None (vanilla Node.js)</option>
                                                    <optgroup label="Backend"><option value="express">Express</option><option value="fastify">Fastify</option><option value="nestjs">NestJS</option><option value="koa">Koa</option><option value="hapi">Hapi</option><option value="adonisjs">AdonisJS</option><option value="elysia">Elysia (Bun)</option></optgroup>
                                                    <optgroup label="Full-Stack"><option value="nextjs">Next.js</option><option value="nuxtjs">Nuxt.js</option><option value="remix">Remix</option><option value="sveltekit">SvelteKit</option></optgroup>
                                                    <optgroup label="CMS"><option value="strapi">Strapi</option></optgroup>
                                                </select>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Node.js Version</label>
                                                    {installedNodejs.length === 0 ? (
                                                        <div className="p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 rounded-lg"><p className="text-xs text-amber-700 dark:text-amber-300">No Node.js installed</p></div>
                                                    ) : (
                                                        <select value={config.services.nodejsVersion} onChange={(e) => setConfig(prev => ({ ...prev, services: { ...prev.services, nodejsVersion: e.target.value } }))} className="select text-sm">
                                                            {installedNodejs.map((v) => <option key={v} value={v}>Node {v}</option>)}
                                                        </select>
                                                    )}
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">App Port</label>
                                                    <input type="number" value={config.nodePort} onChange={(e) => setConfig({ ...config, nodePort: parseInt(e.target.value) || 3000 })} className="input text-sm" min="1024" max="65535" placeholder="3000" />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Start Command</label>
                                                <input type="text" value={config.nodeStartCommand} onChange={(e) => setConfig({ ...config, nodeStartCommand: e.target.value })} className="input text-sm" placeholder="npm start" />
                                            </div>
                                        </>
                                    )}
                                </div>

                                {/* Right: Optional Services */}
                                {hasAnyOptionalService && (
                                    <div className="w-64 flex-shrink-0 overflow-y-auto p-6 space-y-3">
                                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Services</p>

                                        {/* Database — card grid */}
                                        {hasDatabaseOptions && (
                                            <div>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Database <span className="text-gray-400">(select one)</span></p>
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    {hasMysql && (
                                                        <div onClick={() => toggleService('mysql')} className={`p-2 rounded-lg border-2 cursor-pointer transition-all text-center ${config.services.mysql ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}>
                                                            <div className="text-lg">🗄️</div>
                                                            <div className="text-xs font-medium text-gray-900 dark:text-white">MySQL</div>
                                                            {config.services.mysql && installedDatabases.mysql.length > 0 && (
                                                                <div className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                                                                    {installedDatabases.mysql.length > 1 ? (
                                                                        <select value={config.services.mysqlVersion} onChange={(e) => { e.stopPropagation(); setConfig(prev => ({ ...prev, services: { ...prev.services, mysqlVersion: e.target.value } })); }} onClick={(e) => e.stopPropagation()} className="w-full text-xs border-0 bg-transparent text-green-600 dark:text-green-400 focus:ring-0 p-0">
                                                                            {installedDatabases.mysql.map((v) => <option key={v} value={v}>{v}</option>)}
                                                                        </select>
                                                                    ) : installedDatabases.mysql[0]}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    {hasMariadb && (
                                                        <div onClick={() => toggleService('mariadb')} className={`p-2 rounded-lg border-2 cursor-pointer transition-all text-center ${config.services.mariadb ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}>
                                                            <div className="text-lg">🐬</div>
                                                            <div className="text-xs font-medium text-gray-900 dark:text-white">MariaDB</div>
                                                            {config.services.mariadb && installedDatabases.mariadb.length > 0 && (
                                                                <div className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                                                                    {installedDatabases.mariadb.length > 1 ? (
                                                                        <select value={config.services.mariadbVersion} onChange={(e) => { e.stopPropagation(); setConfig(prev => ({ ...prev, services: { ...prev.services, mariadbVersion: e.target.value } })); }} onClick={(e) => e.stopPropagation()} className="w-full text-xs border-0 bg-transparent text-green-600 dark:text-green-400 focus:ring-0 p-0">
                                                                            {installedDatabases.mariadb.map((v) => <option key={v} value={v}>{v}</option>)}
                                                                        </select>
                                                                    ) : installedDatabases.mariadb[0]}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    {hasPostgresql && (
                                                        <div onClick={() => toggleService('postgresql')} className={`p-2 rounded-lg border-2 cursor-pointer transition-all text-center ${config.services.postgresql ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}>
                                                            <div className="text-lg">🐘</div>
                                                            <div className="text-xs font-medium text-gray-900 dark:text-white">PostgreSQL</div>
                                                            {config.services.postgresql && installedDatabases.postgresql.length > 0 && (
                                                                <div className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                                                                    {installedDatabases.postgresql.length > 1 ? (
                                                                        <select value={config.services.postgresqlVersion} onChange={(e) => { e.stopPropagation(); setConfig(prev => ({ ...prev, services: { ...prev.services, postgresqlVersion: e.target.value } })); }} onClick={(e) => e.stopPropagation()} className="w-full text-xs border-0 bg-transparent text-green-600 dark:text-green-400 focus:ring-0 p-0">
                                                                            {installedDatabases.postgresql.map((v) => <option key={v} value={v}>{v}</option>)}
                                                                        </select>
                                                                    ) : installedDatabases.postgresql[0]}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    {hasMongodb && (
                                                        <div onClick={() => toggleService('mongodb')} className={`p-2 rounded-lg border-2 cursor-pointer transition-all text-center ${config.services.mongodb ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}>
                                                            <div className="text-lg">🍃</div>
                                                            <div className="text-xs font-medium text-gray-900 dark:text-white">MongoDB</div>
                                                            {config.services.mongodb && installedDatabases.mongodb.length > 0 && (
                                                                <div className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                                                                    {installedDatabases.mongodb.length > 1 ? (
                                                                        <select value={config.services.mongodbVersion} onChange={(e) => { e.stopPropagation(); setConfig(prev => ({ ...prev, services: { ...prev.services, mongodbVersion: e.target.value } })); }} onClick={(e) => e.stopPropagation()} className="w-full text-xs border-0 bg-transparent text-green-600 dark:text-green-400 focus:ring-0 p-0">
                                                                            {installedDatabases.mongodb.map((v) => <option key={v} value={v}>{v}</option>)}
                                                                        </select>
                                                                    ) : installedDatabases.mongodb[0]}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* Other services as compact toggle rows */}
                                        <div className="space-y-1 pt-1">
                                            {[
                                                hasRedis && { id: 'redis', label: 'Redis', icon: '⚡', desc: 'Cache', versions: installedRedis, versionKey: 'redisVersion' },
                                                hasMemcached && { id: 'memcached', label: 'Memcached', icon: '💾', desc: 'Cache', versions: installedMemcached, versionKey: 'memcachedVersion' },
                                                hasMinio && { id: 'minio', label: 'MinIO', icon: '🪣', desc: 'Object storage', versions: [], versionKey: null },
                                                hasPython && { id: 'python', label: 'Python', icon: '🐍', desc: 'Runtime', versions: installedPython, versionKey: 'pythonVersion' },
                                                hasNodejs && !isNodejs && { id: 'nodejs', label: 'Node.js', icon: '🟩', desc: 'npm builds', versions: installedNodejs, versionKey: 'nodejsVersion' },
                                                isLaravel && { id: 'queue', label: 'Queue Worker', icon: '📋', desc: 'Background jobs', versions: [], versionKey: null },
                                            ].filter(Boolean).map((svc) => (
                                                <div key={svc.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border cursor-pointer transition-all ${config.services[svc.id] ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`} onClick={() => toggleService(svc.id)}>
                                                    <span className="text-base">{svc.icon}</span>
                                                    <div className="flex-1 min-w-0">
                                                        <span className="text-xs font-medium text-gray-900 dark:text-white">{svc.label}</span>
                                                        {config.services[svc.id] && svc.versions.length > 1 && svc.versionKey && (
                                                            <select
                                                                value={config.services[svc.versionKey]}
                                                                onChange={(e) => { e.stopPropagation(); setConfig(prev => ({ ...prev, services: { ...prev.services, [svc.versionKey]: e.target.value } })); }}
                                                                onClick={(e) => e.stopPropagation()}
                                                                className="block w-full text-xs border-0 bg-transparent text-green-600 dark:text-green-400 focus:ring-0 p-0 mt-0.5"
                                                            >
                                                                {svc.versions.map((v) => <option key={v} value={v}>{v}</option>)}
                                                            </select>
                                                        )}
                                                        {config.services[svc.id] && svc.versions.length === 1 && (
                                                            <div className="text-xs text-green-600 dark:text-green-400">{svc.versions[0]}</div>
                                                        )}
                                                    </div>
                                                    <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${config.services[svc.id] ? 'bg-green-500 border-green-500' : 'border-gray-300 dark:border-gray-600'}`}>
                                                        {config.services[svc.id] && <span className="text-white text-xs leading-none">✓</span>}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
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
                                    disabled={isImporting || (!isNodejs && (hasNoPhpInstalled || hasNoWebServer)) || (isNodejs && installedNodejs.length === 0) || !config.name}
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
