import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

require('../../../helpers/mockElectronCjs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const fs = require('fs-extra');
const databaseImportExport = require('../../../../src/main/services/database/importExport');

function makeContext() {
  return Object.assign({}, databaseImportExport, {
    managers: { log: { systemWarn: vi.fn(), systemInfo: vi.fn() } },
  });
}

async function runProcessor(input, { chunkSize = 7, options = {} } = {}) {
  const context = makeContext();
  const captured = [];
  const stream = context.createSqlProcessorStream(captured, options);
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  const chunks = [];
  stream.on('data', chunk => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  for (let i = 0; i < buffer.length; i += chunkSize) {
    stream.write(buffer.subarray(i, i + chunkSize));
  }
  stream.end();
  await done;
  return { output: Buffer.concat(chunks).toString('utf8'), captured };
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const DUMP = [
  '-- MySQL dump',
  '/*!40101 SET NAMES utf8mb4 */;',
  'DROP TABLE IF EXISTS `users`;',
  'CREATE TABLE `users` (',
  '  `id` int NOT NULL,',
  '  `first` varchar(20) NOT NULL,',
  '  `full` varchar(50) GENERATED ALWAYS AS (concat(`first`, \' x\')) VIRTUAL,',
  '  `note` text,',
  '  PRIMARY KEY (`id`)',
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
  'LOCK TABLES `users` WRITE;',
  "INSERT INTO `users` VALUES (1,'ann','ann x','a;b'),(2,'bob','bob x','héllo 😀');",
  'UNLOCK TABLES;',
  'CREATE TABLE `posts` (',
  '  `id` int NOT NULL,',
  '  `title` varchar(20)',
  ') ENGINE=InnoDB;',
  "INSERT INTO `posts` VALUES (1,'Ünïcödé ; title');",
  '',
].join('\n');

describe('database/importExport streaming processor', () => {
  it('strips generated columns from CREATE TABLE and matching INSERTs across tiny chunks', async () => {
    const { output, captured } = await runProcessor(DUMP, { chunkSize: 3 });

    expect(captured).toHaveLength(1);
    expect(captured[0].table).toBe('users');
    expect(output).not.toContain('GENERATED ALWAYS');
    expect(output).toContain("INSERT INTO `users` VALUES (1,'ann','a;b'),(2,'bob','héllo 😀');");
    // Untracked tables pass through byte-for-byte (multi-byte chars split across chunks survive).
    expect(output).toContain("INSERT INTO `posts` VALUES (1,'Ünïcödé ; title');");
    expect(output).toContain('UNLOCK TABLES;\nCOMMIT;\n');
  });

  it('passes ordinary dumps through unchanged apart from COMMIT after UNLOCK TABLES', async () => {
    const plain = [
      'CREATE TABLE `t` (`id` int) ENGINE=InnoDB;',
      'LOCK TABLES `t` WRITE;',
      'INSERT INTO `t` VALUES (1),(2);',
      'UNLOCK TABLES;',
      'SELECT 1;',
    ].join('\r\n');

    const { output } = await runProcessor(plain, { chunkSize: 5 });
    expect(output).toBe(plain.replace('UNLOCK TABLES;\r\n', 'UNLOCK TABLES;\r\nCOMMIT;\n'));
  });

  it('injects periodic COMMITs after complete INSERTs but never inside DELIMITER blocks', async () => {
    const sql = [
      'INSERT INTO `a` VALUES (1);',
      'INSERT INTO `a` VALUES',
      '(2),',
      '(3);',
      'DELIMITER ;;',
      'CREATE TRIGGER trg BEFORE INSERT ON a FOR EACH ROW BEGIN',
      'INSERT INTO `log` VALUES (1);',
      'END ;;',
      'DELIMITER ;',
      'INSERT INTO `a` VALUES (4);',
      '',
    ].join('\n');

    const { output } = await runProcessor(sql, { chunkSize: 4, options: { commitEveryBytes: 1 } });
    const lines = output.split('\n');

    expect(lines.slice(0, 6)).toEqual([
      'INSERT INTO `a` VALUES (1);',
      'COMMIT;',
      'INSERT INTO `a` VALUES',
      '(2),',
      '(3);',
      'COMMIT;',
    ]);
    const triggerBlock = output.slice(output.indexOf('DELIMITER ;;'), output.indexOf('DELIMITER ;\n'));
    expect(triggerBlock).not.toContain('COMMIT');
    expect(output.trim().endsWith('INSERT INTO `a` VALUES (4);\nCOMMIT;')).toBe(true);
  });

  it('handles a final statement without a trailing newline', async () => {
    const { output } = await runProcessor('INSERT INTO `x` VALUES (1);', { chunkSize: 100 });
    expect(output).toBe('INSERT INTO `x` VALUES (1);');
  });
});

describe('database/importExport archive sources', () => {
  let tmpDir;
  const sql = 'CREATE TABLE `t` (`id` int) ENGINE=InnoDB;\nINSERT INTO `t` VALUES (1);\n';

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devbox-import-'));
    const nested = path.join(tmpDir, 'src', 'backup-2026', 'db');
    await fs.ensureDir(nested);
    await fs.writeFile(path.join(nested, 'site.sql'), sql);
    await fs.writeFile(path.join(tmpDir, 'src', 'backup-2026', 'README.txt'), 'hello');
    await fs.writeFile(path.join(tmpDir, 'plain.sql.gz'), zlib.gzipSync(sql));

    const tar = require('tar');
    await tar.c({ gzip: true, file: path.join(tmpDir, 'dump.tar.gz'), cwd: path.join(tmpDir, 'src') }, ['backup-2026']);
    await tar.c({ file: path.join(tmpDir, 'dump.tar'), cwd: path.join(tmpDir, 'src') }, ['backup-2026']);

    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    zip.addFile('backup-2026/README.txt', Buffer.from('hello'));
    zip.addFile('__MACOSX/backup-2026/._site.sql', Buffer.from('junk'));
    zip.addFile('backup-2026/db/site.sql', Buffer.from(sql));
    zip.writeZip(path.join(tmpDir, 'dump.zip'));

    const zipGz = new AdmZip();
    zipGz.addFile('nested/folder/site.sql.gz', zlib.gzipSync(sql));
    zipGz.writeZip(path.join(tmpDir, 'dump-gz.zip'));

    const empty = new AdmZip();
    empty.addFile('folder/readme.txt', Buffer.from('nothing here'));
    empty.writeZip(path.join(tmpDir, 'empty.zip'));
  });

  afterAll(async () => {
    await fs.remove(tmpDir);
  });

  it.each([
    ['dump.zip', 'backup-2026/db/site.sql'],
    ['dump-gz.zip', 'nested/folder/site.sql.gz'],
    ['dump.tar.gz', 'backup-2026/db/site.sql'],
    ['dump.tar', 'backup-2026/db/site.sql'],
    ['plain.sql.gz', null],
  ])('streams the SQL out of %s', async (file, entryName) => {
    const context = makeContext();
    const source = await context._openImportSource(path.join(tmpDir, file));
    const text = await readAll(source.stream);
    expect(text).toBe(sql);
    expect(source.state.entryName).toBe(entryName);
    expect(source.state.processedBytes).toBeGreaterThan(0);
    source.destroy();
  });

  it('rejects a zip without any .sql file', async () => {
    const context = makeContext();
    await expect(context._openImportSource(path.join(tmpDir, 'empty.zip'))).rejects.toThrow(/No \.sql/);
  });
});
