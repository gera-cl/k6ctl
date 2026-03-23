import { createDefaultKubernetesService } from '../services/kubernetes.service';
import { ScriptService } from '../services/script.service';
import { loadK6Config } from '../utils/configLoader';
import { loadAndValidateEnv } from '../utils/env';
import logger, { setLogLevel } from '../utils/logger';
import { buildTestRunManifest } from '../utils/testRunManifestBuilder';
import { saveLastRun } from '../utils/lastRunStore';

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

  try {
    // Initialize services
    const scriptService = new ScriptService();
    const kubernetesService = createDefaultKubernetesService();

    // Load test script
    const archive = await scriptService.archiveTest(scriptPath);

    // Load config
    const config = loadK6Config(options.config);

    // Load environment variables
    let envVars;
    try {
      envVars = loadAndValidateEnv();
    } catch (error) {
      logger.warn("Warning: no environment variables loaded, continuing anyway.");
      logger.debug(`Error loading environment variables: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Create configmap for test script
    const configMap = await kubernetesService.createConfigMap(archive, config.namespace);

    // Build testrun
    const testRunManifest = buildTestRunManifest(configMap, archive, config, envVars);

    // Create testrun resource
    const testRunResult = await kubernetesService.createTestRun(testRunManifest);

    // Persist last run state for use by logs/status/delete commands
    await saveLastRun({
      testRunName: testRunManifest.metadata.name,
      namespace: testRunManifest.metadata.namespace,
      configMapName: configMap.configMapName,
      scriptPath,
      createdAt: new Date().toISOString(),
    });
    logger.info(`Last run saved: ${testRunManifest.metadata.name} (namespace: ${testRunManifest.metadata.namespace})`);

  } catch (error) {
    logger.error(`Error running test: ${error instanceof Error ? error.message : String(error)}`);
  }
}
