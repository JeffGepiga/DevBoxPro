/**
 * DevBox Pro appearance/theme configuration
 * Defines accent color palettes, background textures, and dark surface variants.
 */

export const COLOR_PALETTES = {
  sky: {
    label: 'Sky Blue',
    preview: '#0ea5e9',
    shades: {
      50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc', 400: '#38bdf8',
      500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1', 800: '#075985', 900: '#0c4a6e', 950: '#082f49',
    },
  },
  indigo: {
    label: 'Indigo',
    preview: '#6366f1',
    shades: {
      50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8',
      500: '#6366f1', 600: '#4f46e5', 700: '#4338ca', 800: '#3730a3', 900: '#312e81', 950: '#1e1b4b',
    },
  },
  violet: {
    label: 'Violet',
    preview: '#8b5cf6',
    shades: {
      50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd', 400: '#a78bfa',
      500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9', 800: '#5b21b6', 900: '#4c1d95', 950: '#2e1065',
    },
  },
  rose: {
    label: 'Rose',
    preview: '#f43f5e',
    shades: {
      50: '#fff1f2', 100: '#ffe4e6', 200: '#fecdd3', 300: '#fda4af', 400: '#fb7185',
      500: '#f43f5e', 600: '#e11d48', 700: '#be123c', 800: '#9f1239', 900: '#881337', 950: '#4c0519',
    },
  },
  pink: {
    label: 'Pink',
    preview: '#ec4899',
    shades: {
      50: '#fdf2f8', 100: '#fce7f3', 200: '#fbcfe8', 300: '#f9a8d4', 400: '#f472b6',
      500: '#ec4899', 600: '#db2777', 700: '#be185d', 800: '#9d174d', 900: '#831843', 950: '#500724',
    },
  },
  amber: {
    label: 'Amber',
    preview: '#f59e0b',
    shades: {
      50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24',
      500: '#f59e0b', 600: '#d97706', 700: '#b45309', 800: '#92400e', 900: '#78350f', 950: '#451a03',
    },
  },
  emerald: {
    label: 'Emerald',
    preview: '#10b981',
    shades: {
      50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399',
      500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b', 950: '#022c22',
    },
  },
  teal: {
    label: 'Teal',
    preview: '#14b8a6',
    shades: {
      50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 300: '#5eead4', 400: '#2dd4bf',
      500: '#14b8a6', 600: '#0d9488', 700: '#0f766e', 800: '#115e59', 900: '#134e4a', 950: '#042f2e',
    },
  },
};

export const TEXTURES = {
  none:       { label: 'None',        description: 'Clean flat background' },
  dots:       { label: 'Dots',        description: 'Subtle dot grid' },
  grid:       { label: 'Grid',        description: 'Fine grid lines' },
  diagonal:   { label: 'Lines',       description: 'Diagonal hatching' },
  circuit:    { label: 'Circuit',     description: 'PCB-style lines' },
};

export const DARK_SURFACES = {
  default: { label: 'Charcoal', bg: '#111827', surface: '#1f2937' },
  slate:   { label: 'Slate',    bg: '#0f172a', surface: '#1e293b' },
  zinc:    { label: 'Zinc',     bg: '#18181b', surface: '#27272a' },
  night:   { label: 'Night',    bg: '#09090b', surface: '#0f0f13' },
};

