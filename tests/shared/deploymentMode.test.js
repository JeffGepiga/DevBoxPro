import { describe, it, expect } from 'vitest';
import {
  resolveDeploymentMode,
  isProductionMode,
  PRODUCTION_PHP,
  PRODUCTION_NGINX,
  PRODUCTION_NGINX_HEADERS,
  PRODUCTION_APACHE,
  PRODUCTION_MYSQL,
  PRODUCTION_REDIS,
  PRODUCTION_WORKER,
  PRODUCTION_CONFIGS,
} from '../../src/shared/deploymentMode';
import serviceConfig from '../../src/shared/serviceConfig';

describe('deploymentMode', () => {
  describe('resolveDeploymentMode', () => {
    it('returns project deploymentMode when set to local or production', () => {
      expect(resolveDeploymentMode({ deploymentMode: 'production' }, { deploymentMode: 'local' })).toBe('production');
      expect(resolveDeploymentMode({ deploymentMode: 'local' }, { deploymentMode: 'production' })).toBe('local');
    });

    it('falls back to global setting when project deploymentMode is "global" or unset', () => {
      expect(resolveDeploymentMode({ deploymentMode: 'global' }, { deploymentMode: 'production' })).toBe('production');
      expect(resolveDeploymentMode({}, { deploymentMode: 'production' })).toBe('production');
      expect(resolveDeploymentMode(null, { deploymentMode: 'production' })).toBe('production');
    });

    it('falls back to "local" when neither project nor global specifies a mode', () => {
      expect(resolveDeploymentMode({}, {})).toBe('local');
      expect(resolveDeploymentMode(null, null)).toBe('local');
      expect(resolveDeploymentMode({ deploymentMode: 'global' }, {})).toBe('local');
    });
  });

  describe('isProductionMode', () => {
    it('returns true only when effective mode is production', () => {
      expect(isProductionMode({ deploymentMode: 'production' }, {})).toBe(true);
      expect(isProductionMode({}, { deploymentMode: 'production' })).toBe(true);
      expect(isProductionMode({ deploymentMode: 'local' }, { deploymentMode: 'production' })).toBe(false);
      expect(isProductionMode({}, { deploymentMode: 'local' })).toBe(false);
    });
  });

  describe('production configuration constants', () => {
    it('defines PHP production settings with OPcache enabled and display_errors off', () => {
      expect(PRODUCTION_PHP['display_errors']).toBe('Off');
      expect(PRODUCTION_PHP['opcache.enable']).toBe('1');
      expect(PRODUCTION_PHP['opcache.jit']).toBe('1255');
    });

    it('defines Nginx production directives and security headers', () => {
      expect(PRODUCTION_NGINX.serverTokens).toBe('off');
      expect(PRODUCTION_NGINX.workerConnections).toBe(2048);
      expect(PRODUCTION_NGINX.gzip).toBe(true);
      expect(PRODUCTION_NGINX_HEADERS.some((h) => h.includes('X-Frame-Options'))).toBe(true);
      expect(PRODUCTION_NGINX_HEADERS.some((h) => h.includes('Strict-Transport-Security'))).toBe(true);
    });

    it('defines Apache production directives', () => {
      expect(PRODUCTION_APACHE.serverTokens).toBe('Prod');
      expect(PRODUCTION_APACHE.serverSignature).toBe('Off');
      expect(PRODUCTION_APACHE.headers.some((h) => h.includes('X-Content-Type-Options'))).toBe(true);
    });

    it('defines MySQL production overrides with skip-name-resolve and increased buffer pool', () => {
      expect(PRODUCTION_MYSQL['bind-address']).toBe('127.0.0.1');
      expect(PRODUCTION_MYSQL['skip-name-resolve']).toBe('1');
      expect(PRODUCTION_MYSQL['innodb_buffer_pool_size']).toBe('512M');
    });

    it('defines Redis production overrides with password and memory limits', () => {
      expect(PRODUCTION_REDIS.requirepass).toBeTruthy();
      expect(PRODUCTION_REDIS.maxmemory).toBe('256mb');
      expect(PRODUCTION_REDIS.renameCommands.FLUSHALL).toBe('""');
    });

    it('defines Worker production defaults with 2 workers, retries and timeout', () => {
      expect(PRODUCTION_WORKER.numprocs).toBe(2);
      expect(PRODUCTION_WORKER.tries).toBe(3);
      expect(PRODUCTION_WORKER.timeout).toBe(90);
      expect(PRODUCTION_WORKER.memory).toBe(128);
      expect(PRODUCTION_WORKER.maxJobs).toBe(1000);
    });

    it('bundles all production configs in PRODUCTION_CONFIGS', () => {
      expect(PRODUCTION_CONFIGS.php).toBe(PRODUCTION_PHP);
      expect(PRODUCTION_CONFIGS.nginx).toBe(PRODUCTION_NGINX);
      expect(PRODUCTION_CONFIGS.worker).toBe(PRODUCTION_WORKER);
    });

    it('re-exports production constants via serviceConfig', () => {
      expect(serviceConfig.PRODUCTION_CONFIGS).toEqual(PRODUCTION_CONFIGS);
      expect(serviceConfig.PRODUCTION_WORKER).toEqual(PRODUCTION_WORKER);
    });
  });
});
