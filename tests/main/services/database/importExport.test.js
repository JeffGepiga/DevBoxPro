import { describe, it, expect, vi } from 'vitest';

require('../../../helpers/mockElectronCjs');
const databaseImportExport = require('../../../../src/main/services/database/importExport');

function makeContext() {
  return {
    managers: { log: { systemWarn: vi.fn() } },
    splitDefinitions: databaseImportExport.splitDefinitions,
    parseValueSets: databaseImportExport.parseValueSets,
    splitValues: databaseImportExport.splitValues,
    removeColumnsFromValues: databaseImportExport.removeColumnsFromValues,
  };
}

describe('database/importExport', () => {
  it('validates expected import file extensions', () => {
    const context = makeContext();

    expect(databaseImportExport.validateFilePath.call(context, 'backup.sql')).toEqual({ valid: true });
    expect(databaseImportExport.validateFilePath.call(context, 'backup.sql.gz')).toEqual({ valid: true });
    expect(databaseImportExport.validateFilePath.call(context, 'backup.txt')).toEqual({
      valid: false,
      error: 'Invalid file type. Only .sql and .sql.gz files are supported.',
    });
  });

  it('blocks path traversal attempts', () => {
    const context = makeContext();

    const result = databaseImportExport.validateFilePath.call(context, '../backup.sql');

    expect(result.valid).toBe(false);
    expect(result.error).toContain('path traversal');
    expect(context.managers.log.systemWarn).toHaveBeenCalledOnce();
  });

  it('splits CREATE TABLE definitions while respecting commas in expressions', () => {
    const context = makeContext();
    const sql = [
      '`id` int NOT NULL',
      '`full_name` varchar(255) NOT NULL',
      '`display_name` varchar(255) GENERATED ALWAYS AS (concat(`first_name`, ",", `last_name`)) STORED',
      'PRIMARY KEY (`id`)',
    ].join(',\n');

    const definitions = databaseImportExport.splitDefinitions.call(context, sql);

    expect(definitions).toHaveLength(4);
    expect(definitions[2]).toContain('concat');
  });

  it('parses and filters VALUES tuples with nested function calls', () => {
    const context = makeContext();
    const valuesSection = "(1,'alpha,beta',NOW(),4),(2,'gamma',CONCAT('x,','y'),8)";

    const parsedSets = databaseImportExport.parseValueSets.call(context, valuesSection);
    const filteredValues = databaseImportExport.removeColumnsFromValues.call(context, valuesSection, [2]);

    expect(parsedSets).toEqual([
      "1,'alpha,beta',NOW(),4",
      "2,'gamma',CONCAT('x,','y'),8",
    ]);
    expect(filteredValues).toBe("(1,'alpha,beta',4),(2,'gamma',8)");
  });

  it('splits individual values without breaking quoted commas', () => {
    const context = makeContext();

    const values = databaseImportExport.splitValues.call(context, "1,'a,b',CONCAT('x,','y'),NULL");

    expect(values).toEqual(['1', "'a,b'", "CONCAT('x,','y')", 'NULL']);
  });

  it('removes generated columns from raw SQL content', () => {
    const sql = [
      'CREATE TABLE `users` (',
      '  `id` int NOT NULL,',
      '  `full_name` varchar(255) GENERATED ALWAYS AS (concat(`first_name`, `last_name`)) STORED,',
      '  PRIMARY KEY (`id`)',
      ');',
    ].join('\n');

    const processed = databaseImportExport.processImportSql(sql);

    expect(processed).not.toContain('GENERATED ALWAYS');
    expect(processed).toContain('PRIMARY KEY');
  });
});