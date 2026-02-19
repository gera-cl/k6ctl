import { afterAll, describe, expect, test } from '@jest/globals';
import { join, resolve } from 'node:path';
import { archiveTest, ConfigMapResult, createConfigMap, deleteConfigMap } from '../../src/script/script.service';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';

const samplesPath = resolve(__dirname, '..', 'samples');
const scriptSample1 = join(samplesPath, 'k6_script_sample_1.js');
const scriptSample2 = join(samplesPath, 'k6_script_sample_2.js');
const archivedFiles: string[] = [];
const configMaps: ConfigMapResult[] = [];

describe('script.service - configmap', () => {
  afterAll(async () => {
    // Clean up archived files after tests
    await Promise.all(
      archivedFiles.map(file => unlink(file).catch(error => console.error(`Error deleting file ${file}:`, error)))
    );

    // Clean up created config maps in Kubernetes
    await Promise.all(
      configMaps.map(cm => deleteConfigMap(cm.configMapName, cm.namespace)
        .catch(error => console.error(`Error deleting config map ${cm.configMapName}:`, error)))
    );
  });

  test('create config map from archived script', async () => {
    const archiveOutput = await archiveTest(scriptSample2);
    expect(existsSync(archiveOutput.archivePath)).toBe(true);
    archivedFiles.push(archiveOutput.archivePath);

    const configMapResult = await createConfigMap(archiveOutput, 'default');
    expect(configMapResult).toBeDefined();
    console.log(JSON.stringify(configMapResult, null, 2));
    configMaps.push(configMapResult);
  });
});
