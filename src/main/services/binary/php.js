const path = require('path');
const fs = require('fs-extra');
const https = require('https');
const { createWriteStream } = require('fs');
const { resolvePhpExtensionDir } = require('../../utils/PhpPathResolver');

module.exports = {
  async ensureLinuxPhpSystemDependencies(version, id = null) {
    if (this.getPlatform() !== 'linux') {
      return { success: true, skipped: true };
    }

    const dependencyPlan = [
      {
        libraryNames: ['libonig.so.5'],
        packages: {
          'apt-get': ['libonig5'],
          dnf: ['oniguruma'],
          yum: ['oniguruma'],
          zypper: ['libonig5', 'oniguruma5'],
          pacman: ['oniguruma'],
        },
      },
      {
        libraryNames: ['libzip.so.4'],
        packages: {
          'apt-get': ['libzip4t64', 'libzip4'],
          dnf: ['libzip'],
          yum: ['libzip'],
          zypper: ['libzip4', 'libzip5', 'libzip'],
          pacman: ['libzip'],
        },
      },
    ];

    const missingDependencies = [];
    for (const dependency of dependencyPlan) {
      const isPresent = await this.hasLinuxSharedLibrary(dependency.libraryNames);
      if (!isPresent) {
        missingDependencies.push(dependency);
      }
    }

    if (missingDependencies.length === 0) {
      return { success: true, installed: [], alreadyInstalled: true };
    }

    const packageManager = await this.detectLinuxPackageManager();
    if (!packageManager) {
      throw new Error('No supported Linux package manager was found. DevBox Pro could not install the PHP runtime dependencies automatically.');
    }

    const packagesToInstall = [];
    for (const dependency of missingDependencies) {
      const packageName = await this.resolveLinuxPackageName(packageManager, dependency.packages[packageManager.command] || []);
      if (packageName && !packagesToInstall.includes(packageName)) {
        packagesToInstall.push(packageName);
      }
    }

    if (packagesToInstall.length === 0) {
      throw new Error(`DevBox Pro could not determine the Linux packages required for PHP ${version}.`);
    }

    if (id) {
      this.emitProgress(id, {
        status: 'installing',
        progress: 70,
        message: `Installing PHP runtime dependencies with ${packageManager.command}...`,
      });
    }

    await this.runPrivilegedLinuxCommand(packageManager.install(packagesToInstall.join(' ')));

    for (const dependency of missingDependencies) {
      const isPresent = await this.hasLinuxSharedLibrary(dependency.libraryNames);
      if (!isPresent) {
        throw new Error(`Installed Linux packages but ${dependency.libraryNames.join(', ')} is still missing for PHP ${version}.`);
      }
    }

    return { success: true, installed: packagesToInstall };
  },

  async enablePhpExtensions() {
    const platform = this.getPlatform();

    const phpBaseDir = path.join(this.resourcesPath, 'php');
    if (!await fs.pathExists(phpBaseDir)) {
      return;
    }

    const versionDirs = await fs.readdir(phpBaseDir);

    for (const version of versionDirs) {
      if (version === 'win' || version === 'mac' || version === 'downloads') continue;

      const phpPath = path.join(this.resourcesPath, 'php', version, platform);
      const iniPath = path.join(phpPath, 'php.ini');

      if (await fs.pathExists(iniPath)) {
        try {
          let iniContent = await fs.readFile(iniPath, 'utf8');
          let modified = false;

          const extDir = resolvePhpExtensionDir(this.resourcesPath, version, platform).replace(/\\/g, '/');
          if (!iniContent.includes('extension_dir')) {
            iniContent = iniContent.replace('[PHP]', `[PHP]\nextension_dir = "${extDir}"`);
            modified = true;
          } else if (!iniContent.includes(extDir)) {
            iniContent = iniContent.replace(/extension_dir\s*=\s*"[^"]*"/g, `extension_dir = "${extDir}"`);
            modified = true;
          }

          if (platform === 'linux') {
            const normalizedExtensionBlock = await this.buildPhpExtensionBlock(version, platform);
            if (iniContent.includes('; Extensions - enabled by default for Laravel compatibility')) {
              iniContent = iniContent.replace(
                /; Extensions - enabled by default for Laravel compatibility[\s\S]*$/,
                `; Extensions - enabled by default for Laravel compatibility\n${normalizedExtensionBlock}\n`
              );
              modified = true;
            }

            await this.createLinuxPhpLaunchers(phpPath, version);
          }

          if (platform === 'win') {
            const cacertPath = await this.ensureCaCertBundle(phpPath);
            if (cacertPath) {
              if (!iniContent.includes('curl.cainfo')) {
                if (!iniContent.includes('[curl]')) {
                  iniContent += `\n[curl]\ncurl.cainfo = "${cacertPath}"\n`;
                } else {
                  iniContent = iniContent.replace('[curl]', `[curl]\ncurl.cainfo = "${cacertPath}"`);
                }
                modified = true;
              }

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

          if (platform === 'win') {
            const extensions = ['curl', 'fileinfo', 'gd', 'mbstring', 'mysqli', 'openssl', 'pdo_mysql', 'pdo_sqlite', 'sqlite3', 'zip'];

            for (const ext of extensions) {
              const extensionDll = `php_${ext}.dll`;
              const extPath = path.join(extDir.replace(/\//g, path.sep), extensionDll);
              const extensionExists = await fs.pathExists(extPath);
              const extensionLine = `extension=${extensionDll}`;
              const commentedLine = `; extension=${extensionDll} ; Not available`;

              const enabledPattern = new RegExp(`^extension=(?:php_)?${ext}(?:\\.dll)?\\s*$`, 'gm');
              const commentedPattern = new RegExp(`^;\\s*extension=(?:php_)?${ext}(?:\\.dll)?.*$`, 'gm');

              if (extensionExists) {
                if (!iniContent.match(enabledPattern)) {
                  if (iniContent.match(commentedPattern)) {
                    iniContent = iniContent.replace(commentedPattern, extensionLine);
                    modified = true;
                  }
                } else if (!iniContent.includes(extensionLine)) {
                  iniContent = iniContent.replace(enabledPattern, extensionLine);
                  modified = true;
                }
              } else if (iniContent.match(enabledPattern)) {
                iniContent = iniContent.replace(enabledPattern, commentedLine);
                modified = true;
              }
            }
          }

          if (modified) {
            await fs.writeFile(iniPath, iniContent);
          }
        } catch (error) {
          this.managers?.log?.systemWarn(`Could not update php.ini for PHP ${version}`, { error: error.message });
        }
      }
    }
  },

  async downloadPhp(version) {
    const id = `php-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.php[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`PHP ${version} not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const extractPath = path.join(this.resourcesPath, 'php', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      const { downloadPath } = await this.downloadWithVersionProbe('php', version, id, downloadInfo);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);

      if (platform === 'linux') {
        await this.ensureLinuxPhpSystemDependencies(version, id);
      }

      await this.createPhpIni(extractPath, version);

      if (platform === 'win') {
        await this.ensureVCRedist(extractPath);
      }

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
  },

  async createPhpIni(phpPath, version) {
    const platform = this.getPlatform();
    const extDir = resolvePhpExtensionDir(this.resourcesPath, version, platform).replace(/\\/g, '/');

    const settings = this.configStore?.get('settings', {}) || {};
    const timezone = settings.serverTimezone || 'UTC';

    let cacertPath = '';
    if (platform === 'win') {
      cacertPath = await this.ensureCaCertBundle(phpPath);
    }
    const extensionBlock = await this.buildPhpExtensionBlock(version, platform);

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
${extensionBlock}
`;

    const iniPath = path.join(phpPath, 'php.ini');
    await fs.writeFile(iniPath, iniContent);

    if (platform === 'linux') {
      await this.createLinuxPhpLaunchers(phpPath, version);
    }
  },

  async createLinuxPhpLaunchers(phpPath, version) {
    const launcherSpecs = [
      {
        launcherPath: path.join(phpPath, 'php'),
        targetBinary: path.join(phpPath, 'usr', 'bin', `php${version}`),
      },
      {
        launcherPath: path.join(phpPath, 'php-cgi'),
        targetBinary: path.join(phpPath, 'usr', 'bin', `php-cgi${version}`),
      },
    ];

    for (const { launcherPath, targetBinary } of launcherSpecs) {
      if (!await fs.pathExists(targetBinary)) {
        continue;
      }

      const launcherScript = `#!/usr/bin/env bash
ROOT_DIR="$(cd "$(dirname "${'$'}{BASH_SOURCE[0]}")" && pwd)"
LD_LIBRARY_DIRS=()
for dir in "${'${ROOT_DIR}'}/lib" "${'${ROOT_DIR}'}/lib/x86_64-linux-gnu" "${'${ROOT_DIR}'}/usr/lib" "${'${ROOT_DIR}'}/usr/lib/x86_64-linux-gnu" "${'${ROOT_DIR}'}/usr/local/lib"; do
  if [ -d "${'$'}dir" ]; then
    LD_LIBRARY_DIRS+=("${'$'}dir")
  fi
done
if [ ${'$'}{#LD_LIBRARY_DIRS[@]} -gt 0 ]; then
  EXTRA_LD_LIBRARY_PATH="$(IFS=:; echo "${'$'}{LD_LIBRARY_DIRS[*]}")"
  export LD_LIBRARY_PATH="${'$'}{EXTRA_LD_LIBRARY_PATH}${'$'}{LD_LIBRARY_PATH:+:${'$'}LD_LIBRARY_PATH}"
fi
export PHP_INI_SCAN_DIR=""
exec "${'${ROOT_DIR}'}/${path.relative(phpPath, targetBinary).replace(/\\/g, '/')}" -c "${'${ROOT_DIR}'}/php.ini" "${'$'}@"
`;

      await fs.writeFile(launcherPath, launcherScript);
      await fs.chmod(launcherPath, 0o755);
    }
  },

  async buildPhpExtensionBlock(version, platform) {
    const extDir = resolvePhpExtensionDir(this.resourcesPath, version, platform);
    const extPrefix = platform === 'win' ? 'php_' : '';
    const extSuffix = platform === 'win' ? '.dll' : '.so';
    const extensionOrder = platform === 'linux'
      ? ['curl', 'fileinfo', 'ctype', 'iconv', 'mbstring', 'phar', 'pdo', 'mysqlnd', 'pdo_mysql', 'pdo_sqlite', 'mysqli', 'sqlite3', 'zip', 'gd', 'tokenizer', 'xml', 'dom', 'simplexml', 'xmlreader', 'xmlwriter']
      : ['curl', 'fileinfo', 'mbstring', 'openssl', 'pdo_mysql', 'pdo_sqlite', 'mysqli', 'sqlite3', 'zip', 'gd'];
    const extensionLines = [];

    for (const ext of extensionOrder) {
      const extFile = `${extPrefix}${ext}${extSuffix}`;
      const extPath = path.join(extDir, extFile);
      if (await fs.pathExists(extPath)) {
        extensionLines.push(`extension=${extFile}`);
      } else {
        extensionLines.push(`; extension=${extFile} ; Not available in this PHP version`);
      }
    }

    return extensionLines.join('\n');
  },

  async ensureCaCertBundle(phpPath) {
    const cacertPath = path.join(phpPath, 'cacert.pem').replace(/\\/g, '/');

    if (await fs.pathExists(cacertPath)) {
      return cacertPath;
    }

    const cacertUrl = 'https://curl.se/ca/cacert.pem';

    try {
      const response = await new Promise((resolve, reject) => {
        https.get(cacertUrl, (res) => {
          if (res.statusCode === 200) {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => resolve(data));
          } else {
            reject(new Error(`Failed to download CA bundle: ${res.statusCode}`));
          }
        }).on('error', reject);
      });

      await fs.writeFile(cacertPath, response);
      return cacertPath;
    } catch (error) {
      this.managers?.log?.systemWarn('Could not download CA certificate bundle', { error: error.message });
      return '';
    }
  },

  async ensureVCRedist(phpPath) {
    const requiredDlls = [
      'vcruntime140.dll',
      'msvcp140.dll',
      'vcruntime140_1.dll',
    ];

    const vcRedistBaseUrl = 'https://raw.githubusercontent.com/JeffGepiga/DevBoxPro/main/vcredist';
    const missingDlls = [];
    for (const dll of requiredDlls) {
      const dllPath = path.join(phpPath, dll);
      if (!await fs.pathExists(dllPath)) {
        missingDlls.push(dll);
      }
    }

    if (missingDlls.length === 0) {
      return;
    }

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
      }
    }
  },
};