const { app } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const https = require('https');
const http = require('http');
const { pipeline } = require('stream/promises');
const { createWriteStream } = require('fs');
const { createGunzip } = require('zlib');
const AdmZip = require('adm-zip');
const unzipper = require('unzipper');
const { exec, spawn } = require('child_process');
const { spawnAsync, killProcessesByPath } = require('../utils/SpawnUtils');
const { getResourcesPath, getAppCachePath } = require('../utils/PathResolver');
const binaryConfig = require('./binary/config');
const binaryDownload = require('./binary/download');
const binaryExtraction = require('./binary/extraction');
const binaryInstalled = require('./binary/installed');
const binaryMetadata = require('./binary/metadata');
const binaryPhp = require('./binary/php');
const binaryProgress = require('./binary/progress');

// Import centralized service configuration
const { SERVICE_VERSIONS, VERSION_PORT_OFFSETS, DEFAULT_PORTS } = require('../../shared/serviceConfig');

class BinaryDownloadManager {
  constructor() {
    this.resourcesPath = getResourcesPath(app);
    this.downloadProgress = new Map();
    this.listeners = new Set();

    // Throttle tracking for progress updates to prevent UI freeze
    this.lastProgressEmit = new Map(); // id -> { time, progress }
    this.progressThrottleMs = 200; // Minimum ms between progress updates
    this.progressMinDelta = 2; // Minimum progress change (%) to emit

    // Track active downloads for cancellation support
    this.activeDownloads = new Map(); // id -> { request, file, reject }
    this.activeWorkers = new Map(); // id -> { worker, reject, destPath }
    this.cancelledDownloads = new Set(); // Track cancelled IDs to prevent extraction attempts

    // Download URLs for each binary - ALL services now support multiple versions
    // PHP versions updated from https://windows.php.net/download/ on 2025-01
    this.downloads = {
      php: {
        '8.4': {
          win: {
            url: 'https://windows.php.net/downloads/releases/php-8.4.16-nts-Win32-vs17-x64.zip',
            filename: 'php-8.4.16-nts-Win32-vs17-x64.zip',
          },
          mac: {
            url: 'https://github.com/shivammathur/php-builder/releases/download/8.4.16/php-8.4.16-darwin-arm64.tar.gz',
            filename: 'php-8.4.16-darwin-arm64.tar.gz',
          },
          label: 'Latest',
        },
        '8.3': {
          win: {
            url: 'https://windows.php.net/downloads/releases/php-8.3.29-nts-Win32-vs16-x64.zip',
            filename: 'php-8.3.29-nts-Win32-vs16-x64.zip',
          },
          mac: {
            url: 'https://github.com/shivammathur/php-builder/releases/download/8.3.30/php-8.3.30-darwin-arm64.tar.gz',
            filename: 'php-8.3.30-darwin-arm64.tar.gz',
          },
          label: 'Security Only',
        },
        '8.2': {
          win: {
            url: 'https://windows.php.net/downloads/releases/php-8.2.30-nts-Win32-vs16-x64.zip',
            filename: 'php-8.2.30-nts-Win32-vs16-x64.zip',
          },
          mac: {
            url: 'https://github.com/shivammathur/php-builder/releases/download/8.2.30/php-8.2.30-darwin-arm64.tar.gz',
            filename: 'php-8.2.30-darwin-arm64.tar.gz',
          },
        },
        '8.1': {
          win: {
            url: 'https://windows.php.net/downloads/releases/php-8.1.34-nts-Win32-vs16-x64.zip',
            filename: 'php-8.1.34-nts-Win32-vs16-x64.zip',
          },
          mac: {
            url: 'https://github.com/shivammathur/php-builder/releases/download/8.1.34/php-8.1.34-darwin-arm64.tar.gz',
            filename: 'php-8.1.34-darwin-arm64.tar.gz',
          },
        },
        '8.0': {
          win: {
            url: 'https://windows.php.net/downloads/releases/archives/php-8.0.30-nts-Win32-vs16-x64.zip',
            filename: 'php-8.0.30-nts-Win32-vs16-x64.zip',
          },
          mac: {
            url: 'https://github.com/shivammathur/php-builder/releases/download/8.0.30/php-8.0.30-darwin-arm64.tar.gz',
            filename: 'php-8.0.30-darwin-arm64.tar.gz',
          },
          label: 'Legacy',
        },
        '7.4': {
          win: {
            url: 'https://windows.php.net/downloads/releases/archives/php-7.4.33-nts-Win32-vc15-x64.zip',
            filename: 'php-7.4.33-nts-Win32-vc15-x64.zip',
          },
          mac: {
            url: 'https://github.com/shivammathur/php-builder/releases/download/7.4.33/php-7.4.33-darwin-arm64.tar.gz',
            filename: 'php-7.4.33-darwin-arm64.tar.gz',
          },
          label: 'Legacy',
        },
      },
      // MySQL - Multiple versions for compatibility
      mysql: {
        '8.4': {
          win: {
            url: 'https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.7-winx64.zip',
            filename: 'mysql-8.4.7-winx64.zip',
          },
          mac: {
            url: 'https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.7-macos14-arm64.tar.gz',
            filename: 'mysql-8.4.7-macos14-arm64.tar.gz',
          },
          label: 'Latest',
          defaultPort: 3306,
        },
        '8.0': {
          win: {
            url: 'https://cdn.mysql.com/Downloads/MySQL-8.0/mysql-8.0.44-winx64.zip',
            filename: 'mysql-8.0.44-winx64.zip',
          },
          mac: {
            url: 'https://cdn.mysql.com/Downloads/MySQL-8.0/mysql-8.0.44-macos14-arm64.tar.gz',
            filename: 'mysql-8.0.44-macos14-arm64.tar.gz',
          },
          label: 'LTS',
          defaultPort: 3307,
        },
        '5.7': {
          win: {
            url: 'https://cdn.mysql.com/Downloads/MySQL-5.7/mysql-5.7.44-winx64.zip',
            filename: 'mysql-5.7.44-winx64.zip',
          },
          mac: {
            url: 'https://cdn.mysql.com/Downloads/MySQL-5.7/mysql-5.7.44-macos14-x86_64.tar.gz',
            filename: 'mysql-5.7.44-macos14-x86_64.tar.gz',
          },
          label: 'Legacy',
          defaultPort: 3308,
        },
      },
      // MariaDB - Multiple versions
      mariadb: {
        '11.4': {
          win: {
            url: 'https://archive.mariadb.org/mariadb-11.4.9/winx64-packages/mariadb-11.4.9-winx64.zip',
            filename: 'mariadb-11.4.9-winx64.zip',
          },
          mac: {
            url: 'https://archive.mariadb.org/mariadb-11.4.9/bintar-darwin-arm64/mariadb-11.4.9-macos14-arm64.tar.gz',
            filename: 'mariadb-11.4.9-macos14-arm64.tar.gz',
          },
          label: 'Latest',
          defaultPort: 3310,
        },
        '10.11': {
          win: {
            url: 'https://archive.mariadb.org/mariadb-10.11.10/winx64-packages/mariadb-10.11.10-winx64.zip',
            filename: 'mariadb-10.11.10-winx64.zip',
          },
          mac: {
            url: 'https://archive.mariadb.org/mariadb-10.11.10/bintar-darwin-arm64/mariadb-10.11.10-macos14-arm64.tar.gz',
            filename: 'mariadb-10.11.10-macos14-arm64.tar.gz',
          },
          label: 'LTS',
          defaultPort: 3311,
        },
        '10.6': {
          win: {
            url: 'https://archive.mariadb.org/mariadb-10.6.21/winx64-packages/mariadb-10.6.21-winx64.zip',
            filename: 'mariadb-10.6.21-winx64.zip',
          },
          mac: {
            url: 'https://archive.mariadb.org/mariadb-10.6.21/bintar-darwin-arm64/mariadb-10.6.21-macos14-arm64.tar.gz',
            filename: 'mariadb-10.6.21-macos14-arm64.tar.gz',
          },
          label: 'Legacy',
          defaultPort: 3312,
        },
      },
      // Redis - Multiple versions
      redis: {
        '7.4': {
          win: {
            url: 'https://github.com/redis-windows/redis-windows/releases/download/7.4.7/Redis-7.4.7-Windows-x64-msys2.zip',
            filename: 'Redis-7.4.7-Windows-x64-msys2.zip',
          },
          mac: {
            url: 'https://github.com/redis/redis/archive/refs/tags/7.4.7.tar.gz',
            filename: 'redis-7.4.7.tar.gz',
            note: 'Requires compilation on macOS',
          },
          label: 'Latest',
          defaultPort: 6379,
        },
        '7.2': {
          win: {
            url: 'https://github.com/redis-windows/redis-windows/releases/download/7.2.12/Redis-7.2.12-Windows-x64-msys2.zip',
            filename: 'Redis-7.2.12-Windows-x64-msys2.zip',
          },
          mac: {
            url: 'https://github.com/redis/redis/archive/refs/tags/7.2.12.tar.gz',
            filename: 'redis-7.2.12.tar.gz',
            note: 'Requires compilation on macOS',
          },
          label: 'LTS',
          defaultPort: 6380,
        },
        '6.2': {
          win: {
            url: 'https://github.com/redis-windows/redis-windows/releases/download/6.2.21/Redis-6.2.21-Windows-x64-msys2.zip',
            filename: 'Redis-6.2.21-Windows-x64-msys2.zip',
          },
          mac: {
            url: 'https://github.com/redis/redis/archive/refs/tags/6.2.21.tar.gz',
            filename: 'redis-6.2.21.tar.gz',
            note: 'Requires compilation on macOS',
          },
          label: 'Legacy LTS',
          defaultPort: 6381,
        },
      },
      mailpit: {
        win: {
          url: 'https://github.com/axllent/mailpit/releases/download/v1.21.4/mailpit-windows-amd64.zip',
          filename: 'mailpit-windows-amd64.zip',
        },
        mac: {
          url: 'https://github.com/axllent/mailpit/releases/download/v1.21.4/mailpit-darwin-arm64.tar.gz',
          filename: 'mailpit-darwin-arm64.tar.gz',
        },
      },
      phpmyadmin: {
        all: {
          // Using official phpMyAdmin download URL
          url: 'https://www.phpmyadmin.net/downloads/phpMyAdmin-latest-all-languages.zip',
          filename: 'phpMyAdmin-latest-all-languages.zip',
        },
      },
      // Nginx - Multiple versions
      nginx: {
        '1.28': {
          win: {
            url: 'https://nginx.org/download/nginx-1.28.0.zip',
            filename: 'nginx-1.28.0.zip',
          },
          mac: {
            url: 'https://nginx.org/download/nginx-1.28.0.tar.gz',
            filename: 'nginx-1.28.0.tar.gz',
            altInstall: 'brew install nginx',
          },
          label: 'Latest',
          defaultPort: 80,
        },
        '1.26': {
          win: {
            url: 'https://nginx.org/download/nginx-1.26.3.zip',
            filename: 'nginx-1.26.3.zip',
          },
          mac: {
            url: 'https://nginx.org/download/nginx-1.26.3.tar.gz',
            filename: 'nginx-1.26.3.tar.gz',
            altInstall: 'brew install nginx@1.26',
          },
          label: 'Stable',
          defaultPort: 8080,
        },
        '1.24': {
          win: {
            url: 'https://nginx.org/download/nginx-1.24.0.zip',
            filename: 'nginx-1.24.0.zip',
          },
          mac: {
            url: 'https://nginx.org/download/nginx-1.24.0.tar.gz',
            filename: 'nginx-1.24.0.tar.gz',
          },
          label: 'Legacy',
          defaultPort: 8081,
        },
      },
      // Apache - Multiple versions (manual import supported)
      apache: {
        '2.4': {
          win: {
            url: 'https://www.apachelounge.com/download/VS17/binaries/httpd-2.4.62-240904-win64-VS17.zip',
            fallbackUrls: [
              'https://www.apachelounge.com/download/VS17/binaries/httpd-2.4.61-240703-win64-VS17.zip',
            ],
            filename: 'httpd-2.4.62-win64-VS17.zip',
            manualDownloadUrl: 'https://www.apachelounge.com/download/',
            manualDownloadNote: 'Apache Lounge may block automated downloads. If the download fails, please download manually.',
          },
          mac: {
            url: 'https://dlcdn.apache.org/httpd/httpd-2.4.63.tar.gz',
            filename: 'httpd-2.4.63.tar.gz',
            altInstall: 'brew install httpd',
          },
          label: 'Latest',
          defaultPort: 80,
        },
      },
      // Node.js - Multiple versions
      nodejs: {
        '24': {
          win: {
            url: 'https://nodejs.org/dist/v24.14.0/node-v24.14.0-win-x64.zip',
            filename: 'node-v24.14.0-win-x64.zip',
          },
          mac: {
            url: 'https://nodejs.org/dist/v24.14.0/node-v24.14.0-darwin-arm64.tar.gz',
            filename: 'node-v24.14.0-darwin-arm64.tar.gz',
          },
          label: 'Current',
        },
        '22': {
          win: {
            url: 'https://nodejs.org/dist/v22.12.0/node-v22.12.0-win-x64.zip',
            filename: 'node-v22.12.0-win-x64.zip',
          },
          mac: {
            url: 'https://nodejs.org/dist/v22.12.0/node-v22.12.0-darwin-arm64.tar.gz',
            filename: 'node-v22.12.0-darwin-arm64.tar.gz',
          },
          label: 'LTS',
        },
        '20': {
          win: {
            url: 'https://nodejs.org/dist/v20.18.1/node-v20.18.1-win-x64.zip',
            filename: 'node-v20.18.1-win-x64.zip',
          },
          mac: {
            url: 'https://nodejs.org/dist/v20.18.1/node-v20.18.1-darwin-arm64.tar.gz',
            filename: 'node-v20.18.1-darwin-arm64.tar.gz',
          },
          label: 'LTS',
        },
        '18': {
          win: {
            url: 'https://nodejs.org/dist/v18.20.5/node-v18.20.5-win-x64.zip',
            filename: 'node-v18.20.5-win-x64.zip',
          },
          mac: {
            url: 'https://nodejs.org/dist/v18.20.5/node-v18.20.5-darwin-arm64.tar.gz',
            filename: 'node-v18.20.5-darwin-arm64.tar.gz',
          },
          label: 'Maintenance',
        },
        '16': {
          win: {
            url: 'https://nodejs.org/dist/v16.20.2/node-v16.20.2-win-x64.zip',
            filename: 'node-v16.20.2-win-x64.zip',
          },
          mac: {
            url: 'https://nodejs.org/dist/v16.20.2/node-v16.20.2-darwin-arm64.tar.gz',
            filename: 'node-v16.20.2-darwin-arm64.tar.gz',
          },
          label: 'Legacy',
        },
      },
      composer: {
        all: {
          url: 'https://getcomposer.org/download/2.8.4/composer.phar',
          filename: 'composer.phar',
        },
      },
      // Git Portable - for cloning repositories
      git: {
        portable: {
          win: {
            url: 'https://github.com/git-for-windows/git/releases/download/v2.53.0.windows.1/PortableGit-2.53.0-64-bit.7z.exe',
            filename: 'PortableGit-2.53.0-64-bit.7z.exe',
          },
          mac: {
            // On macOS, Git is typically installed via Xcode Command Line Tools or Homebrew
            url: 'builtin',
            note: 'Install via: xcode-select --install or brew install git',
          },
          linux: {
            url: 'builtin',
            note: 'Install via package manager: sudo apt install git or sudo dnf install git',
          },
          label: 'Portable',
        },
      },
      // PostgreSQL - Multiple versions
      postgresql: {
        '17': {
          win: { url: 'https://get.enterprisedb.com/postgresql/postgresql-17.4-1-windows-x64-binaries.zip', filename: 'postgresql-17.4-1-windows-x64-binaries.zip' },
          mac: { url: 'https://get.enterprisedb.com/postgresql/postgresql-17.4-1-osx-binaries.zip', filename: 'postgresql-17.4-1-osx-binaries.zip' },
          linux: { url: 'https://get.enterprisedb.com/postgresql/postgresql-17.4-1-linux-x64-binaries.tar.gz', filename: 'postgresql-17.4-1-linux-x64-binaries.tar.gz' },
          label: 'Latest',
        },
        '16': {
          win: { url: 'https://get.enterprisedb.com/postgresql/postgresql-16.8-1-windows-x64-binaries.zip', filename: 'postgresql-16.8-1-windows-x64-binaries.zip' },
          mac: { url: 'https://get.enterprisedb.com/postgresql/postgresql-16.8-1-osx-binaries.zip', filename: 'postgresql-16.8-1-osx-binaries.zip' },
          linux: { url: 'https://get.enterprisedb.com/postgresql/postgresql-16.8-1-linux-x64-binaries.tar.gz', filename: 'postgresql-16.8-1-linux-x64-binaries.tar.gz' },
          label: 'LTS',
        },
        '15': {
          win: { url: 'https://get.enterprisedb.com/postgresql/postgresql-15.12-1-windows-x64-binaries.zip', filename: 'postgresql-15.12-1-windows-x64-binaries.zip' },
          mac: { url: 'https://get.enterprisedb.com/postgresql/postgresql-15.12-1-osx-binaries.zip', filename: 'postgresql-15.12-1-osx-binaries.zip' },
          linux: { url: 'https://get.enterprisedb.com/postgresql/postgresql-15.12-1-linux-x64-binaries.tar.gz', filename: 'postgresql-15.12-1-linux-x64-binaries.tar.gz' },
          label: 'Stable',
        },
        '14': {
          win: { url: 'https://get.enterprisedb.com/postgresql/postgresql-14.17-1-windows-x64-binaries.zip', filename: 'postgresql-14.17-1-windows-x64-binaries.zip' },
          mac: { url: 'https://get.enterprisedb.com/postgresql/postgresql-14.17-1-osx-binaries.zip', filename: 'postgresql-14.17-1-osx-binaries.zip' },
          linux: { url: 'https://get.enterprisedb.com/postgresql/postgresql-14.17-1-linux-x64-binaries.tar.gz', filename: 'postgresql-14.17-1-linux-x64-binaries.tar.gz' },
          label: 'Legacy',
        },
      },
      // Python - Multiple versions (embeddable on Windows, source on mac/linux)
      python: {
        '3.13': {
          win: { url: 'https://www.python.org/ftp/python/3.13.2/python-3.13.2-embed-amd64.zip', filename: 'python-3.13.2-embed-amd64.zip' },
          mac: { url: 'https://www.python.org/ftp/python/3.13.2/Python-3.13.2.tgz', filename: 'Python-3.13.2.tgz' },
          linux: { url: 'https://www.python.org/ftp/python/3.13.2/Python-3.13.2.tgz', filename: 'Python-3.13.2.tgz' },
          label: 'Latest',
        },
        '3.12': {
          win: { url: 'https://www.python.org/ftp/python/3.12.9/python-3.12.9-embed-amd64.zip', filename: 'python-3.12.9-embed-amd64.zip' },
          mac: { url: 'https://www.python.org/ftp/python/3.12.9/Python-3.12.9.tgz', filename: 'Python-3.12.9.tgz' },
          linux: { url: 'https://www.python.org/ftp/python/3.12.9/Python-3.12.9.tgz', filename: 'Python-3.12.9.tgz' },
          label: 'LTS',
        },
        '3.11': {
          win: { url: 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embeddable-amd64.zip', filename: 'python-3.11.9-embeddable-amd64.zip' },
          mac: { url: 'https://www.python.org/ftp/python/3.11.12/Python-3.11.12.tgz', filename: 'Python-3.11.12.tgz' },
          linux: { url: 'https://www.python.org/ftp/python/3.11.12/Python-3.11.12.tgz', filename: 'Python-3.11.12.tgz' },
          label: 'Stable',
        },
        '3.10': {
          win: { url: 'https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip', filename: 'python-3.10.11-embed-amd64.zip' },
          mac: { url: 'https://www.python.org/ftp/python/3.10.16/Python-3.10.16.tgz', filename: 'Python-3.10.16.tgz' },
          linux: { url: 'https://www.python.org/ftp/python/3.10.16/Python-3.10.16.tgz', filename: 'Python-3.10.16.tgz' },
          label: 'Legacy',
        },
      },
      // MongoDB - Multiple versions
      mongodb: {
        '8.0': {
          win: { url: 'https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-8.0.6.zip', filename: 'mongodb-windows-x86_64-8.0.6.zip' },
          mac: { url: 'https://fastdl.mongodb.org/osx/mongodb-macos-arm64-8.0.6.tgz', filename: 'mongodb-macos-arm64-8.0.6.tgz' },
          linux: { url: 'https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2204-8.0.6.tgz', filename: 'mongodb-linux-x86_64-ubuntu2204-8.0.6.tgz' },
          label: 'Latest',
        },
        '7.0': {
          win: { url: 'https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-7.0.17.zip', filename: 'mongodb-windows-x86_64-7.0.17.zip' },
          mac: { url: 'https://fastdl.mongodb.org/osx/mongodb-macos-arm64-7.0.17.tgz', filename: 'mongodb-macos-arm64-7.0.17.tgz' },
          linux: { url: 'https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2204-7.0.17.tgz', filename: 'mongodb-linux-x86_64-ubuntu2204-7.0.17.tgz' },
          label: 'LTS',
        },
        '6.0': {
          win: { url: 'https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-6.0.21.zip', filename: 'mongodb-windows-x86_64-6.0.21.zip' },
          mac: { url: 'https://fastdl.mongodb.org/osx/mongodb-macos-arm64-6.0.21.tgz', filename: 'mongodb-macos-arm64-6.0.21.tgz' },
          linux: { url: 'https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-ubuntu2204-6.0.21.tgz', filename: 'mongodb-linux-x86_64-ubuntu2204-6.0.21.tgz' },
          label: 'Legacy',
        },
      },
      // mongosh - MongoDB Shell (downloaded alongside MongoDB server)
      mongosh: {
        latest: {
          win: { url: 'https://downloads.mongodb.com/compass/mongosh-2.3.8-win32-x64.zip', filename: 'mongosh-2.3.8-win32-x64.zip' },
          mac: { url: 'https://downloads.mongodb.com/compass/mongosh-2.3.8-darwin-arm64.zip', filename: 'mongosh-2.3.8-darwin-arm64.zip' },
          linux: { url: 'https://downloads.mongodb.com/compass/mongosh-2.3.8-linux-x64.tgz', filename: 'mongosh-2.3.8-linux-x64.tgz' },
          label: 'Latest',
        },
      },
      // SQLite - CLI tools (platform-independent engine, only download CLI binaries)
      sqlite: {
        '3': {
          win: { url: 'https://www.sqlite.org/2025/sqlite-tools-win-x64-3490200.zip', filename: 'sqlite-tools-win-x64-3490200.zip' },
          mac: { url: 'builtin', note: 'SQLite is pre-installed on macOS. Install latest via: brew install sqlite' },
          linux: { url: 'builtin', note: 'Install via package manager: sudo apt install sqlite3' },
          label: 'Latest',
        },
      },
      // MinIO - S3-compatible object storage (single executable, no versioning)
      minio: {
        latest: {
          win: { url: 'https://dl.min.io/server/minio/release/windows-amd64/minio.exe', filename: 'minio.exe' },
          mac: { url: 'https://dl.min.io/server/minio/release/darwin-arm64/minio', filename: 'minio' },
          linux: { url: 'https://dl.min.io/server/minio/release/linux-amd64/minio', filename: 'minio' },
          label: 'Latest',
        },
      },
      // Memcached - Windows builds only available from jefyt/memcached-windows (1.6.x only)
      memcached: {
        '1.6': {
          win: { url: 'https://github.com/jefyt/memcached-windows/releases/download/1.6.8_mingw/memcached-1.6.8-win64-mingw.zip', filename: 'memcached-1.6.8-win64-mingw.zip' },
          mac: { url: 'https://www.memcached.org/files/memcached-1.6.36.tar.gz', filename: 'memcached-1.6.36.tar.gz' },
          linux: { url: 'https://www.memcached.org/files/memcached-1.6.36.tar.gz', filename: 'memcached-1.6.36.tar.gz' },
          label: 'Latest',
        },
      },
    };

    // Version metadata for UI display and compatibility checks
    // Uses centralized configuration from shared/serviceConfig.js
    this.versionMeta = { ...SERVICE_VERSIONS };

    // Track remote config state
    this.remoteConfig = null;
    this.lastRemoteCheck = null;
    this.configVersion = 'built-in'; // Track current config version

    // Local config cache path - persists updates between app restarts
    this.localConfigPath = getAppCachePath(app, 'binaries-config.json');
  }

  getPlatform() {
    if (process.platform === 'win32') return 'win';
    if (process.platform === 'darwin') return 'mac';
    return 'linux';
  }

  async initialize() {
    await fs.ensureDir(this.resourcesPath);
    await fs.ensureDir(path.join(this.resourcesPath, 'php'));
    await fs.ensureDir(path.join(this.resourcesPath, 'mysql'));
    await fs.ensureDir(path.join(this.resourcesPath, 'mariadb'));
    await fs.ensureDir(path.join(this.resourcesPath, 'redis'));
    await fs.ensureDir(path.join(this.resourcesPath, 'mailpit'));
    await fs.ensureDir(path.join(this.resourcesPath, 'phpmyadmin'));
    await fs.ensureDir(path.join(this.resourcesPath, 'nginx'));
    await fs.ensureDir(path.join(this.resourcesPath, 'apache'));
    await fs.ensureDir(path.join(this.resourcesPath, 'nodejs'));
    await fs.ensureDir(path.join(this.resourcesPath, 'composer'));
    await fs.ensureDir(path.join(this.resourcesPath, 'git'));
    await fs.ensureDir(path.join(this.resourcesPath, 'downloads'));

    // Load bundled config/binaries.json first as the baseline
    // This ensures versions always come from the config file, not hardcoded values
    await this.loadBundledConfig();

    // Then load cached remote config (overrides bundled if newer)
    await this.loadCachedConfig();

    // Enable extensions in existing PHP installations (run in background, don't block startup)
    setImmediate(() => {
      this.enablePhpExtensions().catch(err => {
        this.managers?.log?.systemWarn('Error enabling PHP extensions', { error: err.message });
      });
    });
  }

  async downloadMysql(version = '8.4') {
    const id = `mysql-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.mysql[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`MySQL ${version} not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'mysql', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError(`Failed to download MySQL ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  async downloadMariadb(version = '11.4') {
    const id = `mariadb-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.mariadb[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`MariaDB ${version} not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'mariadb', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError(`Failed to download MariaDB ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  async downloadRedis(version = '7.4') {
    const id = `redis-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.redis[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`Redis ${version} not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'redis', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError(`Failed to download Redis ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  async downloadMailpit() {
    const id = 'mailpit';
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.mailpit[platform];

    if (!downloadInfo) {
      throw new Error(`Mailpit not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'mailpit', platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError('Failed to download Mailpit', { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  async downloadPhpMyAdmin() {
    const id = 'phpmyadmin';
    const downloadInfo = this.downloads.phpmyadmin.all;

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'phpmyadmin');

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);

      // Track metadata if headers are available
      try {
        const meta = await this.fetchRemoteMetadata(downloadInfo.url);
        await this.saveServiceMetadata('phpmyadmin', meta);
      } catch (metaErr) {
        // Non-critical, just log
        this.managers?.log?.systemWarn('Failed to fetch phpmyadmin metadata', { error: metaErr.message });
      }

      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError('Failed to download phpMyAdmin', { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  async createPhpMyAdminConfig(pmaPath) {
    const configContent = `<?php
/**
 * phpMyAdmin configuration for DevBox Pro
 */

$cfg['blowfish_secret'] = '${this.generateSecret(32)}';
$cfg['Servers'][1]['host'] = '127.0.0.1';
$cfg['Servers'][1]['port'] = '3306';
$cfg['Servers'][1]['auth_type'] = 'cookie';
$cfg['Servers'][1]['user'] = 'root';
$cfg['Servers'][1]['password'] = '';
$cfg['Servers'][1]['AllowNoPassword'] = true;
$cfg['UploadDir'] = '';
$cfg['SaveDir'] = '';
$cfg['DefaultLang'] = 'en';
$cfg['ServerDefault'] = 1;
`;

    await fs.writeFile(path.join(pmaPath, 'config.inc.php'), configContent);
  }

  async downloadNginx(version = '1.28') {
    const id = `nginx-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.nginx[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`Nginx ${version} not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'nginx', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);

      // Create default nginx config for PHP
      await this.createNginxConfig(extractPath);

      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError(`Failed to download Nginx ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  async createNginxConfig(nginxPath) {
    const confDir = path.join(nginxPath, 'conf');
    const sitesDir = path.join(nginxPath, 'conf', 'sites-enabled');
    await fs.ensureDir(confDir);
    await fs.ensureDir(sitesDir);

    // Main nginx.conf
    const mainConfig = `
worker_processes  auto;
error_log  logs/error.log;
pid        logs/nginx.pid;

events {
    worker_connections  1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;

    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent" "$http_x_forwarded_for"';

    access_log  logs/access.log  main;

    sendfile        on;
    keepalive_timeout  65;

    # Include site configurations
    include sites-enabled/*.conf;
}
`;
    await fs.writeFile(path.join(confDir, 'nginx.conf'), mainConfig);

    // Default site template
    const defaultSite = `
# Default DevBox Pro Site
# Copy this file and modify for each project

server {
    listen       80;
    server_name  localhost;
    root         /path/to/your/project/public;
    index        index.php index.html index.htm;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \\.php$ {
        fastcgi_pass   127.0.0.1:9000;
        fastcgi_index  index.php;
        fastcgi_param  SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include        fastcgi_params;
    }

    location ~ /\\.ht {
        deny  all;
    }
}
`;
    await fs.writeFile(path.join(sitesDir, 'default.conf.example'), defaultSite);

    // Create logs directory
    await fs.ensureDir(path.join(nginxPath, 'logs'));
  }

  async downloadApache(version = '2.4') {
    const id = `apache-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.apache[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`Apache ${version} not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'apache', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      // Try primary URL first, then fallbacks
      const urls = [downloadInfo.url, ...(downloadInfo.fallbackUrls || [])];
      let lastError = null;
      let downloaded = false;

      for (const url of urls) {
        try {
          // Trying Apache download URL
          await this.downloadFile(url, downloadPath, id);
          downloaded = true;
          break;
        } catch (err) {
          // Apache download failed from URL, trying next
          lastError = err;
          // Clean up partial download
          await fs.remove(downloadPath).catch(() => { });
        }
      }

      if (!downloaded) {
        // Provide helpful error message for manual download
        const manualNote = downloadInfo.manualDownloadNote || '';
        const manualUrl = downloadInfo.manualDownloadUrl || 'https://www.apachelounge.com/download/';
        throw new Error(`Apache download failed. ${manualNote} Manual download: ${manualUrl}`);
      }

      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);

      // Apache Lounge ZIPs have files inside an "Apache24" folder - move them up
      const apache24Path = path.join(extractPath, 'Apache24');
      if (await fs.pathExists(apache24Path)) {
        // Moving Apache files from subfolder
        const contents = await fs.readdir(apache24Path);
        for (const item of contents) {
          const srcPath = path.join(apache24Path, item);
          const destPath = path.join(extractPath, item);
          await fs.move(srcPath, destPath, { overwrite: true });
        }
        await fs.remove(apache24Path);
        // Apache files moved successfully
      }

      // Create default Apache config for PHP
      await this.createApacheConfig(extractPath);

      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError(`Failed to download Apache ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  async importApache(filePath, version = '2.4') {
    const id = `apache-${version}`;
    const platform = this.getPlatform();

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      // Validate file exists
      if (!await fs.pathExists(filePath)) {
        throw new Error('File not found: ' + filePath);
      }

      // Validate it's a zip file
      const isValid = await this.validateZipFile(filePath);
      if (!isValid) {
        throw new Error('Invalid ZIP file. Please download the correct Apache ZIP from Apache Lounge.');
      }

      const extractPath = path.join(this.resourcesPath, 'apache', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      this.emitProgress(id, { status: 'extracting', progress: 50 });

      await this.extractArchive(filePath, extractPath, id);

      // Apache Lounge ZIPs have files inside an "Apache24" folder - move them up
      const apache24Path = path.join(extractPath, 'Apache24');
      if (await fs.pathExists(apache24Path)) {
        // Moving imported Apache files from subfolder
        const contents = await fs.readdir(apache24Path);
        for (const item of contents) {
          const srcPath = path.join(apache24Path, item);
          const destPath = path.join(extractPath, item);
          await fs.move(srcPath, destPath, { overwrite: true });
        }
        await fs.remove(apache24Path);
        // Apache import files moved successfully
      }

      // Create default Apache config for PHP
      await this.createApacheConfig(extractPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  async createApacheConfig(apachePath) {
    const confDir = path.join(apachePath, 'conf');
    const extraDir = path.join(apachePath, 'conf', 'extra');
    const vhostsDir = path.join(apachePath, 'conf', 'vhosts');
    await fs.ensureDir(confDir);
    await fs.ensureDir(extraDir);
    await fs.ensureDir(vhostsDir);

    // PHP module config
    const phpConfig = `
# PHP Configuration for Apache
# DevBox Pro will configure the correct PHP path automatically

# Load PHP module (Windows example - adjust path based on PHP version)
# LoadModule php_module "C:/devbox/php/8.3/win/php8apache2_4.dll"

# For PHP-FPM (recommended)
<FilesMatch \\.php$>
    SetHandler "proxy:fcgi://127.0.0.1:9000"
</FilesMatch>

# PHP file handling
<IfModule dir_module>
    DirectoryIndex index.php index.html
</IfModule>

# PHP file types
AddType application/x-httpd-php .php
AddType application/x-httpd-php-source .phps
`;
    await fs.writeFile(path.join(extraDir, 'httpd-php.conf'), phpConfig);

    // Virtual hosts template
    const vhostTemplate = `
# DevBox Pro Virtual Host Template
# Copy and modify for each project

<VirtualHost *:80>
    ServerName myproject.test
    DocumentRoot "/path/to/your/project/public"
    
    <Directory "/path/to/your/project/public">
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
    
    ErrorLog "logs/myproject-error.log"
    CustomLog "logs/myproject-access.log" common
</VirtualHost>

# SSL Example
# <VirtualHost *:443>
#     ServerName myproject.test
#     DocumentRoot "/path/to/your/project/public"
#     
#     SSLEngine on
#     SSLCertificateFile "/path/to/cert.pem"
#     SSLCertificateKeyFile "/path/to/key.pem"
#     
#     <Directory "/path/to/your/project/public">
#         Options Indexes FollowSymLinks
#         AllowOverride All
#         Require all granted
#     </Directory>
# </VirtualHost>
`;
    await fs.writeFile(path.join(vhostsDir, 'template.conf.example'), vhostTemplate);

    // Create logs directory
    await fs.ensureDir(path.join(apachePath, 'logs'));
  }

  generateSecret(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Detect running projects/services that would block removal of a binary.
   * Returns { hasConflicts: boolean, items: [{ kind, id?, name, reason }] }
   */
  async getRunningConflicts(type, version) {
    const items = [];
    const projectManager = this.managers?.project;
    const serviceManager = this.managers?.service;

    // Project-level conflicts: PHP and Node.js binaries are used per-project.
    // Guard against deleting versions that are still referenced by saved projects,
    // not just currently running ones.
    if ((type === 'php' || type === 'nodejs') && projectManager) {
      const projects = typeof projectManager.getAllProjects === 'function'
        ? projectManager.getAllProjects()
        : [];

      for (const proj of projects) {
        if (!proj?.id) continue;

        const matchesPhp = type === 'php' && proj.phpVersion === version;
        const matchesNode = type === 'nodejs' && proj.nodeVersion === version;

        if (matchesPhp || matchesNode) {
          const runtimeLabel = type === 'php' ? `PHP ${version}` : `Node.js ${version}`;
          items.push({
            kind: 'project',
            id: proj.id,
            name: proj.name,
            reason: proj.isRunning ? `Running project uses ${runtimeLabel}` : `Project is configured to use ${runtimeLabel}`,
          });
        }
      }
    }

    // Service-level conflicts: standalone services tracked in ServiceManager
    const serviceTypes = ['mysql', 'mariadb', 'redis', 'postgresql', 'mongodb', 'memcached', 'nginx', 'apache', 'mailpit', 'minio'];
    if (serviceTypes.includes(type) && serviceManager) {
      const runningMap = serviceManager.runningVersions?.get(type);
      if (runningMap) {
        if (version) {
          if (runningMap.has(version)) {
            items.push({ kind: 'service', version, name: `${type} ${version}`, reason: 'Service is currently running' });
          }
        } else {
          // No version key (mailpit, minio) – flag any running entry
          for (const [v] of runningMap) {
            items.push({ kind: 'service', version: v || null, name: `${type}${v ? ` ${v}` : ''}`, reason: 'Service is currently running' });
          }
        }
      }
    }

    return { hasConflicts: items.length > 0, items };
  }

  async removeBinary(type, version = null, force = false) {
    const conflicts = await this.getRunningConflicts(type, version);

    if (conflicts.hasConflicts && !force) {
      const error = new Error(`${type}${version ? ` ${version}` : ''} is currently in use. Stop the project or service using it, then try deleting the binary again.`);
      error.code = 'BINARY_IN_USE';
      error.conflicts = conflicts.items;
      throw error;
    }

    if (force) {
      // Stop any running conflicts before removing so file handles are released
      for (const item of conflicts.items) {
        try {
          if (item.kind === 'project') {
            await this.managers?.project?.stopProject(item.id);
          } else if (item.kind === 'service') {
            await this.managers?.service?.stopService(type, item.version ?? version ?? null);
          }
        } catch (err) {
          this.managers?.log?.systemWarn(`Could not stop ${item.name} before removal`, { error: err.message });
        }
      }
      // Brief pause to allow OS to release file handles
      if (conflicts.hasConflicts) {
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    }

    const platform = this.getPlatform();
    let targetPath;

    // All versioned services now use version/platform structure
    if (version) {
      if (['php', 'nodejs', 'mysql', 'mariadb', 'redis', 'nginx', 'apache'].includes(type)) {
        targetPath = path.join(this.resourcesPath, type, version, platform);
      } else {
        targetPath = path.join(this.resourcesPath, type, version);
      }
    } else if (type === 'phpmyadmin') {
      targetPath = path.join(this.resourcesPath, 'phpmyadmin');
    } else if (type === 'composer') {
      targetPath = path.join(this.resourcesPath, 'composer');
    } else if (type === 'mailpit') {
      targetPath = path.join(this.resourcesPath, 'mailpit', platform);
    } else {
      // Fallback for unversioned services
      targetPath = path.join(this.resourcesPath, type, platform);
    }

    await this.assertBinaryFolderDeletable(targetPath, type, version);
    await fs.remove(targetPath);
    return { success: true };
  }

  async assertBinaryFolderDeletable(targetPath, type, version = null) {
    if (!await fs.pathExists(targetPath)) {
      return;
    }

    const tempPath = `${targetPath}.delete-check-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    let moved = false;

    try {
      // Renaming the whole folder is an inexpensive preflight that fails on Windows
      // when files inside the binary directory are still held by another process.
      await fs.move(targetPath, tempPath, { overwrite: false });
      moved = true;
      await fs.move(tempPath, targetPath, { overwrite: false });
    } catch (error) {
      if (moved) {
        await fs.move(tempPath, targetPath, { overwrite: false }).catch(() => { });
      }

      if (['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) {
        const label = `${type}${version ? ` ${version}` : ''}`;
        const lockedError = new Error(`${label} cannot be deleted because one or more files inside its binary folder are currently in use by another process. Close the app or process using those files, then try deleting the binary again.`);
        lockedError.code = 'BINARY_FILES_IN_USE';
        lockedError.originalError = error.message;
        throw lockedError;
      }

      throw error;
    }
  }

  getDownloadUrls() {
    const platform = this.getPlatform();
    const urls = {
      php: {},
      mysql: {},
      mariadb: {},
      redis: {},
      mailpit: this.downloads.mailpit[platform],
      phpmyadmin: this.downloads.phpmyadmin.all,
      nginx: {},
      apache: {},
      nodejs: {},
      composer: this.downloads.composer.all,
    };

    // PHP versions
    for (const version of Object.keys(this.downloads.php)) {
      urls.php[version] = {
        ...this.downloads.php[version][platform],
        label: this.downloads.php[version].label,
      };
    }

    // MySQL versions
    for (const version of Object.keys(this.downloads.mysql)) {
      urls.mysql[version] = {
        ...this.downloads.mysql[version][platform],
        label: this.downloads.mysql[version].label,
        defaultPort: this.downloads.mysql[version].defaultPort,
      };
    }

    // MariaDB versions
    for (const version of Object.keys(this.downloads.mariadb)) {
      urls.mariadb[version] = {
        ...this.downloads.mariadb[version][platform],
        label: this.downloads.mariadb[version].label,
        defaultPort: this.downloads.mariadb[version].defaultPort,
      };
    }

    // Redis versions
    for (const version of Object.keys(this.downloads.redis)) {
      urls.redis[version] = {
        ...this.downloads.redis[version][platform],
        label: this.downloads.redis[version].label,
        defaultPort: this.downloads.redis[version].defaultPort,
      };
    }

    // Nginx versions
    for (const version of Object.keys(this.downloads.nginx)) {
      urls.nginx[version] = {
        ...this.downloads.nginx[version][platform],
        label: this.downloads.nginx[version].label,
        defaultPort: this.downloads.nginx[version].defaultPort,
      };
    }

    // Apache versions
    for (const version of Object.keys(this.downloads.apache)) {
      urls.apache[version] = {
        ...this.downloads.apache[version][platform],
        label: this.downloads.apache[version].label,
        defaultPort: this.downloads.apache[version].defaultPort,
      };
    }

    // Node.js versions
    for (const version of Object.keys(this.downloads.nodejs)) {
      urls.nodejs[version] = {
        ...this.downloads.nodejs[version][platform],
        label: this.downloads.nodejs[version].label,
      };
    }

    // Python versions
    urls.python = {};
    for (const version of Object.keys(this.downloads.python || {})) {
      if (this.downloads.python[version][platform]) {
        urls.python[version] = {
          ...this.downloads.python[version][platform],
          label: this.downloads.python[version].label,
        };
      }
    }

    return urls;
  }

  // Get available versions for a service
  getAvailableVersions(serviceName) {
    return this.versionMeta[serviceName] || [];
  }

  // Get version metadata including labels
  getVersionMeta() {
    const meta = {};
    for (const [service, versions] of Object.entries(this.versionMeta)) {
      meta[service] = versions.map(version => {
        const info = this.downloads[service]?.[version];
        return {
          version,
          label: info?.label || null,
          defaultPort: info?.defaultPort || null,
        };
      });
    }
    return meta;
  }

  // Generic import method for custom binaries
  async importBinary(serviceName, version, filePath) {
    const id = version && version !== 'default' ? `${serviceName}-${version}` : serviceName;
    const platform = this.getPlatform();

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      // Validate file exists
      if (!await fs.pathExists(filePath)) {
        throw new Error('File not found: ' + filePath);
      }

      const ext = path.extname(filePath).toLowerCase();

      // Handle Composer .phar file specially (not an archive)
      if (serviceName === 'composer' && ext === '.phar') {
        const composerPath = path.join(this.resourcesPath, 'composer');
        await fs.ensureDir(composerPath);
        const destPath = path.join(composerPath, 'composer.phar');
        await fs.copy(filePath, destPath);

        // Track metadata if headers are available (mostly valid for initial download, not arbitrary import, but we'll try to find the canonical url)
        try {
          const dlInfo = this.downloads.composer?.all;
          if (dlInfo) {
            const meta = await this.fetchRemoteMetadata(dlInfo.url);
            await this.saveServiceMetadata('composer', meta);
          }
        } catch (metaErr) {
          // Ignore
        }

        this.emitProgress(id, { status: 'completed', progress: 100 });
        return { success: true, version: 'latest', path: composerPath };
      }

      // Handle phpMyAdmin specially (no version subfolder)
      if (serviceName === 'phpmyadmin') {
        const extractPath = path.join(this.resourcesPath, 'phpmyadmin');
        await fs.remove(extractPath);
        await fs.ensureDir(extractPath);

        this.emitProgress(id, { status: 'extracting', progress: 50 });
        await this.extractArchive(filePath, extractPath, id);
        await this.normalizeExtractedStructure(serviceName, extractPath);
        await this.createPhpMyAdminConfig(extractPath);

        this.emitProgress(id, { status: 'completed', progress: 100 });
        return { success: true, version: 'latest', path: extractPath };
      }

      // Handle Mailpit specially (no version subfolder)
      if (serviceName === 'mailpit') {
        const extractPath = path.join(this.resourcesPath, 'mailpit', platform);
        await fs.remove(extractPath);
        await fs.ensureDir(extractPath);

        this.emitProgress(id, { status: 'extracting', progress: 50 });
        await this.extractArchive(filePath, extractPath, id);
        await this.normalizeExtractedStructure(serviceName, extractPath);

        this.emitProgress(id, { status: 'completed', progress: 100 });
        return { success: true, version: 'latest', path: extractPath };
      }

      // Validate it's a valid archive for other services
      if (ext === '.zip') {
        const isValid = await this.validateZipFile(filePath);
        if (!isValid) {
          throw new Error('Invalid ZIP file.');
        }
      } else if (!filePath.endsWith('.tar.gz') && ext !== '.tgz') {
        throw new Error('Unsupported archive format. Please use .zip or .tar.gz');
      }

      const extractPath = path.join(this.resourcesPath, serviceName, version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      this.emitProgress(id, { status: 'extracting', progress: 50 });

      await this.extractArchive(filePath, extractPath, id);

      // Handle special folder structures
      await this.normalizeExtractedStructure(serviceName, extractPath);

      // Create php.ini for PHP imports
      if (serviceName === 'php') {
        await this.createPhpIni(extractPath, version);
      }

      // Create Apache config for Apache imports
      if (serviceName === 'apache') {
        await this.createApacheConfig(extractPath);
      }

      // Handle Node.js imports - move files from nested node-* directory if needed
      if (serviceName === 'nodejs') {
        const contents = await fs.readdir(extractPath);
        const extractedDir = contents.find((d) => d.startsWith('node-'));
        if (extractedDir) {
          const srcPath = path.join(extractPath, extractedDir);
          const files = await fs.readdir(srcPath);
          for (const file of files) {
            await fs.move(path.join(srcPath, file), path.join(extractPath, file), { overwrite: true });
          }
          await fs.remove(srcPath);
        }
        // Set up PATH configuration for this Node.js version
        await this.setupNodejsEnvironment(version, extractPath);
      }

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version, path: extractPath };
    } catch (error) {
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  // Check for updates for "latest" services (composer, phpmyadmin)
  async checkForServiceUpdates() {
    const updates = {
      composer: { updateAvailable: false },
      phpmyadmin: { updateAvailable: false },
      lastChecked: new Date().toISOString()
    };

    try {
      // Check Composer
      const composerMeta = await this.getLocalServiceMetadata('composer');
      if (composerMeta?.lastModified) {
        const dlInfo = this.downloads.composer?.all;
        if (dlInfo) {
          const remoteMeta = await this.fetchRemoteMetadata(dlInfo.url).catch(() => null);
          if (remoteMeta?.lastModified && remoteMeta.lastModified !== composerMeta.lastModified) {
            // ETag or LastModified drifted = Update Available!
            updates.composer.updateAvailable = true;
          }
        }
      }

      // Check phpMyAdmin
      const pmaMeta = await this.getLocalServiceMetadata('phpmyadmin');
      if (pmaMeta?.lastModified) {
        const dlInfo = this.downloads.phpmyadmin?.all;
        if (dlInfo) {
          const remoteMeta = await this.fetchRemoteMetadata(dlInfo.url).catch(() => null);
          if (remoteMeta?.lastModified && remoteMeta.lastModified !== pmaMeta.lastModified) {
            updates.phpmyadmin.updateAvailable = true;
          }
        }
      }
    } catch (err) {
      this.managers?.log?.systemWarn('Error during service update check', { error: err.message });
    }

    return updates;
  }

  // Normalize extracted folder structure (handle nested folders)
  async normalizeExtractedStructure(serviceName, extractPath) {
    // Check for common nested folder patterns
    const contents = await fs.readdir(extractPath);

    if (contents.length === 1) {
      const singleItem = contents[0];
      const singlePath = path.join(extractPath, singleItem);
      const stat = await fs.stat(singlePath);

      if (stat.isDirectory()) {
        // Move contents up if there's only a single directory
        const innerContents = await fs.readdir(singlePath);
        for (const item of innerContents) {
          const srcPath = path.join(singlePath, item);
          const destPath = path.join(extractPath, item);
          await fs.move(srcPath, destPath, { overwrite: true });
        }
        await fs.remove(singlePath);
        // Normalized folder structure for import
      }
    }

    // Handle Apache-specific "Apache24" folder
    const apache24Path = path.join(extractPath, 'Apache24');
    if (await fs.pathExists(apache24Path)) {
      const innerContents = await fs.readdir(apache24Path);
      for (const item of innerContents) {
        const srcPath = path.join(apache24Path, item);
        const destPath = path.join(extractPath, item);
        await fs.move(srcPath, destPath, { overwrite: true });
      }
      await fs.remove(apache24Path);
    }
  }

  // Download and install Node.js
  async downloadNodejs(version = '20') {
    const id = `nodejs-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.nodejs[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`Node.js ${version} download not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const { downloadPath } = await this.downloadWithVersionProbe('nodejs', version, id, downloadInfo);

      await this.checkCancelled(id, downloadPath);
      this.emitProgress(id, { status: 'extracting', progress: 50 });

      const nodejsPath = path.join(this.resourcesPath, 'nodejs', version, platform);
        await this.prepareNodejsInstallPath(nodejsPath);
      await fs.ensureDir(nodejsPath);

      await this.extractArchive(downloadPath, nodejsPath, id);

      // Move files from nested directory if needed
      const contents = await fs.readdir(nodejsPath);
      const extractedDir = contents.find((d) => d.startsWith('node-'));
      if (extractedDir) {
        const srcPath = path.join(nodejsPath, extractedDir);
        const files = await fs.readdir(srcPath);
        for (const file of files) {
          await fs.move(path.join(srcPath, file), path.join(nodejsPath, file), { overwrite: true });
        }
        await fs.remove(srcPath);
      }

      // Set up PATH configuration for this Node.js version
      await this.setupNodejsEnvironment(version, nodejsPath);

      if (!await this.isNodejsVersionInstalled(version, platform)) {
        await fs.remove(nodejsPath);
        throw new Error(`Node.js ${version} installation is incomplete after extraction. Please try downloading it again.`);
      }

      // Clean up download
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });

      return {
        success: true,
        version,
        path: nodejsPath,
      };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError(`Failed to download Node.js ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  // Set up Node.js environment with proper PATH
  async setupNodejsEnvironment(version, nodejsPath) {
    const platform = this.getPlatform();

    // Create a wrapper script for easy access
    const binDir = path.join(this.resourcesPath, 'bin');
    await fs.ensureDir(binDir);

    if (platform === 'win') {
      // Create batch file wrapper for Windows
      const nodeExe = path.join(nodejsPath, 'node.exe');
      const npmExe = path.join(nodejsPath, 'npm.cmd');
      const npxExe = path.join(nodejsPath, 'npx.cmd');

      const nodeBat = `@echo off\n"${nodeExe}" %*`;
      const npmBat = `@echo off\n"${npmExe}" %*`;
      const npxBat = `@echo off\n"${npxExe}" %*`;

      await fs.writeFile(path.join(binDir, `node${version}.cmd`), nodeBat);
      await fs.writeFile(path.join(binDir, `npm${version}.cmd`), npmBat);
      await fs.writeFile(path.join(binDir, `npx${version}.cmd`), npxBat);
    } else {
      // Create symlinks for macOS/Linux
      const nodeBin = path.join(nodejsPath, 'bin', 'node');
      const npmBin = path.join(nodejsPath, 'bin', 'npm');
      const npxBin = path.join(nodejsPath, 'bin', 'npx');

      try {
        await fs.symlink(nodeBin, path.join(binDir, `node${version}`));
        await fs.symlink(npmBin, path.join(binDir, `npm${version}`));
        await fs.symlink(npxBin, path.join(binDir, `npx${version}`));
      } catch (err) {
        // Symlinks may already exist
        // Symlinks already exist or couldn't be created - continuing
      }
    }

    // Node.js environment set up
  }

  async prepareNodejsInstallPath(nodejsPath) {
    if (!await fs.pathExists(nodejsPath)) {
      return;
    }

    if (process.platform === 'win32') {
      try {
        await killProcessesByPath('node.exe', nodejsPath);
      } catch (error) {
        this.managers?.log?.systemWarn('Failed to stop existing Node.js processes before reinstall', { error: error.message, nodejsPath });
      }

      await new Promise((resolve) => setTimeout(resolve, 750));
    }

    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await fs.remove(nodejsPath);
        return;
      } catch (error) {
        lastError = error;

        if (process.platform !== 'win32' || !['EPERM', 'EBUSY'].includes(error.code) || attempt === 3) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }

    if (lastError) {
      throw lastError;
    }
  }

  // Get Node.js executable path
  getNodejsPath(version = '20') {
    const platform = this.getPlatform();
    const nodejsPath = path.join(this.resourcesPath, 'nodejs', version, platform);
    const nodeExe = platform === 'win' ? 'node.exe' : 'bin/node';
    return path.join(nodejsPath, nodeExe);
  }

  // Get npm executable path
  getNpmPath(version = '20') {
    const platform = this.getPlatform();
    const nodejsPath = path.join(this.resourcesPath, 'nodejs', version, platform);
    const npmExe = platform === 'win' ? 'npm.cmd' : 'bin/npm';
    return path.join(nodejsPath, npmExe);
  }

  // Download and install Composer
  async downloadComposer() {
    const id = 'composer';

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', 'composer.phar');
      await fs.ensureDir(path.dirname(downloadPath));
      // Force IPv4 — getcomposer.org CDN can hang on IPv6 without triggering a timeout error
      await this.downloadFile(this.downloads.composer.all.url, downloadPath, id, { forceIPv4: true });

      this.emitProgress(id, { status: 'installing', progress: 60 });

      // Guard: ensure the download landed on disk before copying
      if (!await fs.pathExists(downloadPath)) {
        throw new Error('Download did not complete — file not found after download.');
      }

      // Move to composer directory
      const composerDir = path.join(this.resourcesPath, 'composer');
      await fs.ensureDir(composerDir);
      await fs.copy(downloadPath, path.join(composerDir, 'composer.phar'));

      // Create wrapper scripts
      await this.setupComposerEnvironment(composerDir);

      // Save metadata for future update checks
      try {
        const meta = await this.fetchRemoteMetadata(this.downloads.composer.all.url);
        await this.saveServiceMetadata('composer', meta);
      } catch (metaErr) {
        // Non-fatal — update checks will just not work until next download
      }

      // Clean up
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });

      return {
        success: true,
        path: composerDir,
      };
    } catch (error) {
      this.managers?.log?.systemError('Failed to download Composer', { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  // Set up Composer environment with wrapper scripts
  async setupComposerEnvironment(composerDir) {
    const platform = this.getPlatform();
    const binDir = path.join(this.resourcesPath, 'bin');
    await fs.ensureDir(binDir);

    const composerPhar = path.join(composerDir, 'composer.phar');

    if (platform === 'win') {
      // Create batch wrapper for Windows
      // Will use the first available PHP version
      const composerBat = `@echo off
setlocal
set "PHP_PATHS=${path.join(this.resourcesPath, 'php')}"
for /d %%V in ("%PHP_PATHS%\\*") do (
    if exist "%%V\\win\\php.exe" (
        "%%V\\win\\php.exe" "${composerPhar}" %*
        exit /b %ERRORLEVEL%
    )
)
echo No PHP installation found. Please install PHP first.
exit /b 1
`;
      await fs.writeFile(path.join(binDir, 'composer.cmd'), composerBat);
      await fs.writeFile(path.join(composerDir, 'composer.cmd'), composerBat);
    } else {
      // Create shell wrapper for macOS/Linux
      const composerSh = `#!/bin/bash
PHP_PATHS="${path.join(this.resourcesPath, 'php')}"
for VERSION in 8.3 8.2 8.1 8.0 7.4; do
    if [ -x "$PHP_PATHS/$VERSION/mac/php" ]; then
        "$PHP_PATHS/$VERSION/mac/php" "${composerPhar}" "$@"
        exit $?
    fi
done
echo "No PHP installation found. Please install PHP first."
exit 1
`;
      await fs.writeFile(path.join(binDir, 'composer'), composerSh);
      await fs.chmod(path.join(binDir, 'composer'), '755');
      await fs.writeFile(path.join(composerDir, 'composer'), composerSh);
      await fs.chmod(path.join(composerDir, 'composer'), '755');
    }

    // Composer environment ready
  }

  // Get Composer path
  getComposerPath() {
    return path.join(this.resourcesPath, 'composer', 'composer.phar');
  }

  // Run Composer command with specific PHP version
  async runComposer(projectPath, command, phpVersion = '8.3', onOutput = null) {
    const platform = this.getPlatform();
    const phpDir = path.join(this.resourcesPath, 'php', phpVersion, platform);
    const phpPath = path.join(phpDir, platform === 'win' ? 'php.exe' : 'php');
    const composerPhar = this.getComposerPath();

    // Checking PHP path
    // Checking Composer path

    if (!await fs.pathExists(phpPath)) {
      const error = `PHP ${phpVersion} is not installed. Please download it from the Binary Manager.`;
      if (onOutput) onOutput(error, 'error');
      throw new Error(error);
    }

    if (!await fs.pathExists(composerPhar)) {
      const error = 'Composer is not installed. Please download it from the Binary Manager.';
      if (onOutput) onOutput(error, 'error');
      throw new Error(error);
    }

    const args = [composerPhar, ...command.split(' ')];

    // Build environment with PHP directory in PATH
    const spawnEnv = {
      ...process.env,
      // Add PHP directory to PATH so Windows can find PHP's DLLs
      PATH: platform === 'win'
        ? `${phpDir};${process.env.PATH || ''}`
        : `${phpDir}:${process.env.PATH || ''}`,
      COMPOSER_HOME: path.join(this.resourcesPath, 'composer'),
      COMPOSER_NO_INTERACTION: '1',
    };

    const spawnOptions = {
      cwd: projectPath,
      env: spawnEnv,
      onStdout: (text) => onOutput?.(text.trim(), 'stdout'),
      onStderr: (text) => onOutput?.(text.trim(), 'stderr'),
    };

    // Use direct PHP spawn for all platforms
    const spawnCommand = phpPath;
    const spawnArgs = args;

    try {
      const { code, error, stderr } = await spawnAsync(spawnCommand, spawnArgs, spawnOptions);

      if (code === 0) {
        return { stdout: '', stderr: '' }; // Output handled via callbacks
      } else {
        const errorMsg = stderr || error?.message || `Composer exited with code ${code}`;
        if (onOutput) onOutput(`Process exited with code ${code}`, 'error');
        throw new Error(errorMsg);
      }
    } catch (err) {
      this.managers?.log?.systemError('[runComposer] Process error', { error: err.message });
      if (onOutput) onOutput(`Process error: ${err.message}`, 'error');
      throw err;
    }
  }

  // Run npm command with specific Node.js version
  async runNpm(projectPath, command, nodeVersion = '20') {
    const platform = this.getPlatform();
    const nodejsPath = path.join(this.resourcesPath, 'nodejs', nodeVersion, platform);
    const nodePath = platform === 'win' ? path.join(nodejsPath, 'node.exe') : path.join(nodejsPath, 'bin', 'node');
    const npmScript = platform === 'win'
      ? path.join(nodejsPath, 'node_modules', 'npm', 'bin', 'npm-cli.js')
      : path.join(nodejsPath, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');

    if (!await fs.pathExists(nodePath)) {
      throw new Error(`Node.js ${nodeVersion} is not installed`);
    }

    return new Promise((resolve, reject) => {
      const args = [npmScript, ...command.split(' ')];
      const proc = spawn(nodePath, args, {
        cwd: projectPath,
        env: {
          ...process.env,
          PATH: `${nodejsPath}${platform === 'win' ? '' : '/bin'}${path.delimiter}${process.env.PATH}`,
        },
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(stderr || `npm exited with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }

  // Download and install Portable Git (Windows only)
  async downloadGit() {
    const platform = this.getPlatform();
    const id = 'git-portable';

    // On macOS, Git should be installed via system (xcode-select or brew)
    if (platform === 'mac') {
      return {
        success: false,
        error: 'Git on macOS should be installed via: xcode-select --install or brew install git'
      };
    }

    const downloadInfo = this.downloads.git?.portable?.[platform];
    if (!downloadInfo || downloadInfo.url === 'builtin') {
      throw new Error('Git download not available for this platform');
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      await this.downloadFile(downloadInfo.url, downloadPath, id);

      await this.checkCancelled(id, downloadPath);
      this.emitProgress(id, { status: 'extracting', progress: 50, message: 'Extracting Portable Git (this may take a few minutes)...' });

      const gitPath = path.join(this.resourcesPath, 'git', platform);
      await fs.ensureDir(gitPath);

      // PortableGit is a self-extracting 7z archive
      // We need to run it with -o to specify output directory and -y to auto-confirm
      const { spawn } = require('child_process');

      await new Promise((resolve, reject) => {
        const proc = spawn(downloadPath, ['-o' + gitPath, '-y'], {
          windowsHide: true,
          stdio: 'ignore',
        });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Git extraction failed with code ${code}`));
          }
        });

        proc.on('error', (err) => {
          reject(new Error(`Failed to extract Git: ${err.message}`));
        });
      });

      // Clean up download
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });

      return {
        success: true,
        path: gitPath,
      };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError('Failed to download Git', { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  // ─── PostgreSQL ──────────────────────────────────────────────────────────────

  async downloadPostgresql(version = '17') {
    const id = `postgresql-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.postgresql[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`PostgreSQL ${version} not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'postgresql', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);

      // The EnterpriseDB PostgreSQL zip is 250+ MB.  AdmZip loads the entire
      // archive into memory and silently drops entries on large zips.
      // Use `unzipper` instead — it streams from disk entry-by-entry and handles
      // arbitrarily large archives reliably on all platforms.
      this.emitProgress(id, { status: 'extracting', progress: 0 });
      const directory = await unzipper.Open.file(downloadPath);
      const totalFiles = directory.files.length;
      let processed = 0;
      for (const file of directory.files) {
        // Skip pgAdmin 4 — we only need the server binaries, and Electron's
        // fs intercept throws on .asar files inside the pgAdmin 4 bundle.
        if (file.path.includes('pgAdmin') || file.path.toLowerCase().endsWith('.asar')) {
          processed++;
          continue;
        }
        const targetPath = path.join(extractPath, file.path);
        if (file.type === 'Directory') {
          await fs.ensureDir(targetPath);
        } else {
          await fs.ensureDir(path.dirname(targetPath));
          await new Promise((res, rej) => {
            file.stream()
              .pipe(fs.createWriteStream(targetPath))
              .on('finish', res)
              .on('error', rej);
          });
        }
        processed++;
        if (processed % 200 === 0) {
          const pct = Math.round((processed / totalFiles) * 90);
          this.emitProgress(id, { status: 'extracting', progress: pct });
        }
      }
      this.emitProgress(id, { status: 'extracting', progress: 95 });

      // EnterpriseDB binaries extract into a 'pgsql' subdirectory — flatten it.
      const pgsqlDir = path.join(extractPath, 'pgsql');
      if (await fs.pathExists(pgsqlDir)) {
        await fs.copy(pgsqlDir, extractPath, { overwrite: true });
        await fs.remove(pgsqlDir);
      }

      await fs.remove(downloadPath);
      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      if (error.cancelled) return { success: false, cancelled: true };
      this.managers?.log?.systemError(`Failed to download PostgreSQL ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  // Get PostgreSQL bin directory
  getPostgresqlBinPath(version = '17') {
    const platform = this.getPlatform();
    return path.join(this.resourcesPath, 'postgresql', version, platform, 'bin');
  }

  // ─── Python ──────────────────────────────────────────────────────────────────

  async downloadPython(version = '3.13') {
    const id = `python-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.python[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`Python ${version} not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'python', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);

      // On Windows, the embeddable zip extracts flat — enable site-packages for pip
      if (platform === 'win') {
        const majorMinor = version.replace('.', '').replace('.', '');  // '3.13' → '313'
        const pthFile = path.join(extractPath, `python${majorMinor}._pth`);
        if (await fs.pathExists(pthFile)) {
          let content = await fs.readFile(pthFile, 'utf8');
          content = content.replace('#import site', 'import site');
          await fs.writeFile(pthFile, content);
        }
      }

      // Bootstrap pip using get-pip.py (embeddable Python doesn't include pip or ensurepip)
      await this.bootstrapPip(extractPath, platform, id);

      await fs.remove(downloadPath);
      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      if (error.cancelled) return { success: false, cancelled: true };
      this.managers?.log?.systemError(`Failed to download Python ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  /**
   * Bootstrap pip into a Python installation using get-pip.py
   * The embeddable Python distribution does not include pip or ensurepip,
   * so we download get-pip.py from the official source and run it.
   */
  async bootstrapPip(pythonDir, platform, id) {
    const pyExe = platform === 'win' ? 'python.exe' : 'bin/python3';
    const pythonPath = path.join(pythonDir, pyExe);

    if (!await fs.pathExists(pythonPath)) {
      this.managers?.log?.systemWarn('Cannot bootstrap pip: Python executable not found');
      return;
    }

    try {
      this.emitProgress(id, { status: 'installing_pip', progress: 85, message: 'Installing pip...' });

      // Download get-pip.py and emit sub-progress so the UI tracks and clears it properly
      const getPipPath = path.join(pythonDir, 'get-pip.py');
      const getPipUrl = 'https://bootstrap.pypa.io/get-pip.py';
      const getPipId = `${id}-getpip`;

      try {
        await this.downloadFile(getPipUrl, getPipPath, getPipId);
        this.emitProgress(getPipId, { status: 'completed', progress: 100 });
      } catch (err) {
        this.emitProgress(getPipId, { status: 'error', error: err.message });
        throw err;
      }

      // Run get-pip.py with the Python executable
      await new Promise((resolve, reject) => {
        const proc = spawn(pythonPath, [getPipPath, '--no-warn-script-location'], {
          cwd: pythonDir,
          windowsHide: true,
          env: { ...process.env },
        });

        let stderr = '';
        proc.stdout.on('data', () => { }); // drain stdout
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`get-pip.py failed with code ${code}: ${stderr}`));
          }
        });

        proc.on('error', (err) => {
          reject(new Error(`Failed to run get-pip.py: ${err.message}`));
        });
      });

      // Clean up get-pip.py
      await fs.remove(getPipPath);

      this.managers?.log?.system?.('pip bootstrapped successfully');
    } catch (error) {
      // pip bootstrap failure is non-fatal — Python still works, just without pip
      this.managers?.log?.systemWarn?.('Failed to bootstrap pip', { error: error.message });
    }
  }

  // Get Python executable path
  getPythonPath(version = '3.13') {
    const platform = this.getPlatform();
    const pyDir = path.join(this.resourcesPath, 'python', version, platform);
    const pyExe = platform === 'win' ? 'python.exe' : 'bin/python3';
    return path.join(pyDir, pyExe);
  }

  // Run pip install for a Python version
  async runPip(version = '3.13', args = [], onOutput = null) {
    const platform = this.getPlatform();
    const pyPath = this.getPythonPath(version);
    const pipArgs = ['-m', 'pip', ...args];

    if (!await fs.pathExists(pyPath)) {
      throw new Error(`Python ${version} is not installed`);
    }

    return new Promise((resolve, reject) => {
      const proc = require('child_process').spawn(pyPath, pipArgs, {
        windowsHide: true,
        shell: false,
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => { stdout += d; onOutput?.(d.toString().trim(), 'stdout'); });
      proc.stderr.on('data', (d) => { stderr += d; onOutput?.(d.toString().trim(), 'stderr'); });
      proc.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || `pip exited with code ${code}`)));
      proc.on('error', reject);
    });
  }

  // ─── MongoDB ─────────────────────────────────────────────────────────────────

  async downloadMongodb(version = '8.0') {
    const id = `mongodb-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.mongodb[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`MongoDB ${version} not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'mongodb', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);

      // MongoDB archives extract into a versioned subdirectory — flatten it
      const contents = await fs.readdir(extractPath);
      const extractedDir = contents.find((d) => d.startsWith('mongodb-'));
      if (extractedDir) {
        const srcPath = path.join(extractPath, extractedDir);
        const files = await fs.readdir(srcPath);
        for (const file of files) {
          await fs.move(path.join(srcPath, file), path.join(extractPath, file), { overwrite: true });
        }
        await fs.remove(srcPath);
      }

      // Also download mongosh alongside MongoDB
      await this.downloadMongosh(version);

      await fs.remove(downloadPath);
      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      if (error.cancelled) return { success: false, cancelled: true };
      this.managers?.log?.systemError(`Failed to download MongoDB ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  // Download mongosh (MongoDB shell) - co-downloaded with MongoDB server
  async downloadMongosh(mongoVersion = '8.0') {
    const id = `mongosh-${mongoVersion}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.mongosh?.latest?.[platform];

    if (!downloadInfo) return { success: false, error: 'mongosh not available for this platform' };

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'mongodb', mongoVersion, platform);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);

      // Flatten mongosh extracted dir into mongodb bin dir
      const mongoshContents = await fs.readdir(extractPath);
      const mongoshDir = mongoshContents.find((d) => d.startsWith('mongosh-'));
      if (mongoshDir) {
        const srcBin = path.join(extractPath, mongoshDir, 'bin');
        const destBin = path.join(extractPath, 'bin');
        if (await fs.pathExists(srcBin)) {
          const binFiles = await fs.readdir(srcBin);
          for (const file of binFiles) {
            await fs.move(path.join(srcBin, file), path.join(destBin, file), { overwrite: true });
          }
        }
        await fs.remove(path.join(extractPath, mongoshDir));
      }

      await fs.remove(downloadPath);
      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true };
    } catch (error) {
      if (error.cancelled) return { success: false, cancelled: true };
      this.managers?.log?.systemWarn('Failed to download mongosh', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  // Get MongoDB bin directory
  getMongodbBinPath(version = '8.0') {
    const platform = this.getPlatform();
    return path.join(this.resourcesPath, 'mongodb', version, platform, 'bin');
  }

  // ─── SQLite ───────────────────────────────────────────────────────────────────

  async downloadSqlite(version = '3') {
    version = version || '3'; // normalize null/undefined (called without version arg)
    const id = 'sqlite';
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.sqlite[version]?.[platform];

    if (!downloadInfo || downloadInfo.url === 'builtin') {
      // SQLite is built-in on macOS and Linux
      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, builtin: true, version };
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'sqlite', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      if (error.cancelled) return { success: false, cancelled: true };
      this.managers?.log?.systemError('Failed to download SQLite', { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  // Get SQLite CLI path
  getSqlitePath(version = '3') {
    const platform = this.getPlatform();
    const sqliteDir = path.join(this.resourcesPath, 'sqlite', version, platform);
    const sqliteExe = platform === 'win' ? 'sqlite3.exe' : 'sqlite3';
    return path.join(sqliteDir, sqliteExe);
  }

  // ─── MinIO ────────────────────────────────────────────────────────────────────

  async downloadMinio() {
    const id = 'minio';
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.minio?.latest?.[platform];

    if (!downloadInfo) {
      throw new Error(`MinIO not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const minioDir = path.join(this.resourcesPath, 'minio', platform);
      await fs.ensureDir(minioDir);

      const destPath = path.join(minioDir, downloadInfo.filename);

      // MinIO is a single executable — just download it directly (no extraction needed)
      await this.downloadFile(downloadInfo.url, destPath, id);
      await this.checkCancelled(id, destPath);

      // Make executable on non-Windows
      if (platform !== 'win') {
        await fs.chmod(destPath, '755');
      }

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true };
    } catch (error) {
      if (error.cancelled) return { success: false, cancelled: true };
      this.managers?.log?.systemError('Failed to download MinIO', { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  // Get MinIO executable path
  getMinioPath() {
    const platform = this.getPlatform();
    const minioDir = path.join(this.resourcesPath, 'minio', platform);
    const minioExe = platform === 'win' ? 'minio.exe' : 'minio';
    return path.join(minioDir, minioExe);
  }

  // ─── Memcached ────────────────────────────────────────────────────────────────

  async downloadMemcached(version = '1.6') {
    const id = `memcached-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.memcached[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`Memcached ${version} not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'memcached', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);

      // Flatten if there's a versioned subdirectory
      const contents = await fs.readdir(extractPath);
      const extractedDir = contents.find((d) => d.startsWith('memcached-'));
      if (extractedDir) {
        const srcPath = path.join(extractPath, extractedDir);
        const stat = await fs.stat(srcPath);
        if (stat.isDirectory()) {
          const files = await fs.readdir(srcPath);
          for (const file of files) {
            await fs.move(path.join(srcPath, file), path.join(extractPath, file), { overwrite: true });
          }
          await fs.remove(srcPath);
        }
      }

      // On Windows, the memcached executable is inside a 'bin' subdirectory, flatten it
      if (platform === 'win') {
        const binPath = path.join(extractPath, 'bin');
        if (await fs.pathExists(binPath)) {
          const binFiles = await fs.readdir(binPath);
          for (const file of binFiles) {
            await fs.move(path.join(binPath, file), path.join(extractPath, file), { overwrite: true });
          }
          await fs.remove(binPath);
        }
      }

      await fs.remove(downloadPath);
      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      if (error.cancelled) return { success: false, cancelled: true };
      this.managers?.log?.systemError(`Failed to download Memcached ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  // Get Memcached executable path
  getMemcachedPath(version = '1.6') {
    const platform = this.getPlatform();
    const memcachedDir = path.join(this.resourcesPath, 'memcached', version, platform);
    const memcachedExe = platform === 'win' ? 'memcached.exe' : 'memcached';
    return path.join(memcachedDir, memcachedExe);
  }
}

Object.assign(BinaryDownloadManager.prototype, binaryConfig, binaryDownload, binaryExtraction, binaryInstalled, binaryMetadata, binaryPhp, binaryProgress);

module.exports = BinaryDownloadManager;