export const GRADIENT_PRESETS = {
  none: {
    label: 'Clean',
    description: 'Solid background only',
    preview: 'linear-gradient(135deg, #f8fafc, #eef2ff)',
    light: 'none',
    dark: 'none',
    contentLight: 'transparent',
    contentDark: 'transparent',
  },
  dawn: {
    label: 'Dawn',
    description: 'Peach to sky glow',
    preview: 'linear-gradient(135deg, #fff7ed, #fde68a 45%, #dbeafe)',
    light: 'radial-gradient(circle at top left, rgba(251, 191, 36, 0.24), transparent 34%), radial-gradient(circle at top right, rgba(251, 146, 60, 0.22), transparent 28%), linear-gradient(180deg, rgba(255, 251, 235, 0.92), rgba(239, 246, 255, 0.86))',
    dark: 'radial-gradient(circle at top left, rgba(245, 158, 11, 0.18), transparent 32%), radial-gradient(circle at top right, rgba(59, 130, 246, 0.16), transparent 30%), linear-gradient(180deg, rgba(10, 14, 23, 0.98), rgba(17, 24, 39, 0.96))',
    contentLight: 'rgba(255, 252, 247, 0.58)',
    contentDark: 'rgba(7, 12, 20, 0.34)',
  },
  lagoon: {
    label: 'Lagoon',
    description: 'Cool aqua depth',
    preview: 'linear-gradient(135deg, #ecfeff, #a5f3fc 35%, #dbeafe)',
    light: 'radial-gradient(circle at 15% 20%, rgba(45, 212, 191, 0.2), transparent 28%), radial-gradient(circle at 85% 10%, rgba(14, 165, 233, 0.16), transparent 32%), linear-gradient(180deg, rgba(240, 253, 250, 0.92), rgba(239, 246, 255, 0.88))',
    dark: 'radial-gradient(circle at 15% 20%, rgba(20, 184, 166, 0.18), transparent 30%), radial-gradient(circle at 85% 10%, rgba(14, 165, 233, 0.15), transparent 28%), linear-gradient(180deg, rgba(7, 17, 24, 0.98), rgba(15, 23, 42, 0.96))',
    contentLight: 'rgba(248, 253, 254, 0.56)',
    contentDark: 'rgba(6, 16, 24, 0.34)',
  },
  ember: {
    label: 'Ember',
    description: 'Warm studio mood',
    preview: 'linear-gradient(135deg, #fff1f2, #fdba74 40%, #fecdd3)',
    light: 'radial-gradient(circle at 12% 18%, rgba(239, 68, 68, 0.18), transparent 30%), radial-gradient(circle at 88% 12%, rgba(249, 115, 22, 0.18), transparent 32%), linear-gradient(180deg, rgba(255, 247, 237, 0.94), rgba(255, 241, 242, 0.88))',
    dark: 'radial-gradient(circle at 12% 18%, rgba(220, 38, 38, 0.17), transparent 30%), radial-gradient(circle at 88% 12%, rgba(234, 88, 12, 0.16), transparent 32%), linear-gradient(180deg, rgba(23, 10, 10, 0.98), rgba(31, 20, 20, 0.96))',
    contentLight: 'rgba(255, 248, 245, 0.58)',
    contentDark: 'rgba(19, 10, 10, 0.35)',
  },
  forest: {
    label: 'Forest',
    description: 'Mossy green wash',
    preview: 'linear-gradient(135deg, #ecfdf5, #86efac 38%, #dcfce7)',
    light: 'radial-gradient(circle at 18% 18%, rgba(34, 197, 94, 0.17), transparent 28%), radial-gradient(circle at 82% 12%, rgba(16, 185, 129, 0.15), transparent 30%), linear-gradient(180deg, rgba(240, 253, 244, 0.94), rgba(236, 253, 245, 0.88))',
    dark: 'radial-gradient(circle at 18% 18%, rgba(22, 163, 74, 0.15), transparent 28%), radial-gradient(circle at 82% 12%, rgba(5, 150, 105, 0.13), transparent 30%), linear-gradient(180deg, rgba(10, 18, 14, 0.98), rgba(17, 24, 19, 0.96))',
    contentLight: 'rgba(246, 253, 248, 0.56)',
    contentDark: 'rgba(8, 16, 12, 0.34)',
  },
  graphite: {
    label: 'Graphite',
    description: 'Neutral studio fade',
    preview: 'linear-gradient(135deg, #f8fafc, #e5e7eb 42%, #ede9fe)',
    light: 'radial-gradient(circle at 15% 15%, rgba(148, 163, 184, 0.16), transparent 28%), radial-gradient(circle at 85% 10%, rgba(99, 102, 241, 0.08), transparent 30%), linear-gradient(180deg, rgba(248, 250, 252, 0.95), rgba(241, 245, 249, 0.9))',
    dark: 'radial-gradient(circle at 15% 15%, rgba(71, 85, 105, 0.18), transparent 30%), radial-gradient(circle at 85% 10%, rgba(99, 102, 241, 0.1), transparent 28%), linear-gradient(180deg, rgba(9, 9, 11, 0.98), rgba(17, 24, 39, 0.96))',
    contentLight: 'rgba(248, 250, 252, 0.54)',
    contentDark: 'rgba(9, 10, 15, 0.34)',
  },
};

