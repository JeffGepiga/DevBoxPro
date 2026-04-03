import { describe, it, expect } from 'vitest';

const nginxService = require('../../../../src/main/services/service/nginx');

describe('service/nginx', () => {
    it('detects stale alternate-version vhosts that still bind standard ports with explicit host prefixes', () => {
        expect(nginxService.hasStandardPortListenDirective('server {\n    listen 0.0.0.0:443 ssl;\n}')).toBe(true);
        expect(nginxService.hasStandardPortListenDirective('server {\n    listen 0.0.0.0:80 default_server;\n}')).toBe(true);
        expect(nginxService.hasStandardPortListenDirective('server {\n    listen 0.0.0.0:8445 ssl http2;\n}')).toBe(false);
        expect(nginxService.hasStandardPortListenDirective('server {\n    listen 8083;\n}')).toBe(false);
    });

    it('treats only inactive standard bindings as stale when ssl falls back', () => {
        expect(nginxService.hasStaleStandardPortListenDirective('server {\n    listen 0.0.0.0:80 default_server;\n}', 80, 8443)).toBe(false);
        expect(nginxService.hasStaleStandardPortListenDirective('server {\n    listen 443 ssl;\n}', 80, 8443)).toBe(true);
        expect(nginxService.hasStaleStandardPortListenDirective('server {\n    listen 8443 ssl;\n}', 80, 8443)).toBe(false);
    });
});