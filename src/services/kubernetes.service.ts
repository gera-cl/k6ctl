import { existsSync, promises as fs_promises } from 'fs';
import { parse } from 'node:path';
import * as k8s from '@kubernetes/client-node';
import logger from '../utils/logger';
import type { ArchivedFile, ConfigMapResult } from '../types/kubernetes.types';
import { TestRunManifest } from '../types/testRunManifest.types';

export class KubernetesService {
  constructor(private readonly k8sApi: k8s.CoreV1Api, private readonly k8sCustomApi: k8s.CustomObjectsApi) { }

  async createConfigMap(archiveFile: ArchivedFile, namespace: string): Promise<ConfigMapResult> {
    // Check if the archive file exists
    if (!existsSync(archiveFile.archivePath)) {
      throw new Error(`Archive file not found at path: ${archiveFile.archivePath}`);
    }

    // Check archive file size (should be less than 1MB for k8s configmap)
    const stats = await fs_promises.stat(archiveFile.archivePath);
    if (stats.size > 1024 * 1024) {
      throw new Error(`Archive file is too large to be stored in a configmap (size: ${stats.size} bytes)`);
    }

    const configMapName = parse(archiveFile.archiveFilename).name;
    const fileContent = await fs_promises.readFile(archiveFile.archivePath, 'base64');

    const configMap: k8s.V1ConfigMap = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: configMapName,
        namespace: namespace,
      },
      binaryData: {
        [archiveFile.archiveFilename]: fileContent,
      },
    };

    await this.k8sApi.createNamespacedConfigMap({ namespace, body: configMap });
    logger.info(`ConfigMap ${configMapName} created in namespace ${namespace}`);
    return { namespace, configMapName };
  }

  async deleteConfigMap(configMapName: string, namespace: string): Promise<void> {
    try {
      await this.k8sApi.deleteNamespacedConfigMap({ name: configMapName, namespace });
      logger.info(`ConfigMap ${configMapName} deleted from namespace ${namespace}`);
    } catch (error) {
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to delete ConfigMap ${configMapName} from namespace ${namespace}: ${errorMessage}`);
    }
  }

  async createTestRun(testRunManifest: TestRunManifest): Promise<any> {
    try {
      const response = await this.k8sCustomApi.createNamespacedCustomObject({
        group: testRunManifest.apiVersion.split('/')[0],
        version: testRunManifest.apiVersion.split('/')[1],
        namespace: testRunManifest.metadata.namespace,
        plural: "testruns",
        body: testRunManifest,
      });
      logger.info(`TestRun ${testRunManifest.metadata.name} created in namespace ${testRunManifest.metadata.namespace}`);
      logger.debug(`Create response: ${JSON.stringify(response)}`);
      return response;
    } catch (error) {
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to create TestRun ${testRunManifest.metadata.name} in namespace ${testRunManifest.metadata.namespace}: ${errorMessage}`);
    }
  }

  async deleteTestRun(testRunManifest: TestRunManifest): Promise<void> {
    try {
      const response = await this.k8sCustomApi.deleteNamespacedCustomObject({
        group: testRunManifest.apiVersion.split('/')[0],
        version: testRunManifest.apiVersion.split('/')[1],
        namespace: testRunManifest.metadata.namespace,
        plural: "testruns",
        name: testRunManifest.metadata.name,
      });
      logger.info(`TestRun ${testRunManifest.metadata.name} deleted from namespace ${testRunManifest.metadata.namespace}`);
      logger.debug(`Delete response: ${JSON.stringify(response)}`);
    } catch (error) {
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to delete TestRun ${testRunManifest.metadata.name} from namespace ${testRunManifest.metadata.namespace}: ${errorMessage}`);
    }
  }
}

export function createDefaultKubernetesService(context?: string): KubernetesService {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  if (context) kc.setCurrentContext(context);
  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
  const k8sCustomApi = kc.makeApiClient(k8s.CustomObjectsApi);
  return new KubernetesService(k8sApi, k8sCustomApi);
}
