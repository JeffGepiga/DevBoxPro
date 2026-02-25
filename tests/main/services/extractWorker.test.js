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

    it('strips common root folder (e.g. nginx-1.28.0/)', async () => {
      const zip = new AdmZip();
      // All entries share the "nginx-1.28.0/" prefix
      zip.addFile('nginx-1.28.0/conf/nginx.conf', Buffer.from('worker_processes 1;'));
      zip.addFile('nginx-1.28.0/logs/.keep', Buffer.from(''));

      const archivePath = path.join(tmpDir, 'rooted.zip');
      const destPath = path.join(tmpDir, 'rooted-out');
      zip.writeZip(archivePath);

      await runWorker({ archivePath, destPath });

      // Root folder should be stripped
      expect(await fs.pathExists(path.join(destPath, 'conf', 'nginx.conf'))).toBe(true);
    });

    it('does NOT strip root when entries have mixed roots', async () => {
      const zip = new AdmZip();
      zip.addFile('rootA/file1.txt', Buffer.from('A'));
      zip.addFile('rootB/file2.txt', Buffer.from('B'));

      const archivePath = path.join(tmpDir, 'mixed.zip');
      const destPath = path.join(tmpDir, 'mixed-out');
      zip.writeZip(archivePath);

      await runWorker({ archivePath, destPath });

      // Both root folders should be preserved
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
});
