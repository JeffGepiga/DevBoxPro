import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../../helpers/mockElectronCjs');

const processes = require('../../../../src/main/services/service/processes');

function makeContext(overrides = {}) {
  return {
    runningVersions: new Map(),
    serviceStatus: new Map(),
    serviceConfigs: {
      nginx: {
        defaultPort: 80,
        sslPort: 443,
        alternatePort: 8081,
        alternateSslPort: 8443,
        versioned: true,
      },
      apache: {
        defaultPort: 8084,
        sslPort: 443,
        alternatePort: 8084,
        alternateSslPort: 8446,
        versioned: true,
      },
      redis: {
        defaultPort: 6379,
        versioned: true,
      },
    },
    versionPortOffsets: {
      nginx: { '1.26': 2 },
      apache: { '2.4': 0 },
      redis: { '7.4': 10 },
    },
    webServerPorts: {
      standard: { http: 80, https: 443 },
      alternate: { http: 8081, https: 8443 },
    },
    standardPortOwner: null,
    standardPortOwnerVersion: null,
    ...processes,
    ...overrides,
  };
}

describe('service/processes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns standard ports for the front-door owner version', () => {
    const ctx = makeContext({
      standardPortOwner: 'nginx',
      standardPortOwnerVersion: '1.28',
    });

    expect(ctx.getServicePorts('nginx', '1.28')).toEqual({
      httpPort: 80,
      sslPort: 443,
    });
  });

  it('returns alternate ports plus version offset for non-front-door web server versions', () => {
    const ctx = makeContext({
      standardPortOwner: 'nginx',
      standardPortOwnerVersion: '1.28',
    });

    expect(ctx.getServicePorts('nginx', '1.26')).toEqual({
      httpPort: 8083,
      sslPort: 8445,
    });
  });

  it('enriches service status with uptime and running version metadata', () => {
    const startedAt = new Date(Date.now() - 5000);
    const ctx = makeContext({
      serviceStatus: new Map([
        ['redis', { status: 'running', startedAt }],
      ]),
      runningVersions: new Map([
        ['redis', new Map([['7.4', { port: 6379, startedAt }]])],
      ]),
    });

    const result = ctx.getAllServicesStatus();

    expect(result.redis.status).toBe('running');
    expect(result.redis.uptime).toBeGreaterThan(0);
    expect(result.redis.runningVersions['7.4']).toEqual(
      expect.objectContaining({ port: 6379 })
    );
    expect(result.redis.runningVersions['7.4'].uptime).toBeGreaterThan(0);
  });

  it('calculates version-specific ports from offsets', () => {
    const ctx = makeContext();

    expect(ctx.getVersionPort('redis', '7.4', 6379)).toBe(6389);
  });
});
