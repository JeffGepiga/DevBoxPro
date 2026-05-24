const path = require('path');
const fs = require('fs-extra');

function parseHostsEntries(hostsContent = '') {
  const entries = [];

  for (const rawLine of hostsContent.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) {
      continue;
    }

    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      continue;
    }

    const [address, ...domains] = parts;
    entries.push({
      address: address.toLowerCase(),
      domains: domains.map((domain) => domain.toLowerCase()),
    });
  }

  return entries;
}

function isLoopbackAddress(address = '') {
  return address === '127.0.0.1' || address === '::1';
}

module.exports = {
  async updateHostsFile(project) {
    if (process.env.PLAYWRIGHT_TEST === 'true') return;
    const domainsToAdd = [];

    if (project.domain) {
      domainsToAdd.push(project.domain);
    }

    if (project.domains && Array.isArray(project.domains)) {
      for (const domain of project.domains) {
        if (domain && !domainsToAdd.includes(domain)) {
          domainsToAdd.push(domain);
        }
      }
    }

    const failures = [];

    for (const domain of domainsToAdd) {
      try {
        const result = await this.addToHostsFile(domain);
        if (result?.success === false) {
          failures.push({ domain, error: result.error || 'Unknown hosts file update failure' });
        }
      } catch (error) {
        failures.push({ domain, error: error.message });
        this.managers.log?.systemWarn(`Could not add ${domain} to hosts file`, { error: error.message });
      }
    }

    if (failures.length > 0) {
      return {
        success: false,
        failures,
        error: failures.map((failure) => `${failure.domain}: ${failure.error}`).join('; '),
      };
    }

    return {
      success: true,
      domains: domainsToAdd,
    };
  },

  validateDomainName(domain) {
    if (!domain || typeof domain !== 'string') {
      return false;
    }

    const domainPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
    if (!domainPattern.test(domain)) {
      this.managers.log?.systemWarn('Invalid domain name rejected', { domain: domain.substring(0, 50) });
      return false;
    }

    const dangerousChars = /[;&|`$(){}[\]<>\\'"!#~*?]/;
    if (dangerousChars.test(domain)) {
      this.managers.log?.systemWarn('Domain contains dangerous characters', { domain: domain.substring(0, 50) });
      return false;
    }

    return true;
  },

  async addToHostsFile(domain) {
    if (process.env.PLAYWRIGHT_TEST === 'true') return;
    if (!domain) return;

    if (!this.validateDomainName(domain)) {
      this.managers.log?.systemWarn('Rejected invalid domain for hosts file', { domain: domain.substring(0, 50) });
      return { success: false, error: 'Invalid domain name format' };
    }

    const hostsPath = process.platform === 'win32'
      ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
      : '/etc/hosts';

    try {
      const hostsContent = await fs.readFile(hostsPath, 'utf-8');
      const requestedHosts = [domain, `www.${domain}`].map((entry) => entry.toLowerCase());
      const matchingEntries = parseHostsEntries(hostsContent).filter((entry) => (
        entry.domains.some((existingDomain) => requestedHosts.includes(existingDomain))
      ));

      const conflictingEntry = matchingEntries.find((entry) => !isLoopbackAddress(entry.address));
      if (conflictingEntry) {
        const conflictingDomains = conflictingEntry.domains.filter((entry) => requestedHosts.includes(entry));
        return {
          success: false,
          error: `Domain ${conflictingDomains.join(', ')} already exists in the hosts file and points to ${conflictingEntry.address}. Please remove the existing entry or choose a different domain.`,
        };
      }

      const existingHosts = new Set();
      for (const entry of matchingEntries) {
        for (const existingDomain of entry.domains) {
          if (requestedHosts.includes(existingDomain) && isLoopbackAddress(entry.address)) {
            existingHosts.add(existingDomain);
          }
        }
      }

      const missingHosts = requestedHosts.filter((entry) => !existingHosts.has(entry));
      if (missingHosts.length === 0) {
        return { success: true, alreadyExists: true };
      }

      const entries = missingHosts.map((entry) => `127.0.0.1\t${entry}`);

      const sudo = require('sudo-prompt');
      const options = {
        name: 'DevBox Pro',
        icns: undefined,
      };

      const { app } = require('electron');
      const tempDir = app.getPath('temp');

      if (process.platform === 'win32') {
        const tempEntriesPath = path.join(tempDir, 'devbox-hosts-entries.txt');
        const scriptPath = path.join(tempDir, 'devbox-hosts-update.bat');

        await fs.writeFile(tempEntriesPath, '\r\n' + entries.join('\r\n') + '\r\n', 'utf8');

        const batchContent = `type "${tempEntriesPath}" >> "${hostsPath}"`;
        await fs.writeFile(scriptPath, batchContent);

        return new Promise((resolve) => {
          sudo.exec(`cmd /c "${scriptPath}"`, options, async (error) => {
            try { await fs.remove(scriptPath); } catch (cleanupError) { }
            try { await fs.remove(tempEntriesPath); } catch (cleanupError) { }

            if (error) {
              this.managers.log?.systemWarn('Could not update hosts file automatically', { error: error.message });
              resolve({ success: false, error: error.message });
            } else {
              resolve({ success: true });
            }
          });
        });
      }

      const tempEntriesPath = path.join(tempDir, 'devbox-hosts-entries.txt');
      await fs.writeFile(tempEntriesPath, '\n' + entries.join('\n') + '\n', 'utf8');
      const command = `cat "${tempEntriesPath}" >> "${hostsPath}"`;

      return new Promise((resolve) => {
        sudo.exec(command, options, async (error) => {
          try { await fs.remove(tempEntriesPath); } catch (cleanupError) { }

          if (error) {
            this.managers.log?.systemWarn('Could not update hosts file automatically', { error: error.message });
            resolve({ success: false, error: error.message });
          } else {
            resolve({ success: true });
          }
        });
      });
    } catch (error) {
      this.managers.log?.systemWarn('Could not read hosts file', { error: error.message });
      return { success: false, error: error.message };
    }
  },

  async removeFromHostsFile(domain) {
    if (process.env.PLAYWRIGHT_TEST === 'true') return;
    if (!domain) return;

    const hostsPath = process.platform === 'win32'
      ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
      : '/etc/hosts';

    try {
      const hostsContent = await fs.readFile(hostsPath, 'utf-8');
      const lines = hostsContent.split('\n').filter((line) => {
        const trimmed = line.trim();
        return !trimmed.includes(domain) || !trimmed.startsWith('127.0.0.1');
      });

      const newContent = lines.join('\n');

      if (newContent !== hostsContent) {
        const sudo = require('sudo-prompt');
        const options = {
          name: 'DevBox Pro',
          icns: undefined,
        };

        if (process.platform === 'win32') {
          const { app } = require('electron');
          const tempDir = app.getPath('temp');
          const tempHostsPath = path.join(tempDir, 'hosts-new');

          await fs.writeFile(tempHostsPath, newContent);
          const command = `copy /Y "${tempHostsPath}" "${hostsPath}"`;

          return new Promise((resolve) => {
            sudo.exec(`cmd /c ${command}`, options, async (error) => {
              try { await fs.remove(tempHostsPath); } catch (cleanupError) { }

              if (error) {
                this.managers.log?.systemWarn(`Could not remove ${domain} from hosts file`, { error: error.message });
                resolve({ success: false, error: error.message });
              } else {
                resolve({ success: true });
              }
            });
          });
        }

        const { app } = require('electron');
        const tempDir = app.getPath('temp');
        const tempHostsPath = path.join(tempDir, 'hosts-new');

        await fs.writeFile(tempHostsPath, newContent);

        return new Promise((resolve) => {
          sudo.exec(`cp "${tempHostsPath}" "${hostsPath}"`, options, async (error) => {
            try { await fs.remove(tempHostsPath); } catch (cleanupError) { }

            if (error) {
              this.managers.log?.systemWarn(`Could not remove ${domain} from hosts file`, { error: error.message });
              resolve({ success: false, error: error.message });
            } else {
              resolve({ success: true });
            }
          });
        });
      }

      return { success: true, nothingToRemove: true };
    } catch (error) {
      this.managers.log?.systemWarn('Could not update hosts file', { error: error.message });
      return { success: false, error: error.message };
    }
  },
};
