import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

const { MigrationManager } = require('../../../src/main/services/MigrationManager');

describe('MigrationManager legacy install migration', () => {
    const tempRoots = [];
    const originalLocalAppData = process.env.LOCALAPPDATA;
    const originalProgramFiles = process.env.ProgramFiles;
    const originalProgramFilesX86 = process.env['ProgramFiles(x86)'];

    afterEach(async () => {
        process.env.LOCALAPPDATA = originalLocalAppData;
        process.env.ProgramFiles = originalProgramFiles;
        process.env['ProgramFiles(x86)'] = originalProgramFilesX86;

        while (tempRoots.length > 0) {
            const root = tempRoots.pop();
            await fs.remove(root);
        }
    });

    it('migrates legacy install-local data and binaries into the standard paths', async () => {
        const tempRoot = path.join(os.tmpdir(), `devboxpro-legacy-${Date.now()}`);
        tempRoots.push(tempRoot);

        const localProgramsRoot = path.join(tempRoot, 'LocalAppData');
        const oldInstallRoot = path.join(localProgramsRoot, 'Programs', 'DevBox Pro');
        const newDataPath = path.join(tempRoot, '.devbox-pro');
        const newResourcesPath = path.join(tempRoot, 'Roaming', 'devbox-pro', 'resources');

        process.env.LOCALAPPDATA = localProgramsRoot;
        process.env.ProgramFiles = path.join(tempRoot, 'ProgramFiles');
        process.env['ProgramFiles(x86)'] = path.join(tempRoot, 'ProgramFilesX86');

        await fs.outputFile(path.join(oldInstallRoot, 'data', 'devbox-pro-config.json'), '{"projects":[]}');
        await fs.outputFile(path.join(oldInstallRoot, 'data', 'mysql', '8.4', 'data', 'ibdata1'), 'mysql-data');
        await fs.outputFile(path.join(oldInstallRoot, 'resources-user', 'nginx', '1.28', 'win', 'nginx.exe'), 'binary');

        const fakeApp = {
            getPath(name) {
                if (name === 'exe') {
                    return path.join(tempRoot, 'dev', 'electron.exe');
                }
                if (name === 'userData') {
                    return path.join(tempRoot, 'Roaming', 'devbox-pro');
                }
                return tempRoot;
            }
        };

        const pathResolver = {
            getPortableRoot: () => null,
            getDataPath: () => newDataPath,
            getResourcesPath: () => newResourcesPath,
        };

        const migration = new MigrationManager(pathResolver, fakeApp);

        expect(await migration.needsLegacyInstallMigration()).toBe(true);

        const migrated = await migration.migrateLegacyInstallData();

        expect(migrated).toBe(true);
        expect(await fs.pathExists(path.join(newDataPath, 'devbox-pro-config.json'))).toBe(true);
        expect(await fs.pathExists(path.join(newDataPath, 'mysql', '8.4', 'data', 'ibdata1'))).toBe(true);
        expect(await fs.pathExists(path.join(newResourcesPath, 'nginx', '1.28', 'win', 'nginx.exe'))).toBe(true);
        expect(await migration.needsConfigRegeneration()).toBe(true);
    });

    it('migrates legacy userData/data into the new standard data path', async () => {
        const tempRoot = path.join(os.tmpdir(), `devboxpro-userdata-${Date.now()}`);
        tempRoots.push(tempRoot);

        const userDataRoot = path.join(tempRoot, 'Roaming', 'devbox-pro');
        const newDataPath = path.join(tempRoot, '.devbox-pro');
        const newResourcesPath = path.join(userDataRoot, 'resources');

        await fs.outputFile(path.join(userDataRoot, 'data', 'projects.json'), '[]');
        await fs.outputFile(path.join(userDataRoot, 'data', 'mysql', '8.4', 'data', 'ibdata1'), 'mysql-data');

        const fakeApp = {
            getPath(name) {
                if (name === 'exe') {
                    return path.join(tempRoot, 'dev', 'electron.exe');
                }
                if (name === 'userData') {
                    return userDataRoot;
                }
                return tempRoot;
            }
        };

        const pathResolver = {
            getPortableRoot: () => null,
            getDataPath: () => newDataPath,
            getResourcesPath: () => newResourcesPath,
        };

        const migration = new MigrationManager(pathResolver, fakeApp);

        expect(await migration.needsLegacyInstallMigration()).toBe(true);

        const migrated = await migration.migrateLegacyInstallData();

        expect(migrated).toBe(true);
        expect(await fs.pathExists(path.join(newDataPath, 'projects.json'))).toBe(true);
        expect(await fs.pathExists(path.join(newDataPath, 'mysql', '8.4', 'data', 'ibdata1'))).toBe(true);
    });

    it('does not repeat the legacy install migration after the marker is written', async () => {
        const tempRoot = path.join(os.tmpdir(), `devboxpro-legacy-marker-${Date.now()}`);
        tempRoots.push(tempRoot);

        const newDataPath = path.join(tempRoot, '.devbox-pro');
        const newResourcesPath = path.join(tempRoot, 'Roaming', 'devbox-pro', 'resources');

        const fakeApp = {
            getPath(name) {
                if (name === 'exe') {
                    return path.join(tempRoot, 'dev', 'electron.exe');
                }
                if (name === 'userData') {
                    return path.join(tempRoot, 'Roaming', 'devbox-pro');
                }
                return tempRoot;
            }
        };

        const pathResolver = {
            getPortableRoot: () => null,
            getDataPath: () => newDataPath,
            getResourcesPath: () => newResourcesPath,
        };

        const migration = new MigrationManager(pathResolver, fakeApp);
        await migration.markLegacyInstallMigrationDone();

        expect(await migration.needsLegacyInstallMigration()).toBe(false);
    });
});