const path = require('path');

async function cleanupStaleManagedWebServerProcesses(resourcePath, logger) {
  if (process.platform !== 'win32' || !resourcePath) {
    return [];
  }

  const { isProcessRunning, killProcessesByPath } = require('./SpawnUtils');

  const targets = [
    { processName: 'nginx.exe', pathFilter: path.join(resourcePath, 'nginx'), serviceName: 'nginx' },
    { processName: 'httpd.exe', pathFilter: path.join(resourcePath, 'apache'), serviceName: 'apache' },
  ];

  const cleanedServices = [];

  for (const target of targets) {
    if (!isProcessRunning(target.processName)) {
      continue;
    }

    try {
      await killProcessesByPath(target.processName, target.pathFilter);
      cleanedServices.push(target.serviceName);
    } catch (error) {
      logger?.systemWarn?.('Failed to clean stale managed web server process on startup', {
        service: target.serviceName,
        error: error.message,
      });
    }
  }

  if (cleanedServices.length > 0) {
    logger?.systemInfo?.('Cleaned stale DevBox web server processes on startup', {
      services: cleanedServices,
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return cleanedServices;
}

module.exports = {
  cleanupStaleManagedWebServerProcesses,
};