const databaseCredentials = require('./database/credentials');
const databaseHelpers = require('./database/helpers');
const databaseImportExport = require('./database/importExport');
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

}

Object.assign(DatabaseManager.prototype, databaseHelpers, databaseCredentials, databasePostgres, databaseMongo, databaseOperations, databaseImportExport);

module.exports = { DatabaseManager };
