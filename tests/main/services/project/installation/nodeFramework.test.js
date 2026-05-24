import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const fs = require('fs-extra');
const childProcess = require('child_process');
const originalPlatform = process.platform;

function setTestPlatform(platform) {
  Object.defineProperty(process, 'platform', {
    value: platform,
  });
}

function expectSpawnedNodeCommand(spawnCall, expectedCommandPathPart, expectedArgs) {
  if (process.platform === 'win32') {
    expect(spawnCall[0].toLowerCase()).toContain('cmd');
    expect(spawnCall[1].slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(spawnCall[1][3]).toContain(expectedCommandPathPart);
    for (const arg of expectedArgs) {
      expect(spawnCall[1][3]).toContain(arg);
    }
    expect(spawnCall[2]).toEqual(expect.objectContaining({ windowsHide: true }));
    return;
  }

  expect(spawnCall[0]).toContain(expectedCommandPathPart);
  expect(spawnCall[1]).toEqual(expectedArgs);
  expect(spawnCall[2]).toEqual(expect.objectContaining({ windowsHide: true }));
}

function makeProcess(exitCode = 0) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  setTimeout(() => proc.emit('close', exitCode), 0);
  return proc;
}

function makeContext(nodeFramework, overrides = {}) {
  return {
    managers: {
      log: {
        systemError: vi.fn(),
      },
    },
    getResourcesPath: vi.fn(() => '/mock/resources'),
    ...nodeFramework,
    ...overrides,
  };
}

