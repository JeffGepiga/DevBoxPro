const fs = require('fs');
const path = require('path');

function getPlatformKey() {
  if (process.platform === 'win32') {
    return 'win';
  }

  if (process.platform === 'darwin') {
    return 'mac';
  }

  return 'linux';
}

function getPhpRootPath(resourcesPath, version, platform = getPlatformKey()) {
  return path.join(resourcesPath, 'php', version, platform);
}

function getPhpBinaryCandidates(resourcesPath, version, platform = getPlatformKey()) {
  const phpRoot = getPhpRootPath(resourcesPath, version, platform);

  if (platform === 'win') {
    return [path.join(phpRoot, 'php.exe')];
  }

  return [
    path.join(phpRoot, 'php'),
    path.join(phpRoot, 'usr', 'bin', `php${version}`),
  ];
}

function getPhpCgiCandidates(resourcesPath, version, platform = getPlatformKey()) {
  const phpRoot = getPhpRootPath(resourcesPath, version, platform);

  if (platform === 'win') {
    return [path.join(phpRoot, 'php-cgi.exe')];
  }

  return [
    path.join(phpRoot, 'php-cgi'),
    path.join(phpRoot, 'usr', 'bin', `php-cgi${version}`),
  ];
}

function resolveFirstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolvePhpBinaryPath(resourcesPath, version, platform = getPlatformKey()) {
  return resolveFirstExistingPath(getPhpBinaryCandidates(resourcesPath, version, platform));
}

function resolvePhpCgiPath(resourcesPath, version, platform = getPlatformKey()) {
  return resolveFirstExistingPath(getPhpCgiCandidates(resourcesPath, version, platform));
}

function resolvePhpExtensionDir(resourcesPath, version, platform = getPlatformKey()) {
  const phpRoot = getPhpRootPath(resourcesPath, version, platform);

  if (platform === 'win') {
    return path.join(phpRoot, 'ext');
  }

  const packagedExtensionsRoot = path.join(phpRoot, 'usr', 'lib', 'php');
  if (fs.existsSync(packagedExtensionsRoot)) {
    const numericDirs = fs.readdirSync(packagedExtensionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));

    if (numericDirs.length > 0) {
      return path.join(packagedExtensionsRoot, numericDirs[0]);
    }
  }

  return path.join(phpRoot, 'lib', 'php', 'extensions');
}

module.exports = {
  getPlatformKey,
  getPhpRootPath,
  resolvePhpBinaryPath,
  resolvePhpCgiPath,
  resolvePhpExtensionDir,
};