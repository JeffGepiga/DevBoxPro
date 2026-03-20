const path = require('path');
const fs = require('fs-extra');
const CompatibilityManager = require('./CompatibilityManager');
const projectCatalog = require('./project/catalog');
const projectDiscovery = require('./project/discovery');
const projectEnvironment = require('./project/environment');
const projectHelpers = require('./project/helpers');
const projectHosts = require('./project/hosts');
const projectInstallation = require('./project/installation');
const projectLifecycle = require('./project/lifecycle');
const projectServiceDeps = require('./project/serviceDeps');
const projectVhostApache = require('./project/vhostApache');
const projectVhostNginx = require('./project/vhostNginx');
const projectVhostOrchestration = require('./project/vhostOrchestration');

class ProjectManager {
  constructor(configStore, managers) {
    this.configStore = configStore;
    this.managers = managers;
    this.runningProjects = new Map();
    this.projectServers = new Map();
    this.compatibilityManager = new CompatibilityManager();
    this.pendingServiceStops = new Map();
    this.networkPort80Owner = null;
  }

  async updateProject(id, updates) {
    const projects = this.configStore.get('projects', []);
    const index = projects.findIndex((project) => project.id === id);

    if (index === -1) {
      throw new Error('Project not found');
    }

    const isRunning = this.runningProjects.has(id);
    const oldProject = { ...projects[index] };
    const oldDomains = this.getProjectDomains(oldProject);

    if (isRunning) {
      await this.stopProject(id);
    }

    if (updates.domains?.length) {
      updates.domain = updates.domains[0];
    }

    projects[index] = {
      ...projects[index],
      ...updates,
      id,
      updatedAt: new Date().toISOString(),
    };

    this.configStore.set('projects', projects);
    const updatedProject = projects[index];
    const newDomains = this.getProjectDomains(updatedProject);
    const previousWebServer = this.getEffectiveWebServer(oldProject);
    const nextWebServer = this.getEffectiveWebServer(updatedProject);
    const previousWebServerVersion = this.getEffectiveWebServerVersion(oldProject, previousWebServer);
    const nextWebServerVersion = this.getEffectiveWebServerVersion(updatedProject, nextWebServer);
    const domainsChanged = JSON.stringify(oldDomains) !== JSON.stringify(newDomains);
    const webServerTargetChanged = previousWebServer !== nextWebServer || previousWebServerVersion !== nextWebServerVersion;
    const vhostConfigChanged = this.hasVhostConfigChanges(oldProject, updatedProject);

    await this.syncCliProjectsFile();

    if (updates.environment && updatedProject.type === 'laravel') {
      try {
        await this.syncEnvFile(updatedProject);
      } catch (error) {
        this.managers.log?.systemWarn('Could not sync .env file', { project: updatedProject.name, error: error.message });
      }
    }

    if (domainsChanged) {
      for (const domain of oldDomains) {
        try {
          await this.removeFromHostsFile(domain);
        } catch {
          // Ignore best-effort cleanup failures for old domains.
        }
      }

      try {
        await this.updateHostsFile(updatedProject);
      } catch (error) {
        this.managers.log?.systemWarn('Could not update hosts file after domain change', { error: error.message });
      }

      if (updatedProject.ssl) {
        try {
          await this.managers.ssl?.createCertificate(updatedProject.domains || [updatedProject.domain]);
        } catch (error) {
          this.managers.log?.systemWarn('Could not regenerate SSL certificate after domain change', { error: error.message });
        }
      }
    }

    if (webServerTargetChanged) {
      try {
        await this.removeVirtualHost({
          ...oldProject,
          webServer: previousWebServer,
          webServerVersion: previousWebServerVersion,
        }, { reloadIfRunning: true });
      } catch (error) {
        this.managers.log?.systemWarn('Could not remove old virtual host after web server change', { error: error.message });
      }
    }

    if (vhostConfigChanged) {
      try {
        await this.createVirtualHost(updatedProject, null, nextWebServerVersion);
      } catch (error) {
        const reason = webServerTargetChanged
          ? 'web server change'
          : domainsChanged
            ? 'domain change'
            : 'project settings change';
        this.managers.log?.systemWarn(`Could not regenerate virtual host after ${reason}`, { error: error.message });
      }
    }

    if (isRunning) {
      await this.startProject(id);
    }

    return projects[index];
  }

