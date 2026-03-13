import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const pathResolver = require('../../../src/main/utils/PathResolver');

describe('PathResolver', () => {
    const exeDir = path.join(os.tmpdir(), 'devboxpro-portable-test');
    const exePath = path.join(exeDir, 'DevBox Pro.exe');
    const userDataPath = path.join(os.tmpdir(), 'devboxpro-electron-userdata');
    const app = {
        getPath(name) {
            if (name === 'exe') return exePath;
            if (name === 'userData') return userDataPath;
            throw new Error(`Unexpected path request: ${name}`);
        },
    };

    beforeEach(() => {
        pathResolver.__resetForTests();
        fs.rmSync(exeDir, { recursive: true, force: true });
        fs.mkdirSync(exeDir, { recursive: true });
    });

    afterEach(() => {
        pathResolver.__resetForTests();
        fs.rmSync(exeDir, { recursive: true, force: true });
    });

    it('returns null when portable.flag is absent', () => {
        expect(pathResolver.getPortableRoot(app)).toBeNull();
    });

    it('returns the exe directory when portable.flag exists', () => {
        fs.writeFileSync(path.join(exeDir, 'portable.flag'), '');
        expect(pathResolver.getPortableRoot(app)).toBe(exeDir);
    });

    it('returns standard paths when not portable', () => {
        expect(pathResolver.getDataPath(app)).toBe(path.join(os.homedir(), '.devbox-pro'));
        expect(pathResolver.getResourcesPath(app)).toBe(path.join(userDataPath, 'resources'));
        expect(pathResolver.getAppCachePath(app, 'binaries-config.json')).toBe(path.join(userDataPath, 'binaries-config.json'));
    });

    it('returns portable paths when portable.flag exists', () => {
        fs.writeFileSync(path.join(exeDir, 'portable.flag'), '');

        expect(pathResolver.getDataPath(app)).toBe(path.join(exeDir, 'data'));
        expect(pathResolver.getResourcesPath(app)).toBe(path.join(exeDir, 'resources-user'));
        expect(pathResolver.getAppCachePath(app, 'binaries-config.json')).toBe(path.join(exeDir, 'binaries-config.json'));
    });
});