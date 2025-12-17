const path = require('path');
const fs = require('fs-extra');
const { spawn, execSync } = require('child_process');

class PhpManager {
  constructor(resourcePath, configStore) {
    this.resourcePath = resourcePath;
    this.configStore = configStore;
    this.phpVersions = {};
    this.supportedVersions = ['7.4', '8.0', '8.1', '8.2', '8.3'];
  }

  async initialize() {
    console.log('Initializing PhpManager...');

    const phpBasePath = path.join(this.resourcePath, 'php');

    // Discover available PHP versions
    for (const version of this.supportedVersions) {
      const versionPath = path.join(phpBasePath, version);
      const phpBinary = this.getPhpBinaryName();
      const binaryPath = path.join(versionPath, phpBinary);

      if (await fs.pathExists(binaryPath)) {
        this.phpVersions[version] = {
          path: versionPath,
          binary: binaryPath,
          available: true,
          extensions: await this.discoverExtensions(versionPath, version),
        };
        console.log(`Found PHP ${version} at ${versionPath}`);
      } else {
        this.phpVersions[version] = {
          path: versionPath,
          binary: binaryPath,
          available: false,
          extensions: [],
        };
      }
    }

    // Store discovered versions
    this.configStore.set('phpVersions', this.phpVersions);

    console.log('PhpManager initialized');
  }

  getPhpBinaryName() {
    return process.platform === 'win32' ? 'php.exe' : 'php';
  }

  getPhpBinaryPath(version) {
    const versionInfo = this.phpVersions[version];
    if (!versionInfo || !versionInfo.available) {
      throw new Error(`PHP ${version} is not available`);
    }
    return versionInfo.binary;
  }

  getAvailableVersions() {
    return Object.entries(this.phpVersions).map(([version, info]) => ({
      version,
      available: info.available,
      path: info.path,
      isDefault: this.getDefaultVersion() === version,
      extensions: info.extensions,
    }));
  }

  getDefaultVersion() {
    const settings = this.configStore.get('settings', {});
    if (settings.defaultPhpVersion && this.phpVersions[settings.defaultPhpVersion]?.available) {
      return settings.defaultPhpVersion;
    }

    // Find first available version
    for (const version of this.supportedVersions.reverse()) {
      if (this.phpVersions[version]?.available) {
        return version;
      }
    }

    return '8.2';
  }

  setDefaultVersion(version) {
    if (!this.phpVersions[version]?.available) {
      throw new Error(`PHP ${version} is not available`);
    }

    const settings = this.configStore.get('settings', {});
    settings.defaultPhpVersion = version;
    this.configStore.set('settings', settings);
  }

  async discoverExtensions(phpPath, version) {
    const extPath = path.join(phpPath, 'ext');
    const iniPath = path.join(phpPath, 'php.ini');

    const allExtensions = [];
    const enabledExtensions = [];

    // Get all available extensions from ext directory
    if (await fs.pathExists(extPath)) {
      const files = await fs.readdir(extPath);
      for (const file of files) {
        if (file.endsWith('.dll') || file.endsWith('.so')) {
          const extName = file.replace(/^php_/, '').replace(/\.(dll|so)$/, '');
          allExtensions.push(extName);
        }
      }
    }

    // Parse php.ini to find enabled extensions
    if (await fs.pathExists(iniPath)) {
      const iniContent = await fs.readFile(iniPath, 'utf-8');
      const extRegex = /^(?:zend_)?extension\s*=\s*(?:php_)?([a-zA-Z0-9_]+)/gm;
      let match;

      while ((match = extRegex.exec(iniContent)) !== null) {
        enabledExtensions.push(match[1]);
      }
    }

    return allExtensions.map((ext) => ({
      name: ext,
      enabled: enabledExtensions.includes(ext),
    }));
  }

  getExtensions(version) {
    const versionInfo = this.phpVersions[version];
    if (!versionInfo) {
      throw new Error(`PHP ${version} not found`);
    }
    return versionInfo.extensions;
  }

