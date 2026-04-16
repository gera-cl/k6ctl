import { existsSync, promises as fs_promises, createReadStream } from 'fs';
import { parse } from 'node:path';
import * as k8s from '@kubernetes/client-node';
import logger from '../utils/logger';
import type { ArchivedFile, ConfigMapResult, VolumeClaimResult } from '../types/kubernetes.types';
import { TestRunManifest } from '../types/testRunManifest.types';
import { printTableGeneric } from '../utils/table.util';

export class KubernetesService {
  constructor(
    private readonly k8sApi: k8s.CoreV1Api,
    private readonly k8sCustomApi: k8s.CustomObjectsApi,
    private readonly kc?: k8s.KubeConfig,
  ) { }

  private getKubeConfig(): k8s.KubeConfig {
    if (this.kc) return this.kc;
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    return kc;
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
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to delete PVC ${volumeClaimName} from namespace ${namespace}: ${errorMessage}`);
    }
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
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to delete TestRun ${testRunName} from namespace ${namespace}: ${errorMessage}`);
    }
  }

  async deletePodByName(podName: string, namespace: string = "default"): Promise<void> {
    try {
      await this.k8sApi.deleteNamespacedPod({ name: podName, namespace });
      logger.info(`Pod ${podName} deleted from namespace ${namespace}`);
    } catch (error) {
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to delete Pod ${podName} from namespace ${namespace}: ${errorMessage}`);
    }
  }

  async getTestRun(testRunName: string, namespace: string = "default"): Promise<TestRunManifest> {
    try {
      const response = await this.k8sCustomApi.getNamespacedCustomObject(this.getTestRunCustomObjectParams(testRunName, namespace));
      return response as TestRunManifest;
    } catch (error) {
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

  async getPodLogs(podName: string, namespace: string = "default", container?: string): Promise<string> {
    try {
      const response = await this.k8sApi.readNamespacedPodLog({
        name: podName,
        namespace,
        ...(container ? { container } : {}),
      });
      return response;
    } catch (error) {
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to get logs for pod ${podName} in namespace ${namespace}: ${errorMessage}`);
    }
  }
}

function fmt(v: any) {
  return v ?? "N/A";
}

function getNamespace(obj: any) {
  return obj?.metadata?.namespace ?? "default";
}

function getName(obj: any) {
  return obj?.metadata?.name ?? "unknown";
}

function ageSince(isoDate: any): string {
  if (!isoDate) return "N/A";
  const created = new Date(isoDate).getTime();
  const now = Date.now();
  let s = Math.max(0, Math.floor((now - created) / 1000));
  const days = Math.floor(s / 86400); s %= 86400;
  const hrs = Math.floor(s / 3600); s %= 3600;
  const mins = Math.floor(s / 60);
  if (days > 0) return `${days}d${hrs}h`;
  if (hrs > 0) return `${hrs}h${mins}m`;
  return `${mins}m`;
}

export function createDefaultKubernetesService(context?: string): KubernetesService {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  if (context) kc.setCurrentContext(context);
  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
  const k8sCustomApi = kc.makeApiClient(k8s.CustomObjectsApi);
  return new KubernetesService(k8sApi, k8sCustomApi, kc);
}

export function printPodsTable(data: k8s.V1PodList): void {
  const pods = data.items ?? [];
  const ns = pods[0]?.metadata?.namespace ?? "unknown";
  printTableGeneric({
    title: "Pods",
    headers: ["Pod", "Namespace", "Container", "Node Name", "Req CPU", "Req Mem", "Lim CPU", "Lim Mem", "Status"],
    items: pods,
    toRows: (pod) => {
      const podName = getName(pod);
      const namespace = getNamespace(pod);
      const status = pod.status?.phase ?? "unknown";
      const node = pod.spec?.nodeName ?? "unknown";
      const containers = pod.spec?.containers ?? [];
      if (containers.length === 0) {
        return [[podName, namespace, "-", "-", "-", "-", "-", status, node]];
      }
      return containers.map((c) => {
        const r = c.resources || {};
        const req = r.requests || {};
        const lim = r.limits || {};
        const statusEmoji = status === 'Succeeded' ? '🟢' : status === 'Failed' ? '🔴' : '🟡';
        return [
          podName,
          namespace,
          c.name,
          node,
          fmt(req.cpu),
          fmt(req.memory),
          fmt(lim.cpu),
          fmt(lim.memory),
          `${status} ${statusEmoji}`,
        ];
      });
    }
  });
}

export function printConfigMapsTable(data: k8s.V1ConfigMapList): void {
  const cms = data.items ?? [];
  const ns = cms[0]?.metadata?.namespace ?? "unknown";
  printTableGeneric({
    title: "ConfigMaps",
    headers: ["Name", "Namespace", "Data keys", "Binary keys", "Age"],
    items: cms,
    toRows: (cm) => {
      const name = getName(cm);
      const namespace = getNamespace(cm);
      const dataKeys = Object.keys(cm.data ?? {}).length ? Object.keys(cm.data ?? {}).join(", ") : "0";
      const binKeys = Object.keys(cm.binaryData ?? {}).length ? Object.keys(cm.binaryData ?? {}).join(", ") : "0";
      const age = ageSince(cm.metadata?.creationTimestamp);
      return [[name, namespace, dataKeys, binKeys, age]];
    }
  });
}

export function printTestRunsTable(testRuns: TestRunManifest[]): void {
  const ns = testRuns[0]?.metadata?.namespace ?? "unknown";
  printTableGeneric({
    title: "TestRuns",
    headers: ["Name", "Namespace", "Parallelism", "Cleanup", "Separate", "Quiet", "Age"],
    items: testRuns,
    toRows: (tr) => {
      const name = tr.metadata?.name ?? "unknown";
      const namespace = tr.metadata?.namespace ?? "unknown";
      const parallelism = tr.spec?.parallelism ?? "N/A";
      const cleanup = tr.spec?.cleanup ?? "N/A";
      const separate = tr.spec?.separate ?? "N/A";
      const quiet = tr.spec?.quiet ?? "N/A";
      const age = (tr as any)?.metadata?.creationTimestamp ?? "N/A";
      return [[name, namespace, parallelism, cleanup, separate, quiet, age]];
    }
  });
}