export const SURFACE_STYLES = {
  soft: {
    label: 'Soft',
    description: 'Subtle depth and glow',
    shadow: '0 1px 2px rgba(15, 23, 42, 0.05), 0 12px 28px rgba(15, 23, 42, 0.06)',
    blur: 'blur(0px)',
    lightBg: 'rgba(255, 255, 255, 0.94)',
    darkBg: 'rgba(31, 41, 55, 0.88)',
    lightBorder: 'rgba(226, 232, 240, 0.9)',
    darkBorder: 'rgba(75, 85, 99, 0.82)',
    shellLightBg: 'rgba(255, 255, 255, 0.82)',
    shellDarkBg: 'rgba(17, 24, 39, 0.82)',
    shellLightBorder: 'rgba(226, 232, 240, 0.92)',
    shellDarkBorder: 'rgba(75, 85, 99, 0.84)',
    shellBlur: 'blur(8px)',
  },
  lifted: {
    label: 'Lifted',
    description: 'Higher contrast panels',
    shadow: '0 10px 30px rgba(15, 23, 42, 0.1), 0 2px 8px rgba(15, 23, 42, 0.08)',
    blur: 'blur(0px)',
    lightBg: 'rgba(255, 255, 255, 0.98)',
    darkBg: 'rgba(17, 24, 39, 0.94)',
    lightBorder: 'rgba(203, 213, 225, 0.95)',
    darkBorder: 'rgba(71, 85, 105, 0.9)',
    shellLightBg: 'rgba(255, 255, 255, 0.94)',
    shellDarkBg: 'rgba(15, 23, 42, 0.9)',
    shellLightBorder: 'rgba(203, 213, 225, 0.95)',
    shellDarkBorder: 'rgba(71, 85, 105, 0.9)',
    shellBlur: 'blur(10px)',
  },
  glass: {
    label: 'Glass',
    description: 'Translucent frosted panels',
    shadow: '0 18px 45px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.25)',
    blur: 'blur(18px)',
    lightBg: 'rgba(255, 255, 255, 0.72)',
    darkBg: 'rgba(17, 24, 39, 0.62)',
    lightBorder: 'rgba(255, 255, 255, 0.72)',
    darkBorder: 'rgba(148, 163, 184, 0.22)',
    shellLightBg: 'rgba(255, 255, 255, 0.58)',
    shellDarkBg: 'rgba(15, 23, 42, 0.46)',
    shellLightBorder: 'rgba(255, 255, 255, 0.68)',
    shellDarkBorder: 'rgba(148, 163, 184, 0.2)',
    shellBlur: 'blur(24px)',
  },
};

export const RADIUS_PRESETS = {
  sharp: {
    label: 'Sharp',
    description: 'Tighter, flatter geometry',
    card: '14px',
    control: '10px',
    button: '10px',
  },
  rounded: {
    label: 'Rounded',
    description: 'Balanced default curves',
    card: '18px',
    control: '12px',
    button: '12px',
  },
  pill: {
    label: 'Pill',
    description: 'More playful soft corners',
    card: '24px',
    control: '18px',
    button: '18px',
  },
};

