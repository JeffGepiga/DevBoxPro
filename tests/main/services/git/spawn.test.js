import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import path from 'path';

vi.mock('../../../../src/main/utils/SpawnUtils', () => ({
  commandExists: vi.fn(() => true),
}));

const childProcess = require('child_process');
const fs = require('fs-extra');
const gitAvailability = require('../../../../src/main/services/git/availability');
const gitSsh = require('../../../../src/main/services/git/ssh');

function createMockProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

describe('git spawn behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('checks system git without shell mode', async () => {
    const proc = createMockProcess();
    const spawnSpy = vi.spyOn(childProcess, 'spawn').mockReturnValue(proc);

    const pending = gitAvailability.checkSystemGit.call({});
    proc.stdout.emit('data', Buffer.from('C:\\Program Files\\Git\\cmd\\git.exe\r\n'));
    proc.emit('close', 0);

    await expect(pending).resolves.toBe('C:\\Program Files\\Git\\cmd\\git.exe');
    expect(spawnSpy).toHaveBeenCalledWith(
      process.platform === 'win32' ? 'where.exe' : 'which',
      ['git'],
      expect.objectContaining({ windowsHide: true })
    );
    expect(spawnSpy.mock.calls[0][2]).not.toHaveProperty('shell');
  });

  it('spawns ssh-keygen with an executable path and argument array', async () => {
    const sshDir = 'C:\\tmp\\devbox-ssh';
    const keyPath = path.join(sshDir, 'devboxpro_rsa');
    const publicKeyPath = `${keyPath}.pub`;
    const proc = createMockProcess();
    const spawnSpy = vi.spyOn(childProcess, 'spawn').mockImplementation(() => {
      setTimeout(() => {
        proc.emit('close', 0);
      }, 0);
      return proc;
    });
    vi.spyOn(fs, 'pathExists').mockImplementation(async (targetPath) => {
      if (targetPath === keyPath || targetPath === publicKeyPath) {
        return false;
      }

      return targetPath === path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh-keygen.exe');
    });
    vi.spyOn(fs, 'ensureDir').mockResolvedValue();
    vi.spyOn(fs, 'readFile').mockResolvedValue('ssh-ed25519 AAAA generated-key\n');

    const pending = gitSsh.generateSshKey.call({
      sshKeyPath: sshDir,
      gitPath: null,
    });

    await expect(pending).resolves.toEqual({
      success: true,
      publicKey: 'ssh-ed25519 AAAA generated-key',
      exists: false,
    });

    expect(spawnSpy).toHaveBeenCalledWith(
      path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh-keygen.exe'),
      ['-t', 'ed25519', '-f', keyPath, '-N', '', '-C', 'devboxpro-generated-key', '-q'],
      expect.objectContaining({
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    );
    expect(spawnSpy.mock.calls[0][2]).not.toHaveProperty('shell');
  });
});