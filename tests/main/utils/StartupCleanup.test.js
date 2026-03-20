import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SpawnUtils = require('../../../src/main/utils/SpawnUtils');
const { cleanupStaleManagedWebServerProcesses } = require('../../../src/main/utils/StartupCleanup');

describe('cleanupStaleManagedWebServerProcesses()', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(SpawnUtils, 'isProcessRunning').mockReturnValue(false);
        vi.spyOn(SpawnUtils, 'killProcessesByPath').mockResolvedValue(undefined);
    });

    it('kills only stale managed web servers that are currently running', async () => {
        const resourcePath = 'C:\\Users\\Jeffrey\\.devbox-pro\\resources';
        const logger = {
            systemInfo: vi.fn(),
            systemWarn: vi.fn(),
        };

        SpawnUtils.isProcessRunning.mockImplementation((processName) => processName === 'nginx.exe');

        const cleaned = await cleanupStaleManagedWebServerProcesses(resourcePath, logger);

        expect(cleaned).toEqual(['nginx']);
        expect(SpawnUtils.killProcessesByPath).toHaveBeenCalledTimes(1);
        expect(SpawnUtils.killProcessesByPath).toHaveBeenCalledWith('nginx.exe', path.join(resourcePath, 'nginx'));
        expect(logger.systemInfo).toHaveBeenCalledWith(
            'Cleaned stale DevBox web server processes on startup',
            { services: ['nginx'] }
        );
        expect(logger.systemWarn).not.toHaveBeenCalled();
    });

    it('returns an empty list when no managed web servers are running', async () => {
        const logger = {
            systemInfo: vi.fn(),
            systemWarn: vi.fn(),
        };

        SpawnUtils.isProcessRunning.mockReturnValue(false);

        const cleaned = await cleanupStaleManagedWebServerProcesses('C:\\Users\\Jeffrey\\.devbox-pro\\resources', logger);

        expect(cleaned).toEqual([]);
        expect(SpawnUtils.killProcessesByPath).not.toHaveBeenCalled();
        expect(logger.systemInfo).not.toHaveBeenCalled();
        expect(logger.systemWarn).not.toHaveBeenCalled();
    });
});