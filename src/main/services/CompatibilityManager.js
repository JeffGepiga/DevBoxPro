/**
 * CompatibilityManager - Validates service version compatibility
 * 
 * Checks for known compatibility issues between different service versions
 * and provides warnings (not blockers) to help users make informed decisions.
 */

class CompatibilityManager {
  constructor() {
    // Define compatibility rules
    // Each rule returns a warning message if the condition is met
    this.rules = [
      {
        id: 'php8-mysql57-auth',
        name: 'PHP 8.x + MySQL 5.7 Authentication',
        check: (config) => {
          const phpMajor = this.getMajorVersion(config.phpVersion);
          const mysqlVersion = config.services?.mysql;
          if (phpMajor >= 8 && mysqlVersion && this.compareVersions(mysqlVersion, '8.0') < 0) {
            return {
              level: 'warning',
              message: `MySQL ${mysqlVersion} uses legacy authentication (mysql_native_password). You may need to configure MySQL to use mysql_native_password for PHP ${config.phpVersion} compatibility.`,
              suggestion: 'Consider using MySQL 8.0+ or configure mysql_native_password in MySQL settings.',
            };
          }
          return null;
        },
      },
      {
        id: 'php74-mysql84-features',
        name: 'PHP 7.4 + MySQL 8.4 Features',
        check: (config) => {
          const phpMajor = this.getMajorVersion(config.phpVersion);
          const mysqlVersion = config.services?.mysql;
          if (phpMajor < 8 && mysqlVersion && this.compareVersions(mysqlVersion, '8.4') >= 0) {
            return {
              level: 'info',
              message: `Some MySQL 8.4 features may not be fully supported with PHP ${config.phpVersion}. Consider upgrading PHP for full compatibility.`,
              suggestion: 'Upgrade to PHP 8.x for best MySQL 8.4 compatibility.',
            };
          }
          return null;
        },
      },
      {
        id: 'mysql-mariadb-conflict',
        name: 'MySQL + MariaDB Port Conflict',
        check: (config) => {
          if (config.services?.mysql && config.services?.mariadb) {
            return {
              level: 'warning',
              message: 'Running both MySQL and MariaDB simultaneously may cause port conflicts. Each will use a different port automatically.',
              suggestion: 'DevBox Pro assigns different ports to each database version automatically.',
            };
          }
          return null;
        },
      },
      {
        id: 'legacy-php-modern-node',
        name: 'Legacy PHP + Modern Node.js',
        check: (config) => {
          const phpMajor = this.getMajorVersion(config.phpVersion);
          const nodeVersion = config.nodeVersion;
          if (phpMajor < 8 && nodeVersion && parseInt(nodeVersion) >= 20) {
            return {
              level: 'info',
              message: `Node.js ${nodeVersion} build tools are designed for modern workflows. Some older Laravel/PHP tools may expect older Node.js versions.`,
              suggestion: 'This is usually fine, but if you encounter build issues, try Node.js 18 or 16.',
            };
          }
          return null;
        },
      },
      {
        id: 'php74-deprecated',
        name: 'PHP 7.4 End of Life',
        check: (config) => {
          if (config.phpVersion === '7.4') {
            return {
              level: 'info',
              message: 'PHP 7.4 reached end-of-life in November 2022 and no longer receives security updates.',
              suggestion: 'Consider upgrading to PHP 8.x for security and performance improvements.',
            };
          }
          return null;
        },
      },
      {
        id: 'php80-deprecated',
        name: 'PHP 8.0 End of Life',
        check: (config) => {
          if (config.phpVersion === '8.0') {
            return {
              level: 'info',
              message: 'PHP 8.0 reached end-of-life in November 2023 and no longer receives security updates.',
              suggestion: 'Consider upgrading to PHP 8.1+ for security updates.',
            };
          }
          return null;
        },
      },
      {
        id: 'redis-php-extension',
        name: 'Redis PHP Extension',
        check: (config) => {
          if (config.services?.redis) {
            return {
              level: 'info',
              message: 'Make sure the PHP Redis extension (phpredis) is enabled in php.ini for your selected PHP version.',
              suggestion: 'Check Binary Manager to configure PHP extensions.',
            };
          }
          return null;
        },
      },
      {
        id: 'laravel-php-version',
        name: 'Laravel PHP Version Requirements',
        check: (config) => {
          if (config.type === 'laravel') {
            const phpVersion = parseFloat(config.phpVersion);
            // Laravel 11 requires PHP 8.2+
            if (phpVersion < 8.2) {
              return {
                level: 'warning',
                message: `Laravel 11 requires PHP 8.2 or higher. PHP ${config.phpVersion} will work with Laravel 10 or earlier.`,
                suggestion: 'Use PHP 8.2+ for Laravel 11, or PHP 8.1+ for Laravel 10.',
              };
            }
          }
          return null;
        },
      },
      {
        id: 'wordpress-php-version',
        name: 'WordPress PHP Version',
        check: (config) => {
          if (config.type === 'wordpress') {
            const phpVersion = parseFloat(config.phpVersion);
            if (phpVersion < 7.4) {
              return {
                level: 'warning',
                message: `WordPress recommends PHP 7.4 or higher. PHP ${config.phpVersion} may cause compatibility issues.`,
                suggestion: 'Upgrade to PHP 7.4+ for best WordPress compatibility.',
              };
            }
          }
          return null;
        },
      },
      {
        id: 'mariadb-mysql-syntax',
        name: 'MariaDB vs MySQL Syntax',
        check: (config) => {
          if (config.services?.mariadb && config.type === 'laravel') {
            return {
              level: 'info',
              message: 'MariaDB is MySQL-compatible but may have minor syntax differences in edge cases.',
              suggestion: 'Laravel works great with MariaDB. Just ensure your database driver is set correctly.',
            };
          }
          return null;
        },
      },
    ];
  }

