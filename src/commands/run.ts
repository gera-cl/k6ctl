import logger, { setLogLevel } from '../utils/logger';

interface RunOptions {
  config: string;
  namespace?: string;
  parallelism?: number;
  verbose?: boolean;
}

export async function runTest(scriptPath: string, options: RunOptions) {
  if (options.verbose) setLogLevel('debug');
  logger.debug(`Running k6 test: ${scriptPath}`);
  logger.debug(`Using config: ${JSON.stringify(options.config, null, 2)}`);
}
