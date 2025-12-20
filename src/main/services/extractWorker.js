/**
 * Extract Worker - Runs ZIP extraction in a separate thread
 * This prevents the main Electron process from freezing
 */
const { parentPort, workerData } = require('worker_threads');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs-extra');

async function extractZip() {
  const { archivePath, destPath } = workerData;
  
  try {
    const zip = new AdmZip(archivePath);
    const entries = zip.getEntries();
    const totalEntries = entries.length;
    let processed = 0;
    
    // Detect common root folder to strip (like nginx-1.28.0/, mysql-8.4.7-winx64/, etc.)
    let commonRoot = null;
    const firstEntry = entries.find(e => !e.isDirectory && e.entryName.includes('/'));
    if (firstEntry) {
      const parts = firstEntry.entryName.split('/');
      if (parts.length > 1) {
        commonRoot = parts[0] + '/';
        // Verify all entries share this root
        const allShareRoot = entries.every(e => 
          e.entryName.startsWith(commonRoot) || e.entryName === parts[0]
        );
        if (!allShareRoot) {
          commonRoot = null; // Don't strip if not all entries share root
        }
      }
    }
    
    for (const entry of entries) {
      if (!entry.isDirectory) {
        let targetPath = entry.entryName;
        
        // Strip common root folder if detected
        if (commonRoot && targetPath.startsWith(commonRoot)) {
          targetPath = targetPath.substring(commonRoot.length);
        }
        
        if (targetPath) {
          const fullPath = path.join(destPath, targetPath);
          const dir = path.dirname(fullPath);
          
          // Ensure directory exists
          await fs.ensureDir(dir);
          
          // Extract file content
          const content = entry.getData();
          await fs.writeFile(fullPath, content);
        }
      }
      processed++;
      
      // Report progress every 50 entries to reduce IPC overhead
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
