import { afterAll, describe, expect, test } from '@jest/globals';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { createDefaultKubernetesService } from '../../src/services/kubernetes.service';
import { ScriptService } from '../../src/services/script.service';
import { ConfigMapResult } from '../../src/types/kubernetes.types';
import { ArchiveResult } from '../../src/types/script.types';
import logger from '../../src/utils/logger';
import { TestRunManifest } from '../../src/types/testRunManifest.types';
import { K6Config } from '../../src/types/config.types';
import { loadK6Config } from '../../src/utils/configLoader';

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
  afterAll(async () => {
    // Clean up archived files after tests
    await Promise.all(
      archivedFiles.map(file => unlink(file).catch(error => console.error(`Error deleting file ${file}:`, error)))
    );

    // Clean up created config maps in Kubernetes
    await Promise.all(
      configMaps.map(cm => kubernetesService.deleteConfigMap(cm.configMapName, cm.namespace)
        .catch(error => console.error(`Error deleting config map ${cm.configMapName}:`, error)))
    );
  });

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
    const result: TestRunManifest = await kubernetesService.createTestRun(configMapResult, archiveOutput, cfg);
    expect(result).toBeDefined();
    logger.info("TestRun result:", JSON.stringify(result));

    // Wait for some time to allow the TestRun to be created and start running
    await new Promise((resolve) => setTimeout(resolve, 40000));

    // Clean up the TestRun after successful creation and execution
    await kubernetesService.deleteTestRun(configMapResult.configMapName, configMapResult.namespace);
  }, 120000);
});
