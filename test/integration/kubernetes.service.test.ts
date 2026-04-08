import { describe, expect, test } from '@jest/globals';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createDefaultKubernetesService } from '../../src/services/kubernetes.service';
import { ScriptService } from '../../src/services/script.service';
import { ConfigMapResult } from '../../src/types/kubernetes.types';
import { ArchiveResult } from '../../src/types/script.types';
import logger from '../../src/utils/logger';
import { TestRunManifest } from '../../src/types/testRunManifest.types';
import { K6Config } from '../../src/types/config.types';
import { loadK6Config } from '../../src/utils/configLoader';
import { buildTestRunManifest } from '../../src/utils/testRunManifestBuilder';
import { saveLastRun } from '../../src/utils/lastRunStore';
import { status } from '../../src/commands/status';
import { logs } from '../../src/commands/logs';
import { deleteLastRun } from '../../src/commands/delete';


const samplesPath = resolve(__dirname, '..', 'samples');
const scriptSample1 = join(samplesPath, 'k6_script_sample_1.js');
const scriptSample2 = join(samplesPath, 'k6_script_sample_2.js');
const archivedFiles: string[] = [];
const configMaps: ConfigMapResult[] = [];

const scriptService = new ScriptService();
const kubernetesService = createDefaultKubernetesService();
let archiveOutput: ArchiveResult;
let configMapResult: ConfigMapResult;

describe('KubernetesService integration tests', () => {

  test('create config map from archived script', async () => {
    archiveOutput = await scriptService.archiveTest(scriptSample2);
    expect(existsSync(archiveOutput.archivePath)).toBe(true);
    archivedFiles.push(archiveOutput.archivePath);

    configMapResult = await kubernetesService.createConfigMap(archiveOutput, 'default');
    expect(configMapResult).toBeDefined();
    console.log(JSON.stringify(configMapResult, null, 2));
    configMaps.push(configMapResult);
  });

  test('Create TestRun from the ConfigMap previously created', async () => {
    const cfg: K6Config = loadK6Config();
    logger.debug("Loaded K6 Config:", JSON.stringify(cfg, null, 2));
    const testRunManifest: TestRunManifest = buildTestRunManifest(configMapResult, archiveOutput, cfg);
    const response = await kubernetesService.createTestRun(testRunManifest);
    expect(response).toBeDefined();
    logger.info("TestRun result:", JSON.stringify(response));

    // Persist last run state for use by logs/status/delete commands
    await saveLastRun({
      testRunName: testRunManifest.metadata.name,
      namespace: testRunManifest.metadata.namespace,
      configMapName: configMapResult.configMapName,
      scriptPath: archiveOutput.archivePath,
      createdAt: new Date().toISOString(),
    });
    logger.info(`Last run saved: ${testRunManifest.metadata.name} (namespace: ${testRunManifest.metadata.namespace})`);

    // Wait for some time to allow the TestRun to be created and start running
    await new Promise((resolve) => setTimeout(resolve, 60000));

    // Check status command output
    await status({ namespace: testRunManifest.metadata.namespace });

    // Check logs command output
    await logs({ namespace: testRunManifest.metadata.namespace });

    // Clean up the TestRun after successful creation and execution
    await deleteLastRun({ namespace: testRunManifest.metadata.namespace });
  }, 120000);
});
