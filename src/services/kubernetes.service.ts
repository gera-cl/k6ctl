import { existsSync, promises as fs_promises } from 'fs';
import { parse } from 'node:path';
import * as k8s from '@kubernetes/client-node';
import logger from '../utils/logger';

import type { ArchivedFile, ConfigMapResult } from '../types/kubernetes.types';

export class KubernetesService {
  constructor(private readonly k8sApi: k8s.CoreV1Api) {}

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
}

export function createDefaultKubernetesService(context?: string): KubernetesService {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  if (context) kc.setCurrentContext(context);
  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
  return new KubernetesService(k8sApi);
}
