import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { exec } from 'child_process';
import { HooksService } from '../../src/services/hooks.service';
import type { HookContext, HookResult } from '../../src/services/hooks.service';
import type { HookDefinition } from '../../src/types/config.types';

jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedExec = exec as unknown as jest.Mock;

describe('HooksService', () => {
  let service: HooksService;

  const baseContext: HookContext = {
    scriptPath: '/scripts/test.js',
    namespace: 'perf',
    parallelism: 4,
    phase: 'preRun',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    service = new HooksService();
  });

  /** Helper: make the mocked exec invoke its callback immediately. */
  function mockExecSuccess(stdout = '', stderr = '') {
    mockedExec.mockImplementation((...args: unknown[]) => {
      const cb = args[2] as Function;
      cb(null, stdout, stderr);
      return {} as any;
    });
  }

  function mockExecFailure(errorOverrides: Record<string, unknown> = {}) {
    mockedExec.mockImplementation((...args: unknown[]) => {
      const cb = args[2] as Function;
      const err = Object.assign(new Error('command failed'), errorOverrides);
      cb(err, '', '');
      return {} as any;
    });
  }

  // -----------------------------------------------------------------------

  test('executes hooks in sequential order', async () => {
    const executionOrder: string[] = [];

    mockedExec.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      const cb = args[2] as Function;
      executionOrder.push(cmd);
      cb(null, '', '');
      return {} as any;
    });

    const hooks: HookDefinition[] = [
      { name: 'first', command: 'echo first' },
      { name: 'second', command: 'echo second' },
      { name: 'third', command: 'echo third' },
    ];

    await service.executeHooks(hooks, baseContext);

    expect(executionOrder).toEqual(['echo first', 'echo second', 'echo third']);
  });

  test('injects correct environment variables for preRun', async () => {
    mockExecSuccess();

    const hooks: HookDefinition[] = [{ name: 'env-check', command: 'printenv' }];
    await service.executeHooks(hooks, baseContext);

    const callOpts = mockedExec.mock.calls[0][1] as { env: Record<string, string> };
    expect(callOpts.env.K6CTL_SCRIPT_PATH).toBe('/scripts/test.js');
    expect(callOpts.env.K6CTL_NAMESPACE).toBe('perf');
    expect(callOpts.env.K6CTL_PARALLELISM).toBe('4');
    expect(callOpts.env.K6CTL_HOOK_PHASE).toBe('preRun');
    expect(callOpts.env.K6CTL_TESTRUN_NAME).toBeUndefined();
  });

  test('injects K6CTL_TESTRUN_NAME for postRun', async () => {
    mockExecSuccess();

    const postRunContext: HookContext = {
      ...baseContext,
      phase: 'postRun',
      testRunName: 'run-abc-123',
    };

    const hooks: HookDefinition[] = [{ name: 'post-hook', command: 'echo done' }];
    await service.executeHooks(hooks, postRunContext);

    const callOpts = mockedExec.mock.calls[0][1] as { env: Record<string, string> };
    expect(callOpts.env.K6CTL_HOOK_PHASE).toBe('postRun');
    expect(callOpts.env.K6CTL_TESTRUN_NAME).toBe('run-abc-123');
  });

  test('aborts if a hook fails and continueOnError=false', async () => {
    let callCount = 0;
    mockedExec.mockImplementation((...args: unknown[]) => {
      const cb = args[2] as Function;
      callCount++;
      if (callCount === 1) {
        cb(new Error('boom'), '', '');
      } else {
        cb(null, '', '');
      }
      return {} as any;
    });

    const hooks: HookDefinition[] = [
      { name: 'will-fail', command: 'exit 1', continueOnError: false },
      { name: 'should-not-run', command: 'echo ok' },
    ];

    await expect(service.executeHooks(hooks, baseContext))
      .rejects.toThrow("Hook 'will-fail' failed: boom");

    // Second hook should never have been called
    expect(callCount).toBe(1);
  });

  test('continues if a hook fails and continueOnError=true', async () => {
    let callCount = 0;
    mockedExec.mockImplementation((...args: unknown[]) => {
      const cb = args[2] as Function;
      callCount++;
      if (callCount === 1) {
        cb(new Error('non-fatal'), '', '');
      } else {
        cb(null, '', '');
      }
      return {} as any;
    });

    const hooks: HookDefinition[] = [
      { name: 'soft-fail', command: 'exit 1', continueOnError: true },
      { name: 'next-hook', command: 'echo ok' },
    ];

    const results = await service.executeHooks(hooks, baseContext);

    expect(callCount).toBe(2);
    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(false);
    expect(results[1].success).toBe(true);
  });

  test('respects timeout and reports failure', async () => {
    mockedExec.mockImplementation((...args: unknown[]) => {
      const cb = args[2] as Function;
      const err = Object.assign(new Error('killed'), { killed: true });
      cb(err, '', '');
      return {} as any;
    });

    const hooks: HookDefinition[] = [
      { name: 'slow-hook', command: 'sleep 999', timeout: 5 },
    ];

    await expect(service.executeHooks(hooks, baseContext))
      .rejects.toThrow("Hook 'slow-hook' failed: Timed out after 5s");

    // Verify the timeout was passed to exec options
    const callOpts = mockedExec.mock.calls[0][1] as { timeout: number };
    expect(callOpts.timeout).toBe(5000);
  });

  test('respects workingDir', async () => {
    mockExecSuccess();

    const hooks: HookDefinition[] = [
      { name: 'cwd-hook', command: 'ls', workingDir: '/custom/dir' },
    ];

    await service.executeHooks(hooks, baseContext);

    const callOpts = mockedExec.mock.calls[0][1] as { cwd: string };
    expect(callOpts.cwd).toBe('/custom/dir');
  });

  test('returns HookResult[] with duration', async () => {
    mockExecSuccess('hello', '');

    const hooks: HookDefinition[] = [
      { name: 'result-hook', command: 'echo hello' },
    ];

    const results = await service.executeHooks(hooks, baseContext);

    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.name).toBe('result-hook');
    expect(r.success).toBe(true);
    expect(typeof r.durationMs).toBe('number');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    expect(r.error).toBeUndefined();
  });

  test('returns empty array if no hooks provided', async () => {
    const results = await service.executeHooks([], baseContext);

    expect(results).toEqual([]);
    expect(mockedExec).not.toHaveBeenCalled();
  });
});
