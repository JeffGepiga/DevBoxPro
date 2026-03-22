import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { showAndFocusWindow } = require('../../../src/main/utils/WindowUtils');

describe('WindowUtils', () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', {
            value: originalPlatform,
            configurable: true,
        });
    });

    it('returns false when the window is missing', () => {
        expect(showAndFocusWindow(null)).toBe(false);
    });

    it('restores and focuses minimized windows', () => {
        const app = { focus: vi.fn() };
        const window = {
            isDestroyed: vi.fn(() => false),
            setSkipTaskbar: vi.fn(),
            isMinimized: vi.fn(() => true),
            restore: vi.fn(),
            show: vi.fn(),
            moveTop: vi.fn(),
            focus: vi.fn(),
        };

        expect(showAndFocusWindow(window, app)).toBe(true);
        expect(app.focus).toHaveBeenCalled();
        expect(window.setSkipTaskbar).toHaveBeenCalledWith(false);
        expect(window.restore).toHaveBeenCalledTimes(1);
        expect(window.show).toHaveBeenCalledTimes(1);
        expect(window.moveTop).toHaveBeenCalledTimes(1);
        expect(window.focus).toHaveBeenCalledTimes(1);
    });

    it('toggles always-on-top on Windows to surface the window', () => {
        Object.defineProperty(process, 'platform', {
            value: 'win32',
            configurable: true,
        });

        const window = {
            isDestroyed: vi.fn(() => false),
            isMinimized: vi.fn(() => false),
            show: vi.fn(),
            focus: vi.fn(),
            setAlwaysOnTop: vi.fn(),
        };

        showAndFocusWindow(window);

        expect(window.setAlwaysOnTop).toHaveBeenNthCalledWith(1, true);
        expect(window.setAlwaysOnTop).toHaveBeenNthCalledWith(2, false);
        expect(window.focus).toHaveBeenCalledTimes(1);
    });
});