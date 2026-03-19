const fs = require('fs');
const os = require('os');
const path = require('path');

let cachedExePath;
let cachedPortableRoot;

function getExeDir(app) {
  const exePath = typeof app?.getPath === 'function' ? app.getPath('exe') : '';
  if (!exePath) {
    return process.cwd();
  }
  return path.dirname(exePath);
}

function normalizePathForComparison(targetPath) {
  if (!targetPath) {
    return '';
  }

  const normalized = path.normalize(targetPath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isPathInside(parentPath, childPath) {
  const normalizedParent = normalizePathForComparison(parentPath);
  const normalizedChild = normalizePathForComparison(childPath);

  if (!normalizedParent || !normalizedChild) {
    return false;
  }

  const relativePath = path.relative(normalizedParent, normalizedChild);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function isLikelyStandardInstallDir(exeDir) {
  if (process.platform !== 'win32') {
    return false;
  }

  const candidateRoots = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : null,
    process.env.ProgramFiles || null,
    process.env['ProgramFiles(x86)'] || null,
  ].filter(Boolean);

  return candidateRoots.some((rootPath) => isPathInside(rootPath, exeDir));
}

function getPortableRoot(app) {
  const exePath = typeof app?.getPath === 'function' ? app.getPath('exe') : '';

  if (exePath === cachedExePath && cachedPortableRoot !== undefined) {
    return cachedPortableRoot;
  }

  const exeDir = getExeDir(app);
  const flagPath = path.join(exeDir, 'portable.flag');
  const hasPortableFlag = fs.existsSync(flagPath);

  cachedExePath = exePath;
  cachedPortableRoot = hasPortableFlag && !isLikelyStandardInstallDir(exeDir) ? exeDir : null;
  return cachedPortableRoot;
}

function getDataPath(app) {
  const portableRoot = getPortableRoot(app);
  if (portableRoot) {
    return path.join(portableRoot, 'data');
  }

  return path.join(os.homedir(), '.devbox-pro');
}

function getResourcesPath(app) {
  const portableRoot = getPortableRoot(app);
  if (portableRoot) {
    return path.join(portableRoot, 'resources-user');
  }

  return path.join(app.getPath('userData'), 'resources');
}

function getAppCachePath(app, ...segments) {
  const portableRoot = getPortableRoot(app);
  const basePath = portableRoot || app.getPath('userData');
  return segments.length > 0 ? path.join(basePath, ...segments) : basePath;
}

function __resetForTests() {
  cachedExePath = undefined;
  cachedPortableRoot = undefined;
}

module.exports = {
  getPortableRoot,
  getDataPath,
  getResourcesPath,
  getAppCachePath,
  __resetForTests,
};