/**
 * Deployment Mode utilities for DevBox Pro
 *
 * Provides helpers to resolve the effective deployment mode for a project
 * and centralized production configuration constants.
 *
 * NOTE: CommonJS syntax for Electron main process compatibility.
 */

'use strict';

/**
 * Resolve the effective deployment mode for a project.
 * Priority: project-level override > global setting > fallback to 'local'.
 *
 * @param {object} project - The project object (may have deploymentMode)
 * @param {object} globalSettings - The global settings object (has deploymentMode)
 * @returns {'local'|'production'}
 */
function resolveDeploymentMode(project, globalSettings) {
  // Per-project override takes precedence
  if (project && project.deploymentMode && project.deploymentMode !== 'global') {
    return project.deploymentMode;
  }

  // Fall back to global setting
  if (globalSettings && globalSettings.deploymentMode) {
    return globalSettings.deploymentMode;
  }

  // Ultimate fallback
  return 'local';
}

/**
 * Shorthand to check if a project is in production mode.
 *
 * @param {object} project
 * @param {object} globalSettings
 * @returns {boolean}
 */
function isProductionMode(project, globalSettings) {
  return resolveDeploymentMode(project, globalSettings) === 'production';
}

// ─── Production Configuration Constants ──────────────────────────────────────

/**
 * PHP production overrides (applied to php.ini or CLI args)
 */
const PRODUCTION_PHP = {
  'display_errors': 'Off',
  'display_startup_errors': 'Off',
  'expose_php': 'Off',
  'error_reporting': 'E_ALL & ~E_DEPRECATED & ~E_STRICT',
  'log_errors': 'On',
  'opcache.enable': '1',
  'opcache.memory_consumption': '256',
  'opcache.interned_strings_buffer': '16',
  'opcache.max_accelerated_files': '20000',
  'opcache.validate_timestamps': '0',
  'opcache.revalidate_freq': '0',
  'opcache.save_comments': '1',
  'opcache.enable_file_override': '1',
  // JIT settings for PHP 8.0+
  'opcache.jit': '1255',
  'opcache.jit_buffer_size': '100M',
};

/**
 * Nginx production directives for the main nginx.conf (http block level)
 */
const PRODUCTION_NGINX = {
  serverTokens: 'off',
  gzip: true,
  gzipCompLevel: 6,
  gzipMinLength: 256,
  gzipTypes: [
    'text/plain',
    'text/css',
    'application/json',
    'application/javascript',
    'text/xml',
    'application/xml',
    'application/xml+rss',
    'text/javascript',
    'image/svg+xml',
    'application/x-font-ttf',
    'font/opentype',
  ],
  workerConnections: 2048,
  keepaliveTimeout: 65,
  clientBodyTimeout: 12,
  clientHeaderTimeout: 12,
  sendTimeout: 10,
};

/**
 * Additional Nginx vhost security headers for production
 */
const PRODUCTION_NGINX_HEADERS = [
  'add_header X-Frame-Options "SAMEORIGIN" always;',
  'add_header X-Content-Type-Options "nosniff" always;',
  'add_header X-XSS-Protection "1; mode=block" always;',
  'add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
  'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;',
  'add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;',
  'server_tokens off;',
];

/**
 * Apache production directives
 */
const PRODUCTION_APACHE = {
  serverTokens: 'Prod',
  serverSignature: 'Off',
  traceEnable: 'Off',
  headers: [
    'Header always set X-Frame-Options "SAMEORIGIN"',
    'Header always set X-Content-Type-Options "nosniff"',
    'Header always set X-XSS-Protection "1; mode=block"',
    'Header always set Referrer-Policy "strict-origin-when-cross-origin"',
    'Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"',
    'Header always set Permissions-Policy "camera=(), microphone=(), geolocation=()"',
  ],
};

/**
 * MySQL production config overrides (for my.cnf / my.ini)
 */
const PRODUCTION_MYSQL = {
  'bind-address': '127.0.0.1',
  'skip-name-resolve': '1',
  'max_connections': '200',
  'innodb_buffer_pool_size': '512M',
  'innodb_log_file_size': '128M',
  'innodb_flush_log_at_trx_commit': '1',
  'innodb_flush_method': 'O_DIRECT',
  'slow_query_log': '1',
  'long_query_time': '2',
  'query_cache_type': '0',
};

/**
 * Redis production config overrides
 */
const PRODUCTION_REDIS = {
  requirepass: 'devbox-pro-redis',
  maxmemory: '256mb',
  'maxmemory-policy': 'allkeys-lru',
  // Rename dangerous commands to empty string to disable them
  renameCommands: {
    'FLUSHALL': '""',
    'FLUSHDB': '""',
    'CONFIG': '""',
    'DEBUG': '""',
  },
};

/**
 * Supervisor worker production defaults
 */
const PRODUCTION_WORKER = {
  numprocs: 2,
  tries: 3,
  sleep: 3,
  maxJobs: 1000,
  maxTime: 3600,
  timeout: 90,
  memory: 128,
  autorestart: true,
};

/**
 * All production configs bundled
 */
const PRODUCTION_CONFIGS = {
  php: PRODUCTION_PHP,
  nginx: PRODUCTION_NGINX,
  nginxHeaders: PRODUCTION_NGINX_HEADERS,
  apache: PRODUCTION_APACHE,
  mysql: PRODUCTION_MYSQL,
  redis: PRODUCTION_REDIS,
  worker: PRODUCTION_WORKER,
};

module.exports = {
  resolveDeploymentMode,
  isProductionMode,
  PRODUCTION_PHP,
  PRODUCTION_NGINX,
  PRODUCTION_NGINX_HEADERS,
  PRODUCTION_APACHE,
  PRODUCTION_MYSQL,
  PRODUCTION_REDIS,
  PRODUCTION_WORKER,
  PRODUCTION_CONFIGS,
};
