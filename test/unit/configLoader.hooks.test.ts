import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { loadK6Config } from '../../src/utils/configLoader';
import { existsSync, readFileSync } from 'node:fs';

jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedExistsSync = existsSync as unknown as jest.Mock;
const mockedReadFileSync = readFileSync as unknown as jest.Mock;

describe('loadK6Config – hooks configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('parses config with valid hooks (pre and post)', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({
        hooks: {
          preRun: [
            { name: 'setup-db', command: 'bash setup.sh', timeout: 30, continueOnError: true, workingDir: '/opt' },
          ],
          postRun: [
            { name: 'cleanup', command: 'bash teardown.sh' },
          ],
        },
      })
    );

    const cfg = loadK6Config('k6ctl.config.json');

    expect(cfg.hooks.preRun).toHaveLength(1);
    expect(cfg.hooks.preRun[0].name).toBe('setup-db');
    expect(cfg.hooks.preRun[0].command).toBe('bash setup.sh');
    expect(cfg.hooks.preRun[0].timeout).toBe(30);
    expect(cfg.hooks.preRun[0].continueOnError).toBe(true);
    expect(cfg.hooks.preRun[0].workingDir).toBe('/opt');

    expect(cfg.hooks.postRun).toHaveLength(1);
    expect(cfg.hooks.postRun[0].name).toBe('cleanup');
    expect(cfg.hooks.postRun[0].command).toBe('bash teardown.sh');
  });

  test('applies defaults (timeout=60, continueOnError=false)', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({
        hooks: {
          preRun: [
            { name: 'minimal', command: 'echo hi' },
          ],
        },
      })
    );

    const cfg = loadK6Config('k6ctl.config.json');

    const hook = cfg.hooks.preRun[0];
    expect(hook.timeout).toBe(60);
    expect(hook.continueOnError).toBe(false);
    expect(hook.workingDir).toBeUndefined();
  });

  test('rejects hook without name', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({
        hooks: {
          preRun: [
            { command: 'echo hi' },
          ],
        },
      })
    );

    expect(() => loadK6Config('k6ctl.config.json')).toThrow();
  });

  test('rejects hook without command', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({
        hooks: {
          preRun: [
            { name: 'no-cmd' },
          ],
        },
      })
    );

    expect(() => loadK6Config('k6ctl.config.json')).toThrow();
  });

  test('hooks is optional in config', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({
        namespace: 'test-ns',
      })
    );

    const cfg = loadK6Config('k6ctl.config.json');

    expect(cfg.hooks.preRun).toEqual([]);
    expect(cfg.hooks.postRun).toEqual([]);
  });
});