  /**
   * Check configuration for compatibility issues
   * @param {Object} config - Project configuration
   * @param {string} config.phpVersion - PHP version (e.g., '8.3')
   * @param {string} config.type - Project type (e.g., 'laravel', 'wordpress')
   * @param {string} config.nodeVersion - Node.js version (e.g., '20')
   * @param {Object} config.services - Services configuration
   * @param {string} config.services.mysql - MySQL version or null
   * @param {string} config.services.mariadb - MariaDB version or null
   * @param {string} config.services.redis - Redis version or null
   * @returns {Object} - { valid: boolean, warnings: Array, errors: Array }
   */
  checkCompatibility(config) {
    const warnings = [];
    const errors = [];

    for (const rule of this.rules) {
      try {
        const result = rule.check(config);
        if (result) {
          const item = {
            id: rule.id,
            name: rule.name,
            level: result.level,
            message: result.message,
            suggestion: result.suggestion,
          };

          if (result.level === 'error') {
            errors.push(item);
          } else {
            warnings.push(item);
          }
        }
      } catch (error) {
        console.warn(`Error checking rule ${rule.id}:`, error.message);
      }
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors,
      hasIssues: warnings.length > 0 || errors.length > 0,
    };
  }

  /**
   * Get major version number from version string
   * @param {string} version - Version string (e.g., '8.3', '8.0.30')
   * @returns {number} - Major version number
   */
  getMajorVersion(version) {
    if (!version) return 0;
    const parts = version.toString().split('.');
    return parseInt(parts[0], 10) || 0;
  }

  /**
   * Compare two version strings
   * @param {string} v1 - First version
   * @param {string} v2 - Second version
   * @returns {number} - -1 if v1 < v2, 0 if equal, 1 if v1 > v2
   */
  compareVersions(v1, v2) {
    if (!v1 || !v2) return 0;
    
    const parts1 = v1.toString().split('.').map(p => parseInt(p, 10) || 0);
    const parts2 = v2.toString().split('.').map(p => parseInt(p, 10) || 0);
    
    const maxLen = Math.max(parts1.length, parts2.length);
    
    for (let i = 0; i < maxLen; i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      
      if (p1 < p2) return -1;
      if (p1 > p2) return 1;
    }
    
    return 0;
  }

  /**
   * Get all compatibility rules (for UI display)
   * @returns {Array} - List of rule definitions
   */
  getRules() {
    return this.rules.map(rule => ({
      id: rule.id,
      name: rule.name,
    }));
  }

  /**
   * Quick check if a specific combination has known issues
   * @param {string} phpVersion - PHP version
   * @param {string} dbType - Database type ('mysql' or 'mariadb')
   * @param {string} dbVersion - Database version
   * @returns {boolean} - True if there are known issues
   */
  hasKnownIssues(phpVersion, dbType, dbVersion) {
    const config = {
      phpVersion,
      services: {
        [dbType]: dbVersion,
      },
    };
    
    const result = this.checkCompatibility(config);
    return result.warnings.some(w => w.level === 'warning') || result.errors.length > 0;
  }
}

module.exports = CompatibilityManager;
