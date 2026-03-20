const path = require('path');
const fs = require('fs-extra');

module.exports = {
  getAllProjects() {
    return this.configStore.get('projects', []).map((project) => ({
      ...project,
      isRunning: this.runningProjects.has(project.id),
    }));
  },

  getProject(id) {
    const projects = this.configStore.get('projects', []);
    const project = projects.find((entry) => entry.id === id);
    if (project) {
      project.isRunning = this.runningProjects.has(id);
    }
    return project;
  },

  findProjectByPath(projects, projectPath) {
    if (!projectPath) {
      return null;
    }

    const normalizedPath = path.normalize(projectPath).toLowerCase();
    return projects.find((project) => project.path && path.normalize(project.path).toLowerCase() === normalizedPath) || null;
  },

  findProjectByName(projects, projectName) {
    if (!projectName) {
      return null;
    }

    return projects.find((project) => project.name?.toLowerCase() === projectName.toLowerCase()) || null;
  },

  async exportProjectConfig(id, mainWindow = null) {
    const project = this.getProject(id);
    if (!project) throw new Error('Project not found');

    try {
      let phpExtensions = [];
      if (this.managers.php) {
        try {
          const exts = await this.managers.php.getExtensions(project.phpVersion);
          if (exts) {
            phpExtensions = Object.keys(exts).filter((ext) => exts[ext] === true);
          }
        } catch (error) {
          // Ignore if PHP version is not installed or extensions fail to load
        }
      }

      const { app } = require('electron');
      const exportData = {
        name: project.name,
        type: project.type,
        phpVersion: project.phpVersion,
        nodeVersion: project.nodeVersion,
        webServer: project.webServer,
        webServerVersion: project.webServerVersion,
        services: project.services || {},
        supervisor: project.supervisor || { processes: [] },
        phpExtensions,
        exportedAt: new Date().toISOString(),
        devboxVersion: app.getVersion(),
      };

      const devboxJsonPath = path.join(project.path, 'devbox.json');
      await fs.writeJson(devboxJsonPath, exportData, { spaces: 2 });

      this.managers.log?.project(id, 'Successfully exported project configuration to devbox.json');
      if (mainWindow) {
        const { dialog } = require('electron');
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Export Successful',
          message: `Project configuration exported successfully to:\n${devboxJsonPath}`,
          buttons: ['OK'],
        });
      }
      return { success: true, path: devboxJsonPath };
    } catch (error) {
      this.managers.log?.project(id, `Failed to export configuration: ${error.message}`, 'error');
      throw new Error(`Failed to export configuration: ${error.message}`);
    }
  },

  async detectProjectType(projectPath) {
    try {
      const composerPath = path.join(projectPath, 'composer.json');
      if (await fs.pathExists(composerPath)) {
        const composer = await fs.readJson(composerPath);
        if (composer.require?.['laravel/framework']) {
          return 'laravel';
        }
        if (composer.require?.['symfony/framework-bundle']) {
          return 'symfony';
        }
      }

      if (await fs.pathExists(path.join(projectPath, 'wp-config.php'))) {
        return 'wordpress';
      }
      if (await fs.pathExists(path.join(projectPath, 'wp-config-sample.php'))) {
        return 'wordpress';
      }

      return 'custom';
    } catch (error) {
      return 'custom';
    }
  },

  async detectProjectTypeFromPath(folderPath) {
    let type = await this.detectProjectType(folderPath);
    let name = path.basename(folderPath);
    let configOverrides = {};

    const devboxJsonPath = path.join(folderPath, 'devbox.json');
    if (await fs.pathExists(devboxJsonPath)) {
      try {
        const parsedNode = await fs.readJson(devboxJsonPath);
        if (parsedNode) {
          configOverrides = parsedNode;
          if (configOverrides.type) type = configOverrides.type;
          if (configOverrides.name) name = configOverrides.name;
        }
      } catch (error) {
        this.managers.log?.systemWarn('Could not parse devbox.json during project detection', { error: error.message });
      }
    }

    return {
      name,
      path: folderPath,
      type,
      ...configOverrides,
      isConfigImport: Object.keys(configOverrides).length > 0,
    };
  },

  sanitizeDatabaseName(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 64);
  },
};
