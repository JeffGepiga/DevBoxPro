const fs = require('fs-extra');
const os = require('os');
const { spawn } = require('child_process');
const zlib = require('zlib');
const { Transform, PassThrough } = require('stream');
const { v4: uuidv4 } = require('uuid');

const MB = 1024 * 1024;
const GB = 1024 * MB;

const SQL_EXTENSIONS = ['.sql', '.sql.gz', '.gz'];
const ARCHIVE_EXTENSIONS = ['.zip', '.tar', '.tar.gz', '.tgz'];
const TAR_FILE_TYPES = new Set(['File', 'OldFile', 'ContiguousFile']);

// Server variables temporarily raised while a MySQL/MariaDB import is running.
const IMPORT_TUNING_VARIABLES = [
  'version',
  'innodb_flush_log_at_trx_commit',
  'sync_binlog',
  'innodb_buffer_pool_size',
  'innodb_redo_log_capacity',
  'innodb_log_file_size',
  'max_allowed_packet',
];

function isArchivePath(filePath) {
  const lowerPath = String(filePath || '').toLowerCase();
  return ARCHIVE_EXTENSIONS.some(ext => lowerPath.endsWith(ext));
}

/**
 * Whether an archive entry looks like a SQL dump. Entries may live in nested
 * folders (e.g. "backup-2026/db/site.sql"); macOS resource-fork junk is ignored.
 */
