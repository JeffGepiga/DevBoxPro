const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');

module.exports = {
  getProjectsFilePath() {
    return path.join(this.getCliPath(), 'projects.json');
  },

  getProjectMysqlInfo(project) {
    if (project?.services?.mariadb) {
      return {
        dbType: 'mariadb',
        version: project.services.mariadbVersion || '11.4',
      };
    }

    if (project?.services?.mysql) {
      return {
        dbType: 'mysql',
        version: project.services.mysqlVersion || '8.4',
      };
    }

    return this.getActiveMysqlInfo();
  },

  async syncProjectsFile() {
    const cliPath = this.getCliPath();
    await fs.ensureDir(cliPath);

    const projects = this.configStore.get('projects', []);
    const projectMappings = {};
    const defaultNodeVersion = this.getFirstInstalledNodeVersion();

    for (const project of projects) {
      const normalizedPath = path.normalize(project.path);
      const dbInfo = this.getProjectMysqlInfo(project);
      projectMappings[normalizedPath] = {
        id: project.id,
        name: project.name,
        phpVersion: project.phpVersion || '8.3',
        nodejsVersion: project.services?.nodejs ? (project.services.nodejsVersion || defaultNodeVersion) : null,
        mysqlType: dbInfo.dbType,
        mysqlVersion: dbInfo.version,
        services: project.services?.python
          ? {
            pythonVersion: project.services.pythonVersion || '3.13',
          }
          : null,
      };
    }

    const projectsFilePath = this.getProjectsFilePath();
    await fs.writeJson(projectsFilePath, projectMappings, { spaces: 2 });
    return projectsFilePath;
  },

  getProjectForPath(projectPath) {
    const projects = this.configStore.get('projects', []);
    const normalizedPath = path.normalize(projectPath).toLowerCase();

    for (const project of projects) {
      const projectDir = path.normalize(project.path).toLowerCase();
      if (normalizedPath.startsWith(projectDir)) {
        return project;
      }
    }

    return null;
  },

  async executeCommand(workingDir, command, args = []) {
    const project = this.getProjectForPath(workingDir);

    if (!project) {
      throw new Error(`No DevBox Pro project found for path: ${workingDir}`);
    }

    const env = this.buildProjectEnv(project);
    let executable = command;
    let finalArgs = [...args];

    switch (command.toLowerCase()) {
      case 'php': {
        const phpPath = this.getPhpPath(project.phpVersion);
        if (phpPath) {
          executable = phpPath;
        }
        break;
      }

      case 'composer': {
        const composerPath = this.getComposerPath();
        const phpForComposer = this.getPhpPath(project.phpVersion);
        if (composerPath && phpForComposer) {
          executable = phpForComposer;
          finalArgs = [composerPath, ...args];
        }
        break;
      }

      case 'node':
      case 'npm':
      case 'npx': {
        if (project.services?.nodejs) {
          const nodeVersion = project.services.nodejsVersion || this.getFirstInstalledNodeVersion();
          const nodePath = this.getNodePath(nodeVersion);
          if (nodePath) {
            const nodeDir = path.dirname(nodePath);
            if (command.toLowerCase() === 'node') {
              executable = nodePath;
            } else {
              const cmdExe = process.platform === 'win32' ? `${command}.cmd` : command;
              executable = path.join(nodeDir, cmdExe);
            }
          }
        }
        break;
      }

      case 'pip':
      case 'pip3': {
        if (project.services?.python) {
          const pyVersion = project.services.pythonVersion || '3.13';
          const pythonPath = this.getPythonPath(pyVersion);
          if (pythonPath) {
            const scriptsDir = path.join(path.dirname(pythonPath), 'Scripts');
            const pipExe = process.platform === 'win32' ? 'pip.exe' : 'pip3';
            const pipFullPath = path.join(scriptsDir, pipExe);
            if (fs.existsSync(pipFullPath)) {
              executable = pipFullPath;
            } else {
              executable = pythonPath;
              finalArgs = ['-m', 'pip', ...args];
            }
          }
        }
        break;
      }

      case 'python': {
        if (project.services?.python) {
          const pyVersion = project.services.pythonVersion || '3.13';
          const pythonPath = this.getPythonPath(pyVersion);
          if (pythonPath) {
            executable = pythonPath;
          }
        }
        break;
      }

      case 'mysql':
      case 'mysqldump': {
        const dbInfo = this.getProjectMysqlInfo(project);
        const binPath = command.toLowerCase() === 'mysql'
          ? this.getMysqlClientPath(dbInfo.dbType, dbInfo.version)
          : this.getMysqldumpPath(dbInfo.dbType, dbInfo.version);
        if (binPath) {
          executable = binPath;
        }
        break;
      }
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(executable, finalArgs, {
        cwd: workingDir,
        env,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });

      proc.on('close', (code) => {
        resolve({ exitCode: code });
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });
  },
};