/**
 * Reusable fs-extra mock factory for testing modules that perform file I/O.
 *
 * Usage:
 *   vi.mock('fs-extra', () => require('../../tests/helpers/mockFs').createMockFs());
 */
import { vi } from 'vitest';

export function createMockFs(overrides = {}) {
    return {
        ensureDirSync: vi.fn(),
        ensureDir: vi.fn(() => Promise.resolve()),
        pathExists: vi.fn(() => Promise.resolve(false)),
        pathExistsSync: vi.fn(() => false),
        readFile: vi.fn(() => Promise.resolve('')),
        readFileSync: vi.fn(() => ''),
        writeFile: vi.fn(() => Promise.resolve()),
        writeFileSync: vi.fn(),
        readJson: vi.fn(() => Promise.resolve({})),
        readJsonSync: vi.fn(() => ({})),
        writeJson: vi.fn(() => Promise.resolve()),
        writeJsonSync: vi.fn(),
        remove: vi.fn(() => Promise.resolve()),
        removeSync: vi.fn(),
        copy: vi.fn(() => Promise.resolve()),
        copySync: vi.fn(),
        move: vi.fn(() => Promise.resolve()),
        moveSync: vi.fn(),
        mkdirp: vi.fn(() => Promise.resolve()),
        mkdirpSync: vi.fn(),
        stat: vi.fn(() => Promise.resolve({ size: 0, isFile: () => true, isDirectory: () => false })),
        statSync: vi.fn(() => ({ size: 0, isFile: () => true, isDirectory: () => false })),
        existsSync: vi.fn(() => false),
        readdirSync: vi.fn(() => []),
        readdir: vi.fn(() => Promise.resolve([])),
        createWriteStream: vi.fn(() => ({
            write: vi.fn(),
            end: vi.fn(),
            on: vi.fn(),
        })),
        createReadStream: vi.fn(() => ({
            pipe: vi.fn(),
            on: vi.fn(),
        })),
        appendFileSync: vi.fn(),
        appendFile: vi.fn(() => Promise.resolve()),
        unlinkSync: vi.fn(),
        unlink: vi.fn(() => Promise.resolve()),
        renameSync: vi.fn(),
        rename: vi.fn(() => Promise.resolve()),
        ...overrides,
    };
}
