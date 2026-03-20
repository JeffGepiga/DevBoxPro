/**
 * ServiceManager – thin facade
 *
 * All behaviour is kept in domain-specific mixins under ./service/.
 * Mixins are applied via Object.assign() so every method runs with
 * the ServiceManager instance as `this` (same pattern as ProjectManager).
 *
 * Mixin files:
 *   service/helpers.js   – path helpers, VC-redist, MySQL log utils
 *   service/core.js      – initialize, startService, stopService, restart*, startAll*, stopAll*
 *   service/health.js    – waitForService, checkPortOpen, per-service health checks, status/port getters
 *   service/processes.js – killProcess, killOrphan*, getRunningVersions, getAllServicesStatus, getVersionPort
 *   service/nginx.js     – startNginx, reloadNginx, testNginxConfig, createNginxConfig
 *   service/apache.js    – startApache, reloadApache, createApacheConfig
 *   service/mysql.js     – startMySQL, startMySQLDirect, initializeMySQLData, createMySQLConfig,
 *                          createCredentialsInitFile, syncCredentials, getTimezoneOffset
 *   service/mariadb.js   – startMariaDB, startMariaDBDirect, initializeMariaDBData, createMariaDBConfig
 *   service/redis.js     – startRedis, createRedisConfig
 *   service/mailpit.js   – startMailpit
 *   service/phpmyadmin.js – startPhpMyAdmin, updatePhpMyAdminConfig
 *   service/extras.js    – startPostgreSQL, startMongoDB, startMemcached, startMinIO
 */

'use strict';

const { EventEmitter } = require('events');
const { VERSION_PORT_OFFSETS, DEFAULT_PORTS } = require('../../shared/serviceConfig');

// ─── Domain mixins ────────────────────────────────────────────────────────────
const helpersMixin    = require('./service/helpers');
const coreMixin       = require('./service/core');
const healthMixin     = require('./service/health');
const processesMixin  = require('./service/processes');
const nginxMixin      = require('./service/nginx');
const apacheMixin     = require('./service/apache');
const mysqlMixin      = require('./service/mysql');
const mariadbMixin    = require('./service/mariadb');
const redisMixin      = require('./service/redis');
const mailpitMixin    = require('./service/mailpit');
const phpmyadminMixin = require('./service/phpmyadmin');
const extrasMixin     = require('./service/extras');

// ─────────────────────────────────────────────────────────────────────────────

class ServiceManager extends EventEmitter {
  constructor(resourcePath, configStore, managers) {
    super();

    this.resourcePath = resourcePath;
    this.configStore  = configStore;
    this.managers     = managers;

    // Process and state tracking
    this.processes        = new Map(); // 'serviceName' or 'serviceName-version'
    this.serviceStatus    = new Map();
    this.runningVersions  = new Map(); // serviceName → Map<version, { port, startedAt }>
    this.pendingStarts    = new Map();
    this.webServerStartQueue = Promise.resolve();

    // Standard-port ownership (first web server to start gets 80/443)
    this.standardPortOwner        = null;
    this.standardPortOwnerVersion = null;

    this.webServerPorts = {
      standard:  { http: 80,   https: 443  },
      alternate: { http: 8081, https: 8443 },
    };

    // Per-version port offsets (from shared config)
    this.versionPortOffsets = { ...VERSION_PORT_OFFSETS };

    // Service definitions
    // NOTE: healthCheck bindings reference methods that exist after mixin assignment.
    // We use arrow functions so they close over `this` rather than binding eagerly.
    this.serviceConfigs = {
      nginx: {
        name: 'Nginx',
        defaultPort: DEFAULT_PORTS.nginx || 80,
        sslPort: 443,
        alternatePort: 8081,
        alternateSslPort: 8443,
        get healthCheck() { return () => this._sm.checkNginxHealth(); },
        versioned: true,
      },
      apache: {
        name: 'Apache',
        defaultPort: DEFAULT_PORTS.apache || 8081,
        sslPort: 443,
        alternatePort: 8084,
        alternateSslPort: 8446,
        get healthCheck() { return () => this._sm.checkApacheHealth(); },
        versioned: true,
      },
      mysql: {
        name: 'MySQL',
        defaultPort: DEFAULT_PORTS.mysql || 3306,
        get healthCheck() { return () => this._sm.checkMySqlHealth(); },
        versioned: true,
      },
      mariadb: {
        name: 'MariaDB',
        defaultPort: DEFAULT_PORTS.mariadb || 3306,
        get healthCheck() { return () => this._sm.checkMariaDbHealth(); },
        versioned: true,
      },
      redis: {
        name: 'Redis',
        defaultPort: DEFAULT_PORTS.redis || 6379,
        get healthCheck() { return () => this._sm.checkRedisHealth(); },
        versioned: true,
      },
      mailpit: {
        name: 'Mailpit',
        defaultPort: DEFAULT_PORTS.mailpit || 8025,
        smtpPort: DEFAULT_PORTS.mailpitSmtp || 1025,
        get healthCheck() { return () => this._sm.checkMailpitHealth(); },
        versioned: false,
      },
      phpmyadmin: {
        name: 'phpMyAdmin',
        defaultPort: DEFAULT_PORTS.phpmyadmin || 8080,
        get healthCheck() { return () => this._sm.checkPhpMyAdminHealth(); },
        versioned: false,
      },
      postgresql: {
        name: 'PostgreSQL',
        defaultPort: DEFAULT_PORTS.postgresql || 5432,
        get healthCheck() { return () => this._sm.checkPostgresqlHealth(); },
        versioned: true,
      },
      mongodb: {
        name: 'MongoDB',
        defaultPort: DEFAULT_PORTS.mongodb || 27017,
        get healthCheck() { return () => this._sm.checkMongodbHealth(); },
        versioned: true,
      },
      memcached: {
        name: 'Memcached',
        defaultPort: DEFAULT_PORTS.memcached || 11211,
        get healthCheck() { return () => this._sm.checkMemcachedHealth(); },
        versioned: true,
      },
      minio: {
        name: 'MinIO',
        defaultPort: DEFAULT_PORTS.minio || 9000,
        consolePort: DEFAULT_PORTS.minioConsole || 9001,
        get healthCheck() { return () => this._sm.checkMinioHealth(); },
        versioned: false,
      },
    };

    // Wire the _sm back-reference used by the healthCheck getters above
    Object.values(this.serviceConfigs).forEach(cfg => { cfg._sm = this; });
  }
}

// Apply all mixins
Object.assign(
  ServiceManager.prototype,
  helpersMixin,
  coreMixin,
  healthMixin,
  processesMixin,
  nginxMixin,
  apacheMixin,
  mysqlMixin,
  mariadbMixin,
  redisMixin,
  mailpitMixin,
  phpmyadminMixin,
  extrasMixin,
);

module.exports = { ServiceManager };
