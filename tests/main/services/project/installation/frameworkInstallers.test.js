import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';

function makeProcess(exitCode = 0) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  setTimeout(() => proc.emit('close', exitCode), 0);
  return proc;
}

function createBaseContext(mixin, overrides = {}) {
  return {
    managers: {
      binaryDownload: {
        runComposer: vi.fn().mockResolvedValue(undefined),
      },
      database: {
        getDatabaseInfo: vi.fn(() => ({
          user: 'dbuser',
          password: 'secret',
          port: 3307,
        })),
      },
      log: {
        systemError: vi.fn(),
      },
    },
    configStore: {
      get: vi.fn((key, fallback) => {
        if (key === 'settings.defaultTld') {
          return 'test';
        }

        if (key === 'projects') {
          return [{ path: path.join(path.sep, 'workspace', 'project') }];
        }

        return fallback;
      }),
    },
    sanitizeDatabaseName: vi.fn((name) => `db_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`),
    getResourcesPath: vi.fn(() => path.join(path.sep, 'mock', 'resources')),
    ...mixin,
    ...overrides,
  };
}

describe('project/installation/framework installers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unmock('adm-zip');
    vi.unmock('https');
    vi.unmock('http');
  });

  it('installs Laravel and updates environment configuration', async () => {
    const projectPath = path.join(path.sep, 'workspace', 'project');
    const fs = require('fs-extra');
    const childProcess = require('child_process');
    let envPathChecks = 0;
    const spawnMock = vi.spyOn(childProcess, 'spawn').mockImplementation(() => makeProcess(0));
    const ensureDirSpy = vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    const pathExistsSpy = vi.spyOn(fs, 'pathExists').mockImplementation(async (targetPath) => {
      const normalized = String(targetPath);
      if (normalized.endsWith('.env')) {
        envPathChecks += 1;
        return envPathChecks > 1;
      }

      return normalized.endsWith('.env.example')
        || normalized.endsWith('package.json')
        || normalized.includes(`${path.sep}nodejs${path.sep}`)
        || normalized.endsWith(`${path.sep}php.exe`)
        || normalized.endsWith(`${path.sep}php`);
    });
    const copySpy = vi.spyOn(fs, 'copy').mockResolvedValue(undefined);
    const readFileSpy = vi.spyOn(fs, 'readFile').mockResolvedValue([
      'APP_NAME=Laravel',
      'APP_URL=http://localhost',
      'DB_DATABASE=forge',
      'DB_USERNAME=forge',
      'DB_PASSWORD=',
      'DB_PORT=3306',
    ].join('\n'));
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    const laravel = require('../../../../../src/main/services/project/installation/laravel');
    const ctx = createBaseContext(laravel);

    await ctx.installLaravel({
      path: projectPath,
      name: 'My App',
      phpVersion: '8.3',
      services: { nodejs: true, nodejsVersion: '20' },
    });

    expect(ensureDirSpy).toHaveBeenCalledWith(path.dirname(projectPath));
    expect(ctx.managers.binaryDownload.runComposer).toHaveBeenCalledWith(
      path.dirname(projectPath),
      expect.stringContaining('create-project laravel/laravel'),
      '8.3',
      expect.any(Function)
    );
    expect(pathExistsSpy).toHaveBeenCalled();
    expect(copySpy).toHaveBeenCalled();
    expect(readFileSpy).toHaveBeenCalled();
    expect(writeFileSpy).toHaveBeenCalledWith(
      expect.stringContaining('.env'),
      expect.stringContaining('APP_NAME="My App"')
    );
    expect(writeFileSpy).toHaveBeenCalledWith(
      expect.stringContaining('.env'),
      expect.stringContaining('APP_URL=http://my-app.test')
    );
    expect(writeFileSpy).toHaveBeenCalledWith(
      expect.stringContaining('.env'),
      expect.stringContaining('DB_PORT=3307')
    );
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[0][1]).toEqual(['artisan', 'key:generate']);
    expect(spawnMock.mock.calls[1][1]).toEqual(['install']);
    expect(ctx.managers.log.systemError).not.toHaveBeenCalled();
  });

  it('installs WordPress and writes a configured wp-config.php file', async () => {
    const nativeFs = require('fs');
    const fs = require('fs-extra');
    const https = require('https');
    const AdmZip = require('adm-zip');
    const projectPath = nativeFs.mkdtempSync(path.join(os.tmpdir(), 'devbox-wp-'));
    const wpConfigTemplate = [
      "define( 'DB_NAME', 'database_name_here' );",
      "define( 'DB_USER', 'username_here' );",
      "define( 'DB_PASSWORD', 'password_here' );",
      "define( 'DB_HOST', 'localhost' );",
      "define( 'AUTH_KEY', 'put your unique phrase here' );",
      "define( 'SECURE_AUTH_KEY', 'put your unique phrase here' );",
      "define( 'LOGGED_IN_KEY', 'put your unique phrase here' );",
      "define( 'NONCE_KEY', 'put your unique phrase here' );",
      "define( 'AUTH_SALT', 'put your unique phrase here' );",
      "define( 'SECURE_AUTH_SALT', 'put your unique phrase here' );",
      "define( 'LOGGED_IN_SALT', 'put your unique phrase here' );",
      "define( 'NONCE_SALT', 'put your unique phrase here' );",
    ].join('\n');

    const zip = new AdmZip();
    zip.addFile('wordpress/wp-config-sample.php', Buffer.from(wpConfigTemplate));
    zip.addFile('wordpress/index.php', Buffer.from('<?php echo "hi";'));
    const zipBuffer = zip.toBuffer();

    const ensureDirSpy = vi.spyOn(fs, 'ensureDir');
    const createWriteStreamSpy = vi.spyOn(fs, 'createWriteStream');
    const unlinkSpy = vi.spyOn(fs, 'unlink');

    const httpsGetSpy = vi.spyOn(https, 'get').mockImplementation((url, options, callback) => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.headers = { 'content-length': String(zipBuffer.length) };
      response.pipe = (file) => {
        setTimeout(() => {
          response.emit('data', zipBuffer.subarray(0, Math.max(1, Math.floor(zipBuffer.length / 2))));
          response.emit('data', zipBuffer.subarray(Math.max(1, Math.floor(zipBuffer.length / 2))));
          file.write(zipBuffer);
          file.end();
        }, 0);
      };

      setTimeout(() => callback(response), 0);
      return new EventEmitter();
    });

    const wordpress = require('../../../../../src/main/services/project/installation/wordpress');
    const ctx = createBaseContext(wordpress);

    try {
      await ctx.installWordPress({
        path: projectPath,
        name: 'My App',
        wordpressVersion: 'latest',
      });

      expect(ensureDirSpy).toHaveBeenCalledWith(projectPath);
      expect(createWriteStreamSpy).toHaveBeenCalled();
      expect(httpsGetSpy).toHaveBeenCalledWith(
        'https://wordpress.org/latest.zip',
        expect.any(Object),
        expect.any(Function)
      );
      expect(unlinkSpy).toHaveBeenCalledWith(expect.stringContaining('wordpress.zip'));

      const wpConfig = await fs.readFile(path.join(projectPath, 'wp-config.php'), 'utf-8');
      expect(wpConfig).toContain("define( 'DB_NAME', 'db_my_app' )");
      expect(wpConfig).toContain("define( 'DB_USER', 'dbuser' )");
      expect(wpConfig).toContain("define( 'DB_PASSWORD', 'secret' )");
      expect(wpConfig).toContain("define( 'DB_HOST', '127.0.0.1:3307' )");
      expect(ctx.managers.log.systemError).not.toHaveBeenCalled();
    } finally {
      await fs.remove(projectPath);
    }
  });

  it('installs Symfony and updates DATABASE_URL in .env', async () => {
    const projectPath = path.join(path.sep, 'workspace', 'project');
    const fs = require('fs-extra');
    const ensureDirSpy = vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'pathExists').mockImplementation(async (targetPath) => String(targetPath).endsWith('.env'));
    vi.spyOn(fs, 'readFile').mockResolvedValue('APP_ENV=prod\nDATABASE_URL="sqlite:///%kernel.project_dir%/var/data.db"\n');
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    const symfony = require('../../../../../src/main/services/project/installation/symfony');
    const ctx = createBaseContext(symfony);

    await ctx.installSymfony({
      path: projectPath,
      name: 'My App',
      phpVersion: '8.4',
    });

    expect(ensureDirSpy).toHaveBeenCalledWith(path.dirname(projectPath));
    expect(ctx.managers.binaryDownload.runComposer).toHaveBeenNthCalledWith(
      1,
      path.dirname(projectPath),
      expect.stringContaining('create-project symfony/skeleton'),
      '8.4',
      expect.any(Function)
    );
    expect(ctx.managers.binaryDownload.runComposer).toHaveBeenNthCalledWith(
      2,
      projectPath,
      'require webapp --no-interaction',
      '8.4',
      expect.any(Function)
    );
    expect(writeFileSpy).toHaveBeenCalledWith(
      expect.stringContaining('.env'),
      expect.stringContaining('DATABASE_URL="mysql://dbuser:secret@127.0.0.1:3307/db_my_app?serverVersion=8.0"')
    );
    expect(writeFileSpy).toHaveBeenCalledWith(
      expect.stringContaining('.env'),
      expect.stringContaining('APP_ENV=dev')
    );
    expect(ctx.managers.log.systemError).not.toHaveBeenCalled();
  });
});