import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { ScriptService } from '../../src/services/script.service';
import { existsSync } from 'fs';
import type { ExecFn } from '../../src/types/script.types';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedExistsSync = existsSync as unknown as jest.Mock;

describe('ScriptService', () => {
  let mockExec: jest.MockedFunction<ExecFn>;
  let service: ScriptService;

  beforeEach(() => {
    jest.resetAllMocks();
    mockExec = jest.fn<ExecFn>();
    service = new ScriptService(mockExec);
  });

  describe('archiveTest', () => {
    test('throws error if script does not exist', async () => {
      mockedExistsSync.mockReturnValue(false);

      await expect(service.archiveTest('/path/to/script.js'))
        .rejects.toThrow('Script file not found at path: /path/to/script.js');
    });

    test('throws error if output directory does not exist', async () => {
      mockedExistsSync
        .mockReturnValueOnce(true)   // script exists
        .mockReturnValueOnce(false); // output dir missing

      await expect(service.archiveTest('/path/to/script.js', '/fake/output'))
        .rejects.toThrow('Output directory does not exist at path: /fake/output');
    });

    test('throws error if k6 is not installed', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockExec.mockRejectedValue(new Error('command not found: k6'));

      await expect(service.archiveTest('/path/to/script.js'))
        .rejects.toThrow('k6 is not installed. Please install k6 to archive scripts.');
    });

    test('throws error if archive file was not created', async () => {
      mockedExistsSync
        .mockReturnValueOnce(true)   // script exists
        .mockReturnValueOnce(false); // archive file not created after command
      mockExec.mockResolvedValue({ stdout: '', stderr: 'k6 internal error' });

      await expect(service.archiveTest('/path/to/script.js'))
        .rejects.toThrow('Failed to archive the script:');
    });

    test('returns correct ArchiveResult without output directory', async () => {
      mockedExistsSync
        .mockReturnValueOnce(true)  // script exists
        .mockReturnValueOnce(true); // archive file created
      mockExec.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await service.archiveTest('/path/to/script.js');

      expect(result.scriptPath).toBe('/path/to/script.js');
      expect(result.scriptFilename).toBe('script.js');
      expect(result.archiveFilename).toMatch(/^archive-script-\d+\.tar$/);
      expect(result.archivePath).toMatch(/^archive-script-\d+\.tar$/);
    });

    test('returns ArchiveResult with the specified output directory', async () => {
      mockedExistsSync
        .mockReturnValueOnce(true)  // script exists
        .mockReturnValueOnce(true)  // output dir exists
        .mockReturnValueOnce(true); // archive file created
      mockExec.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await service.archiveTest('/path/to/script.js', '/output/dir');

      expect(result.archivePath).toMatch(/^\/output\/dir[/\\]archive-script-\d+\.tar$/);
    });

    test('calls k6 version and then the archive command', async () => {
      mockedExistsSync
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);
      mockExec.mockResolvedValue({ stdout: '', stderr: '' });

      await service.archiveTest('/path/to/script.js');

      expect(mockExec).toHaveBeenCalledTimes(2);
      expect(mockExec).toHaveBeenNthCalledWith(1, 'k6 version');
      expect((mockExec.mock.calls[1][0] as string)).toMatch(/^k6 archive -v -O .+ \/path\/to\/script\.js$/);
    });

    test('sanitizes underscores in script name', async () => {
      mockedExistsSync
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);
      mockExec.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await service.archiveTest('/path/to/my_script_v2.js');

      expect(result.archiveFilename).toMatch(/^archive-my-script-v2-\d+\.tar$/);
    });
  });
});
