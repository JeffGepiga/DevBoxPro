/**
 * Tests for src/main/services/extractWorker.js
 *
 * extractWorker runs as a worker_thread. We test it by spinning up a Worker
 * and observing the messages posted back via parentPort.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Worker } from 'worker_threads';
import AdmZip from 'adm-zip';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';

const WORKER_PATH = path.resolve('src/main/services/extractWorker.js');

/**
 * Helper – run the extractWorker with given workerData.
 * Resolves with the array of all messages received before 'done' or 'error'.
 */
function runWorker(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, { workerData });
    const messages = [];

    worker.on('message', (msg) => {
      messages.push(msg);
      if (msg.type === 'done' || msg.type === 'error') {
        worker.terminate();
        if (msg.type === 'done') {
          resolve(messages);
        } else {
          reject(Object.assign(new Error(msg.error), { messages }));
        }
      }
    });

    worker.on('error', reject);
    // Safety timeout
    setTimeout(() => {
      worker.terminate();
      reject(new Error('Worker timed out'));
    }, 10000);
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('extractWorker', () => {
  let tmpDir;

  beforeAll(async () => {
    tmpDir = path.join(os.tmpdir(), `ew-test-${Date.now()}`);
    await fs.ensureDir(tmpDir);
  });

  afterAll(async () => {
    await fs.remove(tmpDir).catch(() => {});
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Basic extraction
  // ─────────────────────────────────────────────────────────────────────────

  describe('ZIP extraction', () => {
    it('extracts files and emits done message', async () => {
      // Build a small in-memory ZIP
      const zip = new AdmZip();
      zip.addFile('hello.txt', Buffer.from('Hello, World!'));
      zip.addFile('subdir/nested.txt', Buffer.from('Nested content'));

      const archivePath = path.join(tmpDir, 'basic.zip');
      const destPath = path.join(tmpDir, 'basic-out');
      zip.writeZip(archivePath);

      const messages = await runWorker({ archivePath, destPath });

      // Last message must be 'done'
      expect(messages[messages.length - 1].type).toBe('done');

      // Files must be extracted
      expect(await fs.pathExists(path.join(destPath, 'hello.txt'))).toBe(true);
      expect(await fs.pathExists(path.join(destPath, 'subdir', 'nested.txt'))).toBe(true);

      const content = await fs.readFile(path.join(destPath, 'hello.txt'), 'utf-8');
      expect(content).toBe('Hello, World!');
    });

    it('strips a common root folder when every entry shares it', async () => {
      const zip = new AdmZip();
      zip.addFile('nginx-1.28.0/conf/nginx.conf', Buffer.from('worker_processes 1;'));
      zip.addFile('nginx-1.28.0/logs/.keep', Buffer.from(''));

      const archivePath = path.join(tmpDir, 'rooted.zip');
      const destPath = path.join(tmpDir, 'rooted-out');
      zip.writeZip(archivePath);

      await runWorker({ archivePath, destPath });

      expect(await fs.pathExists(path.join(destPath, 'conf', 'nginx.conf'))).toBe(true);
      expect(await fs.pathExists(path.join(destPath, 'nginx-1.28.0', 'conf', 'nginx.conf'))).toBe(false);
    });

    it('preserves root folders when entries do not share one root', async () => {
      const zip = new AdmZip();
      zip.addFile('rootA/file1.txt', Buffer.from('A'));
      zip.addFile('rootB/file2.txt', Buffer.from('B'));

      const archivePath = path.join(tmpDir, 'mixed.zip');
      const destPath = path.join(tmpDir, 'mixed-out');
      zip.writeZip(archivePath);

      await runWorker({ archivePath, destPath });

      expect(await fs.pathExists(path.join(destPath, 'rootA', 'file1.txt'))).toBe(true);
      expect(await fs.pathExists(path.join(destPath, 'rootB', 'file2.txt'))).toBe(true);
    });

  });

  // ─────────────────────────────────────────────────────────────────────────
  // Progress reporting
  // ─────────────────────────────────────────────────────────────────────────

  describe('progress reporting', () => {
    it('emits at least one progress message', async () => {
      const zip = new AdmZip();
      // Add enough entries to trigger a progress update (every 50)
      for (let i = 0; i < 55; i++) {
        zip.addFile(`file${i}.txt`, Buffer.from(`content ${i}`));
      }

      const archivePath = path.join(tmpDir, 'many.zip');
      const destPath = path.join(tmpDir, 'many-out');
      zip.writeZip(archivePath);

      const messages = await runWorker({ archivePath, destPath });
      const progressMessages = messages.filter((m) => m.type === 'progress');

      expect(progressMessages.length).toBeGreaterThan(0);
      expect(progressMessages[0]).toHaveProperty('progress');
      expect(progressMessages[0].progress).toBeGreaterThan(0);
      expect(progressMessages[0].progress).toBeLessThanOrEqual(100);
    });

    it('final progress is 100', async () => {
      const zip = new AdmZip();
      for (let i = 0; i < 52; i++) {
        zip.addFile(`f${i}.txt`, Buffer.from(`x`));
      }

      const archivePath = path.join(tmpDir, 'exact100.zip');
      const destPath = path.join(tmpDir, 'exact100-out');
      zip.writeZip(archivePath);

      const messages = await runWorker({ archivePath, destPath });
      const progressMessages = messages.filter((m) => m.type === 'progress');
      const lastProgress = progressMessages[progressMessages.length - 1];
      expect(lastProgress.progress).toBe(100);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Error handling
  // ─────────────────────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('emits error message for non-existent archive', async () => {
      const workerData = {
        archivePath: path.join(tmpDir, 'nonexistent.zip'),
        destPath: path.join(tmpDir, 'err-out'),
      };

      await expect(runWorker(workerData)).rejects.toThrow();
    });

    it('error message contains descriptive text', async () => {
      const workerData = {
        archivePath: path.join(tmpDir, 'bad.zip'),
        destPath: path.join(tmpDir, 'bad-out'),
      };

      // Write an invalid zip file
      await fs.writeFile(workerData.archivePath, Buffer.from('not a zip file'));

      try {
        await runWorker(workerData);
        // Should not reach here
        expect(true).toBe(false);
      } catch (err) {
        expect(err.message).toBeTruthy();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // .asar / pgAdmin 4 skip behaviour
  // ─────────────────────────────────────────────────────────────────────────

  describe('ASAR and pgAdmin 4 skip behaviour', () => {
    it('skips pgAdmin 4 entries and .asar files, but still extracts server binaries', async () => {
      // Reproduce the exact structure of EDB postgresql-*-windows-x64-binaries.zip.
      const zip = new AdmZip();
      // Server binary that MUST be extracted.
      zip.addFile('pgsql/bin/postgres.exe', Buffer.from('fake-postgres-binary'));
      zip.addFile('pgsql/lib/libpq.dll', Buffer.from('fake-libpq'));
      // pgAdmin 4 entries that MUST be skipped (contain .asar files).
      zip.addFile('pgsql/pgAdmin 4/runtime/resources/default_app.asar', Buffer.from('fake-asar'));
      zip.addFile('pgsql/pgAdmin 4/runtime/app.asar', Buffer.from('fake-app-asar'));
      zip.addFile('pgsql/pgAdmin 4/pgAdmin4.exe', Buffer.from('fake-pgadmin-exe'));
      // StackBuilder that MUST be skipped.
      zip.addFile('pgsql/StackBuilder/StackBuilder.exe', Buffer.from('fake-stackbuilder'));

      const archivePath = path.join(tmpDir, 'pg-skip-test.zip');
      const destPath = path.join(tmpDir, 'pg-skip-out');
      zip.writeZip(archivePath);

      // Must resolve without "Invalid package" error.
      const messages = await runWorker({ archivePath, destPath });
      expect(messages[messages.length - 1].type).toBe('done');

      // Server binaries MUST be present.
      expect(await fs.pathExists(path.join(destPath, 'bin', 'postgres.exe'))).toBe(true);
      expect(await fs.pathExists(path.join(destPath, 'lib', 'libpq.dll'))).toBe(true);

      // pgAdmin 4 MUST have been skipped entirely.
      expect(await fs.pathExists(path.join(destPath, 'pgAdmin 4'))).toBe(false);
      expect(await fs.pathExists(path.join(destPath, 'pgAdmin 4', 'runtime', 'resources', 'default_app.asar'))).toBe(false);

      // StackBuilder MUST have been skipped.
      expect(await fs.pathExists(path.join(destPath, 'StackBuilder'))).toBe(false);
    });

    it('skips standalone .asar files that are not inside pgAdmin 4', async () => {
      // Any .asar file in any location should be skipped to prevent Electron interception.
      const zip = new AdmZip();
      zip.addFile('app/server.exe', Buffer.from('server'));
      zip.addFile('app/config.json', Buffer.from('{}'));
      zip.addFile('app/resources/app.asar', Buffer.from('asar-content'));

      const archivePath = path.join(tmpDir, 'standalone-asar.zip');
      const destPath = path.join(tmpDir, 'standalone-asar-out');
      zip.writeZip(archivePath);

      await runWorker({ archivePath, destPath });

      // Regular files should be extracted.
      expect(await fs.pathExists(path.join(destPath, 'server.exe'))).toBe(true);
      expect(await fs.pathExists(path.join(destPath, 'config.json'))).toBe(true);

      // .asar file should be skipped.
      expect(await fs.pathExists(path.join(destPath, 'resources', 'app.asar'))).toBe(false);
    });
  });
});

