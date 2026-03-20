import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const fs = require('fs-extra');
const childProcess = require('child_process');

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
    expect(spawnSpy.mock.calls[0][0]).toContain('nodejs');
    expect(spawnSpy.mock.calls[0][0]).toContain('20');
    expect(spawnSpy.mock.calls[0][1]).toEqual(['init', '-y']);
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
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await ctx.installNodeFramework({
      path: '/project',
      services: { nodejsVersion: '20' },
      nodeFramework: 'fastify',
    });

    expect(spawnSpy).toHaveBeenCalledTimes(2);
    expect(spawnSpy.mock.calls[0][0]).toContain('nodejs');
    expect(spawnSpy.mock.calls[0][0]).toContain('20');
    expect(spawnSpy.mock.calls[0][1]).toEqual(['-y', 'fastify-cli', 'generate', '.', '--lang=js']);
    expect(spawnSpy.mock.calls[0][2]).toEqual(expect.objectContaining({ cwd: '/project', windowsHide: true }));
    expect(spawnSpy.mock.calls[0][2]).not.toHaveProperty('shell');
    expect(spawnSpy.mock.calls[1][0]).toContain('nodejs');
    expect(spawnSpy.mock.calls[1][0]).toContain('20');
    expect(spawnSpy.mock.calls[1][1]).toEqual(['install']);
    expect(spawnSpy.mock.calls[1][2]).toEqual(expect.objectContaining({ cwd: '/project', windowsHide: true }));
    expect(spawnSpy.mock.calls[1][2]).not.toHaveProperty('shell');
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(ctx.managers.log.systemError).not.toHaveBeenCalled();
  });
});