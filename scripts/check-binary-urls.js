const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

require('../tests/helpers/mockElectronCjs');

const BinaryDownloadManager = require('../src/main/services/BinaryDownloadManager');

const REQUEST_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;
const DEFAULT_CONCURRENCY = 6;

function getRuntimePlatformKey() {
  if (process.platform === 'win32') {
    return 'win';
  }

  if (process.platform === 'darwin') {
    return 'mac';
  }

  return 'linux';
}

function getRequestedScope() {
  if (process.argv.includes('--all') || process.env.BINARY_URL_SCOPE === 'all') {
    return 'all';
  }

  return process.env.BINARY_URL_SCOPE || getRuntimePlatformKey();
}

function shouldIncludeEntryForScope(sourcePath, scope) {
  if (scope === 'all') {
    return true;
  }

  const segments = String(sourcePath || '').split('.');
  const platformSegment = segments[segments.length - 1];
  return platformSegment === scope || platformSegment === 'all';
}

function collectUrlEntries(node, pathParts = [], results = []) {
  if (Array.isArray(node)) {
    node.forEach((value, index) => collectUrlEntries(value, [...pathParts, String(index)], results));
    return results;
  }

  if (!node || typeof node !== 'object') {
    return results;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'url' && typeof value === 'string' && /^https?:\/\//i.test(value)) {
      results.push({
        kind: 'download',
        sourcePath: pathParts.join('.'),
        url: value,
      });
      continue;
    }

    if ((key === 'manualDownloadUrl' || key === 'downloadPage') && typeof value === 'string' && /^https?:\/\//i.test(value)) {
      results.push({
        kind: 'manual',
        sourcePath: pathParts.join('.'),
        url: value,
      });
      continue;
    }

    if (key === 'fallbackUrls' && Array.isArray(value)) {
      value.forEach((fallbackUrl, index) => {
        if (typeof fallbackUrl === 'string' && /^https?:\/\//i.test(fallbackUrl)) {
          results.push({
            kind: 'fallback',
            sourcePath: `${pathParts.join('.')}.fallbackUrls[${index}]`,
            url: fallbackUrl,
          });
        }
      });
      continue;
    }

    collectUrlEntries(value, [...pathParts, key], results);
  }

  return results;
}

function buildUrlInventory(scope) {
  const manager = new BinaryDownloadManager();
  const rawEntries = collectUrlEntries(manager.downloads)
    .filter((entry) => shouldIncludeEntryForScope(entry.sourcePath, scope));
  const uniqueEntries = new Map();

  for (const entry of rawEntries) {
    const existing = uniqueEntries.get(entry.url);
    if (existing) {
      existing.references.push(`${entry.kind}:${entry.sourcePath}`);
      continue;
    }

    uniqueEntries.set(entry.url, {
      url: entry.url,
      kind: entry.kind,
      references: [`${entry.kind}:${entry.sourcePath}`],
    });
  }

  return [...uniqueEntries.values()].sort((left, right) => left.url.localeCompare(right.url));
}

function requestUrl(url, redirectCount = 0) {
  if (redirectCount > MAX_REDIRECTS) {
    return Promise.resolve({ ok: false, url, finalUrl: url, message: 'Too many redirects' });
  }

  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const req = client.request(parsedUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'DevBoxPro-BinaryUrlCheck/1.0',
        Range: 'bytes=0-0',
        Accept: '*/*',
      },
    }, (res) => {
      const statusCode = res.statusCode || 0;
      const location = res.headers.location;

      if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
        res.resume();
        const nextUrl = new URL(location, url).toString();
        requestUrl(nextUrl, redirectCount + 1).then(resolve);
        return;
      }

      if ([200, 206].includes(statusCode)) {
        res.destroy();
        resolve({ ok: true, url, finalUrl: url, statusCode });
        return;
      }

      res.resume();
      resolve({ ok: false, url, finalUrl: url, statusCode, message: `HTTP ${statusCode}` });
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });

    req.on('error', (error) => {
      resolve({ ok: false, url, finalUrl: url, message: error.message });
    });

    req.end();
  });
}

