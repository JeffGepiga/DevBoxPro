/**
 * CompatibilityManager - Validates service version compatibility
 * 
 * Checks for known compatibility issues between different service versions
 * and provides warnings (not blockers) to help users make informed decisions.
 * 
 * Supports remote config updates from GitHub for keeping rules current.
 */

const path = require('path');
const { app } = require('electron');
const { getAppCachePath } = require('../utils/PathResolver');
const compatibilityConfig = require('./compatibility/config');
const compatibilityRules = require('./compatibility/rules');

class CompatibilityManager {
  constructor() {
    // Local config cache path
    this.localConfigPath = getAppCachePath(app, 'compatibility-config.json');

    // Remote config state
    this.remoteConfig = null;
    this.lastRemoteCheck = null;

    // Active rules come from the bundled compatibility config and may later be
    // overridden by a cached remote config.
    this.rules = [];

    // Remote config data
    this.deprecatedServices = {};
    this.frameworkRequirements = {};
    this.webServerRecommendations = {};
    this.databaseRecommendations = {};
    this.configVersion = 'uninitialized';

    this.loadBundledConfigSync();
  }

  getBundledConfigPath() {
    const appPath = typeof app.getAppPath === 'function' ? app.getAppPath() : process.cwd();
    return path.join(appPath, 'config', 'compatibility.json');
  }
}

Object.assign(CompatibilityManager.prototype, compatibilityConfig, compatibilityRules);

module.exports = CompatibilityManager;
