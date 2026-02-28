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

/** Apply all appearance settings at once */
export function applyAppearanceSettings(settings) {
  applyAccentColor(settings.accentColor || 'sky');
  applyTexture(settings.texture || 'none');
  applyDarkSurface(settings.darkSurface || 'default');
}
