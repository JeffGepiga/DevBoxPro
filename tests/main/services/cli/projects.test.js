import { beforeEach, describe, expect, it, vi } from 'vitest';

const path = require('path');
const fs = require('fs-extra');
const cliProjects = require('../../../../src/main/services/cli/projects');

function makeContext(overrides = {}) {
  return {
    ...cliProjects,
    configStore: {
      get: vi.fn((key, fallback) => {
        if (key === 'projects') {
          return [
            {
              id: 'proj-1',
              name: 'Project One',
              path: 'C:/Sites/project-one',
              phpVersion: '8.3',
              services: { nodejs: true, nodejsVersion: '22', python: true, pythonVersion: '3.13' },
            },
          ];
        }
        return fallback;
      }),
    },
    getCliPath: vi.fn(() => '/cli'),
    getFirstInstalledNodeVersion: vi.fn(() => '20'),
    getActiveMysqlInfo: vi.fn(() => ({ dbType: 'mysql', version: '8.4' })),
    buildProjectEnv: vi.fn(() => ({ PATH: 'TEST_PATH' })),
    getProjectForPath: cliProjects.getProjectForPath,
    getPhpPath: vi.fn(() => path.join('/resources', 'php', '8.3', 'win', 'php.exe')),
    getComposerPath: vi.fn(() => path.join('/resources', 'composer', 'composer.phar')),
    getNodePath: vi.fn(() => path.join('/resources', 'nodejs', '22', 'win', 'node.exe')),
    getPythonPath: vi.fn(() => path.join('/resources', 'python', '3.13', 'win', 'python.exe')),
    getActiveMysqlInfo: vi.fn(() => ({ dbType: 'mysql', version: '8.4' })),
    getMysqlClientPath: vi.fn(() => path.join('/resources', 'mysql', '8.4', 'win', 'bin', 'mysql.exe')),
    getMysqldumpPath: vi.fn(() => path.join('/resources', 'mysql', '8.4', 'win', 'bin', 'mysqldump.exe')),
    ...overrides,
  };
}

describe('cli/projects', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('writes normalized project mappings to projects.json', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    const writeJsonSpy = vi.spyOn(fs, 'writeJson').mockResolvedValue(undefined);

    const result = await ctx.syncProjectsFile();

    expect(result).toBe(path.join('/cli', 'projects.json'));
    expect(writeJsonSpy).toHaveBeenCalledWith(
      path.join('/cli', 'projects.json'),
      expect.objectContaining({
        [path.normalize('C:/Sites/project-one')]: expect.objectContaining({
          id: 'proj-1',
          nodejsVersion: '22',
          mysqlType: 'mysql',
          mysqlVersion: '8.4',
        }),
      }),
      { spaces: 2 }
    );
  });

  it('finds the project that contains a working directory', () => {
    const ctx = makeContext();

    expect(ctx.getProjectForPath('C:/Sites/project-one/src')).toEqual(expect.objectContaining({ id: 'proj-1' }));
    expect(ctx.getProjectForPath('C:/Other/location')).toBeNull();
  });

  it('rejects command execution when the working directory is not a registered project', async () => {
    const ctx = makeContext({
      getProjectForPath: vi.fn(() => null),
    });

    await expect(ctx.executeCommand('C:/Unknown/project', 'composer', ['install'])).rejects.toThrow(
      'No DevBox Pro project found for path: C:/Unknown/project'
    );
  });
});