const path = require('path');
const fs = require('fs-extra');
const https = require('https');
const { execFile } = require('child_process');

const SERVICE_DISPLAY_NAMES = {
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  postgresql: 'PostgreSQL',
  mongodb: 'MongoDB',
  redis: 'Redis',
  python: 'Python',
  memcached: 'Memcached',
  minio: 'MinIO',
};

const LINUX_COMMAND_FALLBACKS = {
  bash: ['/bin/bash', '/usr/bin/bash'],
  sudo: ['/usr/bin/sudo', '/bin/sudo'],
  pkexec: ['/usr/bin/pkexec', '/bin/pkexec'],
  'apt-get': ['/usr/bin/apt-get', '/bin/apt-get'],
  dnf: ['/usr/bin/dnf', '/bin/dnf'],
  yum: ['/usr/bin/yum', '/bin/yum'],
  zypper: ['/usr/bin/zypper', '/bin/zypper'],
  pacman: ['/usr/bin/pacman', '/bin/pacman'],
  'wsl.exe': ['/mnt/c/Windows/System32/wsl.exe'],
};

const LINUX_SHARED_LIBRARY_PACKAGE_MAP = {
  'libaio.so.1': {
    'apt-get': ['libaio1'],
    dnf: ['libaio'],
    yum: ['libaio'],
    zypper: ['libaio1', 'libaio'],
    pacman: ['libaio'],
  },
  'libnuma.so.1': {
    'apt-get': ['libnuma1'],
    dnf: ['numactl-libs', 'numactl'],
    yum: ['numactl-libs', 'numactl'],
    zypper: ['libnuma1', 'numactl'],
    pacman: ['numactl'],
  },
  'libncurses.so.5': {
    'apt-get': ['libncurses5', 'libncurses6'],
    dnf: ['ncurses-compat-libs', 'ncurses-libs'],
    yum: ['ncurses-compat-libs', 'ncurses-libs'],
    zypper: ['libncurses5', 'libncurses6'],
    pacman: ['ncurses'],
  },
  'libtinfo.so.5': {
    'apt-get': ['libtinfo5', 'libncurses6'],
    dnf: ['ncurses-compat-libs', 'ncurses-libs'],
    yum: ['ncurses-compat-libs', 'ncurses-libs'],
    zypper: ['libtinfo5', 'libncurses6'],
    pacman: ['ncurses'],
  },
  'libssl.so.1.1': {
    'apt-get': ['libssl1.1', 'libssl3'],
    dnf: ['compat-openssl11', 'openssl-libs'],
    yum: ['compat-openssl11', 'openssl-libs'],
    zypper: ['libopenssl1_1', 'libopenssl3'],
    pacman: ['openssl'],
  },
  'libcrypto.so.1.1': {
    'apt-get': ['libssl1.1', 'libssl3'],
    dnf: ['compat-openssl11', 'openssl-libs'],
    yum: ['compat-openssl11', 'openssl-libs'],
    zypper: ['libopenssl1_1', 'libopenssl3'],
    pacman: ['openssl'],
  },
};

