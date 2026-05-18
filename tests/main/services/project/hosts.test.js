import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fs = require('fs-extra');

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

  it('treats loopback hosts entries with multiple aliases as already registered', async () => {
    const ctx = makeContext({
      managers: {
        log: {
          systemWarn: vi.fn(),
        },
      },
      addToHostsFile: hosts.addToHostsFile,
    });
    process.env.PLAYWRIGHT_TEST = 'false';
    vi.spyOn(fs, 'readFile').mockResolvedValue('127.0.0.1 app.test www.app.test\n');

    const result = await ctx.addToHostsFile('app.test');

    expect(result).toEqual({ success: true, alreadyExists: true });
  });

  it('rejects conflicting non-loopback hosts entries for the requested domain', async () => {
    const ctx = makeContext({
      managers: {
        log: {
          systemWarn: vi.fn(),
        },
      },
      addToHostsFile: hosts.addToHostsFile,
    });
    process.env.PLAYWRIGHT_TEST = 'false';
    vi.spyOn(fs, 'readFile').mockResolvedValue('10.0.0.20 app.test\n');

    const result = await ctx.addToHostsFile('app.test');

    expect(result).toEqual({
      success: false,
      error: 'Domain app.test already exists in the hosts file and points to 10.0.0.20. Please remove the existing entry or choose a different domain.',
    });
  });
});
