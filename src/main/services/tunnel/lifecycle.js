const dns = require('dns').promises;
const http = require('http');
const httpProxy = require('http-proxy');
const treeKill = require('tree-kill');
const { findAvailablePort } = require('../../utils/PortUtils');

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const REWRITEABLE_TUNNEL_CONTENT_TYPES = [
  'text/html',
  'text/css',
  'text/javascript',
  'application/javascript',
  'application/json',
  'application/ld+json',
  'application/xml',
  'image/svg+xml',
];

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

  rewriteTunnelProxyLocationHeader(location, tunnelTarget, publicUrl) {
    if (!location || !publicUrl) {
      return location;
    }

    const candidates = [
      tunnelTarget?.displayUrl,
      tunnelTarget?.hostHeader ? `http://${tunnelTarget.hostHeader}` : null,
      tunnelTarget?.hostHeader ? `https://${tunnelTarget.hostHeader}` : null,
    ].filter(Boolean);

    for (const candidate of candidates.sort((left, right) => right.length - left.length)) {
      if (location.startsWith(candidate)) {
        return `${publicUrl}${location.slice(candidate.length)}`;
      }
    }

    return location;
  },

  rewriteTunnelProxyCookies(setCookieHeader, tunnelTarget, publicUrl) {
    if (!setCookieHeader || !publicUrl || !tunnelTarget?.hostHeader) {
      return setCookieHeader;
    }

    const publicHostname = new URL(publicUrl).hostname;
    const domainPattern = new RegExp(`;\\s*Domain=\\.?${escapeRegex(tunnelTarget.hostHeader)}`, 'iu');
    const cookieHeaders = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];

    return cookieHeaders.map((cookie) => cookie.replace(domainPattern, `; Domain=${publicHostname}`));
  },

  shouldRewriteTunnelProxyBody(contentType) {
    const normalizedContentType = String(contentType || '').toLowerCase();
    return REWRITEABLE_TUNNEL_CONTENT_TYPES.some((candidate) => normalizedContentType.includes(candidate));
  },

  rewriteTunnelProxyBody(bodyBuffer, tunnelTarget, publicUrl) {
    if (!bodyBuffer || !publicUrl) {
      return bodyBuffer;
    }

    const replacements = [
      tunnelTarget?.displayUrl,
      tunnelTarget?.hostHeader ? `https://${tunnelTarget.hostHeader}` : null,
      tunnelTarget?.hostHeader ? `http://${tunnelTarget.hostHeader}` : null,
      tunnelTarget?.hostHeader ? `//${tunnelTarget.hostHeader}` : null,
    ].filter(Boolean);

    let bodyText = bodyBuffer.toString('utf8');
    for (const candidate of replacements.sort((left, right) => right.length - left.length)) {
      bodyText = bodyText.split(candidate).join(publicUrl);
    }

    return Buffer.from(bodyText, 'utf8');
  },

  async prepareTunnelTarget(provider, tunnelTarget, projectId) {
    if (provider !== 'cloudflared') {
      return tunnelTarget;
    }

    const effectiveTarget = typeof tunnelTarget === 'string'
      ? { targetUrl: tunnelTarget, displayUrl: tunnelTarget, hostHeader: null }
      : { ...tunnelTarget };

    const proxyPort = await findAvailablePort(62100, 200, '127.0.0.1');
    if (!proxyPort) {
      throw new Error('Could not allocate a local tunnel proxy port.');
    }

    const proxyContext = {
      tunnelTarget: effectiveTarget,
      publicUrl: null,
    };

    const proxy = httpProxy.createProxyServer({
      target: effectiveTarget.targetUrl,
      changeOrigin: false,
      ws: true,
      ignorePath: false,
      selfHandleResponse: true,
      xfwd: false,
      secure: false,
    });

    proxy.on('proxyReq', (proxyReq, req) => {
      const originalHost = req.headers.host || '';
      if (effectiveTarget.hostHeader) {
        proxyReq.setHeader('Host', effectiveTarget.hostHeader);
      }

      if (originalHost) {
        proxyReq.setHeader('X-Forwarded-Host', originalHost);
      }

      proxyReq.setHeader('Accept-Encoding', 'identity');
      proxyReq.setHeader('X-Forwarded-Proto', req.headers['x-forwarded-proto'] || 'https');
    });

    proxy.on('proxyRes', (proxyRes, req, res) => {
      const headers = { ...proxyRes.headers };

      if (headers.location) {
        headers.location = this.rewriteTunnelProxyLocationHeader(
          headers.location,
          effectiveTarget,
          proxyContext.publicUrl
        );
      }

      if (headers['set-cookie']) {
        headers['set-cookie'] = this.rewriteTunnelProxyCookies(
          headers['set-cookie'],
          effectiveTarget,
          proxyContext.publicUrl
        );
      }

      const shouldRewriteBody = proxyContext.publicUrl && this.shouldRewriteTunnelProxyBody(headers['content-type']);
      if (!shouldRewriteBody) {
        res.writeHead(proxyRes.statusCode || 200, headers);
        proxyRes.pipe(res);
        return;
      }

      const chunks = [];
      proxyRes.on('data', (chunk) => {
        chunks.push(Buffer.from(chunk));
      });

      proxyRes.on('end', () => {
        const rewrittenBody = this.rewriteTunnelProxyBody(Buffer.concat(chunks), effectiveTarget, proxyContext.publicUrl);
        delete headers['content-length'];
        delete headers['content-encoding'];
        delete headers['transfer-encoding'];
        headers['content-length'] = Buffer.byteLength(rewrittenBody);
        res.writeHead(proxyRes.statusCode || 200, headers);
        res.end(rewrittenBody);
      });
    });

    proxy.on('error', (error, req, res) => {
      this.managers?.log?.project?.(projectId, `[cloudflared:proxy] ${error.message}`);
      if (res && !res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
      }
      if (res && !res.writableEnded) {
        res.end('DevBox Pro tunnel proxy error');
      }
    });

    const server = http.createServer((req, res) => {
      proxy.web(req, res);
    });

    server.on('upgrade', (req, socket, head) => {
      proxy.ws(req, socket, head);
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(proxyPort, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });

    return {
      ...effectiveTarget,
      proxyContext,
      localProxy: proxy,
      localProxyServer: server,
      targetUrl: `http://127.0.0.1:${proxyPort}`,
    };
  },

  async ensurePublicUrlReady(provider, publicUrl, isActive = () => true, timeoutMs = 20000) {
    if (provider !== 'cloudflared' || !publicUrl) {
      return true;
    }

    const hostname = new URL(publicUrl).hostname;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (!isActive()) {
        return false;
      }

      try {
        await dns.lookup(hostname);
        return true;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    return false;
  },

  async cleanupPreparedTunnel(state) {
    if (!state?.localProxyServer) {
      return;
    }

    await new Promise((resolve) => {
      state.localProxyServer.close(() => resolve());
    });

    state.localProxy?.close?.();
    state.localProxyServer = null;
    state.localProxy = null;
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
    let preparedTunnelTarget = null;

    try {
      preparedTunnelTarget = await this.prepareTunnelTarget(provider, tunnelTarget, projectId);
    } catch (error) {
      if (preparedTunnelTarget) {
        await this.cleanupPreparedTunnel(preparedTunnelTarget);
      }
      throw error;
    }

    const targetUrl = typeof preparedTunnelTarget === 'string'
      ? preparedTunnelTarget
      : (preparedTunnelTarget?.displayUrl || preparedTunnelTarget?.targetUrl || null);
    const args = this.getTunnelStartArgs(provider, preparedTunnelTarget);

    let processRef;
    try {
      processRef = this.spawnTunnelProcess(binaryPath, args, project);
    } catch (error) {
      await this.cleanupPreparedTunnel(preparedTunnelTarget);
      throw error;
    }

    const state = {
      provider,
      process: processRef,
      pid: processRef.pid,
      publicUrl: null,
      status: 'starting',
      error: null,
      startedAt: new Date().toISOString(),
      targetUrl,
      tunnelTarget: preparedTunnelTarget,
      localProxy: preparedTunnelTarget?.localProxy || null,
      localProxyServer: preparedTunnelTarget?.localProxyServer || null,
      proxyContext: preparedTunnelTarget?.proxyContext || null,
      stopping: false,
    };

    this.activeTunnels.set(projectId, state);
    this.emitTunnelStatus(this.serializeTunnelState(projectId, state));

    const logOutput = (chunk, source) => {
      const text = chunk.toString();
      this.managers?.log?.project?.(projectId, `[${provider}:${source}] ${text.trim()}`);

      const publicUrl = this.extractPublicUrl(provider, text);
      if (!publicUrl || state.publicUrl === publicUrl || state.pendingPublicUrl === publicUrl) {
        return;
      }

      state.pendingPublicUrl = publicUrl;

      if (provider !== 'cloudflared') {
        state.publicUrl = publicUrl;
        state.pendingPublicUrl = null;
        if (state.proxyContext) {
          state.proxyContext.publicUrl = publicUrl;
        }
        state.status = 'running';
        state.error = null;
        this.emitTunnelStatus(this.serializeTunnelState(projectId, state));
        return;
      }

      if (state.publicUrlProbe) {
        return;
      }

      state.publicUrlProbe = this.ensurePublicUrlReady(
        provider,
        publicUrl,
        () => this.activeTunnels.get(projectId) === state && !state.stopping
      )
        .then((ready) => {
          if (this.activeTunnels.get(projectId) !== state || state.stopping) {
            return;
          }

          if (!ready) {
            state.error = 'Tunnel URL was created but DNS is not ready yet. Try again in a few seconds.';
            state.pendingPublicUrl = null;
            this.emitTunnelStatus(this.serializeTunnelState(projectId, state));
            return;
          }

          state.publicUrl = publicUrl;
          state.pendingPublicUrl = null;
          if (state.proxyContext) {
            state.proxyContext.publicUrl = publicUrl;
          }
          state.status = 'running';
          state.error = null;
          this.emitTunnelStatus(this.serializeTunnelState(projectId, state));
        })
        .catch((error) => {
          if (this.activeTunnels.get(projectId) !== state || state.stopping) {
            return;
          }

          state.error = error.message;
          state.pendingPublicUrl = null;
          this.emitTunnelStatus(this.serializeTunnelState(projectId, state));
        })
        .finally(() => {
          state.publicUrlProbe = null;
        });
    };

    processRef.stdout?.on('data', (chunk) => logOutput(chunk, 'stdout'));
    processRef.stderr?.on('data', (chunk) => logOutput(chunk, 'stderr'));

    processRef.on('error', (error) => {
      state.status = 'error';
      state.error = error.message;
      this.activeTunnels.delete(projectId);
      this.cleanupPreparedTunnel(state).catch(() => {});
      this.emitTunnelStatus(this.serializeTunnelState(projectId, state));
    });

    processRef.on('exit', (code, signal) => {
      const wasStopping = state.stopping;
      this.activeTunnels.delete(projectId);
      this.cleanupPreparedTunnel(state).catch(() => {});

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

    await this.cleanupPreparedTunnel(state);

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