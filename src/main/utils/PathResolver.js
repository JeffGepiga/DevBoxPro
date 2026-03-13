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

function getPortableRoot(app) {
  const exePath = typeof app?.getPath === 'function' ? app.getPath('exe') : '';

  if (exePath === cachedExePath && cachedPortableRoot !== undefined) {
    return cachedPortableRoot;
  }

  const exeDir = getExeDir(app);
  const flagPath = path.join(exeDir, 'portable.flag');

  cachedExePath = exePath;
  cachedPortableRoot = fs.existsSync(flagPath) ? exeDir : null;
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