describe('project/installation/nodeFramework', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    setTestPlatform(originalPlatform);
  });

  it('creates a vanilla Node.js starter when no framework is selected', async () => {
    const spawnSpy = vi.spyOn(childProcess, 'spawn').mockImplementation(() => makeProcess(0));
    const nodeFramework = require('../../../../../src/main/services/project/installation/nodeFramework');
    const ctx = makeContext(nodeFramework);
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await ctx.installNodeFramework({
      path: '/project',
      services: { nodejsVersion: '20' },
      nodeFramework: '',
    });

    expect(fs.ensureDir).toHaveBeenCalledWith('/project');
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expectSpawnedNodeCommand(spawnSpy.mock.calls[0], process.platform === 'win32' ? 'npm.cmd' : 'nodejs', ['init', '-y']);
    expect(spawnSpy.mock.calls[0][2]).toEqual(expect.objectContaining({ cwd: '/project', windowsHide: true }));
    expect(spawnSpy.mock.calls[0][2]).not.toHaveProperty('shell');
    expect(fs.writeFile.mock.calls[0][0]).toContain('project');
    expect(fs.writeFile.mock.calls[0][0]).toContain('index.js');
    expect(fs.writeFile.mock.calls[0][1]).toContain('Hello from Node.js!');
    expect(ctx.managers.log.systemError).not.toHaveBeenCalled();
  });

  it('runs the fastify CLI scaffold and installs dependencies', async () => {
    const spawnSpy = vi.spyOn(childProcess, 'spawn').mockImplementation(() => makeProcess(0));
    const nodeFramework = require('../../../../../src/main/services/project/installation/nodeFramework');
    const ctx = makeContext(nodeFramework);
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await ctx.installNodeFramework({
      path: '/project',
      services: { nodejsVersion: '20' },
      nodeFramework: 'fastify',
    });

    expect(spawnSpy).toHaveBeenCalledTimes(2);
    expectSpawnedNodeCommand(spawnSpy.mock.calls[0], process.platform === 'win32' ? 'npx.cmd' : 'nodejs', ['-y', 'fastify-cli', 'generate', '.', '--lang=js']);
    expect(spawnSpy.mock.calls[0][2]).toEqual(expect.objectContaining({ cwd: '/project', windowsHide: true }));
    expect(spawnSpy.mock.calls[0][2]).not.toHaveProperty('shell');
    expectSpawnedNodeCommand(spawnSpy.mock.calls[1], process.platform === 'win32' ? 'npm.cmd' : 'nodejs', ['install']);
    expect(spawnSpy.mock.calls[1][2]).toEqual(expect.objectContaining({ cwd: '/project', windowsHide: true }));
    expect(spawnSpy.mock.calls[1][2]).not.toHaveProperty('shell');
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(ctx.managers.log.systemError).not.toHaveBeenCalled();
  });

  it('runs Nuxt scaffolding non-interactively before installing dependencies', async () => {
    const spawnSpy = vi.spyOn(childProcess, 'spawn').mockImplementation(() => makeProcess(0));
    const nodeFramework = require('../../../../../src/main/services/project/installation/nodeFramework');
    const ctx = makeContext(nodeFramework);
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await ctx.installNodeFramework({
      path: '/project',
      services: { nodejsVersion: '20' },
      nodeFramework: 'nuxtjs',
    });

    expect(spawnSpy).toHaveBeenCalledTimes(2);
    expectSpawnedNodeCommand(
      spawnSpy.mock.calls[0],
      process.platform === 'win32' ? 'npx.cmd' : 'nodejs',
      ['-y', 'nuxi@latest', 'init', '.', '--force', '--template', 'minimal', '--no-modules', '--no-install', '--packageManager', 'npm']
    );
    expect(spawnSpy.mock.calls[0][2]).toEqual(expect.objectContaining({ cwd: '/project', windowsHide: true }));
    expect(spawnSpy.mock.calls[0][2]).not.toHaveProperty('shell');
    expectSpawnedNodeCommand(spawnSpy.mock.calls[1], process.platform === 'win32' ? 'npm.cmd' : 'nodejs', ['install']);
    expect(spawnSpy.mock.calls[1][2]).toEqual(expect.objectContaining({ cwd: '/project', windowsHide: true }));
    expect(spawnSpy.mock.calls[1][2]).not.toHaveProperty('shell');
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(ctx.managers.log.systemError).not.toHaveBeenCalled();
  });

  it('runs Next.js scaffolding with the expected non-interactive flags', async () => {
    const spawnSpy = vi.spyOn(childProcess, 'spawn').mockImplementation(() => makeProcess(0));
    const nodeFramework = require('../../../../../src/main/services/project/installation/nodeFramework');
    const ctx = makeContext(nodeFramework);
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await ctx.installNodeFramework({
      path: '/project',
      services: { nodejsVersion: '20' },
      nodeFramework: 'nextjs',
    });

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expectSpawnedNodeCommand(
      spawnSpy.mock.calls[0],
      process.platform === 'win32' ? 'npx.cmd' : 'nodejs',
      ['-y', 'create-next-app@latest', '.', '--use-npm', '--eslint', '--no-tailwind', '--no-src-dir', '--no-app', '--no-import-alias', '--turbopack']
    );
    expect(spawnSpy.mock.calls[0][2]).toEqual(expect.objectContaining({ cwd: '/project', windowsHide: true }));
    expect(spawnSpy.mock.calls[0][2]).not.toHaveProperty('shell');
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(ctx.managers.log.systemError).not.toHaveBeenCalled();
  });

  it('runs SvelteKit scaffolding non-interactively before installing dependencies', async () => {
    const spawnSpy = vi.spyOn(childProcess, 'spawn').mockImplementation(() => makeProcess(0));
    const nodeFramework = require('../../../../../src/main/services/project/installation/nodeFramework');
    const ctx = makeContext(nodeFramework);
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await ctx.installNodeFramework({
      path: '/project',
      services: { nodejsVersion: '20' },
      nodeFramework: 'sveltekit',
    });

    expect(spawnSpy).toHaveBeenCalledTimes(2);
    expectSpawnedNodeCommand(
      spawnSpy.mock.calls[0],
      process.platform === 'win32' ? 'npx.cmd' : 'nodejs',
      ['-y', 'sv', 'create', '.', '--template', 'minimal', '--no-types', '--no-add-ons', '--no-install', '--no-dir-check']
    );
    expect(spawnSpy.mock.calls[0][2]).toEqual(expect.objectContaining({ cwd: '/project', windowsHide: true }));
    expect(spawnSpy.mock.calls[0][2]).not.toHaveProperty('shell');
    expectSpawnedNodeCommand(spawnSpy.mock.calls[1], process.platform === 'win32' ? 'npm.cmd' : 'nodejs', ['install']);
    expect(spawnSpy.mock.calls[1][2]).toEqual(expect.objectContaining({ cwd: '/project', windowsHide: true }));
    expect(spawnSpy.mock.calls[1][2]).not.toHaveProperty('shell');
    expect(fs.pathExists).toHaveBeenCalledWith(expect.stringContaining('package.json'));
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(ctx.managers.log.systemError).not.toHaveBeenCalled();
  });

  it('runs Remix scaffolding before installing dependencies', async () => {
    const spawnSpy = vi.spyOn(childProcess, 'spawn').mockImplementation(() => makeProcess(0));
    const nodeFramework = require('../../../../../src/main/services/project/installation/nodeFramework');
    const ctx = makeContext(nodeFramework);
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await ctx.installNodeFramework({
      path: '/project',
      services: { nodejsVersion: '20' },
      nodeFramework: 'remix',
    });

    expect(spawnSpy).toHaveBeenCalledTimes(2);
    expectSpawnedNodeCommand(
      spawnSpy.mock.calls[0],
      process.platform === 'win32' ? 'npx.cmd' : 'nodejs',
      ['-y', 'create-remix@latest', '.', '--no-install', '--no-git-init']
    );
    expect(spawnSpy.mock.calls[0][2]).toEqual(expect.objectContaining({ cwd: '/project', windowsHide: true }));
    expect(spawnSpy.mock.calls[0][2]).not.toHaveProperty('shell');
    expectSpawnedNodeCommand(spawnSpy.mock.calls[1], process.platform === 'win32' ? 'npm.cmd' : 'nodejs', ['install']);
    expect(spawnSpy.mock.calls[1][2]).toEqual(expect.objectContaining({ cwd: '/project', windowsHide: true }));
    expect(spawnSpy.mock.calls[1][2]).not.toHaveProperty('shell');
    expect(ctx.managers.log.systemError).not.toHaveBeenCalled();
  });

  it('fails before npm install when scaffolding does not create package.json', async () => {
    const spawnSpy = vi.spyOn(childProcess, 'spawn').mockImplementation(() => makeProcess(0));
    const nodeFramework = require('../../../../../src/main/services/project/installation/nodeFramework');
    const ctx = makeContext(nodeFramework);
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'pathExists').mockResolvedValue(false);
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await expect(ctx.installNodeFramework({
      path: '/project',
      services: { nodejsVersion: '20' },
      nodeFramework: 'sveltekit',
    })).rejects.toThrow('SvelteKit scaffolding did not create package.json');

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(ctx.managers.log.systemError).toHaveBeenCalledWith(
      '[installNodeFramework] Framework scaffolding error',
      expect.objectContaining({ framework: 'sveltekit', error: 'SvelteKit scaffolding did not create package.json' })
    );
  });

  it('routes Windows npm and npx wrappers through cmd.exe', async () => {
    setTestPlatform('win32');
    const spawnSpy = vi.spyOn(childProcess, 'spawn').mockImplementation(() => makeProcess(0));
    const nodeFramework = require('../../../../../src/main/services/project/installation/nodeFramework');
    const ctx = makeContext(nodeFramework, {
      getResourcesPath: vi.fn(() => 'C:/mock/resources'),
    });
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await ctx.installNodeFramework({
      path: 'C:/project',
      services: { nodejsVersion: '20' },
      nodeFramework: 'express',
    });

    expect(spawnSpy).toHaveBeenCalledTimes(2);
    expect(spawnSpy.mock.calls[0][0].toLowerCase()).toContain('cmd');
    expect(spawnSpy.mock.calls[0][1].slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(spawnSpy.mock.calls[0][1][3]).toContain('npx.cmd');
    expect(spawnSpy.mock.calls[0][1][3]).toContain('express-generator');
    expect(spawnSpy.mock.calls[1][0].toLowerCase()).toContain('cmd');
    expect(spawnSpy.mock.calls[1][1][3]).toContain('npm.cmd');
    expect(spawnSpy.mock.calls[1][1][3]).toContain('install');
  });
});