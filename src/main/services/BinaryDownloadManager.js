const { app } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const https = require('https');
const http = require('http');
const { pipeline } = require('stream/promises');
const { createWriteStream } = require('fs');
const { createGunzip } = require('zlib');
const tar = require('tar');
const AdmZip = require('adm-zip');
const unzipper = require('unzipper');
const { exec, spawn } = require('child_process');
const { Worker } = require('worker_threads');
const { spawnAsync } = require('../utils/SpawnUtils');

// Import centralized service configuration
const { SERVICE_VERSIONS, VERSION_PORT_OFFSETS, DEFAULT_PORTS } = require('../../shared/serviceConfig');

// Remote config URL - fetches binary versions and download URLs from GitHub
const REMOTE_CONFIG_URL = 'https://raw.githubusercontent.com/JeffGepiga/DevBoxPro/main/config/binaries.json';

class BinaryDownloadManager {
  constructor() {
    this.resourcesPath = path.join(app.getPath('userData'), 'resources');
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
            url: 'https://github.com/shivammathur/php-builder/releases/download/8.3.29/php-8.3.29-darwin-arm64.tar.gz',
            filename: 'php-8.3.29-darwin-arm64.tar.gz',
          },
          label: 'LTS',
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
        '22': {
          win: {
            url: 'https://nodejs.org/dist/v22.12.0/node-v22.12.0-win-x64.zip',
            filename: 'node-v22.12.0-win-x64.zip',
          },
          mac: {
            url: 'https://nodejs.org/dist/v22.12.0/node-v22.12.0-darwin-arm64.tar.gz',
            filename: 'node-v22.12.0-darwin-arm64.tar.gz',
          },
          label: 'Current',
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
            url: 'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/PortableGit-2.47.1.2-64-bit.7z.exe',
            filename: 'PortableGit-2.47.1.2-64-bit.7z.exe',
          },
          mac: {
            // On macOS, Git is typically installed via Xcode Command Line Tools or Homebrew
            url: 'builtin',
            note: 'Install via: xcode-select --install or brew install git',
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
          win: { url: 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip', filename: 'python-3.11.9-embed-amd64.zip' },
          mac: { url: 'https://www.python.org/ftp/python/3.11.12/Python-3.11.12.tgz', filename: 'Python-3.11.12.tgz' },
          linux: { url: 'https://www.python.org/ftp/python/3.11.12/Python-3.11.12.tgz', filename: 'Python-3.11.12.tgz' },
          label: 'Stable',
        },
        '3.10': {
          win: { url: 'https://www.python.org/ftp/python/3.10.13/python-3.10.13-embed-amd64.zip', filename: 'python-3.10.13-embed-amd64.zip' },
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
    this.localConfigPath = path.join(app.getPath('userData'), 'binaries-config.json');
  }

  getPlatform() {
    if (process.platform === 'win32') return 'win';
    if (process.platform === 'darwin') return 'mac';
    return 'linux';
  }

  // Fetch remote config from GitHub to check for binary updates
  async checkForUpdates() {
    try {
      // Checking for binary updates

      const remoteConfig = await this.fetchRemoteConfig();
      if (!remoteConfig) {
        return { success: false, error: 'Failed to fetch remote config' };
      }

      this.remoteConfig = remoteConfig;
      this.lastRemoteCheck = new Date().toISOString();

      // Check if remote version is newer
      const isNewerVersion = this.isVersionNewer(remoteConfig.version, this.configVersion);

      // Compare versions and find updates (for display purposes)
      const updates = this.compareConfigs(remoteConfig);

      return {
        success: true,
        configVersion: remoteConfig.version,
        currentVersion: this.configVersion,
        lastUpdated: remoteConfig.lastUpdated,
        updates,
        // Only show updates if remote version is newer
        hasUpdates: isNewerVersion
      };
    } catch (error) {
      this.managers?.log?.systemError('Error checking for updates', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  // Check if version1 is newer than version2 (semver comparison)
  isVersionNewer(version1, version2) {
    if (!version1 || !version2 || version2 === 'built-in') return true;
    if (version1 === version2) return false;

    const v1Parts = version1.split('.').map(p => parseInt(p, 10) || 0);
    const v2Parts = version2.split('.').map(p => parseInt(p, 10) || 0);

    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
      const p1 = v1Parts[i] || 0;
      const p2 = v2Parts[i] || 0;
      if (p1 > p2) return true;
      if (p1 < p2) return false;
    }
    return false;
  }

  // Fetch remote config JSON from GitHub
  async fetchRemoteConfig() {
    return new Promise((resolve, reject) => {
      https.get(REMOTE_CONFIG_URL, {
        headers: { 'User-Agent': 'DevBoxPro' }
      }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: Failed to fetch config`));
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const config = JSON.parse(data);
            resolve(config);
          } catch (e) {
            reject(new Error('Invalid JSON in remote config'));
          }
        });
      }).on('error', reject);
    });
  }

  // Compare remote config with current downloads to find updates
  compareConfigs(remoteConfig) {
    const updates = [];
    const platform = this.getPlatform();

    for (const [serviceName, serviceData] of Object.entries(remoteConfig)) {
      if (serviceName === 'version' || serviceName === 'lastUpdated') continue;

      const currentService = this.downloads[serviceName];
      if (!currentService) continue;

      const remoteDownloads = serviceData.downloads || {};

      for (const [version, versionData] of Object.entries(remoteDownloads)) {
        const currentVersion = currentService[version];
        const remotePlatformData = versionData[platform] || versionData.all;

        if (!remotePlatformData || remotePlatformData.url === 'manual' || remotePlatformData.url === 'builtin') {
          continue;
        }

        if (!currentVersion) {
          // New version available
          updates.push({
            service: serviceName,
            version,
            type: 'new_version',
            label: versionData.label || null,
            newUrl: remotePlatformData.url,
            newFilename: remotePlatformData.filename
          });
        } else {
          const currentPlatformData = currentVersion[platform] || currentVersion.all;
          if (currentPlatformData && remotePlatformData.url !== currentPlatformData.url) {
            // Updated download URL (likely new patch version)
            updates.push({
              service: serviceName,
              version,
              type: 'updated',
              label: versionData.label || currentVersion.label || null,
              oldFilename: currentPlatformData.filename,
              newFilename: remotePlatformData.filename,
              newUrl: remotePlatformData.url
            });
          }
        }
      }
    }

    return updates;
  }

  // Apply remote config updates to the downloads object and save to disk
  async applyUpdates() {
    if (!this.remoteConfig) {
      return { success: false, error: 'No remote config loaded. Run checkForUpdates first.' };
    }

    try {
      // Apply config to in-memory downloads
      const appliedCount = await this.applyConfigToDownloads(this.remoteConfig);

      // Update the current config version
      this.configVersion = this.remoteConfig.version;

      // Save to local cache for persistence
      await this.saveCachedConfig(this.remoteConfig);

      // Binary config updates applied
      return { success: true, appliedCount, version: this.configVersion };
    } catch (error) {
      this.managers?.log?.systemError('Error applying updates', { error: error.message });
      return { success: false, error: error.message };
    }
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

  // Load bundled config/binaries.json from the app directory
  // This is the single source of truth for default versions and download URLs
  async loadBundledConfig() {
    try {
      // In development: config/ is at project root
      // In production: config/ is bundled inside app.asar
      const appPath = app.getAppPath();
      const bundledConfigPath = path.join(appPath, 'config', 'binaries.json');

      if (await fs.pathExists(bundledConfigPath)) {
        const bundledConfig = await fs.readJson(bundledConfigPath);
        await this.applyConfigToDownloads(bundledConfig);
        this.configVersion = bundledConfig.version || 'bundled';
        return true;
      }
    } catch (error) {
      this.managers?.log?.systemWarn('Failed to load bundled binary config', { error: error.message });
    }
    return false;
  }

  // Load cached binary config from local storage
  async loadCachedConfig() {
    try {
      if (await fs.pathExists(this.localConfigPath)) {
        const cachedData = await fs.readJson(this.localConfigPath);

        if (cachedData && cachedData.config) {
          // Loading cached binary config

          // Apply cached config
          this.remoteConfig = cachedData.config;
          this.configVersion = cachedData.config.version; // Restore the version
          await this.applyConfigToDownloads(cachedData.config);

          return true;
        }
      }
    } catch (error) {
      this.managers?.log?.systemWarn('Failed to load cached binary config', { error: error.message });
    }
    return false;
  }

  // Save config to local cache
  async saveCachedConfig(config) {
    try {
      const cacheData = {
        savedAt: new Date().toISOString(),
        config: config
      };
      await fs.writeJson(this.localConfigPath, cacheData, { spaces: 2 });
      // Saved binary config to cache
      return true;
    } catch (error) {
      this.managers?.log?.systemError('Failed to save binary config cache', { error: error.message });
      return false;
    }
  }

  // Apply config object to downloads (shared logic for load and apply)
  async applyConfigToDownloads(config) {
    const platform = this.getPlatform();
    let appliedCount = 0;

    for (const [serviceName, serviceData] of Object.entries(config)) {
      if (serviceName === 'version' || serviceName === 'lastUpdated') continue;

      if (!this.downloads[serviceName]) {
        this.downloads[serviceName] = {};
      }

      const remoteDownloads = serviceData.downloads || {};

      for (const [version, versionData] of Object.entries(remoteDownloads)) {
        const remotePlatformData = versionData[platform] || versionData.all;

        if (!remotePlatformData || remotePlatformData.url === 'manual' || remotePlatformData.url === 'builtin') {
          continue;
        }

        // Update or create version entry
        if (!this.downloads[serviceName][version]) {
          this.downloads[serviceName][version] = {};
        }

        const targetKey = versionData.all ? 'all' : platform;
        this.downloads[serviceName][version][targetKey] = {
          url: remotePlatformData.url,
          filename: remotePlatformData.filename
        };

        if (versionData.label) {
          this.downloads[serviceName][version].label = versionData.label;
        }

        appliedCount++;
      }

      // Update version meta
      if (serviceData.versions && Array.isArray(serviceData.versions)) {
        this.versionMeta[serviceName] = serviceData.versions;
      }
    }

    return appliedCount;
  }

  // Enable common extensions in all installed PHP versions and fix configuration issues
  async enablePhpExtensions() {
    const platform = this.getPlatform();

    // Dynamically scan for all installed PHP versions (including custom imports)
    const phpBaseDir = path.join(this.resourcesPath, 'php');
    if (!await fs.pathExists(phpBaseDir)) {
      return;
    }

    const versionDirs = await fs.readdir(phpBaseDir);

    for (const version of versionDirs) {
      // Skip non-directory entries and platform folders from old structure
      if (version === 'win' || version === 'mac' || version === 'downloads') continue;

      const phpPath = path.join(this.resourcesPath, 'php', version, platform);
      const iniPath = path.join(phpPath, 'php.ini');

      if (await fs.pathExists(iniPath)) {
        try {
          let iniContent = await fs.readFile(iniPath, 'utf8');
          let modified = false;

          // Check if extension_dir is properly set
          const extDir = path.join(phpPath, 'ext').replace(/\\/g, '/');
          if (!iniContent.includes('extension_dir')) {
            // Add extension_dir after [PHP]
            iniContent = iniContent.replace('[PHP]', `[PHP]\nextension_dir = "${extDir}"`);
            modified = true;
          } else if (!iniContent.includes(extDir)) {
            // Update extension_dir
            iniContent = iniContent.replace(/extension_dir\s*=\s*"[^"]*"/g, `extension_dir = "${extDir}"`);
            modified = true;
          }

          // Ensure CA certificate bundle exists and is configured (Windows)
          if (platform === 'win') {
            const cacertPath = await this.ensureCaCertBundle(phpPath);
            if (cacertPath) {
              // Add or update curl.cainfo
              if (!iniContent.includes('curl.cainfo')) {
                // Add [curl] section if not exists
                if (!iniContent.includes('[curl]')) {
                  iniContent += `\n[curl]\ncurl.cainfo = "${cacertPath}"\n`;
                } else {
                  iniContent = iniContent.replace('[curl]', `[curl]\ncurl.cainfo = "${cacertPath}"`);
                }
                modified = true;
              }
              // Add or update openssl.cafile
              if (!iniContent.includes('openssl.cafile')) {
                if (!iniContent.includes('[openssl]')) {
                  iniContent += `\n[openssl]\nopenssl.cafile = "${cacertPath}"\n`;
                } else {
                  iniContent = iniContent.replace('[openssl]', `[openssl]\nopenssl.cafile = "${cacertPath}"`);
                }
                modified = true;
              }
            }
          }

          // Fix extension format for Windows (add php_ prefix and .dll suffix if missing)
          // Also comment out extensions that don't exist to prevent warnings
          if (platform === 'win') {
            const extensions = ['curl', 'fileinfo', 'gd', 'mbstring', 'mysqli', 'openssl', 'pdo_mysql', 'pdo_sqlite', 'sqlite3', 'zip'];

            for (const ext of extensions) {
              const extensionDll = `php_${ext}.dll`;
              const extPath = path.join(extDir.replace(/\//g, path.sep), extensionDll);
              const extensionExists = await fs.pathExists(extPath);
              const extensionLine = `extension=${extensionDll}`;
              const commentedLine = `; extension=${extensionDll} ; Not available`;

              // Check if extension line exists (enabled or not)
              const enabledPattern = new RegExp(`^extension=(?:php_)?${ext}(?:\\.dll)?\\s*$`, 'gm');
              const commentedPattern = new RegExp(`^;\\s*extension=(?:php_)?${ext}(?:\\.dll)?.*$`, 'gm');

              if (extensionExists) {
                // Extension exists - ensure it's enabled
                if (!iniContent.match(enabledPattern)) {
                  // Not enabled - check if commented
                  if (iniContent.match(commentedPattern)) {
                    // Uncomment and fix format
                    iniContent = iniContent.replace(commentedPattern, extensionLine);
                    modified = true;
                  }
                } else if (!iniContent.includes(extensionLine)) {
                  // Enabled but wrong format - fix it
                  iniContent = iniContent.replace(enabledPattern, extensionLine);
                  modified = true;
                }
              } else {
                // Extension doesn't exist - comment it out to prevent warnings
                if (iniContent.match(enabledPattern)) {
                  iniContent = iniContent.replace(enabledPattern, commentedLine);
                  modified = true;
                  // Disabled missing extension
                }
              }
            }
          }

          if (modified) {
            await fs.writeFile(iniPath, iniContent);
            // Fixed php.ini for PHP version
          }
        } catch (error) {
          this.managers?.log?.systemWarn(`Could not update php.ini for PHP ${version}`, { error: error.message });
        }
      }
    }
  }

  addProgressListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  emitProgress(id, progress) {
    // Always emit status changes immediately (starting, completed, error)
    // But throttle progress updates for downloading AND extracting
    const isProgressUpdate = (progress.status === 'downloading' || progress.status === 'extracting') &&
      progress.progress !== 0 && progress.progress !== 100;

    if (!isProgressUpdate) {
      this.downloadProgress.set(id, progress);
      this.lastProgressEmit.delete(id); // Clear throttle tracking
      this.listeners.forEach((cb) => cb(id, progress));

      // Clean up completed/errored downloads after emitting
      if (progress.status === 'completed' || progress.status === 'error') {
        setTimeout(() => {
          this.downloadProgress.delete(id);
          this.lastProgressEmit.delete(id);
        }, 1000);
      }
      return;
    }

    // Throttle downloading/extracting progress updates
    const now = Date.now();
    const last = this.lastProgressEmit.get(id);
    const currentProgress = progress.progress || 0;

    // Check if we should emit this update
    const timeSinceLast = last ? (now - last.time) : Infinity;
    const progressDelta = last ? Math.abs(currentProgress - last.progress) : Infinity;

    // Emit if: enough time passed OR significant progress change OR first update
    if (timeSinceLast >= this.progressThrottleMs || progressDelta >= this.progressMinDelta || !last) {
      this.downloadProgress.set(id, progress);
      this.lastProgressEmit.set(id, { time: now, progress: currentProgress });
      this.listeners.forEach((cb) => cb(id, progress));
    }
  }

  // Get currently active downloads (in progress, not completed/errored)
  getActiveDownloads() {
    const active = {};
    for (const [id, progress] of this.downloadProgress.entries()) {
      if (progress.status !== 'completed' && progress.status !== 'error') {
        active[id] = progress;
      }
    }
    return active;
  }

  async getInstalledBinaries() {
    const platform = this.getPlatform();
    const installed = {
      php: {},
      mysql: {},
      mariadb: {},
      redis: {},
      mailpit: false,
      phpmyadmin: false,
      nginx: {},
      apache: {},
      nodejs: {},
      composer: false,
      git: false,
    };

    // Check PHP versions - requires both php.exe and php-cgi.exe for a complete installation
    for (const version of this.versionMeta.php) {
      const phpPath = path.join(this.resourcesPath, 'php', version, platform);
      const phpExe = platform === 'win' ? 'php.exe' : 'php';
      const phpCgiExe = platform === 'win' ? 'php-cgi.exe' : 'php-cgi';
      const phpExists = await fs.pathExists(path.join(phpPath, phpExe));
      const phpCgiExists = await fs.pathExists(path.join(phpPath, phpCgiExe));
      installed.php[version] = phpExists && phpCgiExists;
    }
    // Also scan for custom PHP versions (requires both php and php-cgi)
    await this.scanCustomPhpVersions(installed.php, platform);

    // Check MySQL versions
    for (const version of this.versionMeta.mysql) {
      const mysqlPath = path.join(this.resourcesPath, 'mysql', version, platform, 'bin');
      const mysqlExe = platform === 'win' ? 'mysqld.exe' : 'mysqld';
      installed.mysql[version] = await fs.pathExists(path.join(mysqlPath, mysqlExe));
    }
    // Also scan for custom MySQL versions
    await this.scanCustomVersions('mysql', installed.mysql, platform, platform === 'win' ? 'bin/mysqld.exe' : 'bin/mysqld');

    // Check MariaDB versions
    for (const version of this.versionMeta.mariadb) {
      const mariadbPath = path.join(this.resourcesPath, 'mariadb', version, platform, 'bin');
      const mariadbExe = platform === 'win' ? 'mariadbd.exe' : 'mariadbd';
      installed.mariadb[version] = await fs.pathExists(path.join(mariadbPath, mariadbExe));
    }
    // Also scan for custom MariaDB versions
    await this.scanCustomVersions('mariadb', installed.mariadb, platform, platform === 'win' ? 'bin/mariadbd.exe' : 'bin/mariadbd');

    // Check Redis versions
    for (const version of this.versionMeta.redis) {
      const redisPath = path.join(this.resourcesPath, 'redis', version, platform);
      const redisExe = platform === 'win' ? 'redis-server.exe' : 'redis-server';
      installed.redis[version] = await fs.pathExists(path.join(redisPath, redisExe));
    }
    // Also scan for custom Redis versions using recursive scanner
    const redisExe = platform === 'win' ? 'redis-server.exe' : 'redis-server';
    await this.scanBinaryVersionsRecursive('redis', installed.redis, platform, redisExe);


    // Check Mailpit
    const mailpitPath = path.join(this.resourcesPath, 'mailpit', platform);
    const mailpitExe = platform === 'win' ? 'mailpit.exe' : 'mailpit';
    installed.mailpit = await fs.pathExists(path.join(mailpitPath, mailpitExe));

    // Check phpMyAdmin
    const pmaPath = path.join(this.resourcesPath, 'phpmyadmin', 'index.php');
    installed.phpmyadmin = await fs.pathExists(pmaPath);

    // Check Nginx versions
    for (const version of this.versionMeta.nginx) {
      const nginxPath = path.join(this.resourcesPath, 'nginx', version, platform);
      const nginxExe = platform === 'win' ? 'nginx.exe' : 'nginx';
      installed.nginx[version] = await fs.pathExists(path.join(nginxPath, nginxExe));
    }
    // Also scan for custom Nginx versions using recursive scanner
    const nginxExe = platform === 'win' ? 'nginx.exe' : 'nginx';
    await this.scanBinaryVersionsRecursive('nginx', installed.nginx, platform, nginxExe);

    // Check Apache versions
    for (const version of this.versionMeta.apache) {
      const apachePath = path.join(this.resourcesPath, 'apache', version, platform);
      const apacheExe = platform === 'win' ? 'bin/httpd.exe' : 'bin/httpd';
      installed.apache[version] = await fs.pathExists(path.join(apachePath, apacheExe));
    }
    // Also scan for custom Apache versions
    await this.scanCustomVersions('apache', installed.apache, platform, platform === 'win' ? 'bin/httpd.exe' : 'bin/httpd');

    // Check Node.js versions
    for (const version of this.versionMeta.nodejs) {
      const nodePath = path.join(this.resourcesPath, 'nodejs', version, platform);
      const nodeExe = platform === 'win' ? 'node.exe' : 'bin/node';
      installed.nodejs[version] = await fs.pathExists(path.join(nodePath, nodeExe));
    }
    // Also scan for custom Node.js versions using recursive scanner
    const nodeExe = platform === 'win' ? 'node.exe' : 'node';
    await this.scanBinaryVersionsRecursive('nodejs', installed.nodejs, platform, nodeExe);

    // Check Composer
    const composerPath = path.join(this.resourcesPath, 'composer', 'composer.phar');
    installed.composer = await fs.pathExists(composerPath);

    // Check Git (Portable Git)
    const gitPath = path.join(this.resourcesPath, 'git', platform);
    const gitExe = platform === 'win' ? 'cmd/git.exe' : 'bin/git';
    installed.git = await fs.pathExists(path.join(gitPath, gitExe));

    // Check PostgreSQL versions
    installed.postgresql = {};
    for (const version of (this.versionMeta.postgresql || [])) {
      const pgPath = path.join(this.resourcesPath, 'postgresql', version, platform, 'bin');
      const pgExe = platform === 'win' ? 'postgres.exe' : 'postgres';
      installed.postgresql[version] = await fs.pathExists(path.join(pgPath, pgExe));
    }

    // Check Python versions
    installed.python = {};
    for (const version of (this.versionMeta.python || [])) {
      const pyPath = path.join(this.resourcesPath, 'python', version, platform);
      const pyExe = platform === 'win' ? 'python.exe' : 'bin/python3';
      installed.python[version] = await fs.pathExists(path.join(pyPath, pyExe));
    }

    // Check MongoDB versions
    installed.mongodb = {};
    for (const version of (this.versionMeta.mongodb || [])) {
      const mongoPath = path.join(this.resourcesPath, 'mongodb', version, platform, 'bin');
      const mongoExe = platform === 'win' ? 'mongod.exe' : 'mongod';
      installed.mongodb[version] = await fs.pathExists(path.join(mongoPath, mongoExe));
    }

    // Check SQLite (single version, CLI tools)
    const sqlitePath = path.join(this.resourcesPath, 'sqlite', '3', platform);
    const sqliteExe = platform === 'win' ? 'sqlite3.exe' : 'sqlite3';
    const sqliteBuiltin = platform !== 'win'; // macOS/Linux have it built in
    installed.sqlite = sqliteBuiltin || await fs.pathExists(path.join(sqlitePath, sqliteExe));

    // Check MinIO (single executable)
    const minioPath = path.join(this.resourcesPath, 'minio', platform);
    const minioExe = platform === 'win' ? 'minio.exe' : 'minio';
    installed.minio = await fs.pathExists(path.join(minioPath, minioExe));

    // Check Memcached versions
    installed.memcached = {};
    for (const version of (this.versionMeta.memcached || [])) {
      const memcachedPath = path.join(this.resourcesPath, 'memcached', version, platform);
      const memcachedExe = platform === 'win' ? 'memcached.exe' : 'memcached';
      installed.memcached[version] = await fs.pathExists(path.join(memcachedPath, memcachedExe));
    }

    return installed;
  }

  // Scan for custom imported versions not in the predefined list
  async scanCustomVersions(serviceName, installedObj, platform, exePath) {
    try {
      const serviceDir = path.join(this.resourcesPath, serviceName);
      if (!await fs.pathExists(serviceDir)) return;

      const dirs = await fs.readdir(serviceDir);
      for (const dir of dirs) {
        // Skip if already checked (predefined version) or if it's the platform folder (old structure)
        if (installedObj[dir] !== undefined || dir === 'win' || dir === 'mac') continue;

        const fullPath = path.join(serviceDir, dir, platform, exePath);
        if (await fs.pathExists(fullPath)) {
          installedObj[dir] = true;
        }
      }
    } catch (error) {
      this.managers?.log?.systemWarn(`Error scanning custom ${serviceName} versions`, { error: error.message });
    }
  }

  // Special method for PHP that checks for both php and php-cgi
  async scanCustomPhpVersions(installedObj, platform) {
    try {
      const serviceDir = path.join(this.resourcesPath, 'php');
      if (!await fs.pathExists(serviceDir)) return;

      const phpExe = platform === 'win' ? 'php.exe' : 'php';
      const phpCgiExe = platform === 'win' ? 'php-cgi.exe' : 'php-cgi';

      const dirs = await fs.readdir(serviceDir);
      for (const dir of dirs) {
        // Skip if already checked (predefined version) or if it's the platform folder (old structure)
        if (installedObj[dir] !== undefined || dir === 'win' || dir === 'mac') continue;

        const phpPath = path.join(serviceDir, dir, platform, phpExe);
        const phpCgiPath = path.join(serviceDir, dir, platform, phpCgiExe);

        const phpExists = await fs.pathExists(phpPath);
        const phpCgiExists = await fs.pathExists(phpCgiPath);

        // Only mark as installed if both executables exist
        if (phpExists && phpCgiExists) {
          installedObj[dir] = true;
        }
      }
    } catch (error) {
      this.managers?.log?.systemWarn('Error scanning custom PHP versions', { error: error.message });
    }
  }

  // Universal recursive scanner for binaries that may be in nested directory structures
  // This handles both standard paths and nested directories from archive extraction
  // Used for: Redis, Nginx, Node.js, and any other services with potential nesting
  async scanBinaryVersionsRecursive(serviceName, installedObj, platform, exeName, maxDepth = 2) {
    try {
      const serviceDir = path.join(this.resourcesPath, serviceName);
      if (!await fs.pathExists(serviceDir)) return;

      const dirs = await fs.readdir(serviceDir);
      for (const dir of dirs) {
        // Skip if already checked (predefined version) or if it's the platform folder (old structure)
        if (installedObj[dir] !== undefined || dir === 'win' || dir === 'mac') continue;

        // First check the standard path: {service}/{version}/{platform}/{exeName}
        const standardPath = path.join(serviceDir, dir, platform, exeName);
        if (await fs.pathExists(standardPath)) {
          installedObj[dir] = true;
          continue;
        }

        // If not found in standard path, recursively search up to maxDepth levels deep
        // This handles cases where extraction creates nested directories
        const versionPlatformDir = path.join(serviceDir, dir, platform);
        if (await fs.pathExists(versionPlatformDir)) {
          const found = await this.findExecutableRecursive(versionPlatformDir, exeName, 0, maxDepth);
          if (found) {
            installedObj[dir] = true;
          }
        }
      }
    } catch (error) {
      this.managers?.log?.systemWarn(`Error scanning ${serviceName} versions`, { error: error.message });
    }
  }

  // Recursively search for executable in directory tree

  // maxDepth controls how many levels deep we search (prevents infinite loops)
  async findExecutableRecursive(dir, exeName, currentDepth, maxDepth) {
    if (currentDepth > maxDepth) return false;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      // First check if the executable exists in current directory
      for (const entry of entries) {
        if (entry.isFile() && entry.name === exeName) {
          return true;
        }
      }

      // If not found, recursively check subdirectories
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subDir = path.join(dir, entry.name);
          const found = await this.findExecutableRecursive(subDir, exeName, currentDepth + 1, maxDepth);
          if (found) return true;
        }
      }
    } catch (error) {
      // Ignore errors for individual directories (permissions, etc.)
    }

    return false;
  }


  async downloadFile(url, destPath, id, retryWithoutVerify = false) {
    // Ensure the directory exists before downloading
    await fs.ensureDir(path.dirname(destPath));

    return new Promise((resolve, reject) => {
      const file = createWriteStream(destPath);
      const protocol = url.startsWith('https') ? https : http;
      const parsedUrl = new URL(url);

      // Store reject function for cancellation
      const downloadInfo = { request: null, file, reject, destPath };
      this.activeDownloads.set(id, downloadInfo);

      // Build request options with SSL fallback for Windows
      const requestOptions = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/octet-stream, application/zip, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Host': parsedUrl.host,
        },
      };

      // Add SSL fallback agent for Windows certificate issues
      if (url.startsWith('https')) {
        requestOptions.agent = new https.Agent({
          rejectUnauthorized: !retryWithoutVerify
        });
      }

      const request = protocol.get(url, requestOptions, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 303 || response.statusCode === 307) {
          file.close();
          try { fs.unlinkSync(destPath); } catch (e) { /* ignore */ }
          const redirectUrl = response.headers.location.startsWith('http')
            ? response.headers.location
            : new URL(response.headers.location, url).toString();
          return this.downloadFile(redirectUrl, destPath, id)
            .then(resolve)
            .catch(reject);
        }

        if (response.statusCode !== 200) {
          file.close();
          try { fs.unlinkSync(destPath); } catch (e) { /* ignore */ }
          reject(new Error(`Download failed with status ${response.statusCode}`));
          return;
        }

        // Check if we're getting HTML instead of binary (common with blocked downloads)
        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('text/html') && !destPath.endsWith('.html')) {
          file.close();
          try { fs.unlinkSync(destPath); } catch (e) { /* ignore */ }
          reject(new Error('Server returned HTML instead of binary. Download may be blocked or URL may be invalid.'));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10) || 0;
        let downloadedSize = 0;

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          const progress = totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0;
          this.emitProgress(id, {
            status: 'downloading',
            progress,
            downloaded: downloadedSize,
            total: totalSize,
          });
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          this.activeDownloads.delete(id);
          resolve(destPath);
        });
      });

      // Store the request reference for cancellation
      downloadInfo.request = request;

      request.on('error', (err) => {
        file.close();
        this.activeDownloads.delete(id);
        fs.unlink(destPath, () => { });
        // Don't reject if this was a user-initiated cancellation
        if (this.cancelledDownloads.has(id)) {
          this.cancelledDownloads.delete(id);
          const cancelError = new Error('Download cancelled');
          cancelError.cancelled = true;
          reject(cancelError);
        } else {
          // Check if SSL certificate error and retry without verification
          const isSSLError = err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
            err.code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' ||
            err.code === 'CERT_HAS_EXPIRED' ||
            err.message.includes('certificate') ||
            err.message.includes('SSL');

          if (!retryWithoutVerify && isSSLError) {
            this.managers?.log?.systemWarn(`SSL certificate error for ${id}, retrying without verification`, { error: err.message });
            // Retry download without SSL verification
            this.downloadFile(url, destPath, id, true)
              .then(resolve)
              .catch(reject);
            return;
          }

          // Provide user-friendly error messages for common network errors
          let userMessage = err.message;
          if (err.code === 'ENOTFOUND') {
            userMessage = 'Cannot reach download server. Check your internet connection.';
          } else if (err.code === 'ECONNREFUSED') {
            userMessage = 'Connection refused. Server may be down or blocked by firewall.';
          } else if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
            userMessage = 'Connection timed out. Check your internet or firewall settings.';
          } else if (err.code === 'ECONNRESET') {
            userMessage = 'Connection was reset. This may be caused by a firewall or proxy.';
          } else if (err.code === 'CERT_HAS_EXPIRED' || err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
            userMessage = 'SSL certificate error. Check your system date/time or antivirus settings.';
          } else if (err.code === 'EACCES' || err.code === 'EPERM') {
            userMessage = 'Permission denied. Run as administrator or check antivirus.';
          }

          // Log error to system logs
          this.managers?.log?.systemError(`Download failed for ${id}`, {
            url,
            error: err.message,
            code: err.code
          });

          const networkError = new Error(userMessage);
          networkError.code = err.code;
          networkError.originalError = err.message;
          reject(networkError);
        }
      });

      file.on('error', (err) => {
        file.close();
        this.activeDownloads.delete(id);
        fs.unlink(destPath, () => { });
        // Don't reject if this was a user-initiated cancellation
        if (this.cancelledDownloads.has(id)) {
          this.cancelledDownloads.delete(id);
          const cancelError = new Error('Download cancelled');
          cancelError.cancelled = true;
          reject(cancelError);
        } else {
          reject(err);
        }
      });
    });
  }

  /**
   * Cancel an active download or extraction
   * @param {string} id - The download ID
   * @returns {boolean} - True if a download/extraction was cancelled, false otherwise
   */
  cancelDownload(id) {
    let cancelled = false;

    // Check for active download
    const downloadInfo = this.activeDownloads.get(id);
    if (downloadInfo) {
      // Cancelling download

      try {
        // Destroy the HTTP request to abort the download
        if (downloadInfo.request) {
          downloadInfo.request.destroy();
        }

        // Close the file stream
        if (downloadInfo.file) {
          downloadInfo.file.close();
        }

        // Delete the partial file
        if (downloadInfo.destPath) {
          fs.unlink(downloadInfo.destPath, () => { });
        }

        // Note: We don't reject the promise here - just clean up silently
        // The UI is updated via emitProgress with 'cancelled' status
      } catch (error) {
        this.managers?.log?.systemError(`Error cancelling download for ${id}`, { error: error.message });
      }

      this.activeDownloads.delete(id);
      cancelled = true;
    }

    // Check for active extraction worker
    const workerInfo = this.activeWorkers.get(id);
    if (workerInfo) {
      // Cancelling extraction

      try {
        // Terminate the worker thread
        if (workerInfo.worker) {
          workerInfo.worker.terminate();
        }

        // Clean up partially extracted files
        if (workerInfo.destPath) {
          fs.remove(workerInfo.destPath, () => { });
        }

        // Note: We don't reject the promise here - just clean up silently
      } catch (error) {
        this.managers?.log?.systemError(`Error cancelling extraction for ${id}`, { error: error.message });
      }

      this.activeWorkers.delete(id);
      cancelled = true;
    }

    if (!cancelled) {
      // No active download or extraction to cancel
      return false;
    }

    // Mark as cancelled so extraction doesn't attempt to run
    this.cancelledDownloads.add(id);

    // Clean up tracking
    this.downloadProgress.delete(id);
    this.lastProgressEmit.delete(id);

    // Emit cancelled status
    this.emitProgress(id, { status: 'cancelled', progress: 0 }, true);

    return true;
  }

  /**
   * Check if a download was cancelled and throw if so
   * @param {string} id - The download ID
   * @param {string} downloadPath - Path to clean up if cancelled
   * @throws {Error} CancelledError if the download was cancelled
   */
  async checkCancelled(id, downloadPath = null) {
    if (this.cancelledDownloads.has(id)) {
      this.cancelledDownloads.delete(id);
      if (downloadPath) {
        await fs.remove(downloadPath).catch(() => { });
      }
      const error = new Error('Download cancelled');
      error.cancelled = true;
      throw error;
    }
  }

  async extractArchive(archivePath, destPath, id) {
    this.emitProgress(id, { status: 'extracting', progress: 0 });

    const ext = path.extname(archivePath).toLowerCase();
    const basename = path.basename(archivePath).toLowerCase();

    await fs.ensureDir(destPath);

    if (ext === '.zip') {
      // Validate ZIP file before extraction
      const isValidZip = await this.validateZipFile(archivePath);
      if (!isValidZip) {
        // Check if it's actually HTML
        const fileStart = await fs.readFile(archivePath, { encoding: 'utf8', flag: 'r' }).catch(() => '');
        const first500 = fileStart.slice(0, 500).toLowerCase();
        if (first500.includes('<!doctype') || first500.includes('<html')) {
          throw new Error('Downloaded file is HTML instead of ZIP. The download source may be blocking automated downloads or the URL is invalid.');
        }
        throw new Error('Invalid ZIP file. The download may have been corrupted or blocked.');
      }
      // Use async extraction to avoid blocking the UI
      await this.extractZipAsync(archivePath, destPath, id);
    } else if (basename.endsWith('.tar.gz') || ext === '.tgz') {
      await tar.x({
        file: archivePath,
        cwd: destPath,
        strip: 1, // Remove top-level directory
      });
    }

    this.emitProgress(id, { status: 'extracting', progress: 100 });
  }

  async validateZipFile(filePath) {
    try {
      // Read first 4 bytes - ZIP files start with PK (0x50 0x4B)
      // Use fs.read with a callback-style approach since fs-extra.open returns fd number
      const buffer = Buffer.alloc(4);
      const fd = await fs.open(filePath, 'r');
      await new Promise((resolve, reject) => {
        require('fs').read(fd, buffer, 0, 4, 0, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      await fs.close(fd);
      // Check for ZIP magic number: PK\x03\x04 or PK\x05\x06 (empty) or PK\x07\x08 (spanned)
      const isValid = buffer[0] === 0x50 && buffer[1] === 0x4B;
      // ZIP validation completed
      return isValid;
    } catch (err) {
      this.managers?.log?.systemError('Error validating ZIP file', { error: err.message });
      return false;
    }
  }

  async extractZipAsync(archivePath, destPath, id) {
    return new Promise((resolve, reject) => {
      try {
        // Use worker thread to prevent UI freeze
        const workerPath = path.join(__dirname, 'extractWorker.js');

        const worker = new Worker(workerPath, {
          workerData: { archivePath, destPath }
        });

        // Track the worker for cancellation support
        this.activeWorkers.set(id, { worker, reject, destPath });

        worker.on('message', (message) => {
          if (message.type === 'progress') {
            this.emitProgress(id, { status: 'extracting', progress: message.progress });
          } else if (message.type === 'done') {
            this.activeWorkers.delete(id);
            resolve();
          } else if (message.type === 'error') {
            this.activeWorkers.delete(id);
            reject(new Error(message.error));
          }
        });

        worker.on('error', (error) => {
          this.activeWorkers.delete(id);
          reject(error);
        });

        worker.on('exit', (code) => {
          this.activeWorkers.delete(id);
          if (code !== 0) {
            reject(new Error(`Worker stopped with exit code ${code}`));
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async downloadPhp(version) {
    const id = `php-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.php[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`PHP ${version} not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'php', version, platform);

      // Clean existing installation
      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      // Download
      await this.downloadFile(downloadInfo.url, downloadPath, id);

      // Check if cancelled before extraction
      await this.checkCancelled(id, downloadPath);

      // Extract
      await this.extractArchive(downloadPath, extractPath, id);

      // Create default php.ini
      await this.createPhpIni(extractPath, version);

      // On Windows, ensure VC++ Runtime DLLs are bundled with PHP
      if (platform === 'win') {
        await this.ensureVCRedist(extractPath);
      }

      // Cleanup download
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError(`Failed to download PHP ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  async createPhpIni(phpPath, version) {
    const platform = this.getPlatform();
    const extDir = platform === 'win' ? path.join(phpPath, 'ext').replace(/\\/g, '/') : path.join(phpPath, 'lib', 'php', 'extensions');

    // Windows uses php_ prefix for extensions
    const extPrefix = platform === 'win' ? 'php_' : '';
    const extSuffix = platform === 'win' ? '.dll' : '.so';

    // Get timezone from settings
    const settings = this.configStore?.get('settings', {}) || {};
    const timezone = settings.serverTimezone || 'UTC';

    // Download CA certificate bundle for curl/openssl if on Windows
    let cacertPath = '';
    if (platform === 'win') {
      cacertPath = await this.ensureCaCertBundle(phpPath);
    }

    // Build extension list - only include extensions that exist
    const extensions = ['curl', 'fileinfo', 'mbstring', 'openssl', 'pdo_mysql', 'pdo_sqlite', 'mysqli', 'sqlite3', 'zip', 'gd'];
    const extensionLines = [];

    for (const ext of extensions) {
      const extFile = `${extPrefix}${ext}${extSuffix}`;
      const extPath = path.join(extDir.replace(/\//g, path.sep), extFile);
      if (await fs.pathExists(extPath)) {
        extensionLines.push(`extension=${extFile}`);
      } else {
        extensionLines.push(`; extension=${extFile} ; Not available in this PHP version`);
      }
    }

    const iniContent = `[PHP]
; DevBox Pro PHP ${version} Configuration
engine = On
short_open_tag = Off
precision = 14
output_buffering = 4096
zlib.output_compression = Off
implicit_flush = Off
serialize_precision = -1
disable_functions =
disable_classes =
zend.enable_gc = On
expose_php = Off
max_execution_time = 300
max_input_time = 300
memory_limit = 512M
error_reporting = E_ALL
display_errors = On
display_startup_errors = On
log_errors = On
log_errors_max_len = 1024
ignore_repeated_errors = Off
ignore_repeated_source = Off
report_memleaks = On
variables_order = "GPCS"
request_order = "GP"
register_argc_argv = Off
auto_globals_jit = On
post_max_size = 128M
auto_prepend_file =
auto_append_file =
default_mimetype = "text/html"
default_charset = "UTF-8"
doc_root =
user_dir =
enable_dl = Off
file_uploads = On
upload_max_filesize = 128M
max_file_uploads = 20
allow_url_fopen = On
allow_url_include = Off
default_socket_timeout = 60

; Extension directory
extension_dir = "${extDir}"

[CLI Server]
cli_server.color = On

[Date]
date.timezone = ${timezone}

[Pdo_mysql]
pdo_mysql.default_socket=

[mail function]
SMTP = localhost
smtp_port = 1025
sendmail_from = devbox@localhost

[Session]
session.save_handler = files
session.use_strict_mode = 0
session.use_cookies = 1
session.use_only_cookies = 1
session.name = PHPSESSID
session.auto_start = 0
session.cookie_lifetime = 0
session.cookie_path = /
session.cookie_domain =
session.cookie_httponly = 1
session.serialize_handler = php
session.gc_probability = 1
session.gc_divisor = 1000
session.gc_maxlifetime = 1440
session.cache_limiter = nocache
session.cache_expire = 180
session.use_trans_sid = 0

[opcache]
opcache.enable=1
opcache.enable_cli=1
opcache.memory_consumption=256
opcache.interned_strings_buffer=16
opcache.max_accelerated_files=20000
opcache.validate_timestamps=1
opcache.revalidate_freq=0

[curl]
; CA certificate bundle for HTTPS connections (required for Composer)
${cacertPath ? `curl.cainfo = "${cacertPath}"` : '; curl.cainfo = '}

[openssl]
${cacertPath ? `openssl.cafile = "${cacertPath}"` : '; openssl.cafile = '}

; Extensions - enabled by default for Laravel compatibility
${extensionLines.join('\n')}
`;

    const iniPath = path.join(phpPath, 'php.ini');
    await fs.writeFile(iniPath, iniContent);
  }

  /**
   * Download and cache the CA certificate bundle for curl/openssl
   */
  async ensureCaCertBundle(phpPath) {
    const cacertPath = path.join(phpPath, 'cacert.pem').replace(/\\/g, '/');

    // Check if already exists
    if (await fs.pathExists(cacertPath)) {
      return cacertPath;
    }

    // Download from curl.se (official source)
    const cacertUrl = 'https://curl.se/ca/cacert.pem';

    try {
      // Downloading CA certificate bundle
      const response = await new Promise((resolve, reject) => {
        const https = require('https');
        https.get(cacertUrl, (res) => {
          if (res.statusCode === 200) {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
          } else {
            reject(new Error(`Failed to download CA bundle: ${res.statusCode}`));
          }
        }).on('error', reject);
      });

      await fs.writeFile(cacertPath, response);
      // CA certificate bundle downloaded
      return cacertPath;
    } catch (error) {
      this.managers?.log?.systemWarn('Could not download CA certificate bundle', { error: error.message });
      // Return empty string - PHP will still work but HTTPS may have issues
      return '';
    }
  }

  /**
   * Ensure Visual C++ Runtime DLLs are bundled with PHP on Windows
   * PHP for Windows requires vcruntime140.dll and related DLLs to run
   * We try to copy from System32 first, then download from remote as fallback
   */
  async ensureVCRedist(phpPath) {
    // Required VC++ Runtime DLLs for PHP (VS 2015-2022)
    const requiredDlls = [
      'vcruntime140.dll',
      'msvcp140.dll',
      'vcruntime140_1.dll', // Required for some PHP versions
    ];

    // Remote URL for VC++ DLLs (hosted on GitHub)
    const vcRedistBaseUrl = 'https://raw.githubusercontent.com/JeffGepiga/DevBoxPro/main/vcredist';

    // Check if DLLs already exist
    const missingDlls = [];
    for (const dll of requiredDlls) {
      const dllPath = path.join(phpPath, dll);
      if (!await fs.pathExists(dllPath)) {
        missingDlls.push(dll);
      }
    }

    if (missingDlls.length === 0) {
      // All DLLs already present
      return;
    }

    // Try to copy from Windows System32 first (fastest if available)
    const system32Path = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
    const stillMissing = [];

    for (const dll of missingDlls) {
      const systemDll = path.join(system32Path, dll);
      const destDll = path.join(phpPath, dll);

      try {
        if (await fs.pathExists(systemDll)) {
          await fs.copy(systemDll, destDll);
          this.managers?.log?.info(`[ensureVCRedist] Copied ${dll} from System32`);
        } else {
          stillMissing.push(dll);
        }
      } catch (err) {
        this.managers?.log?.systemWarn(`[ensureVCRedist] Could not copy ${dll} from System32`, { error: err.message });
        stillMissing.push(dll);
      }
    }

    // Download missing DLLs from remote
    for (const dll of stillMissing) {
      const destDll = path.join(phpPath, dll);
      const dllUrl = `${vcRedistBaseUrl}/${dll}`;

      try {
        this.managers?.log?.info(`[ensureVCRedist] Downloading ${dll} from remote...`);

        await new Promise((resolve, reject) => {
          const file = createWriteStream(destDll);
          https.get(dllUrl, (response) => {
            if (response.statusCode === 200) {
              response.pipe(file);
              file.on('finish', () => {
                file.close();
                resolve();
              });
            } else if (response.statusCode === 302 || response.statusCode === 301) {
              // Follow redirect
              https.get(response.headers.location, (res2) => {
                if (res2.statusCode === 200) {
                  res2.pipe(file);
                  file.on('finish', () => {
                    file.close();
                    resolve();
                  });
                } else {
                  reject(new Error(`Failed to download ${dll}: ${res2.statusCode}`));
                }
              }).on('error', reject);
            } else {
              reject(new Error(`Failed to download ${dll}: ${response.statusCode}`));
            }
          }).on('error', reject);
        });

        this.managers?.log?.info(`[ensureVCRedist] Downloaded ${dll} successfully`);
      } catch (err) {
        this.managers?.log?.systemWarn(`[ensureVCRedist] Could not download ${dll}`, { error: err.message });
        // Don't fail completely - PHP might still work if other DLLs are present
      }
    }
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

      // Create config file
      await this.createPhpMyAdminConfig(extractPath);

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

  async removeBinary(type, version = null) {
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

    await fs.remove(targetPath);
    return { success: true };
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

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      await this.downloadFile(downloadInfo.url, downloadPath, id);

      await this.checkCancelled(id, downloadPath);
      this.emitProgress(id, { status: 'extracting', progress: 50 });

      const nodejsPath = path.join(this.resourcesPath, 'nodejs', version, platform);
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

      // Clean up download
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'complete', progress: 100 });

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
      const npmBat = `@echo off\n"${nodeExe}" "${path.join(nodejsPath, 'node_modules', 'npm', 'bin', 'npm-cli.js')}" %*`;
      const npxBat = `@echo off\n"${nodeExe}" "${path.join(nodejsPath, 'node_modules', 'npm', 'bin', 'npx-cli.js')}" %*`;

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
      await this.downloadFile(this.downloads.composer.all.url, downloadPath, id);

      this.emitProgress(id, { status: 'installing', progress: 60 });

      // Move to composer directory
      const composerDir = path.join(this.resourcesPath, 'composer');
      await fs.ensureDir(composerDir);
      await fs.copy(downloadPath, path.join(composerDir, 'composer.phar'));

      // Create wrapper scripts
      await this.setupComposerEnvironment(composerDir);

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

module.exports = BinaryDownloadManager;
