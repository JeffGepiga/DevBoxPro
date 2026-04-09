const fs = require('fs-extra');
const { spawn } = require('child_process');
const zlib = require('zlib');
const { Transform } = require('stream');
const { v4: uuidv4 } = require('uuid');

module.exports = {
  validateFilePath(filePath, checkExtension = true) {
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
      const validExtensions = ['.sql', '.sql.gz', '.gz'];
      const lowerPath = filePath.toLowerCase();
      const hasValidExtension = validExtensions.some(ext => lowerPath.endsWith(ext));

      if (!hasValidExtension) {
        return { valid: false, error: 'Invalid file type. Only .sql and .sql.gz files are supported.' };
      }
    }

    return { valid: true };
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

    progressCallback?.({ operationId, status: 'starting', message: 'Starting import...', dbName: safeName });

    const isGzipped = filePath.toLowerCase().endsWith('.gz');
    const clientPath = this.getDbClientPath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    const user = settings.dbUser || this.dbConfig.user;
    const password = settings.dbPassword || '';

    if (!await fs.pathExists(clientPath)) {
      throw new Error(`MySQL client not found at ${clientPath}. Please ensure the database binary is installed.`);
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
        let lastReportedProgress = -1;

        progressCallback?.({ operationId, status: 'importing', message: 'Importing to database (streaming)...', progress: 0, dbName: safeName });

        const args = [
          `-h${this.dbConfig.host}`,
          `-P${port}`,
          `-u${user}`,
        ];

        if (password) {
          args.push(`-p${password}`);
        }

        args.push(safeName);

        const proc = spawn(clientPath, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });

        this.runningOperations.set(operationId, { proc, type: 'import', dbName: safeName });

        let stderr = '';
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        const readStream = fs.createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 });

        readStream.on('data', (chunk) => {
          processedBytes += chunk.length;
          const progress = Math.round((processedBytes / totalSize) * 100);
          if (progress !== lastReportedProgress && progress % 5 === 0) {
            lastReportedProgress = progress;
            const sizeMB = (processedBytes / (1024 * 1024)).toFixed(1);
            const totalMB = (totalSize / (1024 * 1024)).toFixed(1);
            progressCallback?.({
              operationId,
              status: 'importing',
              message: `Importing... ${sizeMB}MB / ${totalMB}MB (${progress}%)`,
              progress,
              dbName: safeName,
            });
          }
        });

        const capturedVirtualColumns = [];
        const sqlProcessor = this.createSqlProcessorStream(capturedVirtualColumns);

        // Write performance-critical MySQL session variables before import data
        const perfPreamble = Buffer.from(
          'SET autocommit=0;\n' +
          'SET unique_checks=0;\n' +
          'SET foreign_key_checks=0;\n' +
          'SET sql_log_bin=0;\n' +
          'SET NAMES utf8mb4;\n',
          'utf8'
        );
        proc.stdin.write(perfPreamble);

        if (isGzipped) {
          progressCallback?.({ operationId, status: 'importing', message: 'Decompressing and importing (streaming)...', progress: 0, dbName: safeName });

          const gunzip = zlib.createGunzip();

          gunzip.on('error', (err) => {
            proc.stdin.end();
            this.runningOperations.delete(operationId);
            reject(new Error(`Decompression error: ${err.message}`));
          });

          readStream.pipe(gunzip).pipe(sqlProcessor).pipe(proc.stdin, { end: false });
        } else {
          readStream.pipe(sqlProcessor).pipe(proc.stdin, { end: false });
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

        // Write performance epilogue and close stdin when the SQL processor finishes
        sqlProcessor.on('end', () => {
          const perfEpilogue = Buffer.from(
            '\nSET unique_checks=1;\n' +
            'SET foreign_key_checks=1;\n' +
            'COMMIT;\n',
            'utf8'
          );
          proc.stdin.write(perfEpilogue);
          proc.stdin.end();
        });

        proc.on('close', async (code) => {
          if (code === 0) {
            try {
              if (capturedVirtualColumns.length > 0) {
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

              this.runningOperations.delete(operationId);
              progressCallback?.({ operationId, status: 'complete', message: 'Import completed successfully!', dbName: safeName });
              resolve({ success: true, operationId });
            } catch (postImportError) {
              this.runningOperations.delete(operationId);
              progressCallback?.({ operationId, status: 'complete', message: 'Import completed with warnings (virtual columns)', dbName: safeName });
              resolve({ success: true, operationId, warning: postImportError.message });
            }
          } else if (code === null) {
            this.runningOperations.delete(operationId);
            progressCallback?.({ operationId, status: 'cancelled', message: 'Import cancelled', dbName: safeName });
            resolve({ success: false, cancelled: true, operationId });
          } else {
            const errorMsg = stderr || `Process exited with code ${code}`;
            const operation = this.runningOperations.get(operationId);
            if (operation) {
              operation.status = 'failed';
              operation.error = errorMsg;
              setTimeout(() => {
                this.runningOperations.delete(operationId);
              }, 5 * 60 * 1000);
            }

            progressCallback?.({ operationId, status: 'error', message: `Import failed: ${errorMsg}`, dbName: safeName });
            reject(new Error(`Import failed: ${errorMsg}`));
          }
        });

        proc.on('error', (error) => {
          const operation = this.runningOperations.get(operationId);
          if (operation) {
            operation.status = 'failed';
            operation.error = error.message;
          }
          progressCallback?.({ operationId, status: 'error', message: `Import error: ${error.message}`, dbName: safeName });
          reject(error);
        });
      } catch (error) {
        this.runningOperations.delete(operationId);
        progressCallback?.({ operationId, status: 'error', message: `Import error: ${error.message}`, dbName: safeName });
        reject(error);
      }
    });
  },


  createSqlProcessorStream(capturedVirtualColumns = []) {
    const self = this;
    let buffer = '';
    const generatedColumns = new Map();
    let passthrough = false; // Switches to true after all CREATE TABLEs are processed
    let seenInsert = false;

    return new Transform({
      highWaterMark: 8 * 1024 * 1024,
      transform(chunk, encoding, callback) {
        // Fast passthrough: once all CREATE TABLEs are processed and no virtual columns,
        // skip all parsing and push data directly
        if (passthrough) {
          this.push(chunk);
          callback();
          return;
        }

        buffer += chunk.toString('utf8');

        let inString = false;
        let stringChar = '';
        let lastValidSemicolon = -1;

        for (let index = 0; index < buffer.length; index++) {
          const char = buffer[index];
          const nextChar = buffer[index + 1] || '';

          if (inString) {
            if (char === '\\') {
              index++;
              continue;
            }
            if (char === stringChar) {
              if (nextChar === stringChar) {
                index++;
                continue;
              }
              inString = false;
            }
          } else if (char === "'" || char === '"') {
            inString = true;
            stringChar = char;
          } else if (char === ';') {
            const after = buffer.substring(index + 1, index + 20);
            if (!after || /^[\s\r\n]*($|--|\/\*|INSERT|CREATE|DROP|LOCK|UNLOCK|ALTER|SET)/i.test(after)) {
              lastValidSemicolon = index;
            }
          }
        }

        if (lastValidSemicolon === -1) {
          if (buffer.length > 50 * 1024 * 1024) {
            this.push(Buffer.from(buffer, 'utf8'));
            buffer = '';
          }
          callback();
          return;
        }

        let toProcess = buffer.substring(0, lastValidSemicolon + 1);
        buffer = buffer.substring(lastValidSemicolon + 1);

        toProcess = toProcess.replace(
          /CREATE TABLE\s+`(\w+)`\s*\(([\s\S]*?)\)\s*(ENGINE[\s\S]*?;)/gi,
          (match, tableName, tableDefinition, enginePart) => {
            const definitions = self.splitDefinitions(tableDefinition);
            const filteredDefinitions = [];
            const virtualIndices = [];
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

              if (/GENERATED\s+ALWAYS\s+AS/i.test(trimmed) || /AS\s*\(.*\)\s*(VIRTUAL|STORED)/i.test(trimmed)) {
                virtualIndices.push(columnIndex);
                capturedVirtualColumns.push({ table: tableName, def: trimmed });
                columnIndex++;
                continue;
              }

              columnIndex++;
              filteredDefinitions.push(trimmed);
            }

            if (virtualIndices.length === 0) {
              return match;
            }

            generatedColumns.set(tableName.toLowerCase(), virtualIndices);
            const newDefinition = '\n  ' + filteredDefinitions.join(',\n  ') + '\n';
            return `CREATE TABLE \`${tableName}\` (${newDefinition}) ${enginePart}`;
          }
        );

        // Fast path: if no virtual/generated columns detected, skip INSERT processing entirely
        if (generatedColumns.size === 0) {
          // Once we've seen INSERT statements without any virtual columns in preceding
          // CREATE TABLEs, switch to full passthrough for remaining data
          if (!seenInsert && /INSERT\s+INTO/i.test(toProcess)) {
            seenInsert = true;
          }
          if (seenInsert && !/CREATE\s+TABLE/i.test(toProcess)) {
            passthrough = true;
            // Flush any remaining buffer too
            if (buffer.length > 0) {
              this.push(Buffer.from(toProcess + buffer, 'utf8'));
              buffer = '';
            } else {
              this.push(Buffer.from(toProcess, 'utf8'));
            }
            callback();
            return;
          }
          this.push(Buffer.from(toProcess, 'utf8'));
          callback();
          return;
        }

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
          let scannerIndex = valuesStart;
          let valuesInString = false;
          let valuesStringChar = '';

          while (scannerIndex < toProcess.length) {
            const char = toProcess[scannerIndex];
            const nextChar = toProcess[scannerIndex + 1] || '';

            if (valuesInString) {
              if (char === '\\') {
                scannerIndex += 2;
                continue;
              }
              if (char === valuesStringChar) {
                if (nextChar === valuesStringChar) {
                  scannerIndex += 2;
                  continue;
                }
                valuesInString = false;
              }
              scannerIndex++;
              continue;
            }

            if (char === "'" || char === '"') {
              valuesInString = true;
              valuesStringChar = char;
              scannerIndex++;
              continue;
            }

            if (char === ';') {
              valuesEnd = scannerIndex;
              break;
            }

            scannerIndex++;
          }

          if (valuesEnd === -1) {
            valuesEnd = toProcess.length;
          }

          const valuesSection = toProcess.substring(valuesStart, valuesEnd);
          const processedValues = self.removeColumnsFromValues(valuesSection, virtualIndices);

          result += `INSERT INTO \`${insertMatch[1]}\` VALUES ${processedValues}`;
          lastIndex = valuesEnd;
        }

        result += toProcess.substring(lastIndex);
        this.push(Buffer.from(result, 'utf8'));
        callback();
      },

      flush(callback) {
        if (buffer.trim()) {
          this.push(Buffer.from(buffer, 'utf8'));
        }
        callback();
      },
    });
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
        '--force',
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