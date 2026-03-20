const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const { v4: uuidv4 } = require('uuid');
const databaseCredentials = require('./database/credentials');
const databaseHelpers = require('./database/helpers');
const databaseMongo = require('./database/mongo');
const databaseOperations = require('./database/operations');
const databasePostgres = require('./database/postgres');

class DatabaseManager {
  constructor(resourcePath, configStore, managers = {}) {
    this.resourcePath = resourcePath;
    this.configStore = configStore;
    this.managers = managers;
    this.dbConfig = {
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: '',
    };
    // Track running import/export operations for cancellation
    this.runningOperations = new Map(); // operationId -> { proc, type, dbName }
  }

  /**
   * Validate import/export file path for security
   * @param {string} filePath - The file path to validate
   * @param {boolean} checkExtension - Whether to validate file extension
   * @returns {Object} { valid: boolean, error?: string }
   */
  validateFilePath(filePath, checkExtension = true) {
    if (!filePath || typeof filePath !== 'string') {
      return { valid: false, error: 'Invalid file path' };
    }

    // Security: Block path traversal attempts
    if (filePath.includes('..')) {
      this.managers.log?.systemWarn('Blocked path traversal attempt in database import/export', {
        path: filePath.substring(0, 100),
      });
      return { valid: false, error: 'Invalid file path (path traversal detected)' };
    }

    // Security: Check for valid SQL file extensions
    if (checkExtension) {
      const validExtensions = ['.sql', '.sql.gz', '.gz'];
      const lowerPath = filePath.toLowerCase();
      const hasValidExtension = validExtensions.some(ext => lowerPath.endsWith(ext));

      if (!hasValidExtension) {
        return { valid: false, error: 'Invalid file type. Only .sql and .sql.gz files are supported.' };
      }
    }

    return { valid: true };
  }

