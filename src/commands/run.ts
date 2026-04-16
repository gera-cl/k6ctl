import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { createDefaultKubernetesService } from '../services/kubernetes.service';
import { ScriptService } from '../services/script.service';
import { loadK6Config } from '../utils/configLoader';
import { loadAndValidateEnv } from '../utils/env';
import logger, { setLogLevel } from '../utils/logger';
import { buildTestRunManifest, buildTestRunManifestWithVolumeClaim } from '../utils/testRunManifestBuilder';
import { saveLastRun } from '../utils/lastRunStore';

function listTestFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

function promptSelection(files: string[], dir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log('\nAvailable test scripts:');
    files.forEach((file, i) => {
      const relative = path.relative(dir, file);
      console.log(`  [${String(i + 1).padStart(2)}] ${relative}`);
    });

    console.log('');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`Select a test (1-${files.length}): `, answer => {
      rl.close();
      const index = parseInt(answer.trim(), 10) - 1;
      if (isNaN(index) || index < 0 || index >= files.length) {
        reject(new Error(`Invalid selection: "${answer}"`));
      } else {
        resolve(files[index]);
      }
    });
  });
}

interface RunOptions {
  config: string;
  namespace?: string;
  parallelism?: number;
  verbose?: boolean;
  dir: string;
}

export async function runTest(scriptPath: string, options: RunOptions) {
  if (options.verbose) setLogLevel('debug');

  if (!scriptPath) {
    const files = listTestFiles(options.dir);
    if (files.length === 0) {
      logger.error(`No .js test files found in ${options.dir}`);
      process.exit(1);
    }
    try {
      scriptPath = await promptSelection(files, options.dir);
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  logger.debug(`Running k6 test: ${scriptPath}`);
  logger.debug(`Using config: ${JSON.stringify(options.config, null, 2)}`);

  try {
    // Initialize services
    const scriptService = new ScriptService();
    const kubernetesService = createDefaultKubernetesService();

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

    // Load test script
    const archive = await scriptService.archiveTest(scriptPath);

    if (archive.archiveSize > 1024 * 1024) {
      // Volume flow
      logger.info(`Test script archive size (${(archive.archiveSize / (1024 * 1024)).toFixed(2)} MB) exceeds 1 MB, using volume flow.`);

      const volumeClaimResult = await kubernetesService.createPVCWithArchive(archive, config.namespace);
      const testRunManifest = buildTestRunManifestWithVolumeClaim(volumeClaimResult, config, envVars);
      await kubernetesService.createTestRun(testRunManifest);

      await saveLastRun({
        testRunName: testRunManifest.metadata.name,
        namespace: testRunManifest.metadata.namespace,
        volumeClaimName: volumeClaimResult.volumeClaimName,
        scriptPath,
        createdAt: new Date().toISOString(),
      });
      logger.info(`Last run saved: ${testRunManifest.metadata.name} (namespace: ${testRunManifest.metadata.namespace})`);
      return;
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
