import { describe, it, expect, vi, afterEach } from 'vitest';

const fs = require('fs-extra');
const supervisorHelpers = require('../../../../src/main/services/supervisor/helpers');

function makeContext() {
  return {
    resourcePath: '/resources',
    tokenizeCommand: supervisorHelpers.tokenizeCommand,
    getPlatform: supervisorHelpers.getPlatform,
    normalizeExecutableToken: supervisorHelpers.normalizeExecutableToken,
    prependPath: supervisorHelpers.prependPath,
  };
}

describe('supervisor/helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tokenizes quoted command arguments', () => {
    const context = makeContext();

    const tokens = supervisorHelpers.tokenizeCommand.call(context, 'php artisan queue:work --queue="high,default"');

    expect(tokens).toEqual(['php', 'artisan', 'queue:work', '--queue=high,default']);
  });

  it('normalizes executable extensions', () => {
    const context = makeContext();

    expect(supervisorHelpers.normalizeExecutableToken.call(context, 'C:/tools/npm.cmd')).toBe('npm');
    expect(supervisorHelpers.normalizeExecutableToken.call(context, 'python3')).toBe('python3');
  });

  it('resolves pip commands through the bundled python runtime', async () => {
    const context = makeContext();
    const project = {
      phpVersion: '8.3',
      environment: { APP_ENV: 'local' },
      services: { pythonVersion: '3.13' },
    };
    const config = {
      command: 'pip install requests',
      environment: { EXTRA_FLAG: '1' },
    };

    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);

    const result = await supervisorHelpers.resolveProcessCommand.call(context, project, config);

    expect(result.command.replace(/\\/g, '/')).toContain('/resources/python/3.13/');
    expect(result.args).toEqual(['-m', 'pip', 'install', 'requests']);
    expect(result.env.PYTHONUNBUFFERED).toBe('1');
    expect(result.env.EXTRA_FLAG).toBe('1');
  });
});