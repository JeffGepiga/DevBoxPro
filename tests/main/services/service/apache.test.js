import { describe, it, expect } from 'vitest';

const apacheService = require('../../../../src/main/services/service/apache');

describe('service/apache', () => {
  it('treats only inactive standard bindings as stale when ssl falls back', () => {
    expect(apacheService.hasStaleStandardPortBindings('<VirtualHost *:80>\n</VirtualHost>', 80, 444)).toBe(false);
    expect(apacheService.hasStaleStandardPortBindings('<VirtualHost *:443>\n</VirtualHost>', 80, 444)).toBe(true);
    expect(apacheService.hasStaleStandardPortBindings('Listen 0.0.0.0:443', 80, 444)).toBe(true);
    expect(apacheService.hasStaleStandardPortBindings('<VirtualHost *:8084>\n</VirtualHost>', 80, 444)).toBe(false);
  });
});