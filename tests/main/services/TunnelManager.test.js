import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

require('../../helpers/mockElectronCjs');
const { TunnelManager } = require('../../../src/main/services/TunnelManager');

function createProcessStub() {
  const processRef = new EventEmitter();
  processRef.stdout = new EventEmitter();
  processRef.stderr = new EventEmitter();
  processRef.pid = 4242;
  return processRef;
}

function makeManager(overrides = {}) {
  const configStore = {
    get: vi.fn((key, defaultValue) => defaultValue),
    set: vi.fn(),
  };

  const managers = {
    project: {
      getProject: vi.fn(() => ({
        id: 'proj-1',
        name: 'My App',
        domain: 'myapp.test',
        isRunning: true,
        tunnelProvider: 'cloudflared',
      })),
      getProjectLocalAccessPorts: vi.fn(() => ({ httpPort: 80, sslPort: 443 })),
      getProjectPrimaryDomain: vi.fn(() => 'myapp.test'),
      startingProjects: new Set(),
      pendingProjectStops: new Map(),
      runningProjects: new Map([['proj-1', true]]),
    },
    log: {
      project: vi.fn(),
    },
  };

  const manager = new TunnelManager('/resources', configStore, managers);
  const processRef = createProcessStub();

  Object.assign(manager, {
    ensureProviderInstalled: vi.fn().mockResolvedValue('/resources/cloudflared.exe'),
    buildTunnelTarget: vi.fn(() => 'https://myapp.test'),
    getTunnelStartArgs: vi.fn(() => ['tunnel', '--url', 'https://myapp.test']),
    spawnTunnelProcess: vi.fn(() => processRef),
    extractPublicUrl: vi.fn((provider, output) => {
      const match = output.match(/https:\/\/[^\s]+/);
      return match ? match[0] : null;
    }),
    getZrokStatus: vi.fn().mockResolvedValue({ enabled: false, configuredAt: null }),
    ...overrides,
  });

  return { manager, processRef, configStore, managers };
}

describe('TunnelManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('emits a running status after the tunnel process prints a public URL', async () => {
    const { manager, processRef } = makeManager();
    const statusEmitter = vi.fn();
    manager.setStatusEmitter(statusEmitter);

    const initial = await manager.startTunnel('proj-1', 'cloudflared');

    expect(initial).toEqual(expect.objectContaining({
      projectId: 'proj-1',
      provider: 'cloudflared',
      status: 'starting',
      publicUrl: null,
    }));

    processRef.stdout.emit('data', Buffer.from('INF tunnel ready at https://myapp.trycloudflare.com'));

    expect(statusEmitter).toHaveBeenLastCalledWith(expect.objectContaining({
      projectId: 'proj-1',
      provider: 'cloudflared',
      status: 'running',
      publicUrl: 'https://myapp.trycloudflare.com',
    }));
  });

  it('rejects zrok tunnels until zrok has been enabled app-wide', async () => {
    const { manager } = makeManager({
      getZrokStatus: vi.fn().mockResolvedValue({ enabled: false, configuredAt: null }),
    });

    await expect(manager.startTunnel('proj-1', 'zrok')).rejects.toThrow(/zrok is not enabled/i);
  });

  it('routes cloudflared to localhost with the project domain as host header', () => {
    const { manager, managers } = makeManager();
    const project = managers.project.getProject();

    const tunnelTarget = TunnelManager.prototype.buildTunnelTarget.call(manager, project, 'cloudflared');
    const args = TunnelManager.prototype.getTunnelStartArgs.call(manager, 'cloudflared', tunnelTarget);

    expect(tunnelTarget).toEqual({
      targetUrl: 'http://127.0.0.1:80',
      displayUrl: 'http://myapp.test',
      hostHeader: 'myapp.test',
    });
    expect(args).toEqual([
      'tunnel',
      '--url',
      'http://127.0.0.1:80',
      '--no-autoupdate',
      '--http-host-header',
      'myapp.test',
    ]);
  });

  it('keeps zrok targeting the project domain URL', () => {
    const { manager, managers } = makeManager();
    const project = managers.project.getProject();

    const tunnelTarget = TunnelManager.prototype.buildTunnelTarget.call(manager, project, 'zrok');
    const args = TunnelManager.prototype.getTunnelStartArgs.call(manager, 'zrok', tunnelTarget);

    expect(tunnelTarget).toEqual({
      targetUrl: 'http://myapp.test',
      displayUrl: 'http://myapp.test',
      hostHeader: 'myapp.test',
    });
    expect(args).toEqual(['share', 'public', 'http://myapp.test', '--headless']);
  });

  it('normalizes bare zrok hostnames into public https URLs', () => {
    const { manager } = makeManager();

    const publicUrl = TunnelManager.prototype.extractPublicUrl.call(
      manager,
      'zrok',
      '[  11.355]    INFO main.(*sharePublicCommand).shareLocal access your zrok share at the following endpoints:\n kqxfkboe3dpn.shares.zrok.io\n'
    );

    expect(publicUrl).toBe('https://kqxfkboe3dpn.shares.zrok.io');
  });

  it('waits for a project that is still transitioning to running before starting a tunnel', async () => {
    vi.useFakeTimers();

    const { manager, managers } = makeManager();
    managers.project.runningProjects.clear();
    managers.project.startingProjects.add('proj-1');
    managers.project.getProject = vi.fn(() => ({
      id: 'proj-1',
      name: 'My App',
      domain: 'myapp.test',
      isRunning: managers.project.runningProjects.has('proj-1'),
      tunnelProvider: 'cloudflared',
    }));

    const startPromise = manager.startTunnel('proj-1', 'cloudflared');

    setTimeout(() => {
      managers.project.runningProjects.set('proj-1', true);
      managers.project.startingProjects.delete('proj-1');
    }, 50);

    await vi.advanceTimersByTimeAsync(200);

    await expect(startPromise).resolves.toEqual(expect.objectContaining({
      projectId: 'proj-1',
      status: 'starting',
    }));

    vi.useRealTimers();
  });
});