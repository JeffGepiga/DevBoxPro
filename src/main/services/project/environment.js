const path = require('path');
const fs = require('fs-extra');

module.exports = {
  async initialize() {
    if (!this.configStore.get('projects')) {
      this.configStore.set('projects', []);
    }

    await this.compatibilityManager.initialize();
    await this.cleanupOrphanedConfigs();
  },

  async cleanupOrphanedConfigs() {
    const dataPath = this.getDataPath();
    const projects = this.configStore.get('projects', []);
    const validIds = new Set(projects.map((project) => project.id));

    const dirs = [
      path.join(dataPath, 'apache', 'vhosts'),
      path.join(dataPath, 'nginx', 'sites'),
    ];

    const nginxDataDir = path.join(dataPath, 'nginx');
    try {
      if (await fs.pathExists(nginxDataDir)) {
        const entries = await fs.readdir(nginxDataDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const sitesDir = path.join(nginxDataDir, entry.name, 'sites');
            if (await fs.pathExists(sitesDir)) {
              dirs.push(sitesDir);
            }
          }
        }
      }
    } catch (error) {
      // Ignore errors reading nginx data directory
    }

    for (const dir of dirs) {
      if (!await fs.pathExists(dir)) {
        continue;
      }

      const files = await fs.readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.conf')) {
          continue;
        }

        const projectId = file.replace('.conf', '');
        if (!validIds.has(projectId)) {
          await fs.remove(path.join(dir, file));
        }
      }
    }
  },

  async ensureCliInstalled() {
    const cli = this.managers.cli;
    if (!cli) {
      this.managers.log?.systemWarn('CLI manager not available');
      return;
    }

    try {
      const status = await cli.checkCliInstalled();

      if (!status.installed) {
        await cli.installCli();
      }

      if (!status.inPath && process.platform === 'win32' && process.env.PLAYWRIGHT_TEST !== 'true') {
        try {
          await cli.addToPath();
        } catch (error) {
          // Silently ignore PATH errors
        }
      }

      await this.syncCliProjectsFile();
    } catch (error) {
      this.managers.log?.systemWarn('Could not ensure CLI installed', { error: error.message });
    }
  },

  async syncCliProjectsFile() {
    const cli = this.managers.cli;
    if (!cli) {
      this.managers.log?.systemWarn('CLI Manager not initialized, skipping CLI sync');
      return;
    }

    try {
      const syncedPath = await cli.syncProjectsFile();
      this.managers.log?.systemInfo(`CLI projects file synced: ${syncedPath}`);

      if (cli.getDirectShimsEnabled()) {
        const status = await cli.checkCliInstalled();
        if (!status.installed || !status.inPath) {
          await cli.installCli();
          await cli.installDirectShims();
          if (process.env.PLAYWRIGHT_TEST !== 'true') {
            await cli.addToPath();
          }
          this.managers.log?.systemInfo('Terminal commands auto-initialized');
        }
      }
    } catch (error) {
      this.managers.log?.systemError('Failed to sync CLI projects file', { error: error.message, stack: error.stack });
    }
  },

  async syncEnvFile(project) {
    if (!project.path || !project.environment) {
      return;
    }

    const envPath = path.join(project.path, '.env');

    if (!await fs.pathExists(envPath)) {
      return;
    }

    let envContent = await fs.readFile(envPath, 'utf-8');

    for (const [key, value] of Object.entries(project.environment)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      const newLine = `${key}=${value}`;

      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, newLine);
      } else {
        envContent = envContent.trim() + '\n' + newLine + '\n';
      }
    }

    await fs.writeFile(envPath, envContent);
  },

  async readEnvFile(projectId) {
    const project = this.getProject(projectId);
    if (!project || !project.path) {
      throw new Error('Project not found');
    }

    const envPath = path.join(project.path, '.env');

    if (!await fs.pathExists(envPath)) {
      return {};
    }

    const envContent = await fs.readFile(envPath, 'utf-8');
    const environment = {};
    const lines = envContent.split('\n');
    let currentKey = null;
    let currentValue = '';
    let inMultilineQuote = null;

    for (const line of lines) {
      if (inMultilineQuote) {
        currentValue += '\n' + line;
        const trimmedLine = line.trimEnd();
        if (trimmedLine.endsWith(inMultilineQuote) && !trimmedLine.endsWith('\\' + inMultilineQuote)) {
          currentValue = currentValue.slice(0, -1);
          environment[currentKey] = currentValue;
          currentKey = null;
          currentValue = '';
          inMultilineQuote = null;
        }
        continue;
      }

      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const equalsIndex = trimmed.indexOf('=');
      if (equalsIndex > 0) {
        const key = trimmed.substring(0, equalsIndex).trim();
        const value = trimmed.substring(equalsIndex + 1).trim();
        const startsWithDoubleQuote = value.startsWith('"');
        const startsWithSingleQuote = value.startsWith("'");

        if (startsWithDoubleQuote || startsWithSingleQuote) {
          const quote = startsWithDoubleQuote ? '"' : "'";
          const valueWithoutStartQuote = value.slice(1);

          if (valueWithoutStartQuote.endsWith(quote) && !valueWithoutStartQuote.endsWith('\\' + quote)) {
            environment[key] = valueWithoutStartQuote.slice(0, -1);
          } else {
            currentKey = key;
            currentValue = valueWithoutStartQuote;
            inMultilineQuote = quote;
          }
        } else {
          environment[key] = value;
        }
      }
    }

    if (currentKey && inMultilineQuote) {
      environment[currentKey] = currentValue;
    }

    return environment;
  },

  getDefaultEnvironment(projectType, projectName, port) {
    const baseEnv = {
      APP_ENV: 'local',
      APP_DEBUG: 'true',
    };

    switch (projectType) {
      case 'laravel': {
        const dbInfo = this.managers?.database?.getDatabaseInfo() || {};
        const dbUser = dbInfo.user || 'root';
        const dbPassword = dbInfo.password || '';
        const dbPort = dbInfo.port || 3306;

        return {
          ...baseEnv,
          APP_NAME: projectName,
          APP_KEY: '',
          APP_URL: `http://localhost:${port}`,
          DB_CONNECTION: 'mysql',
          DB_HOST: '127.0.0.1',
          DB_PORT: String(dbPort),
          DB_DATABASE: this.sanitizeDatabaseName(projectName),
          DB_USERNAME: dbUser,
          DB_PASSWORD: dbPassword,
          CACHE_DRIVER: 'redis',
          QUEUE_CONNECTION: 'redis',
          SESSION_DRIVER: 'redis',
          REDIS_HOST: '127.0.0.1',
          REDIS_PORT: '6379',
          MAIL_MAILER: 'smtp',
          MAIL_HOST: '127.0.0.1',
          MAIL_PORT: '1025',
        };
      }

      case 'symfony': {
        const dbInfo = this.managers?.database?.getDatabaseInfo() || {};
        const dbUser = dbInfo.user || 'root';
        const dbPassword = dbInfo.password || '';
        const dbPort = dbInfo.port || 3306;
        const dbName = this.sanitizeDatabaseName(projectName);

        return {
          ...baseEnv,
          DATABASE_URL: `mysql://${dbUser}:${dbPassword}@127.0.0.1:${dbPort}/${dbName}`,
          MAILER_DSN: 'smtp://127.0.0.1:1025',
        };
      }

      case 'wordpress':
        return {
          ...baseEnv,
          WP_DEBUG: 'true',
        };

      default:
        return baseEnv;
    }
  },
};
