const path = require('path');
const fs = require('fs-extra');
const https = require('https');
const { createWriteStream } = require('fs');
const { execFile } = require('child_process');
const { killProcessesInDirectory, killProcessesByPath } = require('../../utils/SpawnUtils');

const STANDARD_PHP_EXTENSIONS = new Set([
  'php_bz2.dll',
  'php_curl.dll',
  'php_dba.dll',
  'php_enchant.dll',
  'php_exif.dll',
  'php_ffi.dll',
  'php_fileinfo.dll',
  'php_ftp.dll',
  'php_gd.dll',
  'php_gettext.dll',
  'php_gmp.dll',
  'php_imap.dll',
  'php_intl.dll',
  'php_ldap.dll',
  'php_mbstring.dll',
  'php_mysqli.dll',
  'php_oci8_12c.dll',
  'php_oci8_19.dll',
  'php_odbc.dll',
  'php_opcache.dll',
  'php_openssl.dll',
  'php_pdo_firebird.dll',
  'php_pdo_mysql.dll',
  'php_pdo_oci.dll',
  'php_pdo_odbc.dll',
  'php_pdo_pgsql.dll',
  'php_pdo_sqlite.dll',
  'php_pgsql.dll',
  'php_shmop.dll',
  'php_snmp.dll',
  'php_soap.dll',
  'php_sockets.dll',
  'php_sodium.dll',
  'php_sqlite3.dll',
  'php_tidy.dll',
  'php_xsl.dll',
  'php_zip.dll',
]);

function parseSemVer(versionStr) {
  if (!versionStr || typeof versionStr !== 'string') return null;
  const match = versionStr.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3] || '0', 10),
  };
}

function compareSemVer(v1, v2) {
  const p1 = parseSemVer(v1);
  const p2 = parseSemVer(v2);
  if (!p1 || !p2) return 0;
  if (p1.major !== p2.major) return p1.major - p2.major;
  if (p1.minor !== p2.minor) return p1.minor - p2.minor;
  return p1.patch - p2.patch;
}

async function needsWindowsRuntimeSync(sourcePath, destPath) {
  if (!await fs.pathExists(destPath)) {
    return true;
  }

  try {
    const [sourceStat, destStat] = await Promise.all([
      fs.stat(sourcePath),
      fs.stat(destPath),
    ]);

    if (sourceStat.size !== destStat.size) {
      return true;
    }

    const [sourceBuffer, destBuffer] = await Promise.all([
      fs.readFile(sourcePath),
      fs.readFile(destPath),
    ]);

    return !sourceBuffer.equals(destBuffer);
  } catch (_error) {
    return true;
  }
}

function getBundledVCRedistDirs() {
  return [
    process.resourcesPath ? path.join(process.resourcesPath, 'vcredist') : null,
    path.resolve(__dirname, '../../../../vcredist'),
  ].filter(Boolean);
}

