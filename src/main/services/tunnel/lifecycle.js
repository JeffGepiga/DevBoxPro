const treeKill = require('tree-kill');

module.exports = {
  async waitForProjectToBeRunning(projectId, timeoutMs = 4000) {
    const projectManager = this.managers?.project;
    if (!projectManager) {
      return false;
    }

    const isRunning = () => {
      const project = projectManager.getProject?.(projectId);
      return Boolean(project?.isRunning || projectManager.runningProjects?.has(projectId));
    };

    if (isRunning()) {
      return true;
    }

    const isTransitioning = () => Boolean(
      projectManager.startingProjects?.has(projectId)
      || projectManager.pendingProjectStops?.has(projectId)
    );

    if (!isTransitioning()) {
      return false;
    }

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (isRunning()) {
        return true;
      }

      if (!isTransitioning()) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return isRunning();
  },

  async startTunnel(projectId, requestedProvider = null) {
    const project = this.managers?.project?.getProject?.(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const isProjectRunning = Boolean(
      project.isRunning
      || this.managers?.project?.runningProjects?.has(projectId)
      || await this.waitForProjectToBeRunning(projectId)
    );

    if (!isProjectRunning) {
      throw new Error('Project must be running before it can be shared on the internet.');
    }

    const provider = requestedProvider || project.tunnelProvider;
    if (!provider) {
      throw new Error('Choose a tunnel provider first.');
    }

    if (!['cloudflared', 'zrok'].includes(provider)) {
      throw new Error(`Unsupported tunnel provider: ${provider}`);
    }

    if (provider === 'zrok') {
      const zrokStatus = await this.getZrokStatus();
      if (!zrokStatus.enabled) {
        throw new Error('zrok is not enabled. Configure it from Binary Manager → Tools.');
      }
    }

    const existing = this.activeTunnels.get(projectId);
    if (existing?.process && !existing.stopping && existing.provider === provider) {
      return this.serializeTunnelState(projectId, existing);
    }

    if (existing?.process) {
      await this.stopTunnel(projectId);
    }

    const binaryPath = await this.ensureProviderInstalled(provider);
    const tunnelTarget = this.buildTunnelTarget(project, provider);
    const targetUrl = typeof tunnelTarget === 'string'
      ? tunnelTarget
      : (tunnelTarget?.displayUrl || tunnelTarget?.targetUrl || null);
    const args = this.getTunnelStartArgs(provider, tunnelTarget);
    const processRef = this.spawnTunnelProcess(binaryPath, args, project);
    const state = {
      provider,
      process: processRef,
      pid: processRef.pid,
      publicUrl: null,
      status: 'starting',
      error: null,
      startedAt: new Date().toISOString(),
      targetUrl,
      stopping: false,
    };

    this.activeTunnels.set(projectId, state);
    this.emitTunnelStatus(this.serializeTunnelState(projectId, state));

    const logOutput = (chunk, source) => {
      const text = chunk.toString();
      this.managers?.log?.project?.(projectId, `[${provider}:${source}] ${text.trim()}`);

      const publicUrl = this.extractPublicUrl(provider, text);
      if (!publicUrl || state.publicUrl === publicUrl) {
        return;
      }

      state.publicUrl = publicUrl;
      state.status = 'running';
      state.error = null;
      this.emitTunnelStatus(this.serializeTunnelState(projectId, state));
    };

    processRef.stdout?.on('data', (chunk) => logOutput(chunk, 'stdout'));
    processRef.stderr?.on('data', (chunk) => logOutput(chunk, 'stderr'));

    processRef.on('error', (error) => {
      state.status = 'error';
      state.error = error.message;
      this.activeTunnels.delete(projectId);
      this.emitTunnelStatus(this.serializeTunnelState(projectId, state));
    });

    processRef.on('exit', (code, signal) => {
      const wasStopping = state.stopping;
      this.activeTunnels.delete(projectId);

      if (wasStopping) {
        return;
      }

      const hadUrl = Boolean(state.publicUrl);
      const payload = {
        projectId,
        provider: state.provider,
        publicUrl: state.publicUrl,
        status: hadUrl ? 'stopped' : 'error',
        error: hadUrl ? null : `Tunnel process exited${code != null ? ` with code ${code}` : signal ? ` (${signal})` : ''}`,
        startedAt: state.startedAt,
        targetUrl: state.targetUrl,
      };
      this.emitTunnelStatus(payload);
    });

    return this.serializeTunnelState(projectId, state);
  },

  async stopTunnel(projectId) {
    const state = this.activeTunnels.get(projectId);
    if (!state) {
      return { success: true, wasRunning: false };
    }

    state.stopping = true;
    this.activeTunnels.delete(projectId);

    const pid = state.process?.pid || state.pid;
    if (pid) {
      await new Promise((resolve) => {
        treeKill(pid, 'SIGTERM', () => resolve());
      });
    }

    this.emitTunnelStatus({
      projectId,
      provider: state.provider,
      publicUrl: state.publicUrl,
      status: 'stopped',
      error: null,
      startedAt: state.startedAt,
      targetUrl: state.targetUrl,
    });

    return { success: true, wasRunning: true };
  },

  async stopAllTunnels() {
    const projectIds = Array.from(this.activeTunnels.keys());

    for (const projectId of projectIds) {
      await this.stopTunnel(projectId);
    }

    return { success: true, stopped: projectIds.length };
  },
};