import { describe, it, expect, vi } from 'vitest';

const compatibilityRules = require('../../../../src/main/services/compatibility/rules');

function makeContext() {
  return {
    rules: [],
    frameworkRequirements: {
      laravel: {
        '10': { phpMin: '8.1' },
        '11': { phpMin: '8.2' },
      },
    },
    managers: {},
    compareVersions: compatibilityRules.compareVersions,
    getFreshFrameworkVersion: compatibilityRules.getFreshFrameworkVersion,
    getConfigValue: compatibilityRules.getConfigValue,
    evaluateCondition: compatibilityRules.evaluateCondition,
    interpolateMessage: compatibilityRules.interpolateMessage,
    createRuleChecker: compatibilityRules.createRuleChecker,
    normalizeConfig: compatibilityRules.normalizeConfig,
    checkCompatibility: compatibilityRules.checkCompatibility,
  };
}

describe('compatibility/rules', () => {
  it('normalizes flattened compatibility payloads', () => {
    const context = makeContext();

    const normalized = compatibilityRules.normalizeConfig.call(context, {
      projectType: 'laravel',
      phpVersion: '8.1',
      mysqlVersion: '5.7',
      nodejsVersion: '22',
      installFresh: true,
    });

    expect(normalized.type).toBe('laravel');
    expect(normalized.services.mysql).toBe('5.7');
    expect(normalized.nodeVersion).toBe('22');
    expect(normalized.frameworkVersion).toBe('11');
  });

  it('evaluates explicit comparison operators semantically', () => {
    const context = makeContext();

    expect(compatibilityRules.evaluateCondition.call(context, '8.1', { lt: '8.2' })).toBe(true);
    expect(compatibilityRules.evaluateCondition.call(context, '8.2', { lt: '8.2' })).toBe(false);
    expect(compatibilityRules.evaluateCondition.call(context, '8.2', { gte: '8.2' })).toBe(true);
  });

  it('creates executable rule checkers with interpolated messages', () => {
    const context = makeContext();
    const rule = {
      id: 'laravel11-php-version',
      name: 'Laravel 11 PHP Requirements',
      conditions: {
        projectType: { exact: 'laravel' },
        frameworkVersion: { exact: '11' },
        phpVersion: { lt: '8.2' },
      },
      result: {
        level: 'warning',
        message: 'Laravel 11 requires PHP 8.2 or higher. PHP {phpVersion} selected.',
        suggestion: 'Upgrade PHP.',
      },
    };

    const checker = compatibilityRules.createRuleChecker.call(context, rule);
    const result = checker({
      type: 'laravel',
      frameworkVersion: '11',
      phpVersion: '8.1',
      services: {},
    });

    expect(result).toEqual({
      level: 'warning',
      message: 'Laravel 11 requires PHP 8.2 or higher. PHP 8.1 selected.',
      suggestion: 'Upgrade PHP.',
    });
  });
});