module.exports = {
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

          const extDir = path.join(phpPath, 'ext').replace(/\\/g, '/');
          if (!iniContent.includes('extension_dir')) {
            iniContent = iniContent.replace('[PHP]', `[PHP]\nextension_dir = "${extDir}"`);
            modified = true;
          } else if (!iniContent.includes(extDir)) {
            iniContent = iniContent.replace(/extension_dir\s*=\s*"[^"]*"/g, `extension_dir = "${extDir}"`);
            modified = true;
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

    this.ensureAutomatedDownloadAvailable(downloadInfo, `PHP ${version}`, platform);

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const extractPath = path.join(this.resourcesPath, 'php', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      const { downloadPath } = await this.downloadWithVersionProbe('php', version, id, downloadInfo);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);
      await this.createPhpIni(extractPath, version);

      if (platform === 'win') {
        await this.ensureVCRedist(extractPath);
      }

      await fs.remove(downloadPath);

      const configuredVersion = this.getConfiguredPhpVersion(version);
      await fs.writeJson(path.join(extractPath, '.version-info.json'), {
        version: configuredVersion,
        baseVersion: version,
        filename: downloadInfo.filename,
        url: downloadInfo.url,
        installedAt: new Date().toISOString(),
      }, { spaces: 2 }).catch(() => {});

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
    const extDir = platform === 'win' ? path.join(phpPath, 'ext').replace(/\\/g, '/') : path.join(phpPath, 'lib', 'php', 'extensions');
    const extPrefix = platform === 'win' ? 'php_' : '';
    const extSuffix = platform === 'win' ? '.dll' : '.so';

    const settings = this.configStore?.get('settings', {}) || {};
    const timezone = settings.serverTimezone || 'UTC';

    let cacertPath = '';
    if (platform === 'win') {
      cacertPath = await this.ensureCaCertBundle(phpPath);
    }

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
    const system32Path = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
    const stillMissing = [];
    const sourceDirs = [
      ...getBundledVCRedistDirs(),
      system32Path,
    ];

    for (const dll of requiredDlls) {
      const destDll = path.join(phpPath, dll);
      let copied = false;

      for (const sourceDir of sourceDirs) {
        const sourceDll = path.join(sourceDir, dll);

        try {
          if (!await fs.pathExists(sourceDll)) {
            continue;
          }

          if (!await needsWindowsRuntimeSync(sourceDll, destDll)) {
            copied = true;
            break;
          }

          await fs.copy(sourceDll, destDll, { overwrite: true });
          this.managers?.log?.info(`[ensureVCRedist] Synchronized ${dll} from ${sourceDir}`);
          copied = true;
          break;
        } catch (err) {
          this.managers?.log?.systemWarn(`[ensureVCRedist] Could not copy ${dll} from ${sourceDir}`, { error: err.message });
        }
      }

      if (!copied) {
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

  getConfiguredPhpVersion(version) {
    const platform = this.getPlatform();
    const downloadInfo = this.downloads?.php?.[version]?.[platform] || this.downloads?.php?.[version]?.all;
    if (!downloadInfo) return version;

    const source = downloadInfo.filename || downloadInfo.url || '';
    const match = source.match(/php-?(\d+\.\d+\.\d+)/i);
    if (match) {
      return match[1];
    }
    return version;
  },

  async getInstalledPhpVersion(version) {
    const platform = this.getPlatform();
    const phpPath = path.join(this.resourcesPath, 'php', version, platform);
    const phpExe = platform === 'win' ? 'php.exe' : 'php';
    const phpExePath = path.join(phpPath, phpExe);

    if (!await fs.pathExists(phpExePath)) {
      return null;
    }

    const infoPath = path.join(phpPath, '.version-info.json');
    if (await fs.pathExists(infoPath)) {
      try {
        const info = await fs.readJson(infoPath);
        if (info && info.version) {
          return info.version;
        }
      } catch {
        // Fall back to probe
      }
    }

    try {
      const output = await new Promise((resolve, reject) => {
        execFile(phpExePath, ['-n', '-r', 'echo PHP_VERSION;'], { timeout: 3000 }, (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout ? stdout.trim() : '');
        });
      });

      if (output && /^\d+\.\d+\.\d+/.test(output)) {
        await fs.writeJson(infoPath, {
          version: output,
          baseVersion: version,
          detectedAt: new Date().toISOString(),
        }, { spaces: 2 }).catch(() => {});
        return output;
      }
    } catch {
      // Fall back if execFile fails
    }

    return version;
  },

  async getPhpVersionDetails(version) {
    const installedVersion = await this.getInstalledPhpVersion(version);
    const configuredVersion = this.getConfiguredPhpVersion(version);
    const platform = this.getPlatform();
    const downloadInfo = this.downloads?.php?.[version]?.[platform] || this.downloads?.php?.[version]?.all;

    let hasUpdate = false;
    if (installedVersion && configuredVersion) {
      hasUpdate = compareSemVer(configuredVersion, installedVersion) > 0;
    }

    return {
      version,
      installed: Boolean(installedVersion),
      installedVersion: installedVersion || null,
      configuredVersion,
      hasUpdate,
      downloadInfo: downloadInfo || null,
    };
  },

  async getAllPhpVersionDetails() {
    const details = {};
    const platform = this.getPlatform();
    const phpBaseDir = path.join(this.resourcesPath, 'php');

    const versions = new Set(this.versionMeta?.php || []);
    if (await fs.pathExists(phpBaseDir)) {
      try {
        const dirs = await fs.readdir(phpBaseDir);
        for (const dir of dirs) {
          if (!['win', 'mac', 'linux', 'downloads'].includes(dir)) {
            versions.add(dir);
          }
        }
      } catch {}
    }

    for (const v of versions) {
      details[v] = await this.getPhpVersionDetails(v);
    }

    return details;
  },

  async checkPhpModifications(version) {
    const platform = this.getPlatform();
    const phpPath = path.join(this.resourcesPath, 'php', version, platform);

    const result = {
      hasModifications: false,
      modifiedFiles: [],
      hasCustomIni: false,
      customExtensions: [],
      customFiles: [],
    };

    if (!await fs.pathExists(phpPath)) {
      return result;
    }

    // Check php.ini
    const iniPath = path.join(phpPath, 'php.ini');
    if (await fs.pathExists(iniPath)) {
      result.hasCustomIni = true;
      result.modifiedFiles.push('php.ini');
    }

    // Check ext/ for custom extensions
    const extDir = path.join(phpPath, 'ext');
    if (await fs.pathExists(extDir)) {
      try {
        const files = await fs.readdir(extDir);
        for (const file of files) {
          if (!STANDARD_PHP_EXTENSIONS.has(file.toLowerCase()) && (file.endsWith('.dll') || file.endsWith('.so'))) {
            result.customExtensions.push(file);
            result.modifiedFiles.push(`ext/${file}`);
          }
        }
      } catch {}
    }

    // Check root directory for custom files
    try {
      const rootEntries = await fs.readdir(phpPath);
      const standardEntries = new Set([
        'php.exe', 'php-cgi.exe', 'php-win.exe', 'phpdbg.exe', 'php.ini', 'php.ini-development',
        'php.ini-production', 'ext', 'cacert.pem', '.version-info.json', 'license.txt', 'news.txt',
        'snapshot.txt', 'glibc-bin', 'dev', 'etc', 'lib', 'usr', 'sbin', 'var', 'php.ini.backup-pre-update'
      ]);

      for (const entry of rootEntries) {
        const lower = entry.toLowerCase();
        if (!standardEntries.has(lower) && !lower.endsWith('.dll')) {
          const entryPath = path.join(phpPath, entry);
          const stat = await fs.stat(entryPath);
          if (stat.isFile()) {
            result.customFiles.push(entry);
            result.modifiedFiles.push(entry);
          }
        }
      }
    } catch {}

    result.hasModifications = result.modifiedFiles.length > 0;
    return result;
  },

  async updatePhp(version, options = {}) {
    const id = `php-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads?.php?.[version]?.[platform] || this.downloads?.php?.[version]?.all;

    this.ensureAutomatedDownloadAvailable(downloadInfo, `PHP ${version}`, platform);

    const preserveModifications = options.preserveModifications !== false;
    const force = Boolean(options.force);

    // Check running conflicts
    const conflicts = typeof this.getRunningConflicts === 'function'
      ? await this.getRunningConflicts('php', version)
      : { hasConflicts: false, items: [] };

    if (conflicts.hasConflicts && !force) {
      const error = new Error(`PHP ${version} is currently in use. Stop the project or service using it, then try updating again.`);
      error.code = 'BINARY_IN_USE';
      error.conflicts = conflicts.items;
      throw error;
    }

    const stoppedProjects = [];
    let stoppedPhpMyAdmin = false;

    if (force && conflicts.hasConflicts) {
      for (const item of conflicts.items) {
        try {
          if (item.kind === 'project') {
            await this.managers?.project?.stopProject(item.id);
            if (!stoppedProjects.includes(item.id)) {
              stoppedProjects.push(item.id);
            }
          } else if (item.kind === 'service') {
            const svcName = item.serviceName || item.id;
            await this.managers?.service?.stopService(svcName, item.version ?? null);
            if (svcName === 'phpmyadmin') {
              stoppedPhpMyAdmin = true;
            }
          }
        } catch (error) {
          this.managers?.log?.systemWarn(`Could not stop ${item.name} before PHP update`, { error: error.message });
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    // Proactively stop phpMyAdmin if running with this PHP version
    if (this.managers?.service?.serviceStatus) {
      const pmaStatus = this.managers.service.serviceStatus.get('phpmyadmin');
      if (pmaStatus?.status === 'running') {
        const defaultPhp = this.managers?.php?.getDefaultVersion?.();
        if (!defaultPhp || defaultPhp === version) {
          try {
            await this.managers.service.stopService('phpmyadmin');
            stoppedPhpMyAdmin = true;
          } catch (e) {
            this.managers?.log?.systemWarn('Could not stop phpMyAdmin before PHP update', { error: e.message });
          }
        }
      }
    }

    // Proactively stop running projects using this PHP version
    if (this.managers?.project) {
      const allProjects = typeof this.managers.project.getAllProjects === 'function'
        ? this.managers.project.getAllProjects()
        : (Array.isArray(this.managers.project.projects)
            ? this.managers.project.projects
            : Object.values(this.managers.project.projects || {}));
      for (const project of allProjects) {
        if (project?.isRunning && (project.phpVersion === version || project.runtimeVersion === version)) {
          try {
            await this.managers.project.stopProject(project.id);
            if (!stoppedProjects.includes(project.id)) {
              stoppedProjects.push(project.id);
            }
          } catch (e) {
            this.managers?.log?.systemWarn(`Could not stop project ${project.name} before PHP update`, { error: e.message });
          }
        }
      }
    }

    const extractPath = path.join(this.resourcesPath, 'php', version, platform);

    // Preemptively terminate any lingering processes inside the target binary directory
    await killProcessesInDirectory(extractPath);
    if (platform === 'win') {
      await killProcessesByPath('php.exe', extractPath).catch(() => {});
      await killProcessesByPath('php-cgi.exe', extractPath).catch(() => {});
      await killProcessesByPath('php-win.exe', extractPath).catch(() => {});
    }

    const modifications = await this.checkPhpModifications(version);

    let savedIniContent = null;
    const savedCustomExtensions = [];
    const savedCustomFiles = [];

    if (preserveModifications && await fs.pathExists(extractPath)) {
      const iniPath = path.join(extractPath, 'php.ini');
      if (await fs.pathExists(iniPath)) {
        try {
          savedIniContent = await fs.readFile(iniPath, 'utf8');
        } catch {}
      }

      const extDir = path.join(extractPath, 'ext');
      if (await fs.pathExists(extDir)) {
        try {
          const files = await fs.readdir(extDir);
          for (const file of files) {
            if (!STANDARD_PHP_EXTENSIONS.has(file.toLowerCase()) && (file.endsWith('.dll') || file.endsWith('.so'))) {
              const srcFile = path.join(extDir, file);
              const stat = await fs.stat(srcFile);
              if (stat.isFile()) {
                const buf = await fs.readFile(srcFile);
                savedCustomExtensions.push({ filename: file, data: buf });
              }
            }
          }
        } catch {}
      }

      try {
        const rootEntries = await fs.readdir(extractPath);
        const standardEntries = new Set([
          'php.exe', 'php-cgi.exe', 'php-win.exe', 'phpdbg.exe', 'php.ini', 'php.ini-development',
          'php.ini-production', 'ext', 'cacert.pem', '.version-info.json', 'license.txt', 'news.txt',
          'snapshot.txt', 'glibc-bin', 'dev', 'etc', 'lib', 'usr', 'sbin', 'var', 'php.ini.backup-pre-update'
        ]);
        for (const entry of rootEntries) {
          const lower = entry.toLowerCase();
          if (!standardEntries.has(lower) && !lower.endsWith('.dll')) {
            const entryPath = path.join(extractPath, entry);
            const stat = await fs.stat(entryPath);
            if (stat.isFile()) {
              const buf = await fs.readFile(entryPath);
              savedCustomFiles.push({ filename: entry, data: buf });
            }
          }
        }
      } catch {}
    }

    const stagingPath = path.join(this.resourcesPath, 'php', version, `${platform}_update_staging`);

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      await fs.remove(stagingPath);
      await fs.ensureDir(stagingPath);

      const { downloadPath } = await this.downloadWithVersionProbe('php', version, id, downloadInfo);
      await this.checkCancelled(id, downloadPath);

      await this.extractArchive(downloadPath, stagingPath, id);

      if (preserveModifications && savedIniContent) {
        const stagingIni = path.join(stagingPath, 'php.ini');
        let iniContent = savedIniContent;

        const finalExtDir = path.join(extractPath, 'ext').replace(/\\/g, '/');
        if (!iniContent.includes('extension_dir')) {
          iniContent = iniContent.replace('[PHP]', `[PHP]\nextension_dir = "${finalExtDir}"`);
        } else {
          iniContent = iniContent.replace(/extension_dir\s*=\s*"[^"]*"/g, `extension_dir = "${finalExtDir}"`);
        }

        if (platform === 'win') {
          const cacertPath = await this.ensureCaCertBundle(stagingPath);
          if (cacertPath) {
            const finalCaCertPath = path.join(extractPath, 'cacert.pem').replace(/\\/g, '/');
            if (!iniContent.includes('curl.cainfo')) {
              iniContent += `\n[curl]\ncurl.cainfo = "${finalCaCertPath}"\n`;
            }
            if (!iniContent.includes('openssl.cafile')) {
              iniContent += `\n[openssl]\nopenssl.cafile = "${finalCaCertPath}"\n`;
            }
          }
        }

        await fs.writeFile(stagingIni, iniContent, 'utf8');

        const stagingExtDir = path.join(stagingPath, 'ext');
        await fs.ensureDir(stagingExtDir);
        for (const ext of savedCustomExtensions) {
          await fs.writeFile(path.join(stagingExtDir, ext.filename), ext.data);
        }

        for (const file of savedCustomFiles) {
          await fs.writeFile(path.join(stagingPath, file.filename), file.data);
        }
      } else {
        await this.createPhpIni(stagingPath, version);
      }

      if (platform === 'win') {
        await this.ensureVCRedist(stagingPath);
      }

      // Preemptively terminate any lingering processes before replacing binary directory
      await killProcessesInDirectory(extractPath);
      if (platform === 'win') {
        await killProcessesByPath('php.exe', extractPath).catch(() => {});
        await killProcessesByPath('php-cgi.exe', extractPath).catch(() => {});
        await killProcessesByPath('php-win.exe', extractPath).catch(() => {});
      }

      // Retry removal on Windows in case of lingering locks
      let removed = false;
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          await fs.remove(extractPath);
          removed = true;
          break;
        } catch (removeErr) {
          if (attempt === 5) throw removeErr;
          await killProcessesInDirectory(extractPath);
          if (platform === 'win') {
            await killProcessesByPath('php.exe', extractPath).catch(() => {});
            await killProcessesByPath('php-cgi.exe', extractPath).catch(() => {});
          }
          await new Promise((r) => setTimeout(r, 600 * attempt));
        }
      }

      await fs.move(stagingPath, extractPath, { overwrite: true });

      if (preserveModifications && savedIniContent) {
        await fs.writeFile(path.join(extractPath, 'php.ini.backup-pre-update'), savedIniContent, 'utf8').catch(() => {});
      }

      await fs.remove(downloadPath);

      const configuredVersion = this.getConfiguredPhpVersion(version);
      await fs.writeJson(path.join(extractPath, '.version-info.json'), {
        version: configuredVersion,
        baseVersion: version,
        filename: downloadInfo.filename,
        url: downloadInfo.url,
        updatedAt: new Date().toISOString(),
        preservedModifications: preserveModifications,
        preservedFiles: preserveModifications ? modifications.modifiedFiles : [],
      }, { spaces: 2 });

      // Restart phpMyAdmin if we stopped it
      if (stoppedPhpMyAdmin) {
        this.emitProgress(id, { status: 'restarting_service', progress: 95, message: 'Restarting phpMyAdmin...' });
        try {
          await this.managers?.service?.startService?.('phpmyadmin');
        } catch (restartErr) {
          this.managers?.log?.systemWarn('Could not restart phpMyAdmin after PHP update', { error: restartErr.message });
        }
      }

      // Restart stopped projects
      for (const projId of stoppedProjects) {
        try {
          await this.managers?.project?.startProject?.(projId);
        } catch (projErr) {
          this.managers?.log?.systemWarn(`Could not restart project ${projId} after PHP update`, { error: projErr.message });
        }
      }

      this.emitProgress(id, { status: 'completed', progress: 100 });

      if (this.managers?.php?.initialize) {
        await this.managers.php.initialize().catch(() => {});
      }

      return {
        success: true,
        version,
        newVersion: configuredVersion,
        preservedModifications: preserveModifications,
        preservedFiles: preserveModifications ? modifications.modifiedFiles : [],
      };
    } catch (error) {
      await fs.remove(stagingPath).catch(() => {});

      if (stoppedPhpMyAdmin && (await fs.pathExists(extractPath))) {
        try {
          await this.managers?.service?.startService?.('phpmyadmin');
        } catch {}
      }
      for (const projId of stoppedProjects) {
        try {
          await this.managers?.project?.startProject?.(projId);
        } catch {}
      }

      if (error.cancelled) {
        return { success: false, cancelled: true };
      }

      this.managers?.log?.systemError(`Failed to update PHP ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },
};