function execFileAsync(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

module.exports = {
  async resolveGithubReleaseAsset(repo, primaryPattern, fallbackPatterns = []) {
    const patterns = [primaryPattern, ...fallbackPatterns]
      .filter(Boolean)
      .map((pattern) => new RegExp(pattern, 'i'));

    const release = await new Promise((resolve, reject) => {
      const request = https.get({
        hostname: 'api.github.com',
        path: `/repos/${repo}/releases/latest`,
        headers: {
          'User-Agent': 'DevBoxPro-App',
          Accept: 'application/vnd.github.v3+json',
        },
      }, (response) => {
        let raw = '';

        response.on('data', (chunk) => {
          raw += chunk.toString();
        });

        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(new Error(`GitHub API returned status ${response.statusCode}`));
            return;
          }

          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error('Failed to parse GitHub release response'));
          }
        });
      });

      request.on('error', reject);
      request.setTimeout(15000, () => {
        request.destroy(new Error('GitHub release lookup timed out'));
      });
    });

    const assets = Array.isArray(release?.assets) ? release.assets : [];
    for (const pattern of patterns) {
      const asset = assets.find((entry) => pattern.test(entry.name || ''));
      if (asset) {
        return {
          url: asset.browser_download_url,
          filename: asset.name,
          tagName: release.tag_name,
        };
      }
    }

    throw new Error(`No matching asset found in ${repo} latest release`);
  },

  async findBinaryInDir(dir, exeName) {
    if (!dir || !await fs.pathExists(dir)) {
      return null;
    }

    const directPath = path.join(dir, exeName);
    if (await fs.pathExists(directPath)) {
      return directPath;
    }

    return this.findExecutableRecursive(dir, exeName, 0, 3);
  },

  async execLinuxCommand(command, args = [], options = {}) {
    return execFileAsync(command, args, options);
  },

  async isRunningInWsl() {
    if (process.platform !== 'linux') {
      return false;
    }

    if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
      return true;
    }

    try {
      const procVersion = await fs.readFile('/proc/version', 'utf8');
      return /microsoft/i.test(String(procVersion || ''));
    } catch (_error) {
      return false;
    }
  },

  async detectLinuxPackageManager() {
    if (process.platform !== 'linux') {
      return null;
    }

    const managers = [
      { command: 'apt-get', install: (pkg) => `DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkg}` },
      { command: 'dnf', install: (pkg) => `dnf install -y ${pkg}` },
      { command: 'yum', install: (pkg) => `yum install -y ${pkg}` },
      { command: 'zypper', install: (pkg) => `zypper --non-interactive install ${pkg}` },
      { command: 'pacman', install: (pkg) => `pacman -Sy --noconfirm ${pkg}` },
    ];

    for (const manager of managers) {
      const resolved = await this.findLinuxCommand(manager.command);
      if (resolved) {
        return manager;
      }
    }

    return null;
  },

  async findLinuxCommand(command) {
    if (process.platform !== 'linux') {
      return null;
    }

    for (const fallbackPath of LINUX_COMMAND_FALLBACKS[command] || []) {
      if (await fs.pathExists(fallbackPath)) {
        return fallbackPath;
      }
    }

    const bashPath = (LINUX_COMMAND_FALLBACKS.bash || []).find((candidate) => fs.existsSync(candidate)) || '/bin/bash';

    try {
      const { stdout } = await this.execLinuxCommand(bashPath, ['-lc', `command -v ${command}`], { encoding: 'utf8' });
      const resolved = String(stdout || '').trim();
      return resolved || null;
    } catch (_error) {
      return null;
    }
  },

  async hasLinuxSharedLibrary(libraryNames = []) {
    if (process.platform !== 'linux') {
      return false;
    }

    const names = Array.isArray(libraryNames) ? libraryNames : [libraryNames];
    try {
      const { stdout } = await this.execLinuxCommand('bash', ['-lc', 'ldconfig -p 2>/dev/null || true'], { encoding: 'utf8' });
      return names.some((name) => String(stdout || '').includes(name));
    } catch (_error) {
      return false;
    }
  },

  async resolveLinuxPackageName(packageManager, packageCandidates = []) {
    const candidates = Array.isArray(packageCandidates) ? packageCandidates.filter(Boolean) : [packageCandidates].filter(Boolean);
    if (candidates.length === 0) {
      return null;
    }

    if (!packageManager || packageManager.command !== 'apt-get') {
      return candidates[0];
    }

    for (const candidate of candidates) {
      try {
        const { stdout } = await this.execLinuxCommand('bash', ['-lc', `apt-cache policy ${candidate}`], { encoding: 'utf8' });
        if (!/Candidate:\s*\(none\)/i.test(String(stdout || ''))) {
          return candidate;
        }
      } catch (_error) {
        // try next candidate
      }
    }

    return candidates[0];
  },

  getLinuxServiceDisplayName(serviceName, version = null) {
    const baseLabel = SERVICE_DISPLAY_NAMES[serviceName] || serviceName;
    return version ? `${baseLabel} ${version}` : baseLabel;
  },

  parseMissingLinuxSharedLibraries(output = '') {
    const missingLibraries = new Set();
    const regex = /^\s*(\S+)\s+=>\s+not found\s*$/gim;
    let match;

    while ((match = regex.exec(String(output || ''))) !== null) {
      missingLibraries.add(match[1]);
    }

    return Array.from(missingLibraries);
  },

  async findMissingLinuxSharedLibraries(binaryPaths = []) {
    if (process.platform !== 'linux') {
      return [];
    }

    const candidates = Array.isArray(binaryPaths) ? binaryPaths : [binaryPaths];
    const missingLibraries = new Set();

    for (const binaryPath of candidates.filter(Boolean)) {
      if (!await fs.pathExists(binaryPath)) {
        continue;
      }

      try {
        const { stdout, stderr } = await this.execLinuxCommand('ldd', [binaryPath], { encoding: 'utf8' });
        for (const library of this.parseMissingLinuxSharedLibraries(`${stdout || ''}\n${stderr || ''}`)) {
          missingLibraries.add(library);
        }
      } catch (error) {
        const output = `${error?.stdout || ''}\n${error?.stderr || ''}\n${error?.message || ''}`;
        if (/not a dynamic executable|statically linked/i.test(output)) {
          continue;
        }

        for (const library of this.parseMissingLinuxSharedLibraries(output)) {
          missingLibraries.add(library);
        }
      }
    }

    return Array.from(missingLibraries);
  },

  async ensureLinuxBinarySystemDependencies(serviceName, version = null, binaryPaths = [], options = {}) {
    if (process.platform !== 'linux') {
      return { success: true, skipped: true };
    }

    const candidates = Array.isArray(binaryPaths) ? binaryPaths.filter(Boolean) : [binaryPaths].filter(Boolean);
    if (candidates.length === 0) {
      return { success: true, skipped: true };
    }

    const missingLibraries = await this.findMissingLinuxSharedLibraries(candidates);
    if (missingLibraries.length === 0) {
      return { success: true, installed: [], alreadyInstalled: true };
    }

    const packageManager = await this.detectLinuxPackageManager();
    if (!packageManager) {
      throw new Error(`No supported Linux package manager was found. DevBox Pro could not install the runtime dependencies for ${this.getLinuxServiceDisplayName(serviceName, version)} automatically.`);
    }

    const packagesToInstall = [];
    const unresolvedLibraries = [];

    for (const libraryName of missingLibraries) {
      const packageCandidates = LINUX_SHARED_LIBRARY_PACKAGE_MAP[libraryName]?.[packageManager.command] || [];
      const packageName = await this.resolveLinuxPackageName(packageManager, packageCandidates);
      if (packageName) {
        if (!packagesToInstall.includes(packageName)) {
          packagesToInstall.push(packageName);
        }
        continue;
      }

      unresolvedLibraries.push(libraryName);
    }

    if (packagesToInstall.length === 0) {
      throw new Error(`DevBox Pro found missing Linux runtime libraries for ${this.getLinuxServiceDisplayName(serviceName, version)} (${missingLibraries.join(', ')}), but it does not yet know which ${packageManager.command} packages provide them.`);
    }

    if (options.id) {
      this.emitProgress(options.id, {
        status: 'installing',
        progress: options.progress ?? 88,
        message: options.message || `Installing ${this.getLinuxServiceDisplayName(serviceName, version)} runtime dependencies with ${packageManager.command}...`,
      });
    }

    await this.runPrivilegedLinuxCommand(packageManager.install(packagesToInstall.join(' ')));

    const remainingLibraries = await this.findMissingLinuxSharedLibraries(candidates);
    if (remainingLibraries.length > 0) {
      throw new Error(`Installed Linux packages for ${this.getLinuxServiceDisplayName(serviceName, version)}, but these libraries are still missing: ${remainingLibraries.join(', ')}.`);
    }

    if (unresolvedLibraries.length > 0) {
      this.managers?.log?.systemWarn(`Installed partial Linux runtime dependencies for ${this.getLinuxServiceDisplayName(serviceName, version)}`, {
        unresolvedLibraries,
      });
    }

    return { success: true, installed: packagesToInstall, missingLibraries };
  },

  async runPrivilegedLinuxCommand(command) {
    if (process.platform !== 'linux') {
      const sudo = require('sudo-prompt');
      const options = { name: 'DevBox Pro' };

      return new Promise((resolve, reject) => {
        sudo.exec(command, options, (error, stdout, stderr) => {
          if (error) {
            error.stdout = stdout;
            error.stderr = stderr;
            reject(error);
            return;
          }

          resolve({ stdout, stderr });
        });
      });
    }

    const bashPath = await this.findLinuxCommand('bash') || '/bin/bash';

    try {
      const { stdout } = await this.execLinuxCommand(bashPath, ['-lc', 'id -u'], { encoding: 'utf8' });
      if (String(stdout || '').trim() === '0') {
        return this.execLinuxCommand(bashPath, ['-lc', command], { encoding: 'utf8' });
      }
    } catch (_error) {
      // continue with other elevation strategies
    }

    if (await this.isRunningInWsl()) {
      const distroName = String(process.env.WSL_DISTRO_NAME || '').trim();
      const wslExecutable = await this.findLinuxCommand('wsl.exe') || '/mnt/c/Windows/System32/wsl.exe';
      if (wslExecutable) {
        const wslArgs = distroName
          ? ['-d', distroName, '-u', 'root', '--', 'bash', '-lc', command]
          : ['-u', 'root', '--', 'bash', '-lc', command];
        try {
          return await this.execLinuxCommand(
            wslExecutable,
            wslArgs,
            { encoding: 'utf8' }
          );
        } catch (_error) {
          // fall through to sudo/pkexec strategies
        }
      }
    }

    try {
      const sudoPath = await this.findLinuxCommand('sudo') || '/usr/bin/sudo';
      return await this.execLinuxCommand(sudoPath, ['-n', bashPath, '-lc', command], { encoding: 'utf8' });
    } catch (error) {
      const stderr = String(error?.stderr || error?.message || '');
      const requiresPassword = /password is required|a password is required|sudo:/i.test(stderr);
      if (!requiresPassword) {
        throw error;
      }
    }

    const hasPkexec = await this.findLinuxCommand('pkexec');
    if (hasPkexec) {
      try {
        return await this.execLinuxCommand(hasPkexec, [bashPath, '-lc', command], { encoding: 'utf8' });
      } catch (error) {
        const detail = `${error?.stderr || ''} ${error?.message || ''}`.trim();
        if (/No polkit authentication agent found|No session for cookie|Not authorized/i.test(detail)) {
          if (await this.isRunningInWsl()) {
            throw new Error('DevBox Pro cannot elevate inside WSLg because no polkit authentication agent is available. Run `sudo apt-get install -y nginx` once in WSL, then click Install again and DevBox Pro will finish staging and manage nginx from the app.');
          }

          throw new Error('No polkit authentication agent is available for GUI elevation. Install nginx from a terminal once, then click Install again so DevBox Pro can finish staging and manage it.');
        }

        throw error;
      }
    }

    if (await this.isRunningInWsl()) {
      throw new Error('DevBox Pro cannot elevate inside WSL because GUI privilege escalation is unavailable here. Run `sudo apt-get install -y nginx` once in WSL, then click Install again and DevBox Pro will finish staging and manage nginx from the app.');
    }

    throw new Error('No supported privilege escalation method is available. Install nginx from a terminal once, then click Install again so DevBox Pro can finish staging and manage it.');
  },

  async ensureManagedLinuxNginxRuntime(version = '1.28') {
    const nginxBinary = await this.findLinuxCommand('nginx');
    if (!nginxBinary) {
      throw new Error('nginx was not found after installation. Verify the package manager install succeeded and try again.');
    }

    const platform = this.getPlatform();
    const extractPath = path.join(this.resourcesPath, 'nginx', version, platform);
    const confDir = path.join(extractPath, 'conf');
    const wrapperPath = path.join(extractPath, 'nginx');
    const mimeTypesSource = '/etc/nginx/mime.types';
    const fastcgiParamsSource = '/etc/nginx/fastcgi_params';

    await fs.ensureDir(confDir);

    const wrapperScript = `#!/usr/bin/env bash
exec "${nginxBinary}" "$@"
`;
    await fs.writeFile(wrapperPath, wrapperScript, { mode: 0o755 });
    await fs.chmod(wrapperPath, 0o755);

    if (await fs.pathExists(mimeTypesSource)) {
      await fs.copy(mimeTypesSource, path.join(confDir, 'mime.types'), { overwrite: true });
    } else {
      await fs.writeFile(path.join(confDir, 'mime.types'), 'types {}\n');
    }

    if (await fs.pathExists(fastcgiParamsSource)) {
      await fs.copy(fastcgiParamsSource, path.join(confDir, 'fastcgi_params'), { overwrite: true });
    } else {
      await fs.writeFile(path.join(confDir, 'fastcgi_params'), 'fastcgi_param QUERY_STRING $query_string;\nfastcgi_param REQUEST_METHOD $request_method;\nfastcgi_param CONTENT_TYPE $content_type;\nfastcgi_param CONTENT_LENGTH $content_length;\nfastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;\nfastcgi_param SCRIPT_NAME $fastcgi_script_name;\nfastcgi_param REQUEST_URI $request_uri;\nfastcgi_param DOCUMENT_URI $document_uri;\nfastcgi_param DOCUMENT_ROOT $document_root;\nfastcgi_param SERVER_PROTOCOL $server_protocol;\nfastcgi_param REQUEST_SCHEME $scheme;\nfastcgi_param HTTPS $https if_not_empty;\nfastcgi_param GATEWAY_INTERFACE CGI/1.1;\nfastcgi_param SERVER_SOFTWARE nginx/$nginx_version;\nfastcgi_param REMOTE_ADDR $remote_addr;\nfastcgi_param REMOTE_PORT $remote_port;\nfastcgi_param REMOTE_USER $remote_user;\nfastcgi_param SERVER_ADDR $server_addr;\nfastcgi_param SERVER_PORT $server_port;\nfastcgi_param SERVER_NAME $server_name;\n');
    }

    await this.createNginxConfig(extractPath);
  },

  async ensureManagedLinuxRedisRuntime(version = '7.4') {
    const redisServerBinary = await this.findLinuxCommand('redis-server');
    if (!redisServerBinary) {
      throw new Error('redis-server was not found after installation. Verify the package manager install succeeded and try again.');
    }

    const redisCliBinary = await this.findLinuxCommand('redis-cli');
    const platform = this.getPlatform();
    const extractPath = path.join(this.resourcesPath, 'redis', version, platform);

    await fs.ensureDir(extractPath);

    const redisServerWrapper = `#!/usr/bin/env bash
exec "${redisServerBinary}" "$@"
`;
    await fs.writeFile(path.join(extractPath, 'redis-server'), redisServerWrapper, { mode: 0o755 });
    await fs.chmod(path.join(extractPath, 'redis-server'), 0o755);

    if (redisCliBinary) {
      const redisCliWrapper = `#!/usr/bin/env bash
exec "${redisCliBinary}" "$@"
`;
      await fs.writeFile(path.join(extractPath, 'redis-cli'), redisCliWrapper, { mode: 0o755 });
      await fs.chmod(path.join(extractPath, 'redis-cli'), 0o755);
    }
  },

  async installManagedLinuxNginx(version = '1.28', downloadInfo = {}) {
    const id = `nginx-${version}`;
    const packageName = downloadInfo.packageName || 'nginx';

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      let nginxBinary = await this.findLinuxCommand('nginx');

      if (!nginxBinary) {
        const packageManager = await this.detectLinuxPackageManager();
        if (!packageManager) {
          throw new Error('No supported Linux package manager was found. Install nginx manually, then try Install again so DevBox Pro can stage it for management.');
        }

        this.emitProgress(id, { status: 'installing', progress: 40, message: `Installing ${packageName} with ${packageManager.command}...` });
        await this.runPrivilegedLinuxCommand(packageManager.install(packageName));
        nginxBinary = await this.findLinuxCommand('nginx');
      }

      this.emitProgress(id, { status: 'installing', progress: 80, message: 'Preparing DevBox Pro nginx runtime...' });
      await this.ensureManagedLinuxNginxRuntime(version);
      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version, systemManaged: true, binary: nginxBinary };
    } catch (error) {
      this.managers?.log?.systemError(`Failed to install managed Linux Nginx ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

  async installManagedLinuxRedis(version = '7.4', downloadInfo = {}) {
    const id = `redis-${version}`;
    const packageCandidatesByManager = downloadInfo.packageNames || {
      'apt-get': ['redis-server', 'redis'],
      dnf: ['redis'],
      yum: ['redis'],
      zypper: ['redis'],
      pacman: ['redis'],
    };

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      let redisBinary = await this.findLinuxCommand('redis-server');

      if (!redisBinary) {
        const packageManager = await this.detectLinuxPackageManager();
        if (!packageManager) {
          throw new Error('No supported Linux package manager was found. Install Redis manually, then try Install again so DevBox Pro can stage it for management.');
        }

        const packageName = await this.resolveLinuxPackageName(packageManager, packageCandidatesByManager[packageManager.command] || []);
        if (!packageName) {
          throw new Error(`DevBox Pro could not determine which ${packageManager.command} package provides Redis.`);
        }

        this.emitProgress(id, { status: 'installing', progress: 40, message: `Installing ${packageName} with ${packageManager.command}...` });
        await this.runPrivilegedLinuxCommand(packageManager.install(packageName));
        redisBinary = await this.findLinuxCommand('redis-server');
      }

      this.emitProgress(id, { status: 'installing', progress: 80, message: 'Preparing DevBox Pro Redis runtime...' });
      await this.ensureManagedLinuxRedisRuntime(version);
      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version, systemManaged: true, binary: redisBinary };
    } catch (error) {
      this.managers?.log?.systemError(`Failed to install managed Linux Redis ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

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
      await this.ensureLinuxBinarySystemDependencies('mysql', version, [path.join(extractPath, 'bin', 'mysqld')], { id });
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
  },

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
      await this.ensureLinuxBinarySystemDependencies('mariadb', version, [
        path.join(extractPath, 'bin', 'mariadbd'),
        path.join(extractPath, 'bin', 'mariadb-install-db'),
      ], { id });
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
  },

  async downloadRedis(version = '7.4') {
    const id = `redis-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.redis[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`Redis ${version} not available for ${platform}`);
    }

    if (process.platform === 'linux' && (downloadInfo.manageWithPackageManager || downloadInfo.url === 'builtin' || downloadInfo.requiresBuild)) {
      return this.installManagedLinuxRedis(version, downloadInfo);
    }

    if (downloadInfo.url === 'builtin') {
      throw new Error(downloadInfo.note || `Redis ${version} is provided by the operating system on ${platform}. Install it with your package manager.`);
    }

    if (downloadInfo.requiresBuild) {
      throw new Error(`Redis ${version} for ${platform} is only available as source and requires a manual build. Use the source link or import a prebuilt archive instead.`);
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
      await this.ensureLinuxBinarySystemDependencies('redis', version, [path.join(extractPath, 'redis-server')], { id });
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
  },

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
  },

  async downloadCloudflared() {
    const id = 'cloudflared';
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.cloudflared?.[platform];

    if (!downloadInfo) {
      throw new Error(`cloudflared not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const targetDir = path.join(this.resourcesPath, 'cloudflared', platform);
      await fs.remove(targetDir);
      await fs.ensureDir(targetDir);

      if (platform === 'win' || platform === 'linux') {
        const destPath = path.join(targetDir, platform === 'win' ? 'cloudflared.exe' : 'cloudflared');
        await this.downloadFile(downloadInfo.url, destPath, id);
        await this.checkCancelled(id, destPath);
        if (platform !== 'win') {
          await fs.chmod(destPath, '755');
        }
      } else {
        const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
        await this.downloadFile(downloadInfo.url, downloadPath, id);
        await this.checkCancelled(id, downloadPath);
        await this.extractArchive(downloadPath, targetDir, id);
        await fs.remove(downloadPath);

        const binaryPath = await this.findBinaryInDir(targetDir, 'cloudflared');
        if (binaryPath) {
          await fs.chmod(binaryPath, '755');
        }
      }

      try {
        const meta = await this.fetchRemoteMetadata(downloadInfo.url);
        await this.saveServiceMetadata('cloudflared', meta);
      } catch (metaErr) {
        this.managers?.log?.systemWarn('Failed to fetch cloudflared metadata', { error: metaErr.message });
      }

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError('Failed to download cloudflared', { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

  async downloadZrok() {
    const id = 'zrok';
    const platform = this.getPlatform();
    const configuredInfo = this.downloads.zrok?.[platform];

    if (!configuredInfo) {
      throw new Error(`zrok not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const resolvedInfo = configuredInfo.githubRepo
        ? await this.resolveGithubReleaseAsset(
          configuredInfo.githubRepo,
          configuredInfo.assetPattern,
          configuredInfo.fallbackAssetPatterns || []
        )
        : configuredInfo;

      const downloadPath = path.join(this.resourcesPath, 'downloads', resolvedInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'zrok', platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(resolvedInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);
      await fs.remove(downloadPath);

      const expectedBinaryName = platform === 'win' ? 'zrok.exe' : 'zrok';
      const binaryCandidates = platform === 'win' ? ['zrok.exe', 'zrok2.exe'] : ['zrok', 'zrok2'];
      let binaryPath = null;

      for (const candidate of binaryCandidates) {
        binaryPath = await this.findBinaryInDir(extractPath, candidate);
        if (!binaryPath) {
          continue;
        }

        const normalizedBinaryPath = path.join(path.dirname(binaryPath), expectedBinaryName);
        if (binaryPath !== normalizedBinaryPath) {
          await fs.move(binaryPath, normalizedBinaryPath, { overwrite: true });
          binaryPath = normalizedBinaryPath;
        }
        break;
      }

      if (!binaryPath) {
        throw new Error('zrok executable was not found after extraction');
      }

      if (platform !== 'win') {
        await fs.chmod(binaryPath, '755');
      }

      try {
        const meta = await this.fetchRemoteMetadata(resolvedInfo.url);
        await this.saveServiceMetadata('zrok', {
          ...meta,
          tagName: resolvedInfo.tagName || null,
        });
      } catch (metaErr) {
        this.managers?.log?.systemWarn('Failed to fetch zrok metadata', { error: metaErr.message });
      }

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError('Failed to download zrok', { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

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

      try {
        const meta = await this.fetchRemoteMetadata(downloadInfo.url);
        await this.saveServiceMetadata('phpmyadmin', meta);
      } catch (metaErr) {
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
  },

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
  },

  async downloadNginx(version = '1.28') {
    const id = `nginx-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.nginx[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`Nginx ${version} not available for ${platform}`);
    }

    if (process.platform === 'linux' && (downloadInfo.manageWithPackageManager || downloadInfo.url === 'builtin' || downloadInfo.requiresBuild)) {
      return this.installManagedLinuxNginx(version, downloadInfo);
    }

    if (downloadInfo.url === 'builtin') {
      throw new Error(downloadInfo.note || `Nginx ${version} is provided by the operating system on ${platform}. Install it with your package manager.`);
    }

    if (downloadInfo.requiresBuild) {
      throw new Error(`Nginx ${version} for ${platform} is only available as source and requires a manual build. Use the source link or import a prebuilt archive instead.`);
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
  },

  async createNginxConfig(nginxPath) {
    const confDir = path.join(nginxPath, 'conf');
    const sitesDir = path.join(nginxPath, 'conf', 'sites-enabled');
    await fs.ensureDir(confDir);
    await fs.ensureDir(sitesDir);

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

    location ~ \.php$ {
        fastcgi_pass   127.0.0.1:9000;
        fastcgi_index  index.php;
        fastcgi_param  SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include        fastcgi_params;
    }

    location ~ /\.ht {
        deny  all;
    }
}
`;
    await fs.writeFile(path.join(sitesDir, 'default.conf.example'), defaultSite);
    await fs.ensureDir(path.join(nginxPath, 'logs'));
  },

  async downloadApache(version = '2.4') {
    const id = `apache-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.apache[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`Apache ${version} not available for ${platform}`);
    }

    if (downloadInfo.url === 'builtin') {
      throw new Error(downloadInfo.note || `Apache ${version} is provided by the operating system on ${platform}. Install it with your package manager.`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'apache', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      const urls = [downloadInfo.url, ...(downloadInfo.fallbackUrls || [])];
      let downloaded = false;

      for (const url of urls) {
        try {
          await this.downloadFile(url, downloadPath, id);
          downloaded = true;
          break;
        } catch (err) {
          await fs.remove(downloadPath).catch(() => { });
        }
      }

      if (!downloaded) {
        const manualNote = downloadInfo.manualDownloadNote || '';
        const manualUrl = downloadInfo.manualDownloadUrl || 'https://www.apachelounge.com/download/';
        throw new Error(`Apache download failed. ${manualNote} Manual download: ${manualUrl}`);
      }

      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);

      const apache24Path = path.join(extractPath, 'Apache24');
      if (await fs.pathExists(apache24Path)) {
        const contents = await fs.readdir(apache24Path);
        for (const item of contents) {
          const srcPath = path.join(apache24Path, item);
          const destPath = path.join(extractPath, item);
          await fs.move(srcPath, destPath, { overwrite: true });
        }
        await fs.remove(apache24Path);
      }

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
  },

  async importApache(filePath, version = '2.4') {
    const id = `apache-${version}`;
    const platform = this.getPlatform();

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      if (!await fs.pathExists(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const isValid = await this.validateZipFile(filePath);
      if (!isValid) {
        throw new Error('Invalid ZIP file. Please download the correct Apache ZIP from Apache Lounge.');
      }

      const extractPath = path.join(this.resourcesPath, 'apache', version, platform);
      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      this.emitProgress(id, { status: 'extracting', progress: 50 });
      await this.extractArchive(filePath, extractPath, id);

      const apache24Path = path.join(extractPath, 'Apache24');
      if (await fs.pathExists(apache24Path)) {
        const contents = await fs.readdir(apache24Path);
        for (const item of contents) {
          const srcPath = path.join(apache24Path, item);
          const destPath = path.join(extractPath, item);
          await fs.move(srcPath, destPath, { overwrite: true });
        }
        await fs.remove(apache24Path);
      }

      await this.createApacheConfig(extractPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

  async createApacheConfig(apachePath) {
    const confDir = path.join(apachePath, 'conf');
    const extraDir = path.join(apachePath, 'conf', 'extra');
    const vhostsDir = path.join(apachePath, 'conf', 'vhosts');
    await fs.ensureDir(confDir);
    await fs.ensureDir(extraDir);
    await fs.ensureDir(vhostsDir);

    const phpConfig = `
# PHP Configuration for Apache
# DevBox Pro will configure the correct PHP path automatically

# Load PHP module (Windows example - adjust path based on PHP version)
# LoadModule php_module "C:/devbox/php/8.3/win/php8apache2_4.dll"

# For PHP-FPM (recommended)
<FilesMatch \.php$>
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
    await fs.ensureDir(path.join(apachePath, 'logs'));
  },

  generateSecret(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=';
    let result = '';
    for (let i = 0; i < length; i += 1) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },
};