/** Apply an accent color palette by overriding CSS custom properties on :root */
export function applyAccentColor(colorKey) {
  const palette = COLOR_PALETTES[colorKey];
  if (!palette) return;
  Object.entries(palette.shades).forEach(([shade, value]) => {
    document.documentElement.style.setProperty(`--color-primary-${shade}`, value);
  });
}

/** Apply a background texture class to <body> */
export function applyTexture(textureKey) {
  const body = document.body;
  Object.keys(TEXTURES).forEach((t) => {
    if (t !== 'none') body.classList.remove(`texture-${t}`);
  });
  if (textureKey && textureKey !== 'none') {
    body.classList.add(`texture-${textureKey}`);
  }
}

/** Apply dark-mode surface variant via data attribute on <html> */
export function applyDarkSurface(surfaceKey) {
  document.documentElement.setAttribute('data-surface', surfaceKey || 'default');
  const surface = DARK_SURFACES[surfaceKey] || DARK_SURFACES.default;
  document.documentElement.style.setProperty('--dvp-dark-bg', surface.bg);
  document.documentElement.style.setProperty('--dvp-dark-surface', surface.surface);
}

export function applyGradientPreset(gradientKey) {
  const preset = GRADIENT_PRESETS[gradientKey] || GRADIENT_PRESETS.none;
  document.documentElement.style.setProperty('--dvp-app-gradient-light', preset.light);
  document.documentElement.style.setProperty('--dvp-app-gradient-dark', preset.dark);
  document.documentElement.style.setProperty('--dvp-content-overlay-light', preset.contentLight);
  document.documentElement.style.setProperty('--dvp-content-overlay-dark', preset.contentDark);
}

export function applySurfaceStyle(styleKey) {
  const resolvedStyleKey = SURFACE_STYLES[styleKey] ? styleKey : 'soft';
  const style = SURFACE_STYLES[resolvedStyleKey];
  document.documentElement.setAttribute('data-surface-style', resolvedStyleKey);
  document.documentElement.style.setProperty('--dvp-card-shadow', style.shadow);
  document.documentElement.style.setProperty('--dvp-card-blur', style.blur);
  document.documentElement.style.setProperty('--dvp-card-bg-light', style.lightBg);
  document.documentElement.style.setProperty('--dvp-card-bg-dark', style.darkBg);
  document.documentElement.style.setProperty('--dvp-card-border-light', style.lightBorder);
  document.documentElement.style.setProperty('--dvp-card-border-dark', style.darkBorder);
  document.documentElement.style.setProperty('--dvp-shell-bg-light', style.shellLightBg);
  document.documentElement.style.setProperty('--dvp-shell-bg-dark', style.shellDarkBg);
  document.documentElement.style.setProperty('--dvp-shell-border-light', style.shellLightBorder);
  document.documentElement.style.setProperty('--dvp-shell-border-dark', style.shellDarkBorder);
  document.documentElement.style.setProperty('--dvp-shell-blur', style.shellBlur);
}

export function applyRadiusPreset(radiusKey) {
  const radius = RADIUS_PRESETS[radiusKey] || RADIUS_PRESETS.rounded;
  document.documentElement.style.setProperty('--dvp-radius-card', radius.card);
  document.documentElement.style.setProperty('--dvp-radius-control', radius.control);
  document.documentElement.style.setProperty('--dvp-radius-button', radius.button);
}

/** Apply all appearance settings at once */
export function applyAppearanceSettings(settings) {
  applyAccentColor(settings.accentColor || 'sky');
  applyGradientPreset(settings.gradientPreset || 'none');
  applyTexture(settings.texture || 'none');
  applySurfaceStyle(settings.surfaceStyle || 'soft');
  applyRadiusPreset(settings.radiusPreset || 'rounded');
  applyDarkSurface(settings.darkSurface || 'default');
}