  /**
   * Import a database from SQL file
   * @param {string} databaseName - Name of the database to import into
   * @param {string} filePath - Path to the SQL file (.sql or .sql.gz)
   * @param {Function} progressCallback - Callback for progress updates
   * @param {string} mode - Import mode: 'clean' (drop all tables first) or 'merge' (keep existing)
   * @returns {Promise<Object>} { success: boolean, operationId: string }
   */
  async importDatabase(databaseName, filePath, progressCallback = null, mode = 'merge') {
    const dbType = this.getActiveDatabaseType();

    // ── Route to engine-specific implementation ──────────────────
    if (dbType === 'postgresql') {
      return this._importPostgres(databaseName, filePath, progressCallback, mode);
    }
    if (dbType === 'mongodb') {
      return this._importMongo(databaseName, filePath, progressCallback, mode);
    }

    // ── MySQL / MariaDB (original implementation) ─────────────────
    const safeName = this.sanitizeName(databaseName);
    const operationId = uuidv4();

    // Security: Validate file path
    const pathValidation = this.validateFilePath(filePath, true);
    if (!pathValidation.valid) {
      throw new Error(pathValidation.error);
    }

    if (!(await fs.pathExists(filePath))) {
      throw new Error('Import file not found');
    }

    // Security: Log import operation
    this.managers.log?.systemInfo('Database import started', {
      database: safeName,
      operationId,
      fileSize: (await fs.stat(filePath)).size,
      mode,
    });

    // Verify database exists before importing
    const databases = await this.listDatabases();
    const dbExists = databases.some(db => db.name === safeName || db.name === databaseName);
    if (!dbExists) {
      throw new Error(`Database '${databaseName}' does not exist. Please create it first.`);
    }

    progressCallback?.({ operationId, status: 'starting', message: 'Starting import...', dbName: safeName });

    const isGzipped = filePath.toLowerCase().endsWith('.gz');
    const clientPath = this.getDbClientPath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    const user = settings.dbUser || this.dbConfig.user;
    const password = settings.dbPassword || '';

    // Check if client exists
    if (!await fs.pathExists(clientPath)) {
      throw new Error(`MySQL client not found at ${clientPath}. Please ensure the database binary is installed.`);
    }

    return new Promise(async (resolve, reject) => {
      try {
        // If clean mode, drop all existing tables first
        if (mode === 'clean') {
          progressCallback?.({ operationId, status: 'cleaning', message: 'Recreating database (clean import)...', dbName: safeName });
          await this.dropAllTables(safeName);
        }

        // Get file size for progress tracking
        const fileStats = await fs.stat(filePath);
        const totalSize = fileStats.size;
        let processedBytes = 0;

        progressCallback?.({ operationId, status: 'importing', message: 'Importing to database (streaming)...', progress: 0, dbName: safeName });

        const args = [
          `-h${this.dbConfig.host}`,
          `-P${port}`,
          `-u${user}`,
        ];

        if (password) {
          args.push(`-p${password}`);
        }

        // Use sanitized database name (trimmed and safe)
        args.push(safeName);

        const proc = spawn(clientPath, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });

        // Track this operation for cancellation
        this.runningOperations.set(operationId, { proc, type: 'import', dbName: safeName });

        let stderr = '';
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        // Create read stream with progress tracking
        const readStream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 }); // 64KB chunks

        readStream.on('data', (chunk) => {
          processedBytes += chunk.length;
          const progress = Math.round((processedBytes / totalSize) * 100);
          // Update progress every ~5%
          if (progress % 5 === 0) {
            const sizeMB = (processedBytes / (1024 * 1024)).toFixed(1);
            const totalMB = (totalSize / (1024 * 1024)).toFixed(1);
            progressCallback?.({
              operationId,
              status: 'importing',
              message: `Importing... ${sizeMB}MB / ${totalMB}MB (${progress}%)`,
              progress,
              dbName: safeName
            });
          }
        });

        // Create SQL processor transform stream to handle generated columns
        const capturedVirtualColumns = []; // Store { table, def } for restoration
        const sqlProcessor = this.createSqlProcessorStream(capturedVirtualColumns);

        // Set up the pipeline
        if (isGzipped) {
          progressCallback?.({ operationId, status: 'importing', message: 'Decompressing and importing (streaming)...', progress: 0, dbName: safeName });

          // Use streaming decompression - much faster and memory efficient
          const gunzip = zlib.createGunzip();

          gunzip.on('error', (err) => {
            proc.stdin.end();
            this.runningOperations.delete(operationId);
            reject(new Error(`Decompression error: ${err.message}`));
          });

          readStream.pipe(gunzip).pipe(sqlProcessor).pipe(proc.stdin);
        } else {
          readStream.pipe(sqlProcessor).pipe(proc.stdin);
        }

        readStream.on('error', (err) => {
          proc.stdin.end();
          this.runningOperations.delete(operationId);
          reject(new Error(`Read error: ${err.message}`));
        });

        sqlProcessor.on('error', (err) => {
          proc.stdin.end();
          this.runningOperations.delete(operationId);
          reject(new Error(`SQL processing error: ${err.message}`));
        });

        proc.on('close', async (code) => {
          if (code === 0) {
            try {
              // Import successful, now restore virtual columns
              if (capturedVirtualColumns.length > 0) {
                progressCallback?.({ operationId, status: 'restoring', message: `Restoring ${capturedVirtualColumns.length} virtual columns...`, dbName: safeName });

                for (const vc of capturedVirtualColumns) {
                  try {
                    // We use the same connection/db
                    await this.runDbQuery(`ALTER TABLE \`${vc.table}\` ADD COLUMN ${vc.def}`, safeName);
                  } catch (alterErr) {
                    this.managers.log?.systemWarn(`Failed to restore virtual column for ${vc.table}`, { error: alterErr.message, def: vc.def });
                    // We continue trying to restore others even if one fails
                  }
                }
              }

              this.runningOperations.delete(operationId);
              // Import completed successfully
              progressCallback?.({ operationId, status: 'complete', message: 'Import completed successfully!', dbName: safeName });
              resolve({ success: true, operationId });
            } catch (postImportError) {
              // This is a partial failure - data is in but post-processing failed
              this.runningOperations.delete(operationId);
              progressCallback?.({ operationId, status: 'complete', message: 'Import completed with warnings (virtual columns)', dbName: safeName });
              resolve({ success: true, operationId, warning: postImportError.message });
            }
          } else if (code === null) {
            this.runningOperations.delete(operationId);
            // Process was killed (cancelled)
            progressCallback?.({ operationId, status: 'cancelled', message: 'Import cancelled', dbName: safeName });
            resolve({ success: false, cancelled: true, operationId });
          } else {
            // Error occurred - keep operation in map but mark as failed so UI can still see it
            // We update the operation object to indicate failure
            const errorMsg = stderr || `Process exited with code ${code}`;
            const op = this.runningOperations.get(operationId);
            if (op) {
              op.status = 'failed';
              op.error = errorMsg;
              // Auto-remove after 5 minutes if not manually cleared, to prevent memory leaks
              setTimeout(() => {
                this.runningOperations.delete(operationId);
              }, 5 * 60 * 1000);
            }

            progressCallback?.({ operationId, status: 'error', message: `Import failed: ${errorMsg}`, dbName: safeName });
            reject(new Error(`Import failed: ${errorMsg}`));
          }
        });

        proc.on('error', (error) => {
          // Keep operation on error too
          const op = this.runningOperations.get(operationId);
          if (op) {
            op.status = 'failed';
            op.error = error.message;
          }
          progressCallback?.({ operationId, status: 'error', message: `Import error: ${error.message}`, dbName: safeName });
          reject(error);
        });
      } catch (error) {
        // Here we might not have a proc yet or it failed synchronously
        this.runningOperations.delete(operationId);
        progressCallback?.({ operationId, status: 'error', message: `Import error: ${error.message}`, dbName: safeName });
        reject(error);
      }
    });
  }

  /**
   * Import a PostgreSQL database from a .sql or .sql.gz file using psql.
   */
  async _importPostgres(databaseName, filePath, progressCallback = null, mode = 'merge') {
    const safeName = this.sanitizeName(databaseName);
    const operationId = uuidv4();

    const pathValidation = this.validateFilePath(filePath, true);
    if (!pathValidation.valid) throw new Error(pathValidation.error);
    if (!await fs.pathExists(filePath)) throw new Error('Import file not found');

    this.managers.log?.systemInfo('PostgreSQL import started', { database: safeName, operationId, mode });

    const databases = await this.listDatabases();
    const dbExists = databases.some(db => db.name === safeName || db.name === databaseName);
    if (!dbExists) {
      throw new Error(`Database '${databaseName}' does not exist. Please create it first.`);
    }

    progressCallback?.({ operationId, status: 'starting', message: 'Starting PostgreSQL import...', dbName: safeName });

    const isGzipped = filePath.toLowerCase().endsWith('.gz');
    const clientPath = this.getDbClientPath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    const user = settings.dbUser !== undefined ? settings.dbUser : this.dbConfig.user;

    if (!await fs.pathExists(clientPath)) {
      throw new Error(`psql not found at ${clientPath}. Please ensure the PostgreSQL binary is installed.`);
    }

    return new Promise(async (resolve, reject) => {
      try {
        if (mode === 'clean') {
          progressCallback?.({ operationId, status: 'cleaning', message: 'Recreating database (clean import)...', dbName: safeName });
          await this.dropAllTables(safeName);
        }

        const fileStats = await fs.stat(filePath);
        const totalSize = fileStats.size;
        let processedBytes = 0;

        progressCallback?.({ operationId, status: 'importing', message: 'Importing to database (streaming)...', progress: 0, dbName: safeName });

        const args = [
          '-h', this.dbConfig.host,
          '-p', String(port),
          '-U', user,
          '-q', // quiet
          safeName,
        ];

        const proc = spawn(clientPath, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          env: this._buildPgEnv(),
        });

        this.runningOperations.set(operationId, { proc, type: 'import', dbName: safeName });

        let stderr = '';
        proc.stderr.on('data', (data) => { stderr += data.toString(); });

        const readStream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
        readStream.on('data', (chunk) => {
          processedBytes += chunk.length;
          const progress = Math.round((processedBytes / totalSize) * 100);
          if (progress % 5 === 0) {
            const sizeMB = (processedBytes / (1024 * 1024)).toFixed(1);
            const totalMB = (totalSize / (1024 * 1024)).toFixed(1);
            progressCallback?.({ operationId, status: 'importing', message: `Importing... ${sizeMB}MB / ${totalMB}MB (${progress}%)`, progress, dbName: safeName });
          }
        });

        if (isGzipped) {
          progressCallback?.({ operationId, status: 'importing', message: 'Decompressing and importing (streaming)...', progress: 0, dbName: safeName });
          const gunzip = zlib.createGunzip();
          gunzip.on('error', (err) => {
            proc.stdin.end();
            this.runningOperations.delete(operationId);
            reject(new Error(`Decompression error: ${err.message}`));
          });
          readStream.pipe(gunzip).pipe(proc.stdin);
        } else {
          readStream.pipe(proc.stdin);
        }

        readStream.on('error', (err) => { proc.stdin.end(); this.runningOperations.delete(operationId); reject(new Error(`Read error: ${err.message}`)); });

        proc.on('close', (code) => {
          this.runningOperations.delete(operationId);
          if (code === 0) {
            progressCallback?.({ operationId, status: 'complete', message: 'Import completed successfully!', dbName: safeName });
            resolve({ success: true, operationId });
          } else if (code === null) {
            progressCallback?.({ operationId, status: 'cancelled', message: 'Import cancelled', dbName: safeName });
            resolve({ success: false, cancelled: true, operationId });
          } else {
            const errorMsg = stderr || `Process exited with code ${code}`;
            progressCallback?.({ operationId, status: 'error', message: `Import failed: ${errorMsg}`, dbName: safeName });
            reject(new Error(`PostgreSQL import failed: ${errorMsg}`));
          }
        });

        proc.on('error', (error) => {
          this.runningOperations.delete(operationId);
          progressCallback?.({ operationId, status: 'error', message: `Import error: ${error.message}`, dbName: safeName });
          reject(error);
        });
      } catch (error) {
        this.runningOperations.delete(operationId);
        progressCallback?.({ operationId, status: 'error', message: `Import error: ${error.message}`, dbName: safeName });
        reject(error);
      }
    });
  }

  /**
   * Import a MongoDB database from a mongodump archive (.gz) using mongorestore.
   */
  async _importMongo(databaseName, filePath, progressCallback = null, mode = 'merge') {
    const safeName = this.sanitizeName(databaseName);
    const operationId = uuidv4();

    const pathValidation = this.validateFilePath(filePath, true);
    if (!pathValidation.valid) throw new Error(pathValidation.error);
    if (!await fs.pathExists(filePath)) throw new Error('Import file not found');

    this.managers.log?.systemInfo('MongoDB import started', { database: safeName, operationId, mode });
    progressCallback?.({ operationId, status: 'starting', message: 'Starting MongoDB import...', dbName: safeName });

    const restorePath = this.getDbRestorePath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    const user = settings.dbUser !== undefined ? settings.dbUser : this.dbConfig.user;
    const password = settings.dbPassword !== undefined ? settings.dbPassword : this.dbConfig.password;

    if (!await fs.pathExists(restorePath)) {
      throw new Error(`mongorestore not found at ${restorePath}. Please ensure the MongoDB binary is installed.`);
    }

    return new Promise((resolve, reject) => {
      const isGzipped = filePath.toLowerCase().endsWith('.gz');
      const args = [
        '--host', this.dbConfig.host,
        '--port', String(port),
        '--db', safeName,
        '--archive=' + filePath,
      ];

      if (isGzipped) args.push('--gzip');
      if (mode === 'clean') args.push('--drop');

      if (user) {
        args.push('--username', user, '--authenticationDatabase', 'admin');
      }
      if (password) {
        args.push('--password', String(password));
      }

      progressCallback?.({ operationId, status: 'importing', message: 'Restoring MongoDB archive...', progress: 0, dbName: safeName });

      const proc = spawn(restorePath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      this.runningOperations.set(operationId, { proc, type: 'import', dbName: safeName });

      let stderr = '';
      proc.stderr.on('data', (data) => {
        const msg = data.toString();
        if (!msg.includes('password') && !msg.toLowerCase().includes('restoring ')) {
          stderr += msg;
        }
      });

      proc.on('close', (code) => {
        this.runningOperations.delete(operationId);
        if (code === 0) {
          progressCallback?.({ operationId, status: 'complete', message: 'Import completed successfully!', dbName: safeName });
          resolve({ success: true, operationId });
        } else if (code === null) {
          progressCallback?.({ operationId, status: 'cancelled', message: 'Import cancelled', dbName: safeName });
          resolve({ success: false, cancelled: true, operationId });
        } else {
          const errorMsg = stderr || `Process exited with code ${code}`;
          progressCallback?.({ operationId, status: 'error', message: `Import failed: ${errorMsg}`, dbName: safeName });
          reject(new Error(`mongorestore failed: ${errorMsg}`));
        }
      });

      proc.on('error', (error) => {
        this.runningOperations.delete(operationId);
        progressCallback?.({ operationId, status: 'error', message: `Import error: ${error.message}`, dbName: safeName });
        reject(error);
      });
    });
  }

  /**
   * Create a Transform stream that processes SQL to handle generated columns
   * - Tracks CREATE TABLE statements to identify generated columns by POSITION
   * - REMOVES generated column definitions from CREATE TABLE
   * - Modifies INSERT statements to remove values at those positions
   * @param {Array} capturedVirtualColumns - Optional array to store removed column definitions { table, def }
   */
  createSqlProcessorStream(capturedVirtualColumns = []) {
    const self = this;
    let buffer = '';
    const generatedColumns = new Map(); // tableName (lowercase) -> array of column indices

    return new Transform({
      transform(chunk, encoding, callback) {
        buffer += chunk.toString('utf8');

        // Find the last complete statement by scanning forward and tracking string state
        // This ensures we don't split in the middle of a quoted string
        let processUpTo = -1;
        let inString = false;
        let stringChar = '';
        let lastValidSemicolon = -1;

        for (let i = 0; i < buffer.length; i++) {
          const char = buffer[i];
          const nextChar = buffer[i + 1] || '';

          if (inString) {
            // Handle escape sequences
            if (char === '\\') {
              i++; // Skip next character (escaped)
              continue;
            }
            // Check for end of string (handle doubled quotes as escape)
            if (char === stringChar) {
              if (nextChar === stringChar) {
                i++; // Skip doubled quote
                continue;
              }
              inString = false;
            }
          } else {
            // Not in string - check for string start or semicolon
            if (char === "'" || char === '"') {
              inString = true;
              stringChar = char;
            } else if (char === ';') {
              // Found a semicolon outside of a string - this is a valid statement end
              const after = buffer.substring(i + 1, i + 20);
              if (!after || /^[\s\r\n]*($|--|\/\*|INSERT|CREATE|DROP|LOCK|UNLOCK|ALTER|SET)/i.test(after)) {
                lastValidSemicolon = i;
              }
            }
          }
        }

        processUpTo = lastValidSemicolon;

        if (processUpTo === -1) {
          if (buffer.length > 10 * 1024 * 1024) {
            // Buffer too large, flushing
            this.push(Buffer.from(buffer, 'utf8'));
            buffer = '';
          }
          callback();
          return;
        }

        let toProcess = buffer.substring(0, processUpTo + 1);
        buffer = buffer.substring(processUpTo + 1);

        // First pass: Find and modify CREATE TABLE statements
        toProcess = toProcess.replace(
          /CREATE TABLE\s+`(\w+)`\s*\(([\s\S]*?)\)\s*(ENGINE[\s\S]*?;)/gi,
          (match, tableName, tableDefinition, enginePart) => {
            const tableNameLower = tableName.toLowerCase();

            // Use robust tokenizer to split definitions
            const definitions = self.splitDefinitions(tableDefinition);
            const filteredDefinitions = [];
            let columnIndex = 0;
            const virtualIndices = [];

            for (const def of definitions) {
              const trimmed = def.trim();
              if (!trimmed) continue;

              // Check if it's a key/constraint (not a column)
              if (/^(PRIMARY KEY|KEY|UNIQUE KEY|CONSTRAINT|FOREIGN KEY|INDEX|CHECK|FULLTEXT)\b/i.test(trimmed)) {
                filteredDefinitions.push(trimmed);
                continue;
              }

              // Assume it's a column if it starts with `name`
              const colMatch = trimmed.match(/^`(\w+)`/);
              if (colMatch) {
                // Check if virtual
                if (/GENERATED\s+ALWAYS\s+AS/i.test(trimmed) || /AS\s*\(.*\)\s*(VIRTUAL|STORED)/i.test(trimmed)) {
                  virtualIndices.push(columnIndex);

                  // Capture for restoration
                  capturedVirtualColumns.push({
                    table: tableName,
                    def: trimmed
                  });

                  columnIndex++;
                  continue; // Skip this column
                }
                columnIndex++;
                filteredDefinitions.push(trimmed);
              } else {
                // Fallback: if we can't identify it, keep it
                filteredDefinitions.push(trimmed);
              }
            }

            if (virtualIndices.length > 0) {
              generatedColumns.set(tableNameLower, virtualIndices);
              const newDefinition = '\n  ' + filteredDefinitions.join(',\n  ') + '\n';
              return `CREATE TABLE \`${tableName}\` (${newDefinition}) ${enginePart}`;
            }

            return match;
          }
        );

        // Second pass: Process INSERT statements
        const insertRegex = /INSERT INTO `(\w+)` VALUES\s*/gi;
        let lastIndex = 0;
        let result = '';
        let insertMatch;

        while ((insertMatch = insertRegex.exec(toProcess)) !== null) {
          const tableName = insertMatch[1].toLowerCase();
          const virtualIndices = generatedColumns.get(tableName);

          result += toProcess.substring(lastIndex, insertMatch.index);

          if (!virtualIndices || virtualIndices.length === 0) {
            result += insertMatch[0];
            lastIndex = insertRegex.lastIndex;
            continue;
          }

          const valuesStart = insertRegex.lastIndex;
          let valuesEnd = -1;

          // Find end of values section (wait for semicolon outside strings)
          let scannerIndex = valuesStart;
          let inString = false;
          let stringChar = '';

          while (scannerIndex < toProcess.length) {
            const char = toProcess[scannerIndex];
            const nextChar = toProcess[scannerIndex + 1] || '';

            if (inString) {
              if (char === '\\') { scannerIndex += 2; continue; }
              if (char === stringChar) {
                if (nextChar === stringChar) { scannerIndex += 2; continue; }
                inString = false;
                scannerIndex++;
                continue;
              }
              scannerIndex++;
            } else {
              if (char === "'" || char === '"') {
                inString = true;
                stringChar = char;
                scannerIndex++;
                continue;
              }
              if (char === ';') {
                valuesEnd = scannerIndex;
                break;
              }
              scannerIndex++;
            }
          }

          if (valuesEnd === -1) valuesEnd = toProcess.length;

          const valuesSection = toProcess.substring(valuesStart, valuesEnd);
          const processedValues = self.removeColumnsFromValues(valuesSection, virtualIndices);

          result += `INSERT INTO \`${insertMatch[1]}\` VALUES ${processedValues}`;
          lastIndex = valuesEnd;
        }

        result += toProcess.substring(lastIndex);

        this.push(Buffer.from(result, 'utf8'));
        if (callback) callback();
      },

      flush(callback) {
        if (buffer.trim()) {
          // Flushing remaining buffer
          this.push(Buffer.from(buffer, 'utf8'));
        }
        callback();
      }
    });
  }

  /**
   * Split SQL definitions by comma, respecting parens/quotes
   */
  splitDefinitions(sql) {
    const definitions = [];
    let current = '';
    let parenDepth = 0;
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < sql.length; i++) {
      const char = sql[i];
      const nextChar = sql[i + 1] || '';

      if (inString) {
        if (char === '\\') {
          current += char + nextChar;
          i++;
          continue;
        }
        if (char === stringChar) {
          if (nextChar === stringChar) {
            current += char + nextChar;
            i++;
            continue;
          }
          inString = false;
        }
        current += char;
        continue;
      }

      // Not in string
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
  }

  /**
   * Remove values at specified indices from a VALUES clause
   * Handles multiple value sets: (a,b,c),(d,e,f)
   */
  removeColumnsFromValues(valuesSection, indicesToRemove) {
    if (indicesToRemove.length === 0) return valuesSection;

    // Parse value sets using proper state machine
    const valueSets = this.parseValueSets(valuesSection);

    // Process each value set
    const processedSets = valueSets.map((valueSet, setIdx) => {
      const values = this.splitValues(valueSet);

      // Filter out the generated column indices
      const filteredValues = [];
      for (let i = 0; i < values.length; i++) {
        if (!indicesToRemove.includes(i)) {
          filteredValues.push(values[i]);
        }
      }

      return '(' + filteredValues.join(',') + ')';
    });

    return processedSets.join(',');
  }

  /**
   * Parse value sets from VALUES section: (v1,v2),(v3,v4),...
   */
  parseValueSets(valuesSection) {
    const valueSets = [];
    let current = '';
    let depth = 0;
    let inString = false;
    let stringChar = '';
    let i = 0;

    while (i < valuesSection.length) {
      const char = valuesSection[i];
      const nextChar = valuesSection[i + 1] || '';

      // Handle escape sequences in strings
      if (inString && char === '\\') {
        current += char + nextChar;
        i += 2;
        continue;
      }

      // Handle doubled quotes (MySQL escape)
      if (inString && char === stringChar && nextChar === stringChar) {
        current += char + nextChar;
        i += 2;
        continue;
      }

      // Toggle string state
      if ((char === "'" || char === '"') && !inString) {
        inString = true;
        stringChar = char;
        current += char;
        i++;
        continue;
      }

      if (inString && char === stringChar) {
        inString = false;
        stringChar = '';
        current += char;
        i++;
        continue;
      }

      // Handle parentheses only when not in string
      if (!inString) {
        if (char === '(') {
          if (depth === 0) {
            current = '';
          } else {
            current += char;
          }
          depth++;
          i++;
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
          i++;
          continue;
        }

        // Skip commas between value sets (depth 0)
        if (char === ',' && depth === 0) {
          i++;
          continue;
        }
      }

      // Add character if we're inside a value set
      if (depth > 0) {
        current += char;
      }
      i++;
    }

    return valueSets;
  }

  /**
   * Split a single value set into individual values
   * Input: "val1,val2,'string,with,commas',val4"
   */
  splitValues(valueSet) {
    const values = [];
    let current = '';
    let inString = false;
    let stringChar = '';
    let parenDepth = 0;
    let i = 0;

    while (i < valueSet.length) {
      const char = valueSet[i];
      const nextChar = valueSet[i + 1] || '';

      // Handle escape sequences
      if (inString && char === '\\') {
        current += char + nextChar;
        i += 2;
        continue;
      }

      // Handle doubled quotes (MySQL escape)
      if (inString && char === stringChar && nextChar === stringChar) {
        current += char + nextChar;
        i += 2;
        continue;
      }

      // Toggle string state
      if ((char === "'" || char === '"') && !inString) {
        inString = true;
        stringChar = char;
        current += char;
        i++;
        continue;
      }

      if (inString && char === stringChar) {
        inString = false;
        stringChar = '';
        current += char;
        i++;
        continue;
      }

      // Track nested parentheses (for functions like NOW(), CONCAT())
      if (!inString) {
        if (char === '(') {
          parenDepth++;
          current += char;
          i++;
          continue;
        }

        if (char === ')') {
          parenDepth--;
          current += char;
          i++;
          continue;
        }

        // Split on comma only when not in string and not in nested parens
        if (char === ',' && parenDepth === 0) {
          values.push(current);
          current = '';
          i++;
          continue;
        }
      }

      current += char;
      i++;
    }

    // Don't forget the last value
    if (current !== '' || values.length > 0) {
      values.push(current);
    }

    return values;
  }

  /**
   * Process SQL content to remove virtual column definitions that may cause import issues
   */
  processImportSql(sql) {
    // Remove GENERATED/VIRTUAL column definitions from CREATE TABLE statements
    // These need to be added back separately via ALTER TABLE after data import
    const virtualColumnPattern = /`\w+`\s+\w+(?:\([^)]*\))?\s+(?:GENERATED ALWAYS )?AS\s*\([^)]+\)\s*(?:VIRTUAL|STORED)?(?:\s+(?:NOT NULL|NULL))?(?:\s+COMMENT\s+'[^']*')?,?\s*\n?/gi;

    let processedSql = sql;

    // Remove virtual columns from CREATE TABLE statements
    processedSql = processedSql.replace(virtualColumnPattern, '');

    // Clean up any trailing commas before closing parenthesis in CREATE TABLE
    processedSql = processedSql.replace(/,(\s*\n?\s*\))/g, '$1');

    // Remove any double newlines
    processedSql = processedSql.replace(/\n\n+/g, '\n');

    return processedSql;
  }

  async exportDatabase(databaseName, outputPath, progressCallback = null) {
    const dbType = this.getActiveDatabaseType();

    // ── Route to engine-specific implementation ──────────────────
    if (dbType === 'postgresql') {
      return this._exportPostgres(databaseName, outputPath, progressCallback);
    }
    if (dbType === 'mongodb') {
      return this._exportMongo(databaseName, outputPath, progressCallback);
    }

    // ── MySQL / MariaDB (original implementation) ─────────────────
    const safeName = this.sanitizeName(databaseName);
    const operationId = uuidv4();

    // Exporting database
    progressCallback?.({ operationId, status: 'starting', message: 'Starting export...', dbName: safeName });

    const dumpPath = this.getDbDumpPath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    const user = settings.dbUser || this.dbConfig.user;
    const password = settings.dbPassword || '';

    // Check if mysqldump exists
    if (!await fs.pathExists(dumpPath)) {
      throw new Error(`mysqldump not found at ${dumpPath}. Please ensure the database binary is installed.`);
    }

    // Ensure output has .gz extension
    const finalPath = outputPath.toLowerCase().endsWith('.gz') ? outputPath : `${outputPath}.gz`;

    return new Promise((resolve, reject) => {
      const args = [
        `-h${this.dbConfig.host}`,
        `-P${port}`,
        `-u${user}`,
        '--single-transaction',
        '--routines',
        '--triggers',
        '--quick',
        '--lock-tables=false',
        '--force', // Continue despite errors
        '--no-tablespaces', // Skip tablespace info (avoids some permission issues)
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

      // Track this operation for cancellation
      this.runningOperations.set(operationId, { proc, type: 'export', dbName: safeName });

      // Create gzip stream and pipe to file
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
        // Filter out common warnings that aren't errors
        if (!msg.includes('Using a password on the command line') &&
          !msg.includes('Warning:')) {
          stderr += msg;
        }
      });

      outputStream.on('finish', () => {
        this.runningOperations.delete(operationId);
        // Export completed successfully
        progressCallback?.({ operationId, status: 'complete', message: 'Export completed successfully!', path: finalPath, dbName: safeName });
        resolve({ success: true, path: finalPath, operationId });
      });

      proc.on('close', (code) => {
        this.runningOperations.delete(operationId);
        if (code === null) {
          // Process was killed (cancelled)
          progressCallback?.({ operationId, status: 'cancelled', message: 'Export cancelled', dbName: safeName });
          resolve({ success: false, cancelled: true, operationId });
        } else if (code !== 0 && stderr) {
          // Check if it's a view-related error but we still got some data
          const isViewError = stderr.includes('View') && (stderr.includes('references invalid') || stderr.includes('1356'));
          if (isViewError && dataReceived) {
            // Partial success - some tables exported but views had issues
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
  }

  /**
   * Export a PostgreSQL database using pg_dump (SQL output piped through gzip).
   */
  async _exportPostgres(databaseName, outputPath, progressCallback = null) {
    const safeName = this.sanitizeName(databaseName);
    const operationId = uuidv4();

    progressCallback?.({ operationId, status: 'starting', message: 'Starting PostgreSQL export...', dbName: safeName });

    const dumpPath = this.getDbDumpPath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    const user = settings.dbUser || this.dbConfig.user;

    if (!await fs.pathExists(dumpPath)) {
      throw new Error(`pg_dump not found at ${dumpPath}. Please ensure the PostgreSQL binary is installed.`);
    }

    const finalPath = outputPath.toLowerCase().endsWith('.gz') ? outputPath : `${outputPath}.gz`;

    return new Promise((resolve, reject) => {
      const args = [
        '-h', this.dbConfig.host,
        '-p', String(port),
        '-U', user,
        '--no-owner',
        '--no-acl',
        safeName,
      ];

      progressCallback?.({ operationId, status: 'dumping', message: 'Creating PostgreSQL dump...', dbName: safeName });

      const proc = spawn(dumpPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: this._buildPgEnv(),
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
        if (!msg.includes('password') && !msg.includes('Warning:')) {
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
          progressCallback?.({ operationId, status: 'error', message: `Export failed: ${stderr}`, dbName: safeName });
          reject(new Error(`pg_dump failed: ${stderr}`));
        }
      });

      proc.on('error', (error) => {
        this.runningOperations.delete(operationId);
        progressCallback?.({ operationId, status: 'error', message: `Export error: ${error.message}`, dbName: safeName });
        reject(error);
      });
    });
  }

  /**
   * Export a MongoDB database using mongodump (archive format, gzip compressed).
   */
  async _exportMongo(databaseName, outputPath, progressCallback = null) {
    const safeName = this.sanitizeName(databaseName);
    const operationId = uuidv4();

    progressCallback?.({ operationId, status: 'starting', message: 'Starting MongoDB export...', dbName: safeName });

    const dumpPath = this.getDbDumpPath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    const user = settings.dbUser || this.dbConfig.user;
    const password = settings.dbPassword || '';

    if (!await fs.pathExists(dumpPath)) {
      throw new Error(`mongodump not found at ${dumpPath}. Please ensure the MongoDB binary is installed.`);
    }

    // mongodump archive files are gzip-compressed by convention — keep .gz extension
    const finalPath = outputPath.toLowerCase().endsWith('.gz') ? outputPath : `${outputPath}.gz`;

    return new Promise((resolve, reject) => {
      const args = [
        '--host', this.dbConfig.host,
        '--port', String(port),
        '--db', safeName,
        '--archive=' + finalPath,
        '--gzip',
      ];

      if (user) {
        args.push('--username', user, '--authenticationDatabase', 'admin');
      }
      if (password) {
        args.push('--password', password);
      }

      progressCallback?.({ operationId, status: 'dumping', message: 'Creating MongoDB dump...', dbName: safeName });

      const proc = spawn(dumpPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      this.runningOperations.set(operationId, { proc, type: 'export', dbName: safeName });

      let stderr = '';

      proc.stderr.on('data', (data) => {
        const msg = data.toString();
        if (!msg.includes('password') && !msg.includes('warning:') && !msg.toLowerCase().includes('writing ')) {
          stderr += msg;
        }
      });

      proc.on('close', (code) => {
        this.runningOperations.delete(operationId);
        if (code === 0) {
          progressCallback?.({ operationId, status: 'complete', message: 'Export completed successfully!', path: finalPath, dbName: safeName });
          resolve({ success: true, path: finalPath, operationId });
        } else if (code === null) {
          progressCallback?.({ operationId, status: 'cancelled', message: 'Export cancelled', dbName: safeName });
          resolve({ success: false, cancelled: true, operationId });
        } else {
          progressCallback?.({ operationId, status: 'error', message: `Export failed: ${stderr}`, dbName: safeName });
          reject(new Error(`mongodump failed: ${stderr}`));
        }
      });

      proc.on('error', (error) => {
        this.runningOperations.delete(operationId);
        progressCallback?.({ operationId, status: 'error', message: `Export error: ${error.message}`, dbName: safeName });
        reject(error);
      });
    });
  }

}

Object.assign(DatabaseManager.prototype, databaseHelpers, databaseCredentials, databasePostgres, databaseMongo, databaseOperations);

module.exports = { DatabaseManager };