  async reorderProjects(projectIds) {
    const projects = this.configStore.get('projects', []);
    const projectMap = new Map();

    for (const project of projects) {
      projectMap.set(project.id, project);
    }

    const reorderedProjects = [];
    for (const id of projectIds) {
      if (projectMap.has(id)) {
        reorderedProjects.push(projectMap.get(id));
        projectMap.delete(id);
      }
    }

    for (const [, project] of projectMap.entries()) {
      reorderedProjects.push(project);
    }

    this.configStore.set('projects', reorderedProjects);
    await this.syncCliProjectsFile();

    return { success: true };
  }

  async deleteProject(id, deleteFiles = false) {
    const project = this.getProject(id);
    if (!project) {
      throw new Error('Project not found');
    }

    if (this.runningProjects.has(id)) {
      await this.stopProject(id);
    }

    try {
      await this.removeVirtualHost(project);
    } catch (error) {
      this.managers.log?.systemWarn('Error removing virtual host', { project: project.name, error: error.message });
    }

    try {
      await this.removeFromHostsFile(project.domain);
    } catch (error) {
      this.managers.log?.systemWarn('Error removing from hosts file', { project: project.name, error: error.message });
    }

    if (deleteFiles && project.path) {
      try {
        await fs.remove(project.path);
      } catch (error) {
        this.managers.log?.systemError('Error deleting project files', { project: project.name, path: project.path, error: error.message });
        throw new Error(`Failed to delete project files: ${error.message}`);
      }
    }

    const projects = this.configStore.get('projects', []);
    const filteredProjects = projects.filter((currentProject) => currentProject.id !== id);
    this.configStore.set('projects', filteredProjects);

    await this.syncCliProjectsFile();

    return { success: true, filesDeleted: deleteFiles };
  }

  async moveProject(id, newPath) {
    const project = this.getProject(id);
    if (!project) {
      throw new Error('Project not found');
    }

    const oldPath = project.path;
    if (!oldPath || !newPath) {
      throw new Error('Invalid path');
    }

    if (!await fs.pathExists(oldPath)) {
      throw new Error(`Source path does not exist: ${oldPath}`);
    }

    if (await fs.pathExists(newPath)) {
      throw new Error(`Destination path already exists: ${newPath}`);
    }

    const wasRunning = this.runningProjects.has(id);
    if (wasRunning) {
      this.managers.log?.project(id, `Stopping project before move: ${project.name}`);
      await this.stopProject(id);
    }

    try {
      await this.removeVirtualHost(project);
    } catch (error) {
      this.managers.log?.systemWarn('Error removing old virtual host', { project: project.name, error: error.message });
    }

    try {
      this.managers.log?.project(id, `Moving project from ${oldPath} to ${newPath}`);
      await fs.ensureDir(path.dirname(newPath));
      await fs.move(oldPath, newPath, { overwrite: false });
    } catch (error) {
      this.managers.log?.systemError('Error moving project files', {
        project: project.name,
        from: oldPath,
        to: newPath,
        error: error.message,
      });
      throw new Error(`Failed to move project files: ${error.message}`);
    }

    const projects = this.configStore.get('projects', []);
    const index = projects.findIndex((currentProject) => currentProject.id === id);

    if (index !== -1) {
      projects[index] = {
        ...projects[index],
        path: newPath,
        updatedAt: new Date().toISOString(),
      };
      this.configStore.set('projects', projects);
    }

    try {
      const updatedProject = this.getProject(id);
      await this.createVirtualHost(updatedProject);
    } catch (error) {
      this.managers.log?.systemWarn('Error creating new virtual host', { project: project.name, error: error.message });
    }

    await this.syncCliProjectsFile();
    this.managers.log?.project(id, `Project moved successfully to ${newPath}`);

    if (wasRunning) {
      this.managers.log?.project(id, `Restarting project after move: ${project.name}`);
      await this.startProject(id);
    }

    return { success: true, newPath };
  }

  checkCompatibility(config) {
    return this.compatibilityManager.checkCompatibility(config);
  }

  async checkCompatibilityUpdates() {
    return this.compatibilityManager.checkForUpdates();
  }

  async applyCompatibilityUpdates() {
    return this.compatibilityManager.applyUpdates();
  }

  getCompatibilityConfigInfo() {
    return this.compatibilityManager.getConfigInfo();
  }
}

Object.assign(
  ProjectManager.prototype,
  projectCatalog,
  projectDiscovery,
  projectEnvironment,
  projectHelpers,
  projectHosts,
  projectInstallation,
  projectLifecycle,
  projectServiceDeps,
  projectVhostOrchestration,
  projectVhostNginx,
  projectVhostApache,
);

module.exports = { ProjectManager };
