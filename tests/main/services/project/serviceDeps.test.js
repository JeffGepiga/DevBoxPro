import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const serviceDeps = require('../../../../src/main/services/project/serviceDeps');

function makeContext(overrides = {}) {
  const ctx = {
    runningProjects: new Map(),
    startingProjects: new Set(),
    pendingServiceStops: new Map(),
    managers: {
      service: {
        stopService: vi.fn().mockResolvedValue(undefined),
      },
      log: {
        project: vi.fn(),
      },
    },
    getProject: vi.fn(),
    getEffectiveWebServerVersion: vi.fn((project, webServer) => project.webServerVersion || (webServer === 'apache' ? '2.4' : '1.24')),
    ...serviceDeps,
    ...overrides,
  };

  return ctx;
}

describe('project/serviceDeps', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds the expected service dependency list', () => {
    const ctx = makeContext();

    expect(ctx.getProjectServiceDependencies({
      webServer: 'apache',
      webServerVersion: '2.4',
      services: {
        mysql: true,
        mysqlVersion: '8.4',
        redis: true,
        phpmyadmin: true,
      },
    })).toEqual([
      { name: 'apache', version: '2.4' },
      { name: 'mysql', version: '8.4' },
      { name: 'redis', version: '7.4' },
      { name: 'phpmyadmin', version: null },
    ]);
  });

  it('cancels a pending service stop', () => {
    const ctx = makeContext();
    const timer = setTimeout(() => {}, 1000);
    ctx.pendingServiceStops.set('redis:7.4', { timer, service: { name: 'redis', version: '7.4' } });

    expect(ctx.cancelPendingServiceStop({ name: 'redis', version: '7.4' })).toBe(true);
    expect(ctx.pendingServiceStops.has('redis:7.4')).toBe(false);
  });

  it('stops a service after the grace period when no project still needs it', async () => {
    const ctx = makeContext({
      isServiceNeededByRunningProjects: vi.fn(() => false),
    });

    ctx.scheduleServiceStop('project-1', { name: 'redis', version: '7.4' });
    await vi.advanceTimersByTimeAsync(15000);

    expect(ctx.managers.service.stopService).toHaveBeenCalledWith('redis', '7.4');
    expect(ctx.managers.log.project).toHaveBeenCalledWith('project-1', 'Stopping redis:7.4 after idle grace period');
  });

  it('keeps the service running when another project still depends on it', async () => {
    const ctx = makeContext({
      isServiceNeededByRunningProjects: vi.fn(() => true),
    });

    ctx.scheduleServiceStop('project-2', { name: 'mysql', version: '8.4' });
    await vi.advanceTimersByTimeAsync(15000);

    expect(ctx.managers.service.stopService).not.toHaveBeenCalled();
    expect(ctx.managers.log.project).toHaveBeenCalledWith(
      'project-2',
      'Skipped stopping mysql:8.4 because another project started using it during the grace period'
    );
  });

  it('treats projects that are still starting as active service consumers', () => {
    const project = {
      id: 'project-starting',
      webServer: 'nginx',
      webServerVersion: '1.28',
      services: {
        mysql: true,
        mysqlVersion: '8.4',
      },
    };

    const ctx = makeContext({
      startingProjects: new Set(['project-starting']),
      getProject: vi.fn((id) => (id === 'project-starting' ? project : null)),
    });

    expect(ctx.isServiceNeededByRunningProjects({ name: 'mysql', version: '8.4' })).toBe(true);
  });
});
