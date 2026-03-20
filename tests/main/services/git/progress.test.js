import { describe, it, expect, vi } from 'vitest';

const gitProgress = require('../../../../src/main/services/git/progress');

describe('git/progress', () => {
  it('registers listeners and emits progress payloads', () => {
    const context = { progressListeners: new Set() };
    const listener = vi.fn();

    gitProgress.onProgress.call(context, listener);
    gitProgress.emitProgress.call(context, { percent: 25, text: 'Receiving objects' });

    expect(listener).toHaveBeenCalledWith({ percent: 25, text: 'Receiving objects' });
  });

  it('returns a cleanup function that unregisters listeners', () => {
    const context = { progressListeners: new Set() };
    const listener = vi.fn();

    const cleanup = gitProgress.onProgress.call(context, listener);
    cleanup();
    gitProgress.emitProgress.call(context, { percent: 90 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('swallows listener exceptions', () => {
    const context = { progressListeners: new Set([() => { throw new Error('boom'); }]) };

    expect(() => gitProgress.emitProgress.call(context, { percent: 50 })).not.toThrow();
  });
});