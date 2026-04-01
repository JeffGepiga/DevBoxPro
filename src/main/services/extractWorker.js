/**
 * Extract Worker - Runs ZIP extraction in a separate thread.
 * This prevents the main Electron process from freezing.
 */
process.noAsar = true;

const { parentPort, workerData } = require('worker_threads');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs-extra');

function detectCommonRoot(entries) {
  const firstEntry = entries.find((entry) => !entry.isDirectory && entry.entryName.includes('/'));
  if (!firstEntry) {
    return null;
  }

  const parts = firstEntry.entryName.split('/');
  if (parts.length < 2) {
    return null;
  }

  const commonRoot = `${parts[0]}/`;
  const allShareRoot = entries.every((entry) => entry.entryName.startsWith(commonRoot) || entry.entryName === parts[0]);
  return allShareRoot ? commonRoot : null;
}

function normalizeEntryPath(entryName, commonRoot) {
  if (commonRoot && entryName.startsWith(commonRoot)) {
    return entryName.substring(commonRoot.length);
  }

  return entryName;
}

function shouldSkipEntry(entryPath) {
  const normalized = entryPath.replace(/\\/g, '/');

  if (/\.asar(\/|$)/i.test(normalized) || normalized.toLowerCase().endsWith('.asar')) {
    return true;
  }

  if (/^(pgsql\/)?pgAdmin 4\//i.test(normalized) || /^(pgsql\/)?StackBuilder\//i.test(normalized)) {
    return true;
  }

  return false;
}

function isSafeExtractPath(destPath, targetPath) {
  const rootPath = path.resolve(destPath);
  const fullPath = path.resolve(destPath, targetPath);
  return fullPath === rootPath || fullPath.startsWith(`${rootPath}${path.sep}`);
}

async function extractZip() {
  const { archivePath, destPath } = workerData;

  try {
    const zip = new AdmZip(archivePath);
    const entries = zip.getEntries();
    const totalEntries = entries.length;
    let processed = 0;
    const commonRoot = detectCommonRoot(entries);

    for (const entry of entries) {
      const targetPath = normalizeEntryPath(entry.entryName, commonRoot);
      const skipEntry = !targetPath || shouldSkipEntry(targetPath) || shouldSkipEntry(entry.entryName);

      if (!skipEntry && !entry.isDirectory) {
        if (!isSafeExtractPath(destPath, targetPath)) {
          throw new Error(`Unsafe ZIP entry path: ${entry.entryName}`);
        }

        const fullPath = path.resolve(destPath, targetPath);
        await fs.ensureDir(path.dirname(fullPath));
        await fs.writeFile(fullPath, entry.getData());
      }

      processed++;

      if (processed % 50 === 0 || processed === totalEntries) {
        const progress = Math.round((processed / totalEntries) * 100);
        parentPort.postMessage({ type: 'progress', progress });
      }
    }

    parentPort.postMessage({ type: 'done' });
  } catch (error) {
    parentPort.postMessage({ type: 'error', error: error.message });
  }
}

extractZip();
