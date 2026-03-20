import { describe, expect, it, beforeEach } from 'vitest';
import { applyGradientPreset, applySurfaceStyle } from '../../../src/renderer/src/utils/themeConfig';

describe('themeConfig surface styles', () => {
    beforeEach(() => {
        document.documentElement.removeAttribute('data-surface-style');
        document.documentElement.removeAttribute('style');
    });

    it('applies glass shell and card variables', () => {
        applySurfaceStyle('glass');

        expect(document.documentElement.getAttribute('data-surface-style')).toBe('glass');
        expect(document.documentElement.style.getPropertyValue('--dvp-card-blur')).toBe('blur(18px)');
        expect(document.documentElement.style.getPropertyValue('--dvp-shell-blur')).toBe('blur(24px)');
        expect(document.documentElement.style.getPropertyValue('--dvp-shell-bg-dark')).toBe('rgba(15, 23, 42, 0.46)');
    });

    it('falls back to soft when the style key is unknown', () => {
        applySurfaceStyle('missing');

        expect(document.documentElement.getAttribute('data-surface-style')).toBe('soft');
        expect(document.documentElement.style.getPropertyValue('--dvp-card-blur')).toBe('blur(0px)');
        expect(document.documentElement.style.getPropertyValue('--dvp-shell-blur')).toBe('blur(8px)');
    });

    it('applies content scrim variables for gradient readability', () => {
        applyGradientPreset('dawn');

        expect(document.documentElement.style.getPropertyValue('--dvp-content-overlay-light')).toBe('rgba(255, 252, 247, 0.58)');
        expect(document.documentElement.style.getPropertyValue('--dvp-content-overlay-dark')).toBe('rgba(7, 12, 20, 0.34)');
    });
});