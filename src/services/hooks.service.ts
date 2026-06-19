import { exec } from 'child_process';
import logger from '../utils/logger';

import type { HookDefinition } from '../types/config.types';

const DEFAULT_TIMEOUT_MS = 60_000;

export interface HookContext {
  scriptPath: string;
  namespace: string;
  parallelism: number;
  phase: string;
}

export interface HookResult {
  name: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

/**
 * Service responsible for executing pre-run and post-run hooks.
 *
 * Hooks are executed sequentially in order.  Each hook receives a set of
 * `K6CTL_*` environment variables with context about the current test run.
 *
 * If a hook fails and its `continueOnError` flag is `false` (the default),
 * `executeHooks` throws immediately — callers are expected to catch the error
 * and decide how to proceed (e.g. abort the test for preRun, just log for
 * postRun).
 */
export class HooksService {

  /**
   * Execute an ordered list of hooks, injecting context as environment variables.
   *
   * @returns An array of `HookResult` objects for every hook that was executed
   *          (hooks after a fatal failure are not included).
   * @throws  If a hook fails and `continueOnError` is `false`.
   */
  async executeHooks(hooks: HookDefinition[], context: HookContext): Promise<HookResult[]> {
    const results: HookResult[] = [];
    const env = this.buildEnvVars(context);

    for (const hook of hooks) {
      const result = await this.executeHook(hook, env);
      results.push(result);

      if (!result.success) {
        if (!hook.continueOnError) {
          throw new Error(`Hook '${hook.name}' failed: ${result.error}`);
        }
        logger.warn(`Hook '${hook.name}' failed but continueOnError=true, continuing. Error: ${result.error}`);
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildEnvVars(context: HookContext): Record<string, string> {
    const env: Record<string, string> = {
      K6CTL_SCRIPT_PATH: context.scriptPath,
      K6CTL_NAMESPACE: context.namespace,
      K6CTL_PARALLELISM: String(context.parallelism),
      K6CTL_HOOK_PHASE: context.phase,
    };

    return env;
  }

  private executeHook(hook: HookDefinition, contextEnv: Record<string, string>): Promise<HookResult> {
    const timeoutMs = (hook.timeout ?? 60) * 1000;
    const start = Date.now();

    logger.info(`Running hook '${hook.name}': ${hook.command}`);

    return new Promise<HookResult>((resolve) => {
      const child = exec(hook.command, {
        cwd: hook.workingDir ?? process.cwd(),
        timeout: timeoutMs,
        env: { ...process.env, ...contextEnv },
      }, (error, stdout, stderr) => {
        const durationMs = Date.now() - start;

        if (stdout) logger.debug(`[${hook.name}] stdout: ${stdout.trimEnd()}`);
        if (stderr) logger.debug(`[${hook.name}] stderr: ${stderr.trimEnd()}`);

        if (error) {
          const timedOut = error.killed || (error as NodeJS.ErrnoException).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
          const errorMsg = timedOut
            ? `Timed out after ${timeoutMs / 1000}s`
            : error.message;

          logger.error(`Hook '${hook.name}' failed after ${durationMs}ms: ${errorMsg}`);
          resolve({ name: hook.name, success: false, durationMs, error: errorMsg });
          return;
        }

        logger.info(`Hook '${hook.name}' completed successfully in ${durationMs}ms`);
        resolve({ name: hook.name, success: true, durationMs });
      });
    });
  }
}
