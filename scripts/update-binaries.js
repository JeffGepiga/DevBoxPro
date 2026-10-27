/**
 * DevBox Pro - Automated Binary Manifest Updater
 *
 * Checks official upstream sources for new releases, verifies download URLs,
 * updates config/binaries.json, and increments the manifest version.
 *
 * Can be run manually or via GitHub Actions.
 *
 * Usage:
 *   node scripts/update-binaries.js [--dry-run] [--service <name>]
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '../config/binaries.json');
const REQUEST_TIMEOUT_MS = 12000;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;

function getHeaders(extraHeaders = {}) {
  const headers = {
    'User-Agent': 'DevBoxPro-BinaryUpdater/1.0',
    Accept: 'application/json, text/html, */*',
    ...extraHeaders,
  };
  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }
  return headers;
}

/**
 * Verifies that a remote URL is reachable and returns HTTP 200/206/30x
 */
async function verifyUrl(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return false;
  }

  try {
    let res = await fetch(url, {
      method: 'HEAD',
      headers: getHeaders(),
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.status === 405 || res.status === 403) {
      // Some servers block HEAD requests, fall back to range GET
      res = await fetch(url, {
        method: 'GET',
        headers: getHeaders({ Range: 'bytes=0-0' }),
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    }

    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

/**
 * Fetch JSON with timeout and headers
 */
async function fetchJson(url) {
  const res = await fetch(url, {
    headers: getHeaders(),
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res.json();
}

/**
 * Fetch Text with timeout and headers
 */
async function fetchText(url) {
  const res = await fetch(url, {
    headers: getHeaders(),
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res.text();
}

/**
 * Increment semver patch string ("1.1.4" -> "1.1.5")
 */
function bumpPatchVersion(versionStr) {
  const parts = String(versionStr || '1.0.0').split('.').map((p) => parseInt(p, 10) || 0);
  while (parts.length < 3) parts.push(0);
  parts[2] += 1;
  return parts.join('.');
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE UPDATERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 1. PHP Updater
 * Source: https://windows.php.net/downloads/releases/releases.json
 */
async function updatePhp(config, changes) {
  try {
    console.log('Checking PHP releases from windows.php.net...');
    const releasesData = await fetchJson('https://windows.php.net/downloads/releases/releases.json');
    const phpConfig = config.php?.downloads;
    if (!phpConfig) return;

    for (const [branch, currentData] of Object.entries(phpConfig)) {
      const branchInfo = releasesData[branch];
      if (!branchInfo) continue;

      // Find NTS x64 entry
      const ntsKey = Object.keys(branchInfo).find((k) => k.startsWith('nts-') && k.includes('x64'));
      if (!ntsKey || !branchInfo[ntsKey]?.zip?.path) continue;

      const zipPath = branchInfo[ntsKey].zip.path;
      const primaryUrl = `https://windows.php.net/downloads/releases/${zipPath}`;
      const archiveUrl = `https://windows.php.net/downloads/releases/archives/${zipPath}`;

      let validUrl = null;
      if (await verifyUrl(primaryUrl)) {
        validUrl = primaryUrl;
      } else if (await verifyUrl(archiveUrl)) {
        validUrl = archiveUrl;
      }

      const isCurrentValid = (currentData.win?.url === primaryUrl || currentData.win?.url === archiveUrl) && currentData.win?.filename === zipPath;
      if (!isCurrentValid && validUrl && currentData.win) {
        changes.push({
          service: 'php',
          version: branch,
          platform: 'win',
          from: currentData.win.filename,
          to: zipPath,
        });
        currentData.win.url = validUrl;
        currentData.win.filename = zipPath;
      }
    }
  } catch (err) {
    console.warn(`[PHP] Update check failed: ${err.message}`);
  }
}

/**
 * 2. Node.js Updater
 * Source: https://nodejs.org/dist/index.json
 */
async function updateNodejs(config, changes) {
  try {
    console.log('Checking Node.js releases from nodejs.org...');
    const indexData = await fetchJson('https://nodejs.org/dist/index.json');
    const nodeConfig = config.nodejs?.downloads;
    if (!nodeConfig) return;

    for (const [major, currentData] of Object.entries(nodeConfig)) {
      const targetPrefix = `v${major}.`;
      const match = indexData.find((entry) => entry.version && entry.version.startsWith(targetPrefix));
      if (!match) continue;

      const tag = match.version; // e.g. "v22.23.4"
      const winFilename = `node-${tag}-win-x64.zip`;
      const macFilename = `node-${tag}-darwin-arm64.tar.gz`;
      const linuxFilename = `node-${tag}-linux-x64.tar.gz`;

      const winUrl = `https://nodejs.org/dist/${tag}/${winFilename}`;
      const macUrl = `https://nodejs.org/dist/${tag}/${macFilename}`;
      const linuxUrl = `https://nodejs.org/dist/${tag}/${linuxFilename}`;

      if (currentData.win && currentData.win.filename !== winFilename) {
        if (await verifyUrl(winUrl)) {
          changes.push({
            service: 'nodejs',
            version: major,
            platform: 'win',
            from: currentData.win.filename,
            to: winFilename,
          });
          currentData.win.url = winUrl;
          currentData.win.filename = winFilename;

          if (currentData.mac && currentData.mac.url !== 'builtin') {
            currentData.mac.url = macUrl;
            currentData.mac.filename = macFilename;
          }
          if (currentData.linux && currentData.linux.url !== 'builtin') {
            currentData.linux.url = linuxUrl;
            currentData.linux.filename = linuxFilename;
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[Node.js] Update check failed: ${err.message}`);
  }
}

/**
 * 3. Nginx Updater
 * Source: https://nginx.org/en/download.html
 */
async function updateNginx(config, changes) {
  try {
    console.log('Checking Nginx releases from nginx.org...');
    const html = await fetchText('https://nginx.org/en/download.html');
    const nginxConfig = config.nginx?.downloads;
    if (!nginxConfig) return;

    for (const [branch, currentData] of Object.entries(nginxConfig)) {
      const regex = new RegExp(`nginx-(${branch.replace('.', '\\.')}\\.\\d+)\\.zip`, 'g');
      const matches = [];
      let m;
      while ((m = regex.exec(html)) !== null) {
        matches.push(m[1]);
      }
      if (matches.length === 0) continue;

      matches.sort((a, b) => {
        const pA = parseInt(a.split('.')[2] || '0', 10);
        const pB = parseInt(b.split('.')[2] || '0', 10);
        return pB - pA;
      });

      const latestPatch = matches[0];
      const winFilename = `nginx-${latestPatch}.zip`;
      const winUrl = `https://nginx.org/download/${winFilename}`;

      if (currentData.win && currentData.win.filename !== winFilename) {
        if (await verifyUrl(winUrl)) {
          changes.push({
            service: 'nginx',
            version: branch,
            platform: 'win',
            from: currentData.win.filename,
            to: winFilename,
          });
          currentData.win.url = winUrl;
          currentData.win.filename = winFilename;

          const tarFilename = `nginx-${latestPatch}.tar.gz`;
          const tarUrl = `https://nginx.org/download/${tarFilename}`;
          if (currentData.mac) {
            currentData.mac.url = tarUrl;
            currentData.mac.filename = tarFilename;
          }
          if (currentData.linux) {
            currentData.linux.url = tarUrl;
            currentData.linux.filename = tarFilename;
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[Nginx] Update check failed: ${err.message}`);
  }
}

/**
 * 4. MariaDB Updater
 * Source: https://downloads.mariadb.org/rest-api/mariadb/
 */
async function updateMariaDb(config, changes) {
  try {
    console.log('Checking MariaDB releases from mariadb.org...');
    const mariadbConfig = config.mariadb?.downloads;
    if (!mariadbConfig) return;

    for (const [branch, currentData] of Object.entries(mariadbConfig)) {
      try {
        const releaseData = await fetchJson(`https://downloads.mariadb.org/rest-api/mariadb/${branch}`);
        const releaseVersions = Object.keys(releaseData?.releases || {});
        if (releaseVersions.length === 0) continue;

        const latestVer = releaseVersions[0]; // e.g. "11.4.13"
        const winFilename = `mariadb-${latestVer}-winx64.zip`;
        const winUrl = `https://archive.mariadb.org/mariadb-${latestVer}/winx64-packages/${winFilename}`;

        if (currentData.win && currentData.win.filename !== winFilename) {
          if (await verifyUrl(winUrl)) {
            changes.push({
              service: 'mariadb',
              version: branch,
              platform: 'win',
              from: currentData.win.filename,
              to: winFilename,
            });
            currentData.win.url = winUrl;
            currentData.win.filename = winFilename;

            const linuxFilename = `mariadb-${latestVer}-linux-systemd-x86_64.tar.gz`;
            const linuxUrl = `https://archive.mariadb.org/mariadb-${latestVer}/bintar-linux-systemd-x86_64/${linuxFilename}`;
            if (currentData.linux && currentData.linux.url !== 'builtin') {
              currentData.linux.url = linuxUrl;
              currentData.linux.filename = linuxFilename;
            }
          }
        }
      } catch (branchErr) {
        console.warn(`[MariaDB ${branch}] Check failed: ${branchErr.message}`);
      }
    }
  } catch (err) {
    console.warn(`[MariaDB] Update check failed: ${err.message}`);
  }
}

/**
 * 5. Python Updater
 * Source: https://www.python.org/ftp/python/
 */
async function updatePython(config, changes) {
  try {
    console.log('Checking Python releases from python.org...');
    const html = await fetchText('https://www.python.org/ftp/python/');
    const pythonConfig = config.python?.downloads;
    if (!pythonConfig) return;

    for (const [branch, currentData] of Object.entries(pythonConfig)) {
      const regex = new RegExp(`href="(${branch.replace('.', '\\.')}\\.\\d+)/"`, 'g');
      const patches = [];
      let m;
      while ((m = regex.exec(html)) !== null) {
        patches.push(m[1]);
      }
      if (patches.length === 0) continue;

      patches.sort((a, b) => {
        const pA = parseInt(a.split('.')[2] || '0', 10);
        const pB = parseInt(b.split('.')[2] || '0', 10);
        return pB - pA;
      });

      const isLegacyEmbed = branch === '3.11';
      const embedSuffix = isLegacyEmbed ? 'embeddable' : 'embed';

      // Find highest patch that actually has an embed zip
      for (const patchVer of patches) {
        const candidateFilename = `python-${patchVer}-${embedSuffix}-amd64.zip`;
        const candidateUrl = `https://www.python.org/ftp/python/${patchVer}/${candidateFilename}`;

        if (candidateFilename === currentData.win?.filename) {
          break; // Already at latest working patch
        }

        if (await verifyUrl(candidateUrl)) {
          changes.push({
            service: 'python',
            version: branch,
            platform: 'win',
            from: currentData.win.filename,
            to: candidateFilename,
          });
          currentData.win.url = candidateUrl;
          currentData.win.filename = candidateFilename;

          const tgzFilename = `Python-${patchVer}.tgz`;
          const tgzUrl = `https://www.python.org/ftp/python/${patchVer}/${tgzFilename}`;
          if (currentData.mac && currentData.mac.url !== 'builtin') {
            currentData.mac.url = tgzUrl;
            currentData.mac.filename = tgzFilename;
          }
          if (currentData.linux && currentData.linux.url !== 'builtin') {
            currentData.linux.url = tgzUrl;
            currentData.linux.filename = tgzFilename;
          }
          break;
        }
      }
    }
  } catch (err) {
    console.warn(`[Python] Update check failed: ${err.message}`);
  }
}

/**
 * 6. GitHub Releases-based Tools (Mailpit, Cloudflared, zrok, Git, MinIO, Mongosh)
 */
async function updateGitHubTools(config, changes) {
  const tools = [
    {
      name: 'git',
      repo: 'git-for-windows/git',
      target: config.git?.downloads?.portable?.win,
      assetPattern: /^PortableGit-.*-64-bit\.7z\.exe$/i,
      updatePlatform: 'win',
      versionKey: 'portable',
    },
    {
      name: 'mailpit',
      repo: 'axllent/mailpit',
      target: config.mailpit?.downloads?.latest?.win,
      assetPattern: /^mailpit-windows-amd64\.zip$/i,
      updatePlatform: 'win',
      versionKey: 'latest',
      companionAssets: {
        mac: /^mailpit-darwin-arm64\.tar\.gz$/i,
        linux: /^mailpit-linux-amd64\.tar\.gz$/i,
      },
      container: config.mailpit?.downloads?.latest,
    },
    {
      name: 'cloudflared',
      repo: 'cloudflare/cloudflared',
      target: config.cloudflared?.downloads?.latest?.win,
      assetPattern: /^cloudflared-windows-amd64\.exe$/i,
      updatePlatform: 'win',
      versionKey: 'latest',
      companionAssets: {
        mac: /^cloudflared-darwin-arm64\.tgz$/i,
        linux: /^cloudflared-linux-amd64$/i,
      },
      container: config.cloudflared?.downloads?.latest,
    },
    {
      name: 'zrok',
      repo: 'openziti/zrok',
      target: config.zrok?.downloads?.latest?.win,
      assetPattern: /^zrok.*windows.*amd64.*\.(zip|tar\.gz)$/i,
      updatePlatform: 'win',
      versionKey: 'latest',
      companionAssets: {
        mac: /^zrok.*darwin.*arm64.*\.(tar\.gz|tgz)$/i,
        linux: /^zrok.*linux.*amd64.*\.(tar\.gz|tgz)$/i,
      },
      container: config.zrok?.downloads?.latest,
    },
    {
      name: 'minio',
      repo: 'minio/minio',
      target: config.minio?.downloads?.latest?.win,
      assetPattern: /^minio\.windows-amd64\..*\.exe$/i,
      updatePlatform: 'win',
      versionKey: 'latest',
      companionAssets: {
        mac: /^minio\.darwin-arm64\..*$/i,
        linux: /^minio\.linux-amd64\..*$/i,
      },
      container: config.minio?.downloads?.latest,
    },
    {
      name: 'mongosh',
      repo: 'mongodb-js/mongosh',
      target: config.mongosh?.downloads?.latest?.win,
      assetPattern: /^mongosh-.*-win32-x64\.zip$/i,
      updatePlatform: 'win',
      versionKey: 'latest',
      companionAssets: {
        mac: /^mongosh-.*-darwin-arm64\.zip$/i,
        linux: /^mongosh-.*-linux-x64\.tgz$/i,
      },
      container: config.mongosh?.downloads?.latest,
    },
  ];

  for (const tool of tools) {
    if (!tool.target) continue;
    try {
      console.log(`Checking ${tool.name} from GitHub (${tool.repo})...`);
      const release = await fetchJson(`https://api.github.com/repos/${tool.repo}/releases/latest`);
      const assets = Array.isArray(release.assets) ? release.assets : [];

      const winAsset = assets.find((a) => tool.assetPattern.test(a.name));
      if (!winAsset) continue;

      if (tool.target.url !== winAsset.browser_download_url) {
        changes.push({
          service: tool.name,
          version: tool.versionKey,
          platform: 'win',
          from: tool.target.filename || tool.target.url,
          to: winAsset.name,
        });

        tool.target.url = winAsset.browser_download_url;
        tool.target.filename = winAsset.name;

        // Update companion platforms if present
        if (tool.companionAssets && tool.container) {
          for (const [plat, pattern] of Object.entries(tool.companionAssets)) {
            const compAsset = assets.find((a) => pattern.test(a.name));
            if (compAsset && tool.container[plat]) {
              tool.container[plat].url = compAsset.browser_download_url;
              tool.container[plat].filename = compAsset.name;
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[${tool.name}] Update check failed: ${err.message}`);
    }
  }
}

/**
 * 7. Redis for Windows (from redis-windows/redis-windows)
 */
async function updateRedisWindows(config, changes) {
  try {
    console.log('Checking Redis for Windows releases...');
    const releases = await fetchJson('https://api.github.com/repos/redis-windows/redis-windows/releases?per_page=20');
    if (!Array.isArray(releases)) return;

    const redisConfig = config.redis?.downloads;
    if (!redisConfig) return;

    for (const [branch, currentData] of Object.entries(redisConfig)) {
      const match = releases.find((r) => r.tag_name && r.tag_name.startsWith(branch));
      if (!match) continue;

      const assets = match.assets || [];
      const winAsset = assets.find((a) => /^Redis-.*-Windows-x64.*\.zip$/i.test(a.name));
      if (!winAsset || !currentData.win) continue;

      if (currentData.win.url !== winAsset.browser_download_url) {
        changes.push({
          service: 'redis',
          version: branch,
          platform: 'win',
          from: currentData.win.filename,
          to: winAsset.name,
        });
        currentData.win.url = winAsset.browser_download_url;
        currentData.win.filename = winAsset.name;
      }
    }
  } catch (err) {
    console.warn(`[Redis] Update check failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const serviceFilter = process.argv.find((_, i, arr) => arr[i - 1] === '--service');

  console.log(`\n=== DevBox Pro Binary Updater ===`);
  console.log(`Config path: ${CONFIG_PATH}`);
  if (isDryRun) console.log('Mode: DRY RUN (no files will be written)');
  if (serviceFilter) console.log(`Filter: service=${serviceFilter}`);
  console.log('');

  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`Config file not found at ${CONFIG_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = JSON.parse(raw);
  const changes = [];

  const updaters = [
    { name: 'php', fn: updatePhp },
    { name: 'nodejs', fn: updateNodejs },
    { name: 'nginx', fn: updateNginx },
    { name: 'mariadb', fn: updateMariaDb },
    { name: 'python', fn: updatePython },
    { name: 'redis', fn: updateRedisWindows },
    { name: 'tools', fn: updateGitHubTools },
  ];

  for (const { name, fn } of updaters) {
    if (serviceFilter && serviceFilter !== name) continue;
    await fn(config, changes);
  }

  console.log('\n=== Update Summary ===');
  if (changes.length === 0) {
    console.log('All binary configurations are already up to date. No changes needed.');
    return;
  }

  console.log(`Found ${changes.length} updated binary definition(s):`);
  for (const change of changes) {
    console.log(` - [${change.service}] ${change.version} (${change.platform}): ${change.from} -> ${change.to}`);
  }

  const oldVersion = config.version || '1.0.0';
  const newVersion = bumpPatchVersion(oldVersion);
  const today = new Date().toISOString().split('T')[0];

  config.version = newVersion;
  config.lastUpdated = today;

  console.log(`\nManifest version bumped: ${oldVersion} -> ${newVersion}`);
  console.log(`lastUpdated set to: ${today}`);

  if (isDryRun) {
    console.log('\n[Dry Run] Changes were NOT written to disk.');
    return;
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log(`Successfully updated ${CONFIG_PATH}!`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error during binary update:', err);
    process.exit(1);
  });
}

module.exports = {
  bumpPatchVersion,
  verifyUrl,
  updatePhp,
  updateNodejs,
  updateNginx,
  updateMariaDb,
  updatePython,
  updateGitHubTools,
  updateRedisWindows,
};

