import { describe, it, expect, vi, afterEach } from 'vitest';

const fs = require('fs-extra');
const supervisorHelpers = require('../../../../src/main/services/supervisor/helpers');

function makeContext() {
  return {
    resourcePath: '/resources',
    getEffectiveProcessCommand: supervisorHelpers.getEffectiveProcessCommand,
    getEffectiveProcessEnvironment: supervisorHelpers.getEffectiveProcessEnvironment,
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

  it('normalizes the default SvelteKit dev command to the project port', async () => {
    const context = makeContext();
    const project = {
      type: 'nodejs',
      domain: 'app.test',
      nodeFramework: 'sveltekit',
      nodePort: 5173,
      phpVersion: '8.3',
      environment: {},
      services: { nodejsVersion: '20' },
    };
    const config = {
      name: 'nodejs-app',
      command: 'npm run dev',
      environment: {},
    };

    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);

    const result = await supervisorHelpers.resolveProcessCommand.call(context, project, config);

    expect(result.command.replace(/\\/g, '/')).toContain('/resources/nodejs/20/');
    expect(result.args).toEqual(['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort']);
    expect(result.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS).toBe('app.test');
  });

  it('leaves custom SvelteKit commands unchanged', async () => {
    const context = makeContext();
    const project = {
      type: 'nodejs',
      nodeFramework: 'sveltekit',
      nodePort: 5173,
    };

    expect(supervisorHelpers.getEffectiveProcessCommand.call(context, project, {
      name: 'nodejs-app',
      command: 'npm run preview',
    })).toBe('npm run preview');
  });

  it.each([
    ['nextjs'],
    ['nuxtjs'],
    ['remix'],
    ['fastify'],
  ])('keeps the default dev command intact for %s while adding the project domain to process env', async (nodeFramework) => {
    const context = makeContext();
    const project = {
      type: 'nodejs',
      domain: 'app.test',
      nodeFramework,
      nodePort: 5173,
      phpVersion: '8.3',
      environment: {},
      services: { nodejsVersion: '20' },
    };
    const config = {
      name: 'nodejs-app',
      command: 'npm run dev',
      environment: {},
    };

    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);

    const result = await supervisorHelpers.resolveProcessCommand.call(context, project, config);

    expect(result.command.replace(/\\/g, '/')).toContain('/resources/nodejs/20/');
    expect(result.args).toEqual(['run', 'dev']);
    expect(result.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS).toBe('app.test');
  });

  it('does not overwrite an explicit additional Vite allowed host', async () => {
    const context = makeContext();

    const env = supervisorHelpers.getEffectiveProcessEnvironment.call(context, {
      type: 'nodejs',
      domain: 'app.test',
    }, {
      name: 'nodejs-app',
    }, {
      __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: 'custom.test',
    });

    expect(env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS).toBe('custom.test');
  });
});