function isSqlArchiveEntry(entryPath) {
  const parts = String(entryPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  const baseName = parts[parts.length - 1] || '';
  if (!baseName || baseName.startsWith('._') || parts.includes('__MACOSX')) {
    return false;
  }
  return /\.sql(\.gz)?$/i.test(baseName);
}

function createByteCounter(state) {
  return new Transform({
    highWaterMark: 4 * MB,
    transform(chunk, encoding, callback) {
      state.processedBytes += chunk.length;
      callback(null, chunk);
    },
  });
}

function createGunzipStream() {
  return zlib.createGunzip({ chunkSize: 4 * MB });
}

function forwardErrors(from, to) {
  from.on('error', (err) => {
    if (!to.destroyed) {
      to.destroy(err);
    }
  });
}

// Case-insensitive ASCII keyword match against raw bytes (no string decoding).
function bytesStartWithKeyword(buf, offset, keywordLower) {
  if (offset + keywordLower.length > buf.length) {
    return false;
  }
  for (let i = 0; i < keywordLower.length; i++) {
    if ((buf[offset + i] | 0x20) !== keywordLower.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

function trailingSignificantByte(buf) {
  for (let i = buf.length - 1; i >= 0; i--) {
    const c = buf[i];
    if (c !== 10 && c !== 13 && c !== 32 && c !== 9) {
      return c;
    }
  }
  return 0;
}

module.exports = {
  validateFilePath(filePath, checkExtension = true, options = {}) {
    const { allowArchives = true } = options;

    if (!filePath || typeof filePath !== 'string') {
      return { valid: false, error: 'Invalid file path' };
    }

    if (filePath.includes('..')) {
      this.managers.log?.systemWarn('Blocked path traversal attempt in database import/export', {
        path: filePath.substring(0, 100),
      });
      return { valid: false, error: 'Invalid file path (path traversal detected)' };
    }

    if (checkExtension) {
      const validExtensions = allowArchives ? [...SQL_EXTENSIONS, ...ARCHIVE_EXTENSIONS] : SQL_EXTENSIONS;
      const lowerPath = filePath.toLowerCase();
      const hasValidExtension = validExtensions.some(ext => lowerPath.endsWith(ext));

      if (!hasValidExtension) {
        return {
          valid: false,
          error: allowArchives
            ? 'Invalid file type. Supported: .sql, .sql.gz, .zip, .tar, .tar.gz, .tgz'
            : 'Invalid file type. Only .sql and .sql.gz files are supported.',
        };
      }
    }

    return { valid: true };
  },

  /**
   * Open an import file as a stream of plain SQL text.
   * Supports .sql, .sql.gz/.gz, and .zip/.tar/.tar.gz/.tgz archives containing a
   * .sql or .sql.gz file anywhere inside (including nested folders). Archives are
   * streamed directly — nothing is extracted to disk.
   *
   * Returns { stream, state, destroy } where state = { processedBytes, totalSize, entryName, error }.
   */
  async _openImportSource(filePath) {
    const lowerPath = filePath.toLowerCase();
    const fileSize = (await fs.stat(filePath)).size;
    const state = { processedBytes: 0, totalSize: fileSize, entryName: null, error: null };
    const streams = [];

    const finalize = (stream) => {
      // Always keep an error listener attached so an early failure (before the
      // caller wires up its own handlers) can't crash the main process.
      stream.on('error', (err) => {
        if (!state.error) {
          state.error = err;
        }
      });
      return {
        stream,
        state,
        destroy: () => {
          for (const s of streams) {
            try {
              s.destroy?.();
            } catch {
              // ignore
            }
          }
        },
      };
    };

    if (lowerPath.endsWith('.zip')) {
      const unzipper = require('unzipper');
      let directory;
      try {
        directory = await unzipper.Open.file(filePath);
      } catch (err) {
        throw new Error(`Unable to read zip archive: ${err.message}`);
      }

      const candidates = directory.files.filter(file => file.type === 'File' && isSqlArchiveEntry(file.path));
      if (candidates.length === 0) {
        throw new Error('No .sql or .sql.gz file found inside the zip archive');
      }

      // If the archive contains several dumps, import the largest one.
      candidates.sort((a, b) => (b.uncompressedSize || 0) - (a.uncompressedSize || 0));
      const entry = candidates[0];
      state.entryName = entry.path;
      state.totalSize = entry.uncompressedSize || fileSize;

      const raw = entry.stream();
      const counter = createByteCounter(state);
      streams.push(raw, counter);
      forwardErrors(raw, counter);
      raw.pipe(counter);

      if (!/\.gz$/i.test(entry.path)) {
        return finalize(counter);
      }

      const gunzip = createGunzipStream();
      streams.push(gunzip);
      forwardErrors(counter, gunzip);
      counter.pipe(gunzip);
      return finalize(gunzip);
    }

    if (lowerPath.endsWith('.tar') || lowerPath.endsWith('.tar.gz') || lowerPath.endsWith('.tgz')) {
      const { Parser } = require('tar');
      const fileStream = fs.createReadStream(filePath, { highWaterMark: 4 * MB });
      const counter = createByteCounter(state);
      const parser = new Parser(); // auto-detects gzip
      const out = new PassThrough({ highWaterMark: 8 * MB });
      streams.push(fileStream, counter, out);

      let matched = false;
      const fail = (err) => {
        if (!out.destroyed) {
          out.destroy(err);
        }
      };

      fileStream.on('error', fail);
      counter.on('error', fail);
      parser.on('error', fail);

      parser.on('entry', (entry) => {
        if (matched || !TAR_FILE_TYPES.has(entry.type) || !isSqlArchiveEntry(entry.path)) {
          entry.resume();
          return;
        }

        matched = true;
        state.entryName = entry.path;

        let src = entry;
        if (/\.gz$/i.test(entry.path)) {
          const gunzip = createGunzipStream();
          streams.push(gunzip);
          gunzip.on('error', fail);
          entry.pipe(gunzip);
          src = gunzip;
        }

        src.on('end', () => {
          // The dump has been fully read; no need to scan the rest of the archive.
          state.processedBytes = state.totalSize;
          fileStream.unpipe(counter);
          fileStream.destroy();
        });
        src.pipe(out);
      });

      const onParserDone = () => {
        if (!matched) {
          fail(new Error('No .sql or .sql.gz file found inside the tar archive'));
        }
      };
      parser.on('end', onParserDone);
      parser.on('close', onParserDone);

      fileStream.pipe(counter).pipe(parser);
      return finalize(out);
    }

    const fileStream = fs.createReadStream(filePath, { highWaterMark: 16 * MB });
    const counter = createByteCounter(state);
    streams.push(fileStream, counter);
    forwardErrors(fileStream, counter);
    fileStream.pipe(counter);

    if (!lowerPath.endsWith('.gz')) {
      return finalize(counter);
    }

    const gunzip = createGunzipStream();
    streams.push(gunzip);
    forwardErrors(counter, gunzip);
    counter.pipe(gunzip);
    return finalize(gunzip);
  },

  /**
   * Temporarily relax durability and raise memory/redo limits on the running
   * MySQL/MariaDB server for the duration of a bulk import. The default dev
   * config uses a 128M buffer pool and ~100M redo log, which makes multi-GB
   * imports crawl (constant checkpoint flushing + secondary-index disk thrash).
   * Values are restored by _restoreImportServerTuning(). Everything is best-effort.
   */
  async _applyImportServerTuning() {
    if (process.env.PLAYWRIGHT_TEST === 'true') {
      return false;
    }

    this._importTuningRefs = (this._importTuningRefs || 0) + 1;
    if (this._importTuningRefs > 1) {
      // Another import already tuned the server; it will be restored when the last one finishes.
      return true;
    }

    const originals = {};
    this._importTuningOriginals = originals;

    const vars = {};
    try {
      const list = IMPORT_TUNING_VARIABLES.map(name => `'${name}'`).join(',');
      const rows = await this.runDbQuery(`SHOW GLOBAL VARIABLES WHERE Variable_name IN (${list})`);
      for (const row of rows || []) {
        if (Array.isArray(row) && row.length >= 2) {
          vars[row[0]] = row[1];
        }
      }
    } catch (error) {
      this.managers.log?.systemWarn('Could not read server variables for import tuning', { error: error.message });
      return true;
    }

    const isMariaDb = /mariadb/i.test(vars.version || '');
    const plan = [];

    // Flush the redo log ~once per second instead of on every commit.
    if (vars.innodb_flush_log_at_trx_commit !== undefined && !['0', '2'].includes(String(vars.innodb_flush_log_at_trx_commit))) {
      plan.push({ name: 'innodb_flush_log_at_trx_commit', value: '2', restore: true });
    }
    if (vars.sync_binlog !== undefined && String(vars.sync_binlog) !== '0') {
      plan.push({ name: 'sync_binlog', value: '0', restore: true });
    }

    // Bigger buffer pool: 25% of RAM, between 512MB and 4GB, bounded by free memory.
    const currentPool = Number(vars.innodb_buffer_pool_size) || 0;
    if (currentPool > 0) {
      let targetPool = Math.min(4 * GB, Math.max(512 * MB, Math.floor(os.totalmem() * 0.25)));
      targetPool = Math.min(targetPool, Math.max(currentPool, Math.floor(os.freemem() * 0.5)));
      targetPool = Math.floor(targetPool / (128 * MB)) * (128 * MB);
      if (targetPool > currentPool) {
        plan.push({ name: 'innodb_buffer_pool_size', value: String(targetPool), restore: true });
      }
    }

    // Bigger redo log (dynamic in MySQL 8.0.30+). Avoids sync checkpoint stalls.
    const redoCapacity = Number(vars.innodb_redo_log_capacity) || 0;
    if (redoCapacity > 0 && redoCapacity < 2 * GB) {
      plan.push({ name: 'innodb_redo_log_capacity', value: String(2 * GB), restore: true });
    }
    // MariaDB 10.9+ allows resizing the redo log online.
    const logFileSize = Number(vars.innodb_log_file_size) || 0;
    if (isMariaDb && logFileSize > 0 && logFileSize < GB) {
      plan.push({ name: 'innodb_log_file_size', value: String(GB), restore: true });
    }

    // Raise before the import connection opens so the session inherits it.
    if ((Number(vars.max_allowed_packet) || 0) < GB) {
      plan.push({ name: 'max_allowed_packet', value: String(GB), restore: false });
    }

    const applied = [];
    for (const { name, value, restore } of plan) {
      try {
        await this.runDbQuery(`SET GLOBAL ${name} = ${value}`);
        if (restore) {
          originals[name] = vars[name];
        }
        applied.push(`${name}=${value}`);
      } catch (error) {
        this.managers.log?.systemWarn(`Import tuning: could not set ${name}`, { error: error.message });
      }
    }

    if (applied.length > 0) {
      this.managers.log?.systemInfo('Applied temporary import tuning', { applied });
    }

    return true;
  },

  async _restoreImportServerTuning() {
    this._importTuningRefs = Math.max(0, (this._importTuningRefs || 1) - 1);
    if (this._importTuningRefs > 0) {
      return;
    }

    const originals = this._importTuningOriginals || {};
    this._importTuningOriginals = null;

    for (const [name, value] of Object.entries(originals)) {
      if (!/^\d+$/.test(String(value))) {
        continue;
      }
      try {
        await this.runDbQuery(`SET GLOBAL ${name} = ${value}`);
      } catch (error) {
        this.managers.log?.systemWarn(`Import tuning: could not restore ${name}`, { error: error.message });
      }
    }
  },

  async importDatabase(databaseName, filePath, progressCallback = null, mode = 'merge') {
    const dbType = this.getActiveDatabaseType();

    if (dbType === 'postgresql') {
      return this._importPostgres(databaseName, filePath, progressCallback, mode);
    }
    if (dbType === 'mongodb') {
      return this._importMongo(databaseName, filePath, progressCallback, mode);
    }

    const safeName = this.sanitizeName(databaseName);
    const operationId = uuidv4();

    const pathValidation = this.validateFilePath(filePath, true);
    if (!pathValidation.valid) {
      throw new Error(pathValidation.error);
    }

    if (!(await fs.pathExists(filePath))) {
      throw new Error('Import file not found');
    }

    this.managers.log?.systemInfo('Database import started', {
      database: safeName,
      operationId,
      fileSize: (await fs.stat(filePath)).size,
      mode,
    });

    const databases = await this.listDatabases();
    const dbExists = databases.some(db => db.name === safeName || db.name === databaseName);
    if (!dbExists) {
      throw new Error(`Database '${databaseName}' does not exist. Please create it first.`);
    }

    const clientPath = this.getDbClientPath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    const user = settings.dbUser || this.dbConfig.user;
    const password = settings.dbPassword || '';

    if (!await fs.pathExists(clientPath)) {
      throw new Error(`MySQL client not found at ${clientPath}. Please ensure the database binary is installed.`);
    }

    progressCallback?.({
      operationId,
      status: 'starting',
      message: isArchivePath(filePath) ? 'Opening archive...' : 'Starting import...',
      dbName: safeName,
    });

    let source;
    try {
      // Open before cleaning so an archive without a .sql file doesn't wipe the database.
      source = await this._openImportSource(filePath);
    } catch (error) {
      progressCallback?.({ operationId, status: 'error', message: `Import error: ${error.message}`, dbName: safeName });
      throw error;
    }

    let tuned = false;
    let progressInterval = null;
    const capturedVirtualColumns = [];
    let outcome = null;
    let failure = null;

    try {
      const activeVersion = this.getActiveDatabaseVersion?.();
      if (activeVersion && this.managers?.service && !this.managers.service.isVersionRunning?.(dbType, activeVersion)) {
        await this.managers.service.rehydrateManagedServiceState?.(dbType, activeVersion);
      }

      if (mode === 'clean') {
        progressCallback?.({ operationId, status: 'cleaning', message: 'Recreating database (clean import)...', dbName: safeName });
        await this.dropAllTables(safeName);
      }

      progressCallback?.({ operationId, status: 'importing', message: 'Optimizing server for bulk import...', progress: 0, dbName: safeName });
      tuned = await this._applyImportServerTuning();

      const importStartTime = Date.now();
      const entryLabel = source.state.entryName ? ` [${source.state.entryName}]` : '';
      progressCallback?.({ operationId, status: 'importing', message: `Importing to database (streaming)${entryLabel}...`, progress: 0, dbName: safeName });

      // Heartbeat: fire every 2 s so the UI never looks frozen during backpressure.
      progressInterval = setInterval(() => {
        const { processedBytes, totalSize } = source.state;
        const elapsed = Math.round((Date.now() - importStartTime) / 1000);
        const readMB = (processedBytes / MB).toFixed(1);
        const totalMB = (totalSize / MB).toFixed(1);
        const pct = totalSize > 0 ? Math.min(Math.round((processedBytes / totalSize) * 100), 99) : 0;
        const rate = elapsed > 0 ? ` @ ${(processedBytes / MB / elapsed).toFixed(1)}MB/s` : '';
        progressCallback?.({
          operationId,
          status: 'importing',
          message: `Importing${entryLabel}... ${readMB}MB / ${totalMB}MB read (${elapsed}s elapsed${rate})`,
          progress: pct,
          dbName: safeName,
        });
      }, 2000);

      const args = [
        `-h${this.dbConfig.host}`,
        `-P${port}`,
        `-u${user}`,
        '--max-allowed-packet=1G',
      ];
      if (password) {
        args.push(`-p${password}`);
      }
      args.push(safeName);

      outcome = await this._streamMysqlImport({ clientPath, args, operationId, safeName, source, capturedVirtualColumns });
      clearInterval(progressInterval);

      if (outcome.code === 0 && !outcome.pipelineError && capturedVirtualColumns.length > 0) {
        progressCallback?.({ operationId, status: 'restoring', message: `Restoring ${capturedVirtualColumns.length} virtual columns...`, dbName: safeName });
        for (const virtualColumn of capturedVirtualColumns) {
          try {
            await this.runDbQuery(`ALTER TABLE \`${virtualColumn.table}\` ADD COLUMN ${virtualColumn.def}`, safeName);
          } catch (alterErr) {
            this.managers.log?.systemWarn(`Failed to restore virtual column for ${virtualColumn.table}`, {
              error: alterErr.message,
              def: virtualColumn.def,
            });
          }
        }
      }
    } catch (error) {
      failure = error;
    } finally {
      clearInterval(progressInterval);
      source.destroy();
      if (tuned) {
        await this._restoreImportServerTuning();
      }
    }

    if (failure) {
      this.runningOperations.delete(operationId);
      progressCallback?.({ operationId, status: 'error', message: `Import error: ${failure.message}`, dbName: safeName });
      throw failure;
    }

    const { code, stderr, pipelineError } = outcome;

    if (code === 0 && !pipelineError) {
      this.runningOperations.delete(operationId);
      progressCallback?.({ operationId, status: 'complete', message: 'Import completed successfully!', dbName: safeName });
      return { success: true, operationId };
    }

    if (code === null && !pipelineError) {
      this.runningOperations.delete(operationId);
      progressCallback?.({ operationId, status: 'cancelled', message: 'Import cancelled', dbName: safeName });
      return { success: false, cancelled: true, operationId };
    }

    const cleanStderr = (stderr || '')
      .split(/\r?\n/)
      .filter(line => line.trim() && !line.includes('Using a password on the command line'))
      .join('\n');
    const errorMsg = pipelineError?.message || cleanStderr || `Process exited with code ${code}`;
    const operation = this.runningOperations.get(operationId);
    if (operation) {
      operation.status = 'failed';
      operation.error = errorMsg;
      setTimeout(() => {
        this.runningOperations.delete(operationId);
      }, 5 * 60 * 1000);
    }

    progressCallback?.({ operationId, status: 'error', message: `Import failed: ${errorMsg}`, dbName: safeName });
    throw new Error(`Import failed: ${errorMsg}`);
  },

  /**
   * Pipe the SQL source through the processor into the mysql client.
   * Resolves with { code, stderr, pipelineError } once the client exits.
   */
  _streamMysqlImport({ clientPath, args, operationId, safeName, source, capturedVirtualColumns }) {
    return new Promise((resolve, reject) => {
      const proc = spawn(clientPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      this.runningOperations.set(operationId, { proc, type: 'import', dbName: safeName });

      let stderr = '';
      let pipelineError = null;
      let settled = false;

      const abort = (err) => {
        if (!pipelineError) {
          pipelineError = err;
        }
        try {
          proc.kill();
        } catch {
          // ignore
        }
      };

      // Drain stdout: if the dump contains statements that print results and
      // nobody reads them, the pipe buffer fills up and the client stalls.
      proc.stdout.resume();
      proc.stderr.on('data', (data) => {
        if (stderr.length < 64 * 1024) {
          stderr += data.toString();
        }
      });
      // Writes after the client exits (error/cancel) raise EPIPE; the exit code reports the real problem.
      proc.stdin.on('error', () => {});

      const sqlProcessor = this.createSqlProcessorStream(capturedVirtualColumns);
      source.stream.on('error', err => abort(new Error(`Failed to read import file: ${err.message}`)));
      sqlProcessor.on('error', err => abort(new Error(`SQL processing error: ${err.message}`)));

      if (source.state.error) {
        abort(new Error(`Failed to read import file: ${source.state.error.message}`));
      }

      // Session settings for bulk loading. autocommit=0 + periodic COMMITs injected
      // by the processor avoid a log flush per INSERT without building one giant
      // transaction. Server-wide tuning is applied separately (see _applyImportServerTuning).
      proc.stdin.write(Buffer.from(
        'SET autocommit=0;\n' +
        'SET unique_checks=0;\n' +
        'SET foreign_key_checks=0;\n' +
        'SET NAMES utf8mb4;\n',
        'utf8'
      ));

      source.stream.pipe(sqlProcessor).pipe(proc.stdin, { end: false });

      sqlProcessor.on('end', () => {
        proc.stdin.end(Buffer.from(
          '\nCOMMIT;\n' +
          'SET autocommit=1;\n' +
          'SET unique_checks=1;\n' +
          'SET foreign_key_checks=1;\n',
          'utf8'
        ));
      });

      proc.on('error', (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });

      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        resolve({ code, stderr, pipelineError });
      });
    });
  },

  /**
   * Line-oriented streaming SQL processor. Operates on raw Buffers so the bulk of
   * a dump (INSERT data) is forwarded without decoding or copying. Only these
   * statements are inspected/rewritten:
   *  - CREATE TABLE: generated (virtual/stored) columns are stripped and recorded
   *    so they can be re-added after import.
   *  - INSERT into tables that had generated columns: those values are removed.
   *  - UNLOCK TABLES: followed by COMMIT.
   * A COMMIT is also injected after a complete INSERT every `commitEveryBytes`
   * (never inside DELIMITER blocks) so autocommit=0 imports stay bounded.
   */
  createSqlProcessorStream(capturedVirtualColumns = [], options = {}) {
    const self = this;
    const commitEveryBytes = options.commitEveryBytes ?? 64 * MB;
    const maxCaptureBytes = options.maxCaptureBytes ?? 256 * MB;
    const HEAD_BYTES = 256;
    const SEMICOLON = 0x3b;
    const COMMIT_BUF = Buffer.from('COMMIT;\n', 'utf8');
    const generatedColumns = new Map();

    let headParts = [];
    let headLen = 0;
    let lineAction = null; // null = start of line (undecided) | 'pass' | 'capture'
    let lineKind = 'other';
    let delimiterLine = null;
    let lastSig = 0;

    let capturing = false;
    let captureKind = null;
    let captureParts = [];
    let captureLen = 0;

    let passStatement = false;
    let passStatementIsInsert = false;
    let customDelimiter = false;
    let bytesSinceCommit = 0;
    let out = [];

    const emit = (buf) => {
      if (!buf || buf.length === 0) return;
      const last = out[out.length - 1];
      // Coalesce adjacent views of the same underlying memory (zero-copy).
      if (last && last.buffer === buf.buffer && last.byteOffset + last.length === buf.byteOffset) {
        out[out.length - 1] = Buffer.from(last.buffer, last.byteOffset, last.length + buf.length);
      } else {
        out.push(buf);
      }
    };

    const classify = (head) => {
      let i = 0;
      while (i < head.length && (head[i] === 32 || head[i] === 9)) i++;
      const first = head[i] | 0x20;

      if (first === 0x64 /* d */) {
        if (bytesStartWithKeyword(head, i, 'delimiter')) {
          delimiterLine = head.toString('latin1', i, Math.min(head.length, i + HEAD_BYTES));
          return 'delimiter';
        }
        return 'other';
      }
      if (customDelimiter) return 'other';

      if (first === 0x69 /* i */) {
        if (!bytesStartWithKeyword(head, i, 'insert')) return 'other';
        if (generatedColumns.size > 0) {
          const text = head.toString('latin1', i, Math.min(head.length, i + HEAD_BYTES));
          const match = text.match(/^INSERT\s+(?:IGNORE\s+)?INTO\s+`?(\w+)`?/i);
          if (match && generatedColumns.has(match[1].toLowerCase())) {
            return 'trackedInsert';
          }
        }
        return 'insert';
      }
      if (first === 0x63 /* c */) {
        if (!bytesStartWithKeyword(head, i, 'create')) return 'other';
        const text = head.toString('latin1', i, Math.min(head.length, i + 64));
        return /^CREATE\s+TABLE\b/i.test(text) ? 'create' : 'other';
      }
      if (first === 0x75 /* u */) {
        if (!bytesStartWithKeyword(head, i, 'unlock')) return 'other';
        const text = head.toString('latin1', i, Math.min(head.length, i + 64));
        return /^UNLOCK\s+TABLES\b/i.test(text) ? 'unlock' : 'other';
      }
      return 'other';
    };

    const maybeCommit = () => {
      if (!customDelimiter && bytesSinceCommit >= commitEveryBytes) {
        emit(COMMIT_BUF);
        bytesSinceCommit = 0;
      }
    };

    const resetCapture = () => {
      capturing = false;
      captureKind = null;
      captureParts = [];
      captureLen = 0;
    };

    const finishCapture = () => {
      const raw = captureParts.length === 1 ? captureParts[0] : Buffer.concat(captureParts, captureLen);
      const kind = captureKind;
      resetCapture();

      // Complete lines only, so UTF-8 decoding never splits a multi-byte character.
      const sql = raw.toString('utf8');
      let rewritten = sql;
      try {
        rewritten = kind === 'create'
          ? self._rewriteCreateTableSql(sql, generatedColumns, capturedVirtualColumns)
          : self._rewriteInsertSql(sql, generatedColumns);
      } catch (error) {
        self.managers?.log?.systemWarn?.('SQL import rewrite failed; passing statement through unchanged', { error: error.message });
        rewritten = sql;
      }
      emit(rewritten === sql ? raw : Buffer.from(rewritten, 'utf8'));

      if (kind === 'trackedInsert') {
        maybeCommit();
      }
    };

    const endOfLine = () => {
      const endsStatement = lastSig === SEMICOLON;
      const kind = lineKind;
      lastSig = 0;
      lineAction = null;
      lineKind = 'other';

      if (capturing) {
        if (endsStatement) finishCapture();
        return;
      }

      if (passStatement) {
        if (endsStatement) {
          passStatement = false;
          if (passStatementIsInsert) maybeCommit();
        }
        return;
      }

      switch (kind) {
        case 'insert':
          if (endsStatement) {
            maybeCommit();
          } else {
            passStatement = true;
            passStatementIsInsert = true;
          }
          break;
        case 'unlock':
          emit(COMMIT_BUF);
          bytesSinceCommit = 0;
          break;
        case 'delimiter': {
          const token = (delimiterLine || '').trim().split(/\s+/)[1];
          customDelimiter = !!token && token !== ';';
          delimiterLine = null;
          break;
        }
        default:
          break;
      }
    };

    const consume = (segment, eol) => {
      let seg = segment;
      bytesSinceCommit += seg.length;

      if (lineAction === null) {
        if (capturing) {
          lineAction = 'capture';
        } else if (passStatement) {
          lineAction = 'pass';
        } else {
          // Buffer the start of the line until we can classify it.
          if (!eol && headLen + seg.length < HEAD_BYTES) {
            headParts.push(seg);
            headLen += seg.length;
            return;
          }
          if (headLen > 0) {
            const total = headLen + seg.length;
            headParts.push(seg);
            seg = Buffer.concat(headParts, total);
            headParts = [];
            headLen = 0;
          }

          lineKind = classify(seg);
          if (lineKind === 'create' || lineKind === 'trackedInsert') {
            capturing = true;
            captureKind = lineKind;
            captureParts = [];
            captureLen = 0;
            lineAction = 'capture';
          } else {
            lineAction = 'pass';
          }
        }
      }

      if (seg.length > 0) {
        const sig = trailingSignificantByte(seg);
        if (sig) lastSig = sig;
      }

      if (lineAction === 'capture') {
        captureParts.push(seg);
        captureLen += seg.length;
        if (captureLen > maxCaptureBytes) {
          // Too large to rewrite in memory; forward unchanged.
          const kind = captureKind;
          for (const part of captureParts) emit(part);
          resetCapture();
          lineAction = 'pass';
          passStatement = true;
          passStatementIsInsert = kind === 'trackedInsert';
        }
      } else {
        emit(seg);
      }

      if (eol) endOfLine();
    };

    const flushOut = (stream) => {
      for (const buf of out) stream.push(buf);
      out = [];
    };

    return new Transform({
      highWaterMark: 16 * MB,
      transform(chunk, encoding, callback) {
        try {
          const length = chunk.length;
          let pos = 0;
          while (pos < length) {
            const nl = chunk.indexOf(10, pos);
            if (nl === -1) {
              consume(chunk.subarray(pos), false);
              break;
            }
            consume(chunk.subarray(pos, nl + 1), true);
            pos = nl + 1;
          }
          flushOut(this);
          callback();
        } catch (error) {
          callback(error);
        }
      },

      flush(callback) {
        try {
          if (headLen > 0 || lineAction !== null) {
            consume(Buffer.alloc(0), true);
          }
          if (capturing) {
            for (const part of captureParts) emit(part);
            resetCapture();
          }
          flushOut(this);
          callback();
        } catch (error) {
          callback(error);
        }
      },
    });
  },

  _rewriteCreateTableSql(sql, generatedColumns, capturedVirtualColumns) {
    if (!/CREATE\s+TABLE/i.test(sql)) {
      return sql;
    }

    const self = this;
    return sql.replace(
      /CREATE TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`(\w+)`\s*\(([\s\S]*?)\)\s*(ENGINE[\s\S]*?;)/gi,
      (match, tableName, tableDefinition, enginePart) => {
        const definitions = self.splitDefinitions(tableDefinition);
        const filteredDefinitions = [];
        const virtualIndices = [];
        const virtualDefs = [];
        let columnIndex = 0;

        for (const definition of definitions) {
          const trimmed = definition.trim();
          if (!trimmed) {
            continue;
          }

          if (/^(PRIMARY KEY|KEY|UNIQUE KEY|CONSTRAINT|FOREIGN KEY|INDEX|CHECK|FULLTEXT)\b/i.test(trimmed)) {
            filteredDefinitions.push(trimmed);
            continue;
          }

          const columnMatch = trimmed.match(/^`(\w+)`/);
          if (!columnMatch) {
            filteredDefinitions.push(trimmed);
            continue;
          }

          if (/GENERATED\s+ALWAYS\s+AS/i.test(trimmed) || /AS\s*\(.*\)\s*(VIRTUAL|STORED|PERSISTENT)/i.test(trimmed)) {
            virtualIndices.push(columnIndex);
            virtualDefs.push({ table: tableName, def: trimmed });
            columnIndex++;
            continue;
          }

          columnIndex++;
          filteredDefinitions.push(trimmed);
        }

        if (virtualIndices.length === 0) {
          generatedColumns.delete(tableName.toLowerCase());
          return match;
        }

        capturedVirtualColumns.push(...virtualDefs);
        generatedColumns.set(tableName.toLowerCase(), virtualIndices);
        const newDefinition = '\n  ' + filteredDefinitions.join(',\n  ') + '\n';
        return `CREATE TABLE \`${tableName}\` (${newDefinition}) ${enginePart}`;
      }
    );
  },

  _rewriteInsertSql(sql, generatedColumns) {
    const insertRegex = /INSERT INTO `(\w+)` VALUES\s*/gi;
    let lastIndex = 0;
    let result = '';
    let insertMatch;
    let changed = false;

    while ((insertMatch = insertRegex.exec(sql)) !== null) {
      const virtualIndices = generatedColumns.get(insertMatch[1].toLowerCase());
      if (!virtualIndices || virtualIndices.length === 0) {
        continue;
      }

      const valuesStart = insertRegex.lastIndex;
      let valuesEnd = -1;
      let scannerIndex = valuesStart;
      let inString = false;
      let stringChar = '';

      while (scannerIndex < sql.length) {
        const char = sql[scannerIndex];

        if (inString) {
          if (char === '\\') {
            scannerIndex += 2;
            continue;
          }
          if (char === stringChar) {
            if (sql[scannerIndex + 1] === stringChar) {
              scannerIndex += 2;
              continue;
            }
            inString = false;
          }
          scannerIndex++;
          continue;
        }

        if (char === "'" || char === '"') {
          inString = true;
          stringChar = char;
        } else if (char === ';') {
          valuesEnd = scannerIndex;
          break;
        }
        scannerIndex++;
      }

      if (valuesEnd === -1) {
        valuesEnd = sql.length;
      }

      const valuesSection = sql.substring(valuesStart, valuesEnd);
      result += sql.substring(lastIndex, insertMatch.index);
      result += `INSERT INTO \`${insertMatch[1]}\` VALUES ${this.removeColumnsFromValues(valuesSection, virtualIndices)}`;
      lastIndex = valuesEnd;
      insertRegex.lastIndex = valuesEnd;
      changed = true;
    }

    if (!changed) {
      return sql;
    }
    return result + sql.substring(lastIndex);
  },

  splitDefinitions(sql) {
    const definitions = [];
    let current = '';
    let parenDepth = 0;
    let inString = false;
    let stringChar = '';

    for (let index = 0; index < sql.length; index++) {
      const char = sql[index];
      const nextChar = sql[index + 1] || '';

      if (inString) {
        if (char === '\\') {
          current += char + nextChar;
          index++;
          continue;
        }
        if (char === stringChar) {
          if (nextChar === stringChar) {
            current += char + nextChar;
            index++;
            continue;
          }
          inString = false;
        }
        current += char;
        continue;
      }

      if (char === "'" || char === '"' || char === '`') {
        inString = true;
        stringChar = char;
        current += char;
        continue;
      }

      if (char === '(') {
        parenDepth++;
        current += char;
        continue;
      }
      if (char === ')') {
        parenDepth--;
        current += char;
        continue;
      }

      if (char === ',' && parenDepth === 0) {
        definitions.push(current);
        current = '';
        continue;
      }

      current += char;
    }

    if (current.trim()) {
      definitions.push(current);
    }

    return definitions;
  },

  removeColumnsFromValues(valuesSection, indicesToRemove) {
    if (indicesToRemove.length === 0) {
      return valuesSection;
    }

    const valueSets = this.parseValueSets(valuesSection);

    return valueSets.map((valueSet) => {
      const values = this.splitValues(valueSet);
      const filteredValues = values.filter((value, index) => !indicesToRemove.includes(index));
      return '(' + filteredValues.join(',') + ')';
    }).join(',');
  },

  parseValueSets(valuesSection) {
    const valueSets = [];
    let current = '';
    let depth = 0;
    let inString = false;
    let stringChar = '';
    let index = 0;

    while (index < valuesSection.length) {
      const char = valuesSection[index];
      const nextChar = valuesSection[index + 1] || '';

      if (inString && char === '\\') {
        current += char + nextChar;
        index += 2;
        continue;
      }

      if (inString && char === stringChar && nextChar === stringChar) {
        current += char + nextChar;
        index += 2;
        continue;
      }

      if ((char === "'" || char === '"') && !inString) {
        inString = true;
        stringChar = char;
        current += char;
        index++;
        continue;
      }

      if (inString && char === stringChar) {
        inString = false;
        stringChar = '';
        current += char;
        index++;
        continue;
      }

      if (!inString) {
        if (char === '(') {
          if (depth === 0) {
            current = '';
          } else {
            current += char;
          }
          depth++;
          index++;
          continue;
        }

        if (char === ')') {
          depth--;
          if (depth === 0) {
            valueSets.push(current);
            current = '';
          } else {
            current += char;
          }
          index++;
          continue;
        }

        if (char === ',' && depth === 0) {
          index++;
          continue;
        }
      }

      if (depth > 0) {
        current += char;
      }
      index++;
    }

    return valueSets;
  },

  splitValues(valueSet) {
    const values = [];
    let current = '';
    let inString = false;
    let stringChar = '';
    let parenDepth = 0;
    let index = 0;

    while (index < valueSet.length) {
      const char = valueSet[index];
      const nextChar = valueSet[index + 1] || '';

      if (inString && char === '\\') {
        current += char + nextChar;
        index += 2;
        continue;
      }

      if (inString && char === stringChar && nextChar === stringChar) {
        current += char + nextChar;
        index += 2;
        continue;
      }

      if ((char === "'" || char === '"') && !inString) {
        inString = true;
        stringChar = char;
        current += char;
        index++;
        continue;
      }

      if (inString && char === stringChar) {
        inString = false;
        stringChar = '';
        current += char;
        index++;
        continue;
      }

      if (!inString) {
        if (char === '(') {
          parenDepth++;
          current += char;
          index++;
          continue;
        }

        if (char === ')') {
          parenDepth--;
          current += char;
          index++;
          continue;
        }

        if (char === ',' && parenDepth === 0) {
          values.push(current);
          current = '';
          index++;
          continue;
        }
      }

      current += char;
      index++;
    }

    if (current !== '' || values.length > 0) {
      values.push(current);
    }

    return values;
  },

  processImportSql(sql) {
    const virtualColumnPattern = /`\w+`\s+\w+(?:\([^)]*\))?\s+(?:GENERATED ALWAYS )?AS\s*\([^)]+\)\s*(?:VIRTUAL|STORED)?(?:\s+(?:NOT NULL|NULL))?(?:\s+COMMENT\s+'[^']*')?,?\s*\n?/gi;

    let processedSql = sql;
    processedSql = processedSql.replace(virtualColumnPattern, '');
    processedSql = processedSql.replace(/,(\s*\n?\s*\))/g, '$1');
    processedSql = processedSql.replace(/\n\n+/g, '\n');

    return processedSql;
  },

  async exportDatabase(databaseName, outputPath, progressCallback = null) {
    const dbType = this.getActiveDatabaseType();

    if (dbType === 'postgresql') {
      return this._exportPostgres(databaseName, outputPath, progressCallback);
    }
    if (dbType === 'mongodb') {
      return this._exportMongo(databaseName, outputPath, progressCallback);
    }

    const safeName = this.sanitizeName(databaseName);
    const operationId = uuidv4();

    progressCallback?.({ operationId, status: 'starting', message: 'Starting export...', dbName: safeName });

    const dumpPath = this.getDbDumpPath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    const user = settings.dbUser || this.dbConfig.user;
    const password = settings.dbPassword || '';

    if (!await fs.pathExists(dumpPath)) {
      throw new Error(`mysqldump not found at ${dumpPath}. Please ensure the database binary is installed.`);
    }

    const finalPath = outputPath.toLowerCase().endsWith('.gz') ? outputPath : `${outputPath}.gz`;

    try {
      // 1073741824 (1GB) is the absolute hard maximum allowed by MySQL's network protocol
      await this.runDbQuery('SET GLOBAL max_allowed_packet = 1073741824;', safeName);
    } catch {
      // Best-effort in case user lacks SUPER / SYSTEM_VARIABLES_ADMIN privileges
    }

    return new Promise((resolve, reject) => {
      const args = [
        `-h${this.dbConfig.host}`,
        `-P${port}`,
        `-u${user}`,
        '--max-allowed-packet=1G',
        '--single-transaction',
        '--routines',
        '--triggers',
        '--quick',
        '--lock-tables=false',
        '--no-tablespaces',
      ];

      if (password) {
        args.push(`-p${password}`);
      }

      args.push(safeName);

      progressCallback?.({ operationId, status: 'dumping', message: 'Creating database dump...', dbName: safeName });

      const proc = spawn(dumpPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      this.runningOperations.set(operationId, { proc, type: 'export', dbName: safeName });

      const gzip = zlib.createGzip({ level: 6 });
      const outputStream = fs.createWriteStream(finalPath);
      proc.stdout.pipe(gzip).pipe(outputStream);

      let stderr = '';
      let dataReceived = false;

      proc.stdout.on('data', () => {
        if (!dataReceived) {
          dataReceived = true;
          progressCallback?.({ operationId, status: 'compressing', message: 'Compressing and writing backup...', dbName: safeName });
        }
      });

      proc.stderr.on('data', (data) => {
        const msg = data.toString();
        if (!msg.includes('Using a password on the command line') && !msg.includes('Warning:')) {
          stderr += msg;
        }
      });

      outputStream.on('finish', () => {
        this.runningOperations.delete(operationId);
        progressCallback?.({ operationId, status: 'complete', message: 'Export completed successfully!', path: finalPath, dbName: safeName });
        resolve({ success: true, path: finalPath, operationId });
      });

      proc.on('close', (code) => {
        this.runningOperations.delete(operationId);
        if (code === null) {
          progressCallback?.({ operationId, status: 'cancelled', message: 'Export cancelled', dbName: safeName });
          resolve({ success: false, cancelled: true, operationId });
        } else if (code !== 0 && stderr) {
          const isViewError = stderr.includes('View') && (stderr.includes('references invalid') || stderr.includes('1356'));
          if (isViewError && dataReceived) {
            const warningMsg = 'Export completed with warnings: Some views could not be exported (they may reference invalid tables/columns)';
            progressCallback?.({ operationId, status: 'complete', message: warningMsg, path: finalPath, dbName: safeName });
            resolve({ success: true, path: finalPath, operationId, warning: stderr });
          } else {
            progressCallback?.({ operationId, status: 'error', message: `Export failed: ${stderr}`, dbName: safeName });
            reject(new Error(`Export failed: ${stderr}`));
          }
        }
      });

      proc.on('error', (error) => {
        this.runningOperations.delete(operationId);
        progressCallback?.({ operationId, status: 'error', message: `Export error: ${error.message}`, dbName: safeName });
        reject(error);
      });
    });
  },
};