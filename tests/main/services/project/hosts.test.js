import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hosts = require('../../../../src/main/services/project/hosts');

function makeContext(overrides = {}) {
  return {
    ...hosts,
    managers: {
      log: {
        systemWarn: vi.fn(),
      },
    },
    addToHostsFile: vi.fn().mockResolvedValue({ success: true }),
    validateDomainName: hosts.validateDomainName,
    ...overrides,
  };
}

describe('project/hosts', () => {
  afterEach(() => {
    delete process.env.PLAYWRIGHT_TEST;
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('deduplicates domains before updating the hosts file', async () => {
    const ctx = makeContext();

    await ctx.updateHostsFile({
      domain: 'app.test',
      domains: ['app.test', 'api.test', 'app.test'],
    });

    expect(ctx.addToHostsFile).toHaveBeenCalledTimes(2);
    expect(ctx.addToHostsFile).toHaveBeenNthCalledWith(1, 'app.test');
    expect(ctx.addToHostsFile).toHaveBeenNthCalledWith(2, 'api.test');
  });

  it('rejects invalid domains with shell metacharacters', () => {
    const ctx = makeContext();

    expect(ctx.validateDomainName('bad;domain.test')).toBe(false);
    expect(ctx.managers.log.systemWarn).toHaveBeenCalled();
  });

  it('allows valid test domains', () => {
    const ctx = makeContext();

    expect(ctx.validateDomainName('my-app.test')).toBe(true);
  });

  it('short-circuits hosts updates during playwright runs', async () => {
    const ctx = makeContext();
    process.env.PLAYWRIGHT_TEST = 'true';

    await ctx.updateHostsFile({ domain: 'ignored.test', domains: ['ignored.test'] });

    expect(ctx.addToHostsFile).not.toHaveBeenCalled();
  });

  it('rejects invalid domains before touching the hosts file', async () => {
    const ctx = makeContext({
      managers: {
        log: {
          systemWarn: vi.fn(),
        },
      },
      addToHostsFile: hosts.addToHostsFile,
    });
    process.env.PLAYWRIGHT_TEST = 'false';

    const result = await ctx.addToHostsFile('bad;domain.test');

    expect(result).toEqual({ success: false, error: 'Invalid domain name format' });
    expect(ctx.managers.log.systemWarn).toHaveBeenCalledWith('Rejected invalid domain for hosts file', { domain: 'bad;domain.test' });
  });
});
