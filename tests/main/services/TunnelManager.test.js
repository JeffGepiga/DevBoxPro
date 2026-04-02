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
});