  async toggleExtension(version, extension, enabled) {
    const versionInfo = this.phpVersions[version];
    if (!versionInfo || !versionInfo.available) {
      throw new Error(`PHP ${version} is not available`);
    }

    const iniPath = path.join(versionInfo.path, 'php.ini');

    if (!(await fs.pathExists(iniPath))) {
      // Create default php.ini if it doesn't exist
      await this.createDefaultIni(versionInfo.path, version);
    }

    let iniContent = await fs.readFile(iniPath, 'utf-8');

    const extLine = process.platform === 'win32' ? `extension=php_${extension}.dll` : `extension=${extension}.so`;

    const commentedLine = `;${extLine}`;

    if (enabled) {
      // Enable extension
      if (iniContent.includes(commentedLine)) {
        iniContent = iniContent.replace(commentedLine, extLine);
      } else if (!iniContent.includes(extLine)) {
        iniContent += `\n${extLine}`;
      }
    } else {
      // Disable extension
      if (iniContent.includes(extLine) && !iniContent.includes(commentedLine)) {
        iniContent = iniContent.replace(extLine, commentedLine);
      }
    }

    await fs.writeFile(iniPath, iniContent);

    // Update cached extensions
    versionInfo.extensions = await this.discoverExtensions(versionInfo.path, version);
    this.configStore.set('phpVersions', this.phpVersions);

    return { success: true, extension, enabled };
  }

  async createDefaultIni(phpPath, version) {
    const iniPath = path.join(phpPath, 'php.ini');
    const templatePath = path.join(phpPath, 'php.ini-development');

    if (await fs.pathExists(templatePath)) {
      await fs.copy(templatePath, iniPath);
    } else {
      // Create basic php.ini
      const basicIni = `
[PHP]
; Basic PHP Configuration for DevBox Pro
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
zend.exception_ignore_args = On
expose_php = Off
max_execution_time = 30
max_input_time = 60
memory_limit = 256M
error_reporting = E_ALL
display_errors = On
display_startup_errors = On
log_errors = On
error_log = ${path.join(phpPath, 'php_errors.log').replace(/\\/g, '/')}
post_max_size = 64M
upload_max_filesize = 64M
max_file_uploads = 20
date.timezone = UTC

; Extensions (uncomment to enable)
extension_dir = "${path.join(phpPath, 'ext').replace(/\\/g, '/')}"

; Common extensions
extension=curl
extension=fileinfo
extension=gd
extension=intl
extension=mbstring
extension=openssl
extension=pdo_mysql
extension=pdo_sqlite
;extension=xdebug

[Session]
session.save_handler = files
session.save_path = "${path.join(phpPath, 'sessions').replace(/\\/g, '/')}"
session.use_strict_mode = 1
session.use_cookies = 1
session.use_only_cookies = 1
session.name = PHPSESSID
session.auto_start = 0
session.cookie_lifetime = 0
session.gc_maxlifetime = 1440

[opcache]
opcache.enable = 1
opcache.memory_consumption = 128
opcache.max_accelerated_files = 10000
opcache.revalidate_freq = 0
`;

      await fs.writeFile(iniPath, basicIni);
      await fs.ensureDir(path.join(phpPath, 'sessions'));
    }
  }

  async runCommand(version, workingDir, command) {
    const phpPath = this.getPhpBinaryPath(version);

    return new Promise((resolve, reject) => {
      const proc = spawn(phpPath, ['-r', command], {
        cwd: workingDir,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
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
          resolve({ success: true, output: stdout });
        } else {
          reject(new Error(stderr || `Command failed with code ${code}`));
        }
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });
  }

  async runArtisan(version, projectPath, artisanCommand) {
    const phpPath = this.getPhpBinaryPath(version);
    const artisanPath = path.join(projectPath, 'artisan');

    if (!(await fs.pathExists(artisanPath))) {
      throw new Error('This is not a Laravel project (artisan not found)');
    }

    return new Promise((resolve, reject) => {
      const args = ['artisan', ...artisanCommand.split(' ')];
      const proc = spawn(phpPath, args, {
        cwd: projectPath,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
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
        resolve({
          success: code === 0,
          output: stdout,
          error: stderr,
          code,
        });
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });
  }

  async runComposer(version, projectPath, composerCommand) {
    const phpPath = this.getPhpBinaryPath(version);
    const composerPath = this.getComposerPath();

    return new Promise((resolve, reject) => {
      const args = [composerPath, ...composerCommand.split(' ')];
      const proc = spawn(phpPath, args, {
        cwd: projectPath,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
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
        resolve({
          success: code === 0,
          output: stdout,
          error: stderr,
          code,
        });
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });
  }

  getComposerPath() {
    return path.join(this.resourcePath, 'composer', 'composer.phar');
  }

  async getPhpInfo(version) {
    const phpPath = this.getPhpBinaryPath(version);

    return new Promise((resolve, reject) => {
      const proc = spawn(phpPath, ['-i'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.on('close', () => {
        resolve(stdout);
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });
  }
}

module.exports = { PhpManager };
