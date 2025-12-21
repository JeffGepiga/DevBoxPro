const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const net = require('net');
const { app } = require('electron');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');

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
  }

  async initialize() {

    // Note: Actual per-version data directories (e.g., data/mysql/8.4/data) 
    // are created by ServiceManager when starting each version.
    // We just ensure the base backup directories exist here.
    const dataPath = path.join(app.getPath('userData'), 'data');
    await fs.ensureDir(path.join(dataPath, 'mysql', 'backups'));
    await fs.ensureDir(path.join(dataPath, 'mariadb', 'backups'));
  }

  // Get the currently active database type (mysql or mariadb)
  getActiveDatabaseType() {
    return this.configStore.getSetting('activeDatabaseType', 'mysql');
  }

  // Get the currently active database version
  getActiveDatabaseVersion() {
    const dbType = this.getActiveDatabaseType();
    const defaultVersion = dbType === 'mariadb' ? '11.4' : '8.4';
    return this.configStore.getSetting('activeDatabaseVersion', defaultVersion);
  }

  // Set the active database type and version
  async setActiveDatabaseType(dbType, version = null) {
    if (!['mysql', 'mariadb'].includes(dbType)) {
      throw new Error('Invalid database type. Must be "mysql" or "mariadb"');
    }
    this.configStore.setSetting('activeDatabaseType', dbType);

    // If version provided, also set it
    if (version) {
      this.configStore.setSetting('activeDatabaseVersion', version);
    }

    return { success: true, type: dbType, version };
  }

  // Get database info including type and credentials
  getDatabaseInfo() {
    const dbType = this.getActiveDatabaseType();
    const version = this.getActiveDatabaseVersion();
    const settings = this.configStore.get('settings', {});
    return {
      type: dbType,
      version: version,
      host: this.dbConfig.host,
      port: this.getActualPort(),
      user: settings.dbUser || 'root',
      password: settings.dbPassword || '',
    };
  }

  // Get the actual running port for the active database type and version
  getActualPort() {
    const dbType = this.getActiveDatabaseType();
    const version = this.getActiveDatabaseVersion();
    const settings = this.configStore.get('settings', {});

    // Try to get the actual port from ServiceManager for the specific version
    if (this.managers.service) {
      // Check if the specific version is running
      const runningVersions = this.managers.service.runningVersions.get(dbType);
      if (runningVersions && runningVersions.has(version)) {
        const versionInfo = runningVersions.get(version);
        if (versionInfo?.port) {
          return versionInfo.port;
        }
      }

      // Version not running - calculate expected port based on version offset
      const serviceConfig = this.managers.service.serviceConfigs[dbType];
      const basePort = serviceConfig?.defaultPort || 3306;
      const portOffset = this.managers.service.versionPortOffsets[dbType]?.[version] || 0;
      const expectedPort = basePort + portOffset;
      return expectedPort;
    }

    // Fallback to default port
    const defaultPort = dbType === 'mariadb' ? 3306 : (settings.mysqlPort || 3306);
    return defaultPort;
  }

  // Check if a specific database service version is running
  isServiceRunning(dbType = null, version = null) {
    const type = dbType || this.getActiveDatabaseType();
    const ver = version || this.getActiveDatabaseVersion();

    if (this.managers.service) {
      const runningVersions = this.managers.service.runningVersions.get(type);
      if (runningVersions && runningVersions.has(ver)) {
        return true;
      }
    }
    return false;
  }

  // Reset database credentials by saving them to ConfigStore
  // Credentials are applied when databases start via the init-file mechanism
  async resetCredentials(newUser = 'root', newPassword = '') {
    // Credentials being saved to ConfigStore

    try {
      // Save the new credentials in settings (ConfigStore is the source of truth)
      this.configStore.setSetting('dbUser', newUser);
      this.configStore.setSetting('dbPassword', newPassword);

      // Update local config for immediate use
      this.dbConfig.user = newUser;
      this.dbConfig.password = newPassword;

      // Credentials saved - will be applied on next database start
      return { success: true };
    } catch (error) {
      this.managers.log?.systemError('Error saving database credentials', { error: error.message });
      throw new Error(`Failed to save credentials: ${error.message}`);
    }
  }

  // Create an init file with SQL commands to reset credentials
  async createCredentialResetInitFile(newUser, newPassword) {
    const dbType = this.getActiveDatabaseType();
    const dataPath = path.join(app.getPath('userData'), 'data');
    const initFilePath = path.join(dataPath, dbType, 'credential_reset.sql');

    // Escape password for SQL
    const escapedPassword = newPassword.replace(/'/g, "''");

    // Build SQL commands - these run with skip-grant-tables so no auth needed
    const sqlCommands = [
      `FLUSH PRIVILEGES;`,
      `CREATE USER IF NOT EXISTS '${newUser}'@'localhost' IDENTIFIED BY '${escapedPassword}';`,
      `CREATE USER IF NOT EXISTS '${newUser}'@'127.0.0.1' IDENTIFIED BY '${escapedPassword}';`,
      `CREATE USER IF NOT EXISTS '${newUser}'@'%' IDENTIFIED BY '${escapedPassword}';`,
      `ALTER USER '${newUser}'@'localhost' IDENTIFIED BY '${escapedPassword}';`,
      `ALTER USER '${newUser}'@'127.0.0.1' IDENTIFIED BY '${escapedPassword}';`,
      `ALTER USER '${newUser}'@'%' IDENTIFIED BY '${escapedPassword}';`,
      `GRANT ALL PRIVILEGES ON *.* TO '${newUser}'@'localhost' WITH GRANT OPTION;`,
      `GRANT ALL PRIVILEGES ON *.* TO '${newUser}'@'127.0.0.1' WITH GRANT OPTION;`,
      `GRANT ALL PRIVILEGES ON *.* TO '${newUser}'@'%' WITH GRANT OPTION;`,
      `FLUSH PRIVILEGES;`,
    ];

    await fs.ensureDir(path.dirname(initFilePath));
    await fs.writeFile(initFilePath, sqlCommands.join('\n'), 'utf8');

    return initFilePath;
  }

  // Run a query without authentication (for skip-grant-tables mode)
  // With skip-grant-tables, MySQL allows connections without password verification
  async runDbQueryNoAuth(query, database = null) {
    const clientPath = this.getDbClientPath();
    const dbType = this.getActiveDatabaseType();

    // Get the actual port from ServiceManager (skip-grant-tables mode uses same port)
    let port = 3306;
    if (this.managers.service) {
      const serviceConfig = this.managers.service.serviceConfigs[dbType];
      if (serviceConfig?.actualPort) {
        port = serviceConfig.actualPort;
      }
    }

    // Check if client exists
    if (!fs.existsSync(clientPath)) {
      throw new Error(`MySQL client not found at ${clientPath}. Please install the database binary.`);
    }

    return new Promise((resolve, reject) => {
      // Use TCP connection - skip-grant-tables mode allows root without password
      const args = [
        `-h127.0.0.1`,
        `-P${port}`,
        '-uroot',
        '--skip-password',  // Explicitly skip password prompt
        '-N',
        '-B',
        '-e',
        query,
      ];

      if (database) {
        args.push(database);
      }

      // Running no-auth query

      const proc = spawn(clientPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          this.managers.log?.systemWarn(`[runDbQueryNoAuth] Query warning`, { stderr });
          // Don't reject for warnings, only for errors
          if (stderr.includes('ERROR')) {
            reject(new Error(`Query failed: ${stderr}`));
          } else {
            resolve([]);
          }
        } else {
          const rows = stdout
            .replace(/\r\n/g, '\n')  // Normalize Windows line endings
            .replace(/\r/g, '')       // Remove stray carriage returns
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(row => {
              const cols = row.split('\t').map(c => c.trim());
              return cols.length === 1 ? { value: cols[0] } : cols;
            });
          resolve(rows);
        }
      });

      proc.on('error', reject);
    });
  }

  getConnections() {
    const dbType = this.getActiveDatabaseType();
    return {
      [dbType]: {
        type: dbType,
        host: this.dbConfig.host,
        port: this.dbConfig.port,
        user: this.dbConfig.user,
        status: 'connected', // Would need actual check
      },
    };
  }

  async listDatabases() {
    const dbType = this.getActiveDatabaseType();

    // Check if service is running first - just return empty array if not
    if (!this.isServiceRunning()) {
      // Service not running - return empty list
      return [];
    }

    const result = await this.runDbQuery('SHOW DATABASES');
    return result.map((row) => ({
      name: (row.Database || '').trim(),
      isSystem: ['information_schema', 'mysql', 'performance_schema', 'sys'].includes((row.Database || '').trim()),
    }));
  }

  async createDatabase(name, version = null) {
    const safeName = this.sanitizeName(name);
    const dbType = this.getActiveDatabaseType();

    // Determine which version to use
    let dbVersion = version;
    if (!dbVersion) {
      const settings = this.configStore.get('settings', {});
      dbVersion = dbType === 'mariadb'
        ? (settings.mariadbVersion || '11.4')
        : (settings.mysqlVersion || '8.4');
    }

    // Check if the SPECIFIC version is running, if not try to start it
    if (!this.isServiceRunning(dbType, dbVersion)) {
      // Database not running, attempting auto-start

      if (this.managers.service) {
        try {
          // Starting database service
          await this.managers.service.startService(dbType, dbVersion);

          // Wait a bit for the service to be ready
          await new Promise(resolve => setTimeout(resolve, 3000));

          // Verify it's running now
          if (!this.isServiceRunning(dbType, dbVersion)) {
            throw new Error(`${dbType} ${dbVersion} failed to start`);
          }

          // Database started successfully
        } catch (startError) {
          this.managers.log?.systemError(`Failed to start ${dbType} ${dbVersion}`, { error: startError.message });
          throw new Error(`Cannot create database: ${dbType} ${dbVersion} is not running and failed to start. Please start it manually first.`);
        }
      } else {
        throw new Error(`Cannot create database: ${dbType} ${dbVersion} is not running. Please start it first.`);
      }
    }

    await this.runDbQuery(`CREATE DATABASE IF NOT EXISTS \`${safeName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    // Database created successfully
    return { success: true, name: safeName };
  }

  async deleteDatabase(name) {
    const safeName = this.sanitizeName(name);

    // Prevent deleting system databases
    if (['information_schema', 'mysql', 'performance_schema', 'sys'].includes(safeName)) {
      throw new Error('Cannot delete system database');
    }

    await this.runDbQuery(`DROP DATABASE IF EXISTS \`${safeName}\``);
    // Database deleted successfully
    return { success: true, name: safeName };
  }

  /**
   * Import a database from SQL file
   * @param {string} databaseName - Name of the database to import into
   * @param {string} filePath - Path to the SQL file (.sql or .sql.gz)
   * @param {Function} progressCallback - Callback for progress updates
   * @param {string} mode - Import mode: 'clean' (drop all tables first) or 'merge' (keep existing)
   */
  async importDatabase(databaseName, filePath, progressCallback = null, mode = 'merge') {
    const safeName = this.sanitizeName(databaseName);

    if (!(await fs.pathExists(filePath))) {
      throw new Error('Import file not found');
    }

    // Importing database

    // Verify database exists before importing
    const databases = await this.listDatabases();
    const dbExists = databases.some(db => db.name === safeName || db.name === databaseName);
    if (!dbExists) {
      throw new Error(`Database '${databaseName}' does not exist. Please create it first.`);
    }

    progressCallback?.({ status: 'starting', message: 'Starting import...' });

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
          progressCallback?.({ status: 'cleaning', message: 'Dropping existing tables...' });
          await this.dropAllTables(safeName);
        }

        // Get file size for progress tracking
        const fileStats = await fs.stat(filePath);
        const totalSize = fileStats.size;
        let processedBytes = 0;

        progressCallback?.({ status: 'importing', message: 'Importing to database (streaming)...', progress: 0 });

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
              status: 'importing',
              message: `Importing... ${sizeMB}MB / ${totalMB}MB (${progress}%)`,
              progress
            });
          }
        });

        // Create SQL processor transform stream to handle generated columns
        const sqlProcessor = this.createSqlProcessorStream();

        // Set up the pipeline
        if (isGzipped) {
          progressCallback?.({ status: 'importing', message: 'Decompressing and importing (streaming)...', progress: 0 });

          // Use streaming decompression - much faster and memory efficient
          const gunzip = zlib.createGunzip();

          gunzip.on('error', (err) => {
            proc.stdin.end();
            reject(new Error(`Decompression error: ${err.message}`));
          });

          readStream.pipe(gunzip).pipe(sqlProcessor).pipe(proc.stdin);
        } else {
          readStream.pipe(sqlProcessor).pipe(proc.stdin);
        }

        readStream.on('error', (err) => {
          proc.stdin.end();
          reject(new Error(`Read error: ${err.message}`));
        });

        sqlProcessor.on('error', (err) => {
          proc.stdin.end();
          reject(new Error(`SQL processing error: ${err.message}`));
        });

        proc.on('close', (code) => {
          if (code === 0) {
            // Import completed successfully
            progressCallback?.({ status: 'complete', message: 'Import completed successfully!' });
            resolve({ success: true });
          } else {
            const errorMsg = stderr || `Process exited with code ${code}`;
            progressCallback?.({ status: 'error', message: `Import failed: ${errorMsg}` });
            reject(new Error(`Import failed: ${errorMsg}`));
          }
        });

        proc.on('error', (error) => {
          progressCallback?.({ status: 'error', message: `Import error: ${error.message}` });
          reject(error);
        });
      } catch (error) {
        progressCallback?.({ status: 'error', message: `Import error: ${error.message}` });
        reject(error);
      }
    });
  }

  /**
   * Create a Transform stream that processes SQL to handle generated columns
   * - Tracks CREATE TABLE statements to identify generated columns by POSITION
   * - REMOVES generated column definitions from CREATE TABLE
   * - Modifies INSERT statements to remove values at those positions
   */
  createSqlProcessorStream() {
    const self = this;
    let buffer = '';
    const generatedColumns = new Map(); // tableName (lowercase) -> array of column indices

    // SQL Processor stream initialized

    return new Transform({
      transform(chunk, encoding, callback) {
        buffer += chunk.toString('utf8');

        // Find the last complete statement
        let processUpTo = -1;

        for (let i = buffer.length - 1; i >= 0; i--) {
          if (buffer[i] === ';') {
            const after = buffer.substring(i + 1, i + 20);
            if (!after || /^[\s\r\n]*($|--|\/\*|INSERT|CREATE|DROP|LOCK|UNLOCK|ALTER|SET)/i.test(after)) {
              processUpTo = i;
              break;
            }
          }
        }

        if (processUpTo === -1) {
          if (buffer.length > 10 * 1024 * 1024) {
            // Buffer too large, flushing
            this.push(buffer);
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

            // Split by lines and process
            const lines = tableDefinition.split('\n');
            const filteredLines = [];
            let columnIndex = 0;
            const virtualIndices = [];

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              const trimmed = line.trim();

              // Skip empty lines
              if (!trimmed) {
                continue;
              }

              // Keep PRIMARY KEY, KEY, CONSTRAINT, etc. as-is
              if (/^(PRIMARY KEY|KEY|UNIQUE KEY|CONSTRAINT|FOREIGN KEY|INDEX|CHECK)\b/i.test(trimmed)) {
                filteredLines.push(trimmed);
                continue;
              }

              // Check if this is a column definition
              const colMatch = trimmed.match(/^`(\w+)`/);
              if (colMatch) {
                const columnName = colMatch[1];

                // Check if it's a virtual/generated column
                if (/GENERATED\s+ALWAYS\s+AS|AS\s*\(.*\)\s*(VIRTUAL|STORED)/i.test(trimmed)) {
                  virtualIndices.push(columnIndex);
                  // Removing generated column from CREATE TABLE
                  columnIndex++;
                  // Don't add this line
                  continue;
                }

                columnIndex++;
              }

              filteredLines.push(trimmed);
            }

            if (virtualIndices.length > 0) {
              generatedColumns.set(tableNameLower, virtualIndices);
              // Table has generated columns removed

              // Rebuild with proper commas
              // Remove trailing commas from all lines first
              const cleanedLines = filteredLines.map(line => line.replace(/,\s*$/, ''));

              // Add commas to all lines except the last one
              const finalLines = cleanedLines.map((line, idx) => {
                if (idx < cleanedLines.length - 1) {
                  return '  ' + line + ',';
                }
                return '  ' + line;
              });

              const newDefinition = '\n' + finalLines.join('\n') + '\n';
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

          // Processing INSERT - removing generated column values

          const valuesStart = insertRegex.lastIndex;
          let valuesEnd = toProcess.indexOf(';', valuesStart);
          if (valuesEnd === -1) valuesEnd = toProcess.length;

          const valuesSection = toProcess.substring(valuesStart, valuesEnd);
          const processedValues = self.removeColumnsFromValues(valuesSection, virtualIndices);

          result += `INSERT INTO \`${insertMatch[1]}\` VALUES ${processedValues}`;
          lastIndex = valuesEnd;
        }

        result += toProcess.substring(lastIndex);

        this.push(result);
        callback();
      },

      flush(callback) {
        if (buffer.trim()) {
          // Flushing remaining buffer
          this.push(buffer);
        }
        callback();
      }
    });
  }

  /**
   * Remove values at specified indices from a VALUES clause
   * Handles multiple value sets: (a,b,c),(d,e,f)
   */
  removeColumnsFromValues(valuesSection, indicesToRemove) {
    if (indicesToRemove.length === 0) return valuesSection;

    // Parse value sets using proper state machine
    const valueSets = this.parseValueSets(valuesSection);

    // Parsed value sets for column removal

    // Process each value set
    const processedSets = valueSets.map((valueSet, setIdx) => {
      const values = this.splitValues(valueSet);

      if (setIdx === 0) {
        // Processing value set for generated column removal
      }

      // Filter out the generated column indices
      const filteredValues = [];
      for (let i = 0; i < values.length; i++) {
        if (!indicesToRemove.includes(i)) {
          filteredValues.push(values[i]);
        }
      }

      if (setIdx === 0) {
        // Values filtered for generated columns
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
            // Start of a new value set
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
            // End of a value set
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
    const safeName = this.sanitizeName(databaseName);

    // Exporting database
    progressCallback?.({ status: 'starting', message: 'Starting export...' });

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
      ];

      if (password) {
        args.push(`-p${password}`);
      }

      args.push(safeName);

      progressCallback?.({ status: 'dumping', message: 'Creating database dump...' });

      const proc = spawn(dumpPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      // Create gzip stream and pipe to file
      const gzip = zlib.createGzip({ level: 6 });
      const outputStream = fs.createWriteStream(finalPath);

      proc.stdout.pipe(gzip).pipe(outputStream);

      let stderr = '';
      let dataReceived = false;

      proc.stdout.on('data', () => {
        if (!dataReceived) {
          dataReceived = true;
          progressCallback?.({ status: 'compressing', message: 'Compressing and writing backup...' });
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
        // Export completed successfully
        progressCallback?.({ status: 'complete', message: 'Export completed successfully!', path: finalPath });
        resolve({ success: true, path: finalPath });
      });

      proc.on('close', (code) => {
        if (code !== 0 && stderr) {
          progressCallback?.({ status: 'error', message: `Export failed: ${stderr}` });
          reject(new Error(`Export failed: ${stderr}`));
        }
      });

      proc.on('error', (error) => {
        progressCallback?.({ status: 'error', message: `Export error: ${error.message}` });
        reject(error);
      });
    });
  }

  async runQuery(databaseName, query) {
    const safeName = this.sanitizeName(databaseName);
    return this.runDbQuery(query, safeName);
  }

  async runDbQuery(query, database = null) {
    const clientPath = this.getDbClientPath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    // Use settings if present, otherwise fall back to dbConfig
    // Note: checks for undefined because empty string is a valid password
    const user = settings.dbUser !== undefined ? settings.dbUser : this.dbConfig.user;
    const password = settings.dbPassword !== undefined ? settings.dbPassword : this.dbConfig.password;

    // Check if client exists
    if (!fs.existsSync(clientPath)) {
      throw new Error(`MySQL client not found at ${clientPath}. Please install the database binary from the Binaries page.`);
    }

    // Running database query

    return new Promise((resolve, reject) => {
      const args = [
        `-h${this.dbConfig.host}`,
        `-P${port}`,
        `-u${user}`,
      ];

      // Add password if set
      if (password) {
        args.push(`-p${password}`);
      }

      args.push(
        '-N', // Skip column names
        '-B', // Batch mode
        '-e',
        query,
      );

      if (database) {
        args.push(database);
      }

      const proc = spawn(clientPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // Parse results - handle both Unix (\n) and Windows (\r\n) line endings
          const rows = stdout
            .replace(/\r\n/g, '\n')  // Normalize Windows line endings
            .replace(/\r/g, '')       // Remove any stray carriage returns
            .trim()
            .split('\n')
            .filter((line) => line.length > 0)
            .map((line) => {
              const columns = line.split('\t').map(col => col.trim());
              // For SHOW DATABASES, first column is Database
              if (query.toLowerCase().includes('show databases')) {
                return { Database: columns[0] };
              }
              return columns;
            });

          resolve(rows);
        } else {
          // Provide helpful error message for access denied errors
          if (stderr.includes('Access denied') || stderr.includes('1045')) {
            const hint = password
              ? 'The stored credentials may be incorrect.'
              : 'The database may have a password set but none is configured in settings.';
            reject(new Error(`Database access denied for user '${user}'. ${hint} You may need to restart the database or check Settings > Network.`));
          } else {
            reject(new Error(`Query failed: ${stderr}`));
          }
        }
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });
  }

  getPhpMyAdminUrl() {
    const settings = this.configStore.get('settings', {});
    const port = settings.phpMyAdminPort || 8080;
    return `http://127.0.0.1:${port}`;
  }

  /**
   * Drop all tables in a database (for clean import)
   */
  async dropAllTables(databaseName) {
    try {
      // Get list of all tables
      const tables = await this.getTables(databaseName);

      if (tables.length === 0) {
        // No tables to drop
        return;
      }

      // Dropping tables for clean import

      // Build a single SQL statement with foreign key checks disabled
      // This ensures everything runs in the same session
      const dropStatements = tables.map(table => `DROP TABLE IF EXISTS \`${table}\``).join('; ');
      const combinedSql = `SET FOREIGN_KEY_CHECKS = 0; ${dropStatements}; SET FOREIGN_KEY_CHECKS = 1;`;

      await this.runDbQuery(combinedSql, databaseName);

      // All tables dropped successfully
    } catch (error) {
      this.managers.log?.systemError(`Error dropping tables in ${databaseName}`, { error: error.message });
      throw error;
    }
  }

  async getTables(databaseName) {
    const result = await this.runDbQuery('SHOW TABLES', databaseName);
    return result.map((row) => (row[0] || '').replace(/[\r\n]/g, '').trim()).filter(name => name.length > 0);
  }

  async getTableStructure(databaseName, tableName) {
    const result = await this.runDbQuery(`DESCRIBE \`${tableName}\``, databaseName);
    return result;
  }

  async getDatabaseSize(databaseName) {
    // Use escaped name in the query string for safety
    const escapedName = databaseName.replace(/'/g, "''");
    const query = `
      SELECT 
        SUM(data_length + index_length) as size
      FROM information_schema.tables 
      WHERE table_schema = '${escapedName}'
    `;
    const result = await this.runDbQuery(query);
    return parseInt(result[0]?.[0] || 0, 10);
  }

  // Helper methods
  sanitizeName(name) {
    // Trim whitespace and sanitize
    const trimmed = String(name || '').trim();
    const sanitized = trimmed.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 64);
    // Remove trailing underscores that might result from sanitization
    return sanitized.replace(/_+$/, '') || 'unnamed';
  }

  // Get the client path based on active database type and running version
  getDbClientPath() {
    const dbType = this.getActiveDatabaseType();
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const binName = process.platform === 'win32' ? 'mysql.exe' : 'mysql';

    // Get the running version from ServiceManager
    let version = null;
    if (this.managers.service) {
      const serviceStatus = this.managers.service.serviceStatus.get(dbType);
      if (serviceStatus?.status === 'running') {
        version = serviceStatus.version;
      }
    }

    // Use version in path if available
    if (version) {
      const versionPath = path.join(this.resourcePath, dbType, version, platform, 'bin', binName);
      if (fs.existsSync(versionPath)) {
        return versionPath;
      }
      // MySQL client not found at version path - trying fallback
    }

    // Fallback: Try to find any available mysql client
    const dbTypePath = path.join(this.resourcePath, dbType);
    if (fs.existsSync(dbTypePath)) {
      try {
        const versions = fs.readdirSync(dbTypePath).filter(v => {
          const binPath = path.join(dbTypePath, v, platform, 'bin', binName);
          return fs.existsSync(binPath);
        });

        if (versions.length > 0) {
          // Prefer newer versions (sort descending)
          versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
          const foundPath = path.join(dbTypePath, versions[0], platform, 'bin', binName);
          // Using fallback MySQL client
          return foundPath;
        }
      } catch (e) {
        this.managers.log?.systemError('Error scanning for MySQL client', { error: e.message });
      }
    }

    // Last resort fallback to old path structure (without version)
    return path.join(this.resourcePath, dbType, platform, 'bin', binName);
  }

  // Get the dump path based on active database type and running version
  getDbDumpPath() {
    const dbType = this.getActiveDatabaseType();
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const binName = process.platform === 'win32' ? 'mysqldump.exe' : 'mysqldump';

    // Get the running version from ServiceManager
    let version = null;
    if (this.managers.service) {
      const serviceStatus = this.managers.service.serviceStatus.get(dbType);
      if (serviceStatus?.status === 'running') {
        version = serviceStatus.version;
      }
    }

    // Use version in path if available
    if (version) {
      const versionPath = path.join(this.resourcePath, dbType, version, platform, 'bin', binName);
      if (fs.existsSync(versionPath)) {
        return versionPath;
      }
      // mysqldump not found at version path - trying fallback
    }

    // Fallback: Try to find any available mysqldump
    const dbTypePath = path.join(this.resourcePath, dbType);
    if (fs.existsSync(dbTypePath)) {
      try {
        const versions = fs.readdirSync(dbTypePath).filter(v => {
          const binPath = path.join(dbTypePath, v, platform, 'bin', binName);
          return fs.existsSync(binPath);
        });

        if (versions.length > 0) {
          // Prefer newer versions (sort descending)
          versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
          const foundPath = path.join(dbTypePath, versions[0], platform, 'bin', binName);
          // Using fallback mysqldump
          return foundPath;
        }
      } catch (e) {
        this.managers.log?.systemError('Error scanning for mysqldump', { error: e.message });
      }
    }

    // Last resort fallback to old path structure (without version)
    return path.join(this.resourcePath, dbType, platform, 'bin', binName);
  }

  // Legacy method names for backwards compatibility
  getMysqlPath() {
    return this.getDbClientPath();
  }

  getMysqldumpPath() {
    return this.getDbDumpPath();
  }

  async checkConnection() {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(3000);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        resolve(false);
      });

      socket.connect(this.dbConfig.port, this.dbConfig.host);
    });
  }
}

module.exports = { DatabaseManager };