function escapePowerShellString(value) {
  return String(value).replace(/'/g, "''");
}

function requestUrlWithPowerShell(url) {
  const script = `
$uri = '${escapePowerShellString(url)}'
$headers = @{ 'User-Agent' = 'DevBoxPro-BinaryUrlCheck/1.0' }

try {
  $response = Invoke-WebRequest -Uri $uri -Method Head -MaximumRedirection 5 -Headers $headers -ErrorAction Stop
  Write-Output ("OK|" + [int]$response.StatusCode)
  exit 0
} catch {
  if ($_.Exception.Response) {
    $status = [int]$_.Exception.Response.StatusCode.value__
    if ($status -eq 405) {
      try {
        $response = Invoke-WebRequest -Uri $uri -Method Get -MaximumRedirection 5 -Headers $headers -ErrorAction Stop
        Write-Output ("OK|" + [int]$response.StatusCode)
        exit 0
      } catch {
        if ($_.Exception.Response) {
          Write-Output ("HTTP|" + [int]$_.Exception.Response.StatusCode.value__)
        } else {
          Write-Output ("ERROR|" + $_.Exception.Message)
        }
        exit 1
      }
    }

    Write-Output ("HTTP|" + $status)
    exit 1
  }

  Write-Output ("ERROR|" + $_.Exception.Message)
  exit 1
}
`;

  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish({ ok: false, url, finalUrl: url, message: `Timed out after ${REQUEST_TIMEOUT_MS}ms` });
    }, REQUEST_TIMEOUT_MS);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      finish({ ok: false, url, finalUrl: url, message: error.message });
    });

    child.on('close', () => {
      clearTimeout(timeout);

      const output = stdout.trim();
      if (output.startsWith('OK|')) {
        const statusCode = Number.parseInt(output.slice(3), 10) || 200;
        finish({ ok: true, url, finalUrl: url, statusCode });
        return;
      }

      if (output.startsWith('HTTP|')) {
        const statusCode = Number.parseInt(output.slice(5), 10) || 0;
        finish({ ok: false, url, finalUrl: url, statusCode, message: `HTTP ${statusCode}` });
        return;
      }

      if (output.startsWith('ERROR|')) {
        finish({ ok: false, url, finalUrl: url, message: output.slice(6) || stderr.trim() || 'PowerShell probe failed' });
        return;
      }

      finish({ ok: false, url, finalUrl: url, message: stderr.trim() || output || 'PowerShell probe failed' });
    });
  });
}

function requestUrlWithCurl(url, useHead = true) {
  const isWindows = process.platform === 'win32';
  const curlCommand = isWindows ? 'curl.exe' : 'curl';
  const sink = isWindows ? 'NUL' : '/dev/null';
  const args = [
    ...(useHead ? ['-I'] : ['-r', '0-0']),
    '-L',
    '-sS',
    '-o',
    sink,
    '-w',
    '%{http_code}',
    '--max-time',
    String(Math.max(5, Math.ceil(REQUEST_TIMEOUT_MS / 1000))),
    url,
  ];

  return new Promise((resolve) => {
    const child = spawn(curlCommand, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      resolve({ ok: false, url, finalUrl: url, message: error.message, probeUnavailable: true });
    });

    child.on('close', async () => {
      const trimmed = stdout.trim();
      const statusCode = Number.parseInt(trimmed, 10);

      if (Number.isFinite(statusCode) && statusCode >= 200 && statusCode < 400) {
        resolve({ ok: true, url, finalUrl: url, statusCode });
        return;
      }

      if (useHead && (statusCode === 405 || statusCode === 0 || !Number.isFinite(statusCode))) {
        const retry = await requestUrlWithCurl(url, false);
        resolve(retry);
        return;
      }

      const message = Number.isFinite(statusCode) && statusCode > 0
        ? `HTTP ${statusCode}`
        : (stderr.trim() || 'curl probe failed');

      resolve({ ok: false, url, finalUrl: url, statusCode: Number.isFinite(statusCode) ? statusCode : undefined, message });
    });
  });
}

function checkUrl(url) {
  if (process.platform === 'win32') {
    return requestUrlWithCurl(url).then((result) => {
      if (result.probeUnavailable) {
        return requestUrlWithPowerShell(url);
      }

      return result;
    });
  }

  return requestUrlWithCurl(url).then((result) => {
    if (!result.probeUnavailable) {
      return result;
    }

    return requestUrl(url);
  });
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

async function main() {
  const concurrency = Number.parseInt(process.env.BINARY_URL_CONCURRENCY || '', 10) || DEFAULT_CONCURRENCY;
  const scope = getRequestedScope();
  const inventory = buildUrlInventory(scope);

  console.log(`Checking ${inventory.length} unique binary URLs for scope ${scope} with concurrency ${concurrency}...`);

  const results = await runWithConcurrency(inventory, concurrency, async (entry) => {
    const probe = await checkUrl(entry.url);
    return { ...entry, ...probe };
  });

  const failures = results.filter((result) => !result.ok);

  if (failures.length === 0) {
    console.log(`All ${results.length} binary URLs are reachable.`);
    return;
  }

  console.error(`Detected ${failures.length} unreachable binary URLs:`);
  for (const failure of failures) {
    console.error(`- ${failure.url}`);
    console.error(`  References: ${failure.references.join(', ')}`);
    console.error(`  Error: ${failure.message || `HTTP ${failure.statusCode || 'unknown'}`}`);
  }

  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Binary URL check failed: ${error.message}`);
  process.exitCode = 1;
});