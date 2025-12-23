/**
 * Application version configuration
 * Single source of truth: package.json (injected at build time by Vite)
 * 
 * To update the version, only change it in the root package.json
 */

// These globals are injected by Vite at build time from package.json
// See vite.config.js for the define configuration
export const APP_VERSION = __APP_VERSION__;
export const APP_NAME = 'DevBox Pro';

export default {
    version: APP_VERSION,
    name: APP_NAME,
};
