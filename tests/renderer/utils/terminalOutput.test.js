import { describe, expect, it } from 'vitest';

import { normalizeInstallationOutput } from '@/utils/terminalOutput';

describe('normalizeInstallationOutput', () => {
  it('strips ANSI sequences and terminal control bytes', () => {
    const lines = normalizeInstallationOutput('\u001b[90m┌\u001b[39m  Welcome to Nuxt!\u001b[22m\r\n\u001b[90m│\u001b[39m');

    expect(lines).toEqual(['┌  Welcome to Nuxt!', '│']);
  });

  it('keeps only the latest carriage-return progress update in a line', () => {
    const lines = normalizeInstallationOutput('◒  Downloading minimal template\r◐  Downloading minimal template\r◓  Downloading minimal template\r');

    expect(lines).toEqual(['◓  Downloading minimal template']);
  });

  it('preserves meaningful indentation while dropping empty control-only chunks', () => {
    expect(normalizeInstallationOutput('\u001b[?25l\u001b[1G\u001b[J')).toEqual([]);
    expect(normalizeInstallationOutput('   HTTP:  http://demo.test\r\n   HTTPS: https://demo.test')).toEqual([
      '   HTTP:  http://demo.test',
      '   HTTPS: https://demo.test',
    ]);
  });
});