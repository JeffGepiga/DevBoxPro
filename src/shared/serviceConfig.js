/**
 * Centralized service configuration for DevBox Pro
 * This file is the single source of truth for all service versions and port configurations
 * 
 * NOTE: This file uses CommonJS syntax for compatibility with Electron's main process.
 * The renderer process should get this config via IPC (window.devbox.binaries.getServiceConfig())
 */

// Service version definitions - these are the versions we support downloading
const SERVICE_VERSIONS = {
  php: ['8.4', '8.3', '8.2', '8.1', '8.0', '7.4'],
  mysql: ['8.4', '8.0', '5.7'],
  mariadb: ['11.4', '10.11', '10.6'],
  redis: ['7.4', '7.2', '6.2'],
  nginx: ['1.28', '1.26', '1.24'],
  apache: ['2.4'],
  nodejs: ['22', '20', '18', '16'],
};

// Port offsets per version (relative to default port)
// This allows running multiple versions simultaneously on different ports
const VERSION_PORT_OFFSETS = {
  mysql: { '8.4': 0, '8.0': 1, '5.7': 2 },
  mariadb: { '11.4': 0, '10.11': 1, '10.6': 2 },
  redis: { '7.4': 0, '7.2': 1, '6.2': 2 },
  nginx: { '1.28': 0, '1.26': 1, '1.24': 2 },
  apache: { '2.4': 0 },
};

// Default service ports
const DEFAULT_PORTS = {
  mysql: 3306,
  mariadb: 3310,  // Base port 3310 to avoid conflict with MySQL (3306-3309)
  redis: 6379,
  nginx: 80,
  apache: 8081,
  mailpit: 8025,
  mailpitSmtp: 1025,
  phpmyadmin: 8080,
};

// Service metadata for UI display
const SERVICE_INFO = {
  php: {
    name: 'PHP',
    description: 'PHP scripting language',
    color: 'indigo',
    versioned: true,
  },
  mysql: {
    name: 'MySQL',
    description: 'Relational database server',
    color: 'blue',
    versioned: true,
    defaultPort: DEFAULT_PORTS.mysql,
  },
  mariadb: {
    name: 'MariaDB',
    description: 'MySQL-compatible database server',
    color: 'teal',
    versioned: true,
    defaultPort: DEFAULT_PORTS.mariadb,
  },
  redis: {
    name: 'Redis',
    description: 'In-memory data store and cache',
    color: 'red',
    versioned: true,
    defaultPort: DEFAULT_PORTS.redis,
  },
  nginx: {
    name: 'Nginx',
    description: 'High-performance web server',
    color: 'green',
    versioned: true,
    defaultPort: DEFAULT_PORTS.nginx,
  },
  apache: {
    name: 'Apache',
    description: 'Full-featured web server',
    color: 'orange',
    versioned: true,
    defaultPort: DEFAULT_PORTS.apache,
  },
  nodejs: {
    name: 'Node.js',
    description: 'JavaScript runtime',
    color: 'green',
    versioned: true,
  },
  mailpit: {
    name: 'Mailpit',
    description: 'Email testing and capture',
    color: 'green',
    versioned: false,
    defaultPort: DEFAULT_PORTS.mailpit,
    webUrl: `http://localhost:${DEFAULT_PORTS.mailpit}`,
  },
  phpmyadmin: {
    name: 'phpMyAdmin',
    description: 'Database management interface',
    color: 'orange',
    versioned: false,
    defaultPort: DEFAULT_PORTS.phpmyadmin,
    webUrl: `http://localhost:${DEFAULT_PORTS.phpmyadmin}`,
  },
};

// Get the port for a specific service version
function getServicePort(serviceName, version) {
  const basePort = DEFAULT_PORTS[serviceName];
  if (!basePort) return null;

  const offset = VERSION_PORT_OFFSETS[serviceName]?.[version] || 0;
  return basePort + offset;
}

// Get the default version for a service
function getDefaultVersion(serviceName) {
  const versions = SERVICE_VERSIONS[serviceName];
  return versions?.[0] || null;
}

// CommonJS export for Electron main process
module.exports = {
  SERVICE_VERSIONS,
  VERSION_PORT_OFFSETS,
  DEFAULT_PORTS,
  SERVICE_INFO,
  getServicePort,
  getDefaultVersion,
};
