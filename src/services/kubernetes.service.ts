import { existsSync, promises as fs_promises, createReadStream } from 'fs';
import { parse } from 'node:path';
import * as k8s from '@kubernetes/client-node';
import logger from '../utils/logger';
import type { ArchivedFile, ConfigMapResult, VolumeClaimResult } from '../types/kubernetes.types';
import { TestRunManifest } from '../types/testRunManifest.types';

export class KubernetesService {
  private readonly k8sLog: k8s.Log;

  constructor(
    private readonly k8sApi: k8s.CoreV1Api,
    private readonly k8sCustomApi: k8s.CustomObjectsApi,
    private readonly kc?: k8s.KubeConfig,
  ) {
    this.k8sLog = new k8s.Log(this.getKubeConfig());
  }

  private getKubeConfig(): k8s.KubeConfig {
    if (this.kc) return this.kc;
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    return kc;
  }

  private isNotFoundError(error: unknown): boolean {
    if ((error as any)?.statusCode === 404) return true;
    if ((error as Error)?.message?.includes('HTTP-Code: 404')) return true;
    return false;
  }

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

    // Clean up the archive file after creating the ConfigMap
    await fs_promises.unlink(archiveFile.archivePath).catch(error => console.error(`Error deleting file ${archiveFile.archivePath}:`, error));
    return { namespace, configMapName };
  }

  async createPVCWithArchive(archiveFile: ArchivedFile, namespace: string): Promise<VolumeClaimResult> {
    if (!existsSync(archiveFile.archivePath)) {
      throw new Error(`Archive file not found at path: ${archiveFile.archivePath}`);
    }

    const stats = await fs_promises.stat(archiveFile.archivePath);
    const storageMi = Math.max(10, Math.ceil(stats.size * 2 / (1024 * 1024)));
    const volumeClaimName = parse(archiveFile.archiveFilename).name;

    // Create PVC
    const pvc: k8s.V1PersistentVolumeClaim = {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: { name: volumeClaimName, namespace },
      spec: {
        accessModes: ['ReadWriteOnce'],
        resources: { requests: { storage: `${storageMi}Mi` } },
      },
    };
    await this.k8sApi.createNamespacedPersistentVolumeClaim({ namespace, body: pvc });
    logger.info(`PVC ${volumeClaimName} created in namespace ${namespace} (${storageMi}Mi)`);

    // Create helper pod mounting the PVC
    const helperPodName = `archive-uploader-${Date.now()}`;
    const helperPod: k8s.V1Pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: helperPodName, namespace },
      spec: {
        restartPolicy: 'Never',
        containers: [{
          name: 'helper',
          image: 'busybox',
          command: ['sleep', 'infinity'],
          volumeMounts: [{ name: 'data', mountPath: '/data' }],
        }],
        volumes: [{ name: 'data', persistentVolumeClaim: { claimName: volumeClaimName } }],
      },
    };
    await this.k8sApi.createNamespacedPod({ namespace, body: helperPod });
    logger.info(`Helper pod ${helperPodName} created in namespace ${namespace}`);

    // Wait for pod to reach Running state
    await this.waitForPodRunning(helperPodName, namespace);

    // Stream archive into pod via exec (like kubectl cp)
    const exec = new k8s.Exec(this.getKubeConfig());
    const stdin = createReadStream(archiveFile.archivePath);
    await new Promise<void>((resolve, reject) => {
      exec.exec(
        namespace,
        helperPodName,
        'helper',
        ['tee', `/data/${archiveFile.archiveFilename}`],
        null,
        null,
        stdin,
        false,
        (status: k8s.V1Status) => {
          if (status.status === 'Success') resolve();
          else reject(new Error(`Failed to upload archive to pod: ${status.message ?? JSON.stringify(status)}`));
        },
      ).catch(reject);
    });
    logger.info(`Archive ${archiveFile.archiveFilename} uploaded to PVC ${volumeClaimName}`);

    // Delete helper pod
    await this.k8sApi.deleteNamespacedPod({ name: helperPodName, namespace })
      .catch(err => logger.debug(`Error deleting helper pod ${helperPodName}: ${(err as Error).message}`));
    logger.info(`Helper pod ${helperPodName} deleted`);

    // Clean up local archive file
    await fs_promises.unlink(archiveFile.archivePath)
      .catch(err => logger.debug(`Error deleting archive file ${archiveFile.archivePath}: ${(err as Error).message}`));

    return { namespace, volumeClaimName, archiveFilename: archiveFile.archiveFilename };
  }

  private async waitForPodRunning(podName: string, namespace: string, maxWaitMs: number = 60_000): Promise<void> {
    const pollInterval = 2_000;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const pod = await this.k8sApi.readNamespacedPod({ name: podName, namespace });
      if (pod.status?.phase === 'Running') return;
      if (pod.status?.phase === 'Failed') throw new Error(`Helper pod ${podName} failed to start`);
      await new Promise(r => setTimeout(r, pollInterval));
    }
    throw new Error(`Helper pod ${podName} did not reach Running state within ${maxWaitMs}ms`);
  }

  async deleteVolumeClaimByName(volumeClaimName: string, namespace: string = "default"): Promise<void> {
    try {
      await this.k8sApi.deleteNamespacedPersistentVolumeClaim({ name: volumeClaimName, namespace });
      logger.info(`PVC ${volumeClaimName} deleted from namespace ${namespace}`);
    } catch (error) {
      if (this.isNotFoundError(error)) {
        logger.warn(`PVC ${volumeClaimName} not found in namespace ${namespace}, skipping deletion`);
        return;
      }
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to delete PVC ${volumeClaimName} from namespace ${namespace}: ${errorMessage}`);
    }
  }

  async deleteConfigMap(configMapName: string, namespace: string): Promise<void> {
    try {
      await this.k8sApi.deleteNamespacedConfigMap({ name: configMapName, namespace });
      logger.info(`ConfigMap ${configMapName} deleted from namespace ${namespace}`);
    } catch (error) {
      if (this.isNotFoundError(error)) {
        logger.warn(`ConfigMap ${configMapName} not found in namespace ${namespace}, skipping deletion`);
        return;
      }
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
    await this.deleteTestRunByName(testRunManifest.metadata.name, testRunManifest.metadata.namespace);
  }

  async listTestRuns(namespace: string = "default"): Promise<any> {
    try {
      const response = await this.k8sCustomApi.listNamespacedCustomObject({
        group: "k6.io",
        version: "v1alpha1",
        namespace: namespace,
        plural: "testruns",
      });
      return response.items as TestRunManifest[];
    } catch (error) {
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to list TestRuns in namespace ${namespace}: ${errorMessage}`);
    }
  }

  async listPods(namespace: string = "default"): Promise<k8s.V1PodList> {
    try {
      const response = await this.k8sApi.listNamespacedPod({ namespace });
      return response as k8s.V1PodList;
    } catch (error) {
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to list Pods in namespace ${namespace}: ${errorMessage}`);
    }
  }

  async listConfigMaps(namespace: string = "default"): Promise<k8s.V1ConfigMapList> {
    try {
      const response = await this.k8sApi.listNamespacedConfigMap({ namespace });
      response.items = response.items?.filter(cm => cm.metadata?.name?.startsWith('archive-'));
      return response as k8s.V1ConfigMapList;
    } catch (error) {
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to list ConfigMaps in namespace ${namespace}: ${errorMessage}`);
    }
  }

  private getTestRunCustomObjectParams(testRunName: string, namespace: string = "default") {
    return {
      group: "k6.io",
      version: "v1alpha1",
      namespace,
      plural: "testruns",
      name: testRunName,
    };
  }

  async deleteTestRunByName(testRunName: string, namespace: string = "default"): Promise<void> {
    try {
      await this.k8sCustomApi.deleteNamespacedCustomObject(this.getTestRunCustomObjectParams(testRunName, namespace));
      logger.info(`TestRun ${testRunName} deleted from namespace ${namespace}`);
    } catch (error) {
      if (this.isNotFoundError(error)) {
        logger.warn(`TestRun ${testRunName} not found in namespace ${namespace}, skipping deletion`);
        return;
      }
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to delete TestRun ${testRunName} from namespace ${namespace}: ${errorMessage}`);
    }
  }

  async deletePodByName(podName: string, namespace: string = "default"): Promise<void> {
    try {
      await this.k8sApi.deleteNamespacedPod({ name: podName, namespace });
      logger.info(`Pod ${podName} deleted from namespace ${namespace}`);
    } catch (error) {
      if (this.isNotFoundError(error)) {
        logger.warn(`Pod ${podName} not found in namespace ${namespace}, skipping deletion`);
        return;
      }
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to delete Pod ${podName} from namespace ${namespace}: ${errorMessage}`);
    }
  }

  async getTestRun(testRunName: string, namespace: string = "default"): Promise<TestRunManifest | null> {
    try {
      const response = await this.k8sCustomApi.getNamespacedCustomObject(this.getTestRunCustomObjectParams(testRunName, namespace));
      return response as TestRunManifest;
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return null;
      }
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to get TestRun ${testRunName} in namespace ${namespace}: ${errorMessage}`);
    }
  }

  async getPodsForTestRun(testRunName: string, namespace: string = "default"): Promise<k8s.V1PodList> {
    try {
      const response = await this.k8sApi.listNamespacedPod({
        namespace,
        labelSelector: `k6_cr=${testRunName}`,
      });
      return response as k8s.V1PodList;
    } catch (error) {
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to get pods for TestRun ${testRunName} in namespace ${namespace}: ${errorMessage}`);
    }
  }

  async getPodLogs(
    podName: string,
    namespace: string = "default",
    container?: string,
    tailLines?: number,
    timestamps?: boolean,
  ): Promise<string> {
    try {
      const response = await this.k8sApi.readNamespacedPodLog({
        name: podName,
        namespace,
        ...(container ? { container } : {}),
        ...(tailLines !== undefined ? { tailLines } : {}),
        ...(timestamps !== undefined ? { timestamps } : {}),
      });
      return response;
    } catch (error) {
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to get logs for pod ${podName} in namespace ${namespace}: ${errorMessage}`);
    }
  }

  async streamPodLogs(
    podName: string,
    namespace: string,
    containerName: string | undefined,
    stream: NodeJS.WritableStream,
    options: { tailLines?: number; follow?: boolean; timestamps?: boolean; sinceSeconds?: number } = {}
  ): Promise<any> {
    return await this.k8sLog.log(namespace, podName, containerName || '', stream as any, {
      follow: options.follow,
      tailLines: options.tailLines,
      timestamps: options.timestamps,
      sinceSeconds: options.sinceSeconds,
    });
  }
}

export function createDefaultKubernetesService(context?: string): KubernetesService {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  if (context) kc.setCurrentContext(context);
  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
  const k8sCustomApi = kc.makeApiClient(k8s.CustomObjectsApi);
  return new KubernetesService(k8sApi, k8sCustomApi, kc);
}
