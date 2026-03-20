import { describe, it, expect, vi, afterEach } from 'vitest';

require('../../../helpers/mockElectronCjs');
const fs = require('fs-extra');
const mongo = require('../../../../src/main/services/database/mongo');

function makeContext(settings = {}) {
  return {
    configStore: {
      get: vi.fn((key, def) => key === 'settings' ? settings : def),
    },
    dbConfig: {
      host: '127.0.0.1',
    },
    getDbClientPath: vi.fn(() => 'C:/resources/mongosh.exe'),
    getActualPort: vi.fn(() => 27017),
  };
}

describe('database/mongo', () => {
  const originalPlaywright = process.env.PLAYWRIGHT_TEST;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalPlaywright === undefined) {
      delete process.env.PLAYWRIGHT_TEST;
    } else {
      process.env.PLAYWRIGHT_TEST = originalPlaywright;
    }
  });

  it('tracks mocked Mongo databases in Playwright mode', async () => {
    process.env.PLAYWRIGHT_TEST = 'true';
    const context = makeContext();

    await mongo._runMongoQuery.call(context, 'db.getSiblingDB("analytics").getCollection("_devbox_meta").updateOne({_id:"init"},{$set:{createdAt:new Date()}},{upsert:true})');
    const names = await mongo._runMongoQuery.call(context, 'db.adminCommand({listDatabases:1}).databases.forEach(d=>print(d.name))');
    await mongo._runMongoQuery.call(context, 'db.dropDatabase()', 'analytics');
    const namesAfterDrop = await mongo._runMongoQuery.call(context, 'db.adminCommand({listDatabases:1}).databases.forEach(d=>print(d.name))');

    expect(names).toContain('analytics');
    expect(namesAfterDrop).not.toContain('analytics');
  });

  it('returns mocked size output for stats queries in Playwright mode', async () => {
    process.env.PLAYWRIGHT_TEST = 'true';
    const context = makeContext();

    const lines = await mongo._runMongoQuery.call(context, 'print(db.stats().dataSize)');

    expect(lines).toEqual(['0']);
  });

  it('rejects when the mongo client binary is missing', async () => {
    process.env.PLAYWRIGHT_TEST = 'false';
    const context = makeContext();
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    await expect(mongo._runMongoQuery.call(context, 'db.stats()')).rejects.toThrow(
      'mongosh not found at C:/resources/mongosh.exe. Please install the MongoDB binary from the Binaries page.'
    );
  });
});