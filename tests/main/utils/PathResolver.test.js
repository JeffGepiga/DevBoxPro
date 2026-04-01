import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const pathResolver = require('../../../src/main/utils/PathResolver');

describe('PathResolver', () => {
    const exeDir = path.join(os.tmpdir(), 'devboxpro-portable-test');
    const exePath = path.join(exeDir, 'DevBox Pro.exe');
    const userDataPath = path.join(os.tmpdir(), 'devboxpro-electron-userdata');
    const portableDir = path.join(os.tmpdir(), 'devboxpro-electron-builder-portable');
    const mockedHomeDir = path.join(os.tmpdir(), 'devboxpro-pathresolver-home');
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
        fs.rmSync(userDataPath, { recursive: true, force: true });
        fs.rmSync(portableDir, { recursive: true, force: true });
        fs.rmSync(mockedHomeDir, { recursive: true, force: true });
        fs.mkdirSync(exeDir, { recursive: true });
        delete process.env.PORTABLE_EXECUTABLE_DIR;
    });

    afterEach(() => {
        pathResolver.__resetForTests();
        fs.rmSync(exeDir, { recursive: true, force: true });
        fs.rmSync(userDataPath, { recursive: true, force: true });
        fs.rmSync(portableDir, { recursive: true, force: true });
        fs.rmSync(mockedHomeDir, { recursive: true, force: true });
        delete process.env.PORTABLE_EXECUTABLE_DIR;
        vi.restoreAllMocks();
    });

    it('returns null when portable.flag is absent', () => {
        expect(pathResolver.getPortableRoot(app)).toBeNull();
    });

    it('returns the exe directory when portable.flag exists', () => {
        fs.writeFileSync(path.join(exeDir, 'portable.flag'), '');
        expect(pathResolver.getPortableRoot(app)).toBe(exeDir);
    });

    it('returns the portable executable directory when launched from an electron-builder portable app', () => {
        process.env.PORTABLE_EXECUTABLE_DIR = portableDir;
        vi.spyOn(os, 'homedir').mockReturnValue(mockedHomeDir);
        pathResolver.__resetForTests();

        expect(pathResolver.getPortableRoot(app)).toBe(portableDir);
        expect(pathResolver.getDataPath(app)).toBe(path.join(portableDir, 'data'));
        expect(pathResolver.getResourcesPath(app)).toBe(path.join(portableDir, 'resources-user'));
    });

    it('prefers the existing standard install paths over the portable executable directory', () => {
        process.env.PORTABLE_EXECUTABLE_DIR = portableDir;
        fs.mkdirSync(path.join(userDataPath, 'resources'), { recursive: true });
        fs.writeFileSync(path.join(userDataPath, 'resources', 'marker.txt'), 'installed');

        pathResolver.__resetForTests();

        expect(pathResolver.getPortableRoot(app)).toBeNull();
        expect(pathResolver.getDataPath(app)).toBe(path.join(os.homedir(), '.devbox-pro'));
        expect(pathResolver.getResourcesPath(app)).toBe(path.join(userDataPath, 'resources'));
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

    it('ignores stale portable.flag files in the standard Windows install directory', () => {
        const originalLocalAppData = process.env.LOCALAPPDATA;
        const standardInstallRoot = path.join(os.tmpdir(), 'devboxpro-standard-install-root');
        const standardExeDir = path.join(standardInstallRoot, 'Programs', 'DevBox Pro', 'DevBoxPro');
        const standardExePath = path.join(standardExeDir, 'DevBoxPro.exe');
        const standardApp = {
            getPath(name) {
                if (name === 'exe') return standardExePath;
                if (name === 'userData') return userDataPath;
                throw new Error(`Unexpected path request: ${name}`);
            },
        };

        process.env.LOCALAPPDATA = standardInstallRoot;
        fs.mkdirSync(standardExeDir, { recursive: true });
        fs.writeFileSync(path.join(standardExeDir, 'portable.flag'), '');
        pathResolver.__resetForTests();

        try {
            expect(pathResolver.getPortableRoot(standardApp)).toBeNull();
            expect(pathResolver.getDataPath(standardApp)).toBe(path.join(os.homedir(), '.devbox-pro'));
        } finally {
            process.env.LOCALAPPDATA = originalLocalAppData;
            fs.rmSync(standardInstallRoot, { recursive: true, force: true });
            pathResolver.__resetForTests();
        }
    });
});