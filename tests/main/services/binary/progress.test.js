import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const progressMixin = require('../../../../src/main/services/binary/progress');

function makeContext(overrides = {}) {
  return {
    listeners: new Set(),
    downloadProgress: new Map(),
    lastProgressEmit: new Map(),
    progressThrottleMs: 1000,
    progressMinDelta: 10,
    ...progressMixin,
    ...overrides,
  };
}

describe('binary/progress', () => {
  let timeoutSpy;

  beforeEach(() => {
    vi.restoreAllMocks();
    timeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((callback) => {
      callback();
      return 0;
    });
  });

  afterEach(() => {
    timeoutSpy.mockRestore();
  });

  it('registers and unregisters progress listeners', () => {
    const ctx = makeContext();
    const listener = vi.fn();

    const unsubscribe = ctx.addProgressListener(listener);
    ctx.emitProgress('dl-1', { status: 'starting', progress: 0 });
    unsubscribe();
    ctx.emitProgress('dl-1', { status: 'completed', progress: 100 });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('throttles small intermediate progress updates', () => {
    const ctx = makeContext({ progressThrottleMs: 1000, progressMinDelta: 10 });
    const listener = vi.fn();
    ctx.addProgressListener(listener);

    ctx.emitProgress('dl-2', { status: 'downloading', progress: 5 });
    ctx.emitProgress('dl-2', { status: 'downloading', progress: 6 });
    ctx.emitProgress('dl-2', { status: 'downloading', progress: 20 });

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('returns only active downloads and cleans up completed entries', () => {
    const ctx = makeContext();

    ctx.emitProgress('active', { status: 'downloading', progress: 50 });
    ctx.emitProgress('done', { status: 'completed', progress: 100 });
    ctx.emitProgress('failed', { status: 'error', error: 'boom' });

    expect(ctx.getActiveDownloads()).toEqual({
      active: { status: 'downloading', progress: 50 },
    });
    expect(ctx.downloadProgress.has('done')).toBe(false);
    expect(ctx.downloadProgress.has('failed')).toBe(false);
  });
});
