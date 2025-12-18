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
const { exec, spawn } = require('child_process');
const { Worker } = require('worker_threads');

class BinaryDownloadManager {
  constructor() {
    this.resourcesPath = path.join(app.getPath('userData'), 'resources');
    this.downloadProgress = new Map();
    this.listeners = new Set();
    
    // Download URLs for each binary
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
          url: 'https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.7-winx64.zip',
          filename: 'mysql-8.4.7-winx64.zip',
        },
        mac: {
          url: 'https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.7-macos14-arm64.tar.gz',
          filename: 'mysql-8.4.7-macos14-arm64.tar.gz',
        },
      },
      mariadb: {
        win: {
          url: 'https://archive.mariadb.org/mariadb-11.4.9/winx64-packages/mariadb-11.4.9-winx64.zip',
          filename: 'mariadb-11.4.9-winx64.zip',
        },
        mac: {
          url: 'https://archive.mariadb.org/mariadb-11.4.9/bintar-darwin-arm64/mariadb-11.4.9-macos14-arm64.tar.gz',
          filename: 'mariadb-11.4.9-macos14-arm64.tar.gz',
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
          url: 'https://files.phpmyadmin.net/phpMyAdmin/5.2.3/phpMyAdmin-5.2.3-all-languages.zip',
          filename: 'phpMyAdmin-5.2.3-all-languages.zip',
        },
      },
      nginx: {
        win: {
          url: 'https://nginx.org/download/nginx-1.28.0.zip',
          filename: 'nginx-1.28.0.zip',
        },
        mac: {
          url: 'https://nginx.org/download/nginx-1.28.0.tar.gz',
          filename: 'nginx-1.28.0.tar.gz',
          // Note: On macOS, nginx is best installed via Homebrew
          altInstall: 'brew install nginx',
        },
      },
      apache: {
        win: {
          // Note: Apache Lounge blocks automated downloads
          // Users may need to download manually from https://www.apachelounge.com/download/
          url: 'https://www.apachelounge.com/download/VS17/binaries/httpd-2.4.62-240904-win64-VS17.zip',
          fallbackUrls: [
            'https://www.apachelounge.com/download/VS17/binaries/httpd-2.4.61-240703-win64-VS17.zip',
          ],
          filename: 'httpd-2.4.62-win64-VS17.zip',
          manualDownloadUrl: 'https://www.apachelounge.com/download/',
          manualDownloadNote: 'Apache Lounge may block automated downloads. If the download fails, please download manually.',
        },
        mac: {
          // Apache comes pre-installed on macOS, but we provide the option
          url: 'https://dlcdn.apache.org/httpd/httpd-2.4.63.tar.gz',
          filename: 'httpd-2.4.63.tar.gz',
          altInstall: 'brew install httpd',
        },
      },
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
        },
      },
      composer: {
        all: {
          url: 'https://getcomposer.org/download/2.8.4/composer.phar',
          filename: 'composer.phar',
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
    await fs.ensureDir(path.join(this.resourcesPath, 'mariadb'));
    await fs.ensureDir(path.join(this.resourcesPath, 'redis'));
    await fs.ensureDir(path.join(this.resourcesPath, 'mailpit'));
    await fs.ensureDir(path.join(this.resourcesPath, 'phpmyadmin'));
    await fs.ensureDir(path.join(this.resourcesPath, 'nginx'));
    await fs.ensureDir(path.join(this.resourcesPath, 'apache'));
    await fs.ensureDir(path.join(this.resourcesPath, 'nodejs'));
    await fs.ensureDir(path.join(this.resourcesPath, 'composer'));
    await fs.ensureDir(path.join(this.resourcesPath, 'downloads'));
    
    // Enable extensions in existing PHP installations
    await this.enablePhpExtensions();
  }

  // Enable common extensions in all installed PHP versions
  async enablePhpExtensions() {
    const platform = this.getPlatform();
    
    for (const version of ['7.4', '8.0', '8.1', '8.2', '8.3', '8.4']) {
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
          
          // Fix extension format for Windows (add php_ prefix and .dll suffix if missing)
          if (platform === 'win') {
            const extensions = ['curl', 'fileinfo', 'gd', 'mbstring', 'mysqli', 'openssl', 'pdo_mysql', 'pdo_sqlite', 'sqlite3', 'zip'];
            const missingExtensions = [];
            
            for (const ext of extensions) {
              const extensionLine = `extension=php_${ext}.dll`;
              
              // Check if extension is already properly enabled
              if (iniContent.includes(extensionLine)) {
                continue; // Already enabled with correct format
              }
              
              // Replace extension=name with extension=php_name.dll
              const simplePattern = new RegExp(`^extension=${ext}\\s*$`, 'gm');
              if (simplePattern.test(iniContent)) {
                iniContent = iniContent.replace(simplePattern, extensionLine);
                modified = true;
                continue;
              }
              
              // Also enable commented extensions with correct format
              const commentedPattern = new RegExp(`^;extension=${ext}\\s*$`, 'gm');
              if (commentedPattern.test(iniContent)) {
                iniContent = iniContent.replace(commentedPattern, extensionLine);
                modified = true;
                continue;
              }
              
              const commentedPattern2 = new RegExp(`^;extension=php_${ext}\\.dll\\s*$`, 'gm');
              if (commentedPattern2.test(iniContent)) {
                iniContent = iniContent.replace(commentedPattern2, extensionLine);
                modified = true;
                continue;
              }
              
              // Extension not found at all - add it to the list of missing extensions
              missingExtensions.push(extensionLine);
            }
            
            // Add any missing extensions to the end of the file
            if (missingExtensions.length > 0) {
              iniContent = iniContent.trimEnd() + '\n' + missingExtensions.join('\n') + '\n';
              modified = true;
              console.log(`Added missing extensions to PHP ${version}: ${missingExtensions.join(', ')}`);
            }
          }
          
          if (modified) {
            await fs.writeFile(iniPath, iniContent);
            console.log(`Fixed php.ini for PHP ${version}`);
          }
        } catch (error) {
          console.warn(`Could not update php.ini for PHP ${version}:`, error.message);
        }
      }
    }
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
      mariadb: false,
      redis: false,
      mailpit: false,
      phpmyadmin: false,
      nginx: false,
      apache: false,
      nodejs: {},
      composer: false,
    };

    // Check PHP versions
    for (const version of ['7.4', '8.0', '8.1', '8.2', '8.3', '8.4']) {
      const phpPath = path.join(this.resourcesPath, 'php', version, platform);
      const phpExe = platform === 'win' ? 'php.exe' : 'php';
      installed.php[version] = await fs.pathExists(path.join(phpPath, phpExe));
    }

    // Check MySQL
    const mysqlPath = path.join(this.resourcesPath, 'mysql', platform, 'bin');
    const mysqlExe = platform === 'win' ? 'mysqld.exe' : 'mysqld';
    installed.mysql = await fs.pathExists(path.join(mysqlPath, mysqlExe));

    // Check MariaDB
    const mariadbPath = path.join(this.resourcesPath, 'mariadb', platform, 'bin');
    const mariadbExe = platform === 'win' ? 'mariadbd.exe' : 'mariadbd';
    installed.mariadb = await fs.pathExists(path.join(mariadbPath, mariadbExe));

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

    // Check Node.js versions
    for (const version of ['18', '20', '22']) {
      const nodePath = path.join(this.resourcesPath, 'nodejs', version, platform);
      const nodeExe = platform === 'win' ? 'node.exe' : 'bin/node';
      installed.nodejs[version] = await fs.pathExists(path.join(nodePath, nodeExe));
    }

    // Check Composer
    const composerPath = path.join(this.resourcesPath, 'composer', 'composer.phar');
    installed.composer = await fs.pathExists(composerPath);

    return installed;
  }

  async downloadFile(url, destPath, id) {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(destPath);
      const protocol = url.startsWith('https') ? https : http;
      const parsedUrl = new URL(url);

      const request = protocol.get(url, { 
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/octet-stream, application/zip, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Host': parsedUrl.host,
        },
      }, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 303 || response.statusCode === 307) {
          file.close();
          fs.unlinkSync(destPath);
          const redirectUrl = response.headers.location.startsWith('http') 
            ? response.headers.location 
            : new URL(response.headers.location, url).toString();
          return this.downloadFile(redirectUrl, destPath, id)
            .then(resolve)
            .catch(reject);
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          reject(new Error(`Download failed with status ${response.statusCode}`));
          return;
        }
        
        // Check if we're getting HTML instead of binary (common with blocked downloads)
        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('text/html') && !destPath.endsWith('.html')) {
          file.close();
          fs.unlinkSync(destPath);
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
      console.log(`[ZIP Validation] ${filePath}: bytes=${buffer[0].toString(16)} ${buffer[1].toString(16)}, valid=${isValid}`);
      return isValid;
    } catch (err) {
      console.error('Error validating ZIP file:', err);
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
        
        worker.on('message', (message) => {
          if (message.type === 'progress') {
            this.emitProgress(id, { status: 'extracting', progress: message.progress });
          } else if (message.type === 'done') {
            resolve();
          } else if (message.type === 'error') {
            reject(new Error(message.error));
          }
        });
        
        worker.on('error', (error) => {
          reject(error);
        });
        
        worker.on('exit', (code) => {
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
    const platform = this.getPlatform();
    const extDir = platform === 'win' ? path.join(phpPath, 'ext').replace(/\\/g, '/') : path.join(phpPath, 'lib', 'php', 'extensions');
    
    // Windows uses php_ prefix for extensions
    const extPrefix = platform === 'win' ? 'php_' : '';
    const extSuffix = platform === 'win' ? '.dll' : '.so';
    
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

[opcache]
opcache.enable=1
opcache.enable_cli=1
opcache.memory_consumption=256
opcache.interned_strings_buffer=16
opcache.max_accelerated_files=20000
opcache.validate_timestamps=1
opcache.revalidate_freq=0

; Extensions - enabled by default for Laravel compatibility
extension=${extPrefix}curl${extSuffix}
extension=${extPrefix}fileinfo${extSuffix}
extension=${extPrefix}mbstring${extSuffix}
extension=${extPrefix}openssl${extSuffix}
extension=${extPrefix}pdo_mysql${extSuffix}
extension=${extPrefix}pdo_sqlite${extSuffix}
extension=${extPrefix}mysqli${extSuffix}
extension=${extPrefix}sqlite3${extSuffix}
extension=${extPrefix}zip${extSuffix}
extension=${extPrefix}gd${extSuffix}
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

  async downloadMariadb() {
    const id = 'mariadb';
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.mariadb[platform];

    if (!downloadInfo) {
      throw new Error(`MariaDB not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'mariadb', platform);

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

      // Try primary URL first, then fallbacks
      const urls = [downloadInfo.url, ...(downloadInfo.fallbackUrls || [])];
      let lastError = null;
      let downloaded = false;
      
      for (const url of urls) {
        try {
          console.log(`[Apache] Trying download from: ${url}`);
          await this.downloadFile(url, downloadPath, id);
          downloaded = true;
          break;
        } catch (err) {
          console.log(`[Apache] Download failed from ${url}: ${err.message}`);
          lastError = err;
          // Clean up partial download
          await fs.remove(downloadPath).catch(() => {});
        }
      }
      
      if (!downloaded) {
        // Provide helpful error message for manual download
        const manualNote = downloadInfo.manualDownloadNote || '';
        const manualUrl = downloadInfo.manualDownloadUrl || 'https://www.apachelounge.com/download/';
        throw new Error(`Apache download failed. ${manualNote} Manual download: ${manualUrl}`);
      }

      await this.extractArchive(downloadPath, extractPath, id);

      // Apache Lounge ZIPs have files inside an "Apache24" folder - move them up
      const apache24Path = path.join(extractPath, 'Apache24');
      if (await fs.pathExists(apache24Path)) {
        console.log('[Apache] Moving files from Apache24 subfolder...');
        const contents = await fs.readdir(apache24Path);
        for (const item of contents) {
          const srcPath = path.join(apache24Path, item);
          const destPath = path.join(extractPath, item);
          await fs.move(srcPath, destPath, { overwrite: true });
        }
        await fs.remove(apache24Path);
        console.log('[Apache] Files moved successfully');
      }

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

  async importApache(filePath) {
    const id = 'apache';
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
      
      const extractPath = path.join(this.resourcesPath, 'apache', platform);
      
      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);
      
      this.emitProgress(id, { status: 'extracting', progress: 50 });
      
      await this.extractArchive(filePath, extractPath, id);
      
      // Apache Lounge ZIPs have files inside an "Apache24" folder - move them up
      const apache24Path = path.join(extractPath, 'Apache24');
      if (await fs.pathExists(apache24Path)) {
        console.log('[Apache Import] Moving files from Apache24 subfolder...');
        const contents = await fs.readdir(apache24Path);
        for (const item of contents) {
          const srcPath = path.join(apache24Path, item);
          const destPath = path.join(extractPath, item);
          await fs.move(srcPath, destPath, { overwrite: true });
        }
        await fs.remove(apache24Path);
        console.log('[Apache Import] Files moved successfully');
      }
      
      // Create default Apache config for PHP
      await this.createApacheConfig(extractPath);
      
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
    } else if (type === 'nodejs' && version) {
      targetPath = path.join(this.resourcesPath, 'nodejs', version, platform);
    } else if (type === 'phpmyadmin') {
      targetPath = path.join(this.resourcesPath, 'phpmyadmin');
    } else if (type === 'composer') {
      targetPath = path.join(this.resourcesPath, 'composer');
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
      mariadb: this.downloads.mariadb[platform],
      redis: this.downloads.redis[platform],
      mailpit: this.downloads.mailpit[platform],
      phpmyadmin: this.downloads.phpmyadmin.all,
      nginx: this.downloads.nginx[platform],
      apache: this.downloads.apache[platform],
      nodejs: {},
      composer: this.downloads.composer.all,
    };

    for (const version of Object.keys(this.downloads.php)) {
      urls.php[version] = this.downloads.php[version][platform];
    }

    for (const version of Object.keys(this.downloads.nodejs)) {
      urls.nodejs[version] = this.downloads.nodejs[version][platform];
    }

    return urls;
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
        console.log('Symlinks already exist or could not be created');
      }
    }

    console.log(`Node.js ${version} environment set up at ${nodejsPath}`);
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

      this.emitProgress(id, { status: 'complete', progress: 100 });

      return {
        success: true,
        path: composerDir,
      };
    } catch (error) {
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

    console.log('Composer environment set up');
  }

  // Get Composer path
  getComposerPath() {
    return path.join(this.resourcesPath, 'composer', 'composer.phar');
  }

  // Run Composer command with specific PHP version
  async runComposer(projectPath, command, phpVersion = '8.3', onOutput = null) {
    const platform = this.getPlatform();
    const phpPath = path.join(this.resourcesPath, 'php', phpVersion, platform, platform === 'win' ? 'php.exe' : 'php');
    const composerPhar = this.getComposerPath();

    console.log('[runComposer] Checking PHP at:', phpPath);
    console.log('[runComposer] Checking Composer at:', composerPhar);

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

    return new Promise((resolve, reject) => {
      const args = [composerPhar, ...command.split(' ')];
      
      // Log the command being run
      console.log(`[runComposer] Running: ${phpPath} ${args.join(' ')} in ${projectPath}`);

      const proc = spawn(phpPath, args, {
        cwd: projectPath,
        env: { 
          ...process.env, 
          COMPOSER_HOME: path.join(this.resourcesPath, 'composer'),
          COMPOSER_NO_INTERACTION: '1',
        },
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        console.log('[runComposer stdout]', text.trim());
        if (onOutput) {
          onOutput(text, 'stdout');
        }
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        console.log('[runComposer stderr]', text.trim());
        if (onOutput) {
          onOutput(text, 'stderr');
        }
      });

      proc.on('close', (code) => {
        console.log(`[runComposer] Process exited with code ${code}`);
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          const errorMsg = stderr || `Composer exited with code ${code}`;
          if (onOutput) onOutput(`Process exited with code ${code}`, 'error');
          reject(new Error(errorMsg));
        }
      });

      proc.on('error', (err) => {
        console.error('[runComposer] Process error:', err);
        if (onOutput) onOutput(`Process error: ${err.message}`, 'error');
        reject(err);
      });
    });
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
}

module.exports = BinaryDownloadManager;
