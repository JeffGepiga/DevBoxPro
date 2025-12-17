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

class BinaryDownloadManager {
  constructor() {
    this.resourcesPath = path.join(app.getPath('userData'), 'resources');
    this.downloadProgress = new Map();
    this.listeners = new Set();
    
    // Download URLs for each binary
    this.downloads = {
      php: {
        '8.3': {
          win: {
            url: 'https://windows.php.net/downloads/releases/php-8.3.14-nts-Win32-vs16-x64.zip',
            filename: 'php-8.3.14-nts-Win32-vs16-x64.zip',
          },
          mac: {
            url: 'https://github.com/shivammathur/php-builder/releases/download/8.3.14/php-8.3.14-darwin-arm64.tar.gz',
            filename: 'php-8.3.14-darwin-arm64.tar.gz',
          },
        },
        '8.2': {
          win: {
            url: 'https://windows.php.net/downloads/releases/php-8.2.27-nts-Win32-vs16-x64.zip',
            filename: 'php-8.2.27-nts-Win32-vs16-x64.zip',
          },
          mac: {
            url: 'https://github.com/shivammathur/php-builder/releases/download/8.2.27/php-8.2.27-darwin-arm64.tar.gz',
            filename: 'php-8.2.27-darwin-arm64.tar.gz',
          },
        },
        '8.1': {
          win: {
            url: 'https://windows.php.net/downloads/releases/php-8.1.31-nts-Win32-vs16-x64.zip',
            filename: 'php-8.1.31-nts-Win32-vs16-x64.zip',
          },
          mac: {
            url: 'https://github.com/shivammathur/php-builder/releases/download/8.1.31/php-8.1.31-darwin-arm64.tar.gz',
            filename: 'php-8.1.31-darwin-arm64.tar.gz',
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
        },
      },
      mysql: {
        win: {
          url: 'https://dev.mysql.com/get/Downloads/MySQL-8.0/mysql-8.0.40-winx64.zip',
          filename: 'mysql-8.0.40-winx64.zip',
        },
        mac: {
          url: 'https://dev.mysql.com/get/Downloads/MySQL-8.0/mysql-8.0.40-macos14-arm64.tar.gz',
          filename: 'mysql-8.0.40-macos14-arm64.tar.gz',
        },
      },
      redis: {
        win: {
          url: 'https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip',
          filename: 'Redis-x64-5.0.14.1.zip',
        },
        mac: {
          url: 'https://github.com/redis/redis/archive/refs/tags/7.4.1.tar.gz',
          filename: 'redis-7.4.1.tar.gz',
          note: 'Requires compilation on macOS',
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
          url: 'https://files.phpmyadmin.net/phpMyAdmin/5.2.1/phpMyAdmin-5.2.1-all-languages.zip',
          filename: 'phpMyAdmin-5.2.1-all-languages.zip',
        },
      },
      nginx: {
        win: {
          url: 'https://nginx.org/download/nginx-1.26.2.zip',
          filename: 'nginx-1.26.2.zip',
        },
        mac: {
          url: 'https://github.com/denji/homebrew-nginx/releases/download/nginx-1.26.2/nginx-1.26.2-arm64.tar.gz',
          filename: 'nginx-1.26.2-arm64.tar.gz',
          // Note: On macOS, nginx is best installed via Homebrew
          altInstall: 'brew install nginx',
        },
      },
      apache: {
        win: {
          url: 'https://www.apachelounge.com/download/VS17/binaries/httpd-2.4.62-240904-win64-VS17.zip',
          filename: 'httpd-2.4.62-win64-VS17.zip',
        },
        mac: {
          // Apache comes pre-installed on macOS, but we provide the option
          url: 'https://github.com/nicbn/apache-httpd-releases/releases/download/2.4.62/httpd-2.4.62-macos-arm64.tar.gz',
          filename: 'httpd-2.4.62-macos-arm64.tar.gz',
          altInstall: 'brew install httpd',
        },
      },
    };
  }

  getPlatform() {
    return process.platform === 'win32' ? 'win' : 'mac';
  }

  async initialize() {
    await fs.ensureDir(this.resourcesPath);
    await fs.ensureDir(path.join(this.resourcesPath, 'php'));
    await fs.ensureDir(path.join(this.resourcesPath, 'mysql'));
    await fs.ensureDir(path.join(this.resourcesPath, 'redis'));
    await fs.ensureDir(path.join(this.resourcesPath, 'mailpit'));
    await fs.ensureDir(path.join(this.resourcesPath, 'phpmyadmin'));
    await fs.ensureDir(path.join(this.resourcesPath, 'nginx'));
    await fs.ensureDir(path.join(this.resourcesPath, 'apache'));
    await fs.ensureDir(path.join(this.resourcesPath, 'downloads'));
  }

  addProgressListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  emitProgress(id, progress) {
    this.downloadProgress.set(id, progress);
    this.listeners.forEach((cb) => cb(id, progress));
  }

  async getInstalledBinaries() {
    const platform = this.getPlatform();
    const installed = {
      php: {},
      mysql: false,
      redis: false,
      mailpit: false,
      phpmyadmin: false,
      nginx: false,
      apache: false,
    };

    // Check PHP versions
    for (const version of ['7.4', '8.0', '8.1', '8.2', '8.3']) {
      const phpPath = path.join(this.resourcesPath, 'php', version, platform);
      const phpExe = platform === 'win' ? 'php.exe' : 'php';
      installed.php[version] = await fs.pathExists(path.join(phpPath, phpExe));
    }

    // Check MySQL
    const mysqlPath = path.join(this.resourcesPath, 'mysql', platform, 'bin');
    const mysqlExe = platform === 'win' ? 'mysqld.exe' : 'mysqld';
    installed.mysql = await fs.pathExists(path.join(mysqlPath, mysqlExe));

    // Check Redis
    const redisPath = path.join(this.resourcesPath, 'redis', platform);
    const redisExe = platform === 'win' ? 'redis-server.exe' : 'redis-server';
    installed.redis = await fs.pathExists(path.join(redisPath, redisExe));

    // Check Mailpit
    const mailpitPath = path.join(this.resourcesPath, 'mailpit', platform);
    const mailpitExe = platform === 'win' ? 'mailpit.exe' : 'mailpit';
    installed.mailpit = await fs.pathExists(path.join(mailpitPath, mailpitExe));

    // Check phpMyAdmin
    const pmaPath = path.join(this.resourcesPath, 'phpmyadmin', 'index.php');
    installed.phpmyadmin = await fs.pathExists(pmaPath);

    // Check Nginx
    const nginxPath = path.join(this.resourcesPath, 'nginx', platform);
    const nginxExe = platform === 'win' ? 'nginx.exe' : 'nginx';
    installed.nginx = await fs.pathExists(path.join(nginxPath, nginxExe));

    // Check Apache
    const apachePath = path.join(this.resourcesPath, 'apache', platform);
    const apacheExe = platform === 'win' ? 'bin/httpd.exe' : 'bin/httpd';
    installed.apache = await fs.pathExists(path.join(apachePath, apacheExe));

    return installed;
  }

  async downloadFile(url, destPath, id) {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(destPath);
      const protocol = url.startsWith('https') ? https : http;

      const request = protocol.get(url, { 
        headers: { 
          'User-Agent': 'DevBox-Pro/1.0.0',
        },
      }, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          file.close();
          fs.unlinkSync(destPath);
          return this.downloadFile(response.headers.location, destPath, id)
            .then(resolve)
            .catch(reject);
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          reject(new Error(`Download failed with status ${response.statusCode}`));
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
          resolve(destPath);
        });
      });

      request.on('error', (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(err);
      });

      file.on('error', (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });
  }

  async extractArchive(archivePath, destPath, id) {
    this.emitProgress(id, { status: 'extracting', progress: 0 });

    const ext = path.extname(archivePath).toLowerCase();
    const basename = path.basename(archivePath).toLowerCase();

    await fs.ensureDir(destPath);

    if (ext === '.zip') {
      const zip = new AdmZip(archivePath);
      zip.extractAllTo(destPath, true);
    } else if (basename.endsWith('.tar.gz') || ext === '.tgz') {
      await tar.x({
        file: archivePath,
        cwd: destPath,
        strip: 1, // Remove top-level directory
      });
    }

    this.emitProgress(id, { status: 'extracting', progress: 100 });
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

      // Extract
      await this.extractArchive(downloadPath, extractPath, id);

      // Create default php.ini
      await this.createPhpIni(extractPath, version);

      // Cleanup download
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true };
    } catch (error) {
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  async createPhpIni(phpPath, version) {
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

[CLI Server]
cli_server.color = On

[Date]
date.timezone = UTC

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
session.sid_length = 26
session.sid_bits_per_character = 5

[opcache]
opcache.enable=1
opcache.enable_cli=1
opcache.memory_consumption=256
opcache.interned_strings_buffer=16
opcache.max_accelerated_files=20000
opcache.validate_timestamps=1
opcache.revalidate_freq=0

; Extensions (enable as needed)
;extension=curl
;extension=gd
;extension=mbstring
;extension=mysqli
;extension=openssl
;extension=pdo_mysql
;extension=pdo_sqlite
;extension=sqlite3
;extension=zip
`;

    const iniPath = path.join(phpPath, 'php.ini');
    await fs.writeFile(iniPath, iniContent);
  }

  async downloadMysql() {
    const id = 'mysql';
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.mysql[platform];

    if (!downloadInfo) {
      throw new Error(`MySQL not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'mysql', platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.extractArchive(downloadPath, extractPath, id);
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true };
    } catch (error) {
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  }

  async downloadRedis() {
    const id = 'redis';
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.redis[platform];

    if (!downloadInfo) {
      throw new Error(`Redis not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'redis', platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.extractArchive(downloadPath, extractPath, id);
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true };
    } catch (error) {
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
      await this.extractArchive(downloadPath, extractPath, id);
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true };
    } catch (error) {
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
      await this.extractArchive(downloadPath, extractPath, id);
      
      // Create config file
      await this.createPhpMyAdminConfig(extractPath);
      
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true };
    } catch (error) {
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

  async downloadNginx() {
    const id = 'nginx';
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.nginx[platform];

    if (!downloadInfo) {
      throw new Error(`Nginx not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'nginx', platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.extractArchive(downloadPath, extractPath, id);

      // Create default nginx config for PHP
      await this.createNginxConfig(extractPath);

      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true };
    } catch (error) {
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

  async downloadApache() {
    const id = 'apache';
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.apache[platform];

    if (!downloadInfo) {
      throw new Error(`Apache not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'apache', platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.extractArchive(downloadPath, extractPath, id);

      // Create default Apache config for PHP
      await this.createApacheConfig(extractPath);

      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true };
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

    if (type === 'php' && version) {
      targetPath = path.join(this.resourcesPath, 'php', version, platform);
    } else if (type === 'phpmyadmin') {
      targetPath = path.join(this.resourcesPath, 'phpmyadmin');
    } else {
      targetPath = path.join(this.resourcesPath, type, platform);
    }

    await fs.remove(targetPath);
    return { success: true };
  }

  getDownloadUrls() {
    const platform = this.getPlatform();
    const urls = {
      php: {},
      mysql: this.downloads.mysql[platform],
      redis: this.downloads.redis[platform],
      mailpit: this.downloads.mailpit[platform],
      phpmyadmin: this.downloads.phpmyadmin.all,
      nginx: this.downloads.nginx[platform],
      apache: this.downloads.apache[platform],
    };

    for (const version of Object.keys(this.downloads.php)) {
      urls.php[version] = this.downloads.php[version][platform];
    }

    return urls;
  }
}

module.exports = BinaryDownloadManager;
