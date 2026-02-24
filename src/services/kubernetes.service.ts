import { existsSync, promises as fs_promises } from 'fs';
import { parse } from 'node:path';
import * as k8s from '@kubernetes/client-node';
import logger from '../utils/logger';
import type { ArchivedFile, ConfigMapResult } from '../types/kubernetes.types';
import { K6Config } from '../types/config.types';
import { loadAndValidateEnv } from '../utils/env';
import { loadK6Config } from '../utils/configLoader';
import { TestRunManifest } from '../types/testRunManifest.types';

type RunnerEnvVar = { name: string; value: string };
const K6_GROUP = "k6.io";
const K6_VERSION = "v1alpha1";
const K6_PLURAL = "testruns";
const K6_KIND = "TestRun";
const K6_CLEANUP_LABEL = "post";
const ARG_OUT = "--out";
const ARG_TAG = "--tag";
const ARG_OUT_PROMETHEUS = "experimental-prometheus-rw";
const K6_PROMETHEUS_RW_SERVER_URL = "K6_PROMETHEUS_RW_SERVER_URL";
const K6_PROMETHEUS_RW_TREND_STATS = "K6_PROMETHEUS_RW_TREND_STATS";

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

  async createTestRun(configMapResult: ConfigMapResult, archiveOutput: ArchivedFile, cfg: K6Config, envFromLoader?: Record<string, string>): Promise<TestRunManifest> {
    const argumentsString = buildArgumentsString(cfg.arguments, cfg, configMapResult.configMapName);
    logger.debug("Constructed arguments string for TestRun manifest:", argumentsString);
    const testRun: TestRunManifest = {
      apiVersion: `${K6_GROUP}/${K6_VERSION}`,
      kind: K6_KIND,
      metadata: {
        name: configMapResult.configMapName,
        namespace: configMapResult.namespace,
      },
      spec: {
        parallelism: cfg.parallelism,
        arguments: argumentsString,
        quiet: String(cfg.quiet),
        ...(cfg.cleanup === true ? { cleanup: K6_CLEANUP_LABEL } : {}),
        separate: cfg.separate,
        runner: {
          image: cfg.runner?.image,
          env: buildRunnerEnv(cfg, envFromLoader),
          ...(cfg.runner?.resources ? { resources: cfg.runner.resources } : {}),
        },
        script: {
          configMap: {
            name: configMapResult.configMapName,
            file: archiveOutput.archiveFilename,
          },
        },
      },
    };
    logger.debug("Constructed TestRun manifest:", JSON.stringify(testRun, null, 2));
    try {
      await this.k8sCustomApi.createNamespacedCustomObject({
        group: K6_GROUP,
        version: K6_VERSION,
        namespace: configMapResult.namespace,
        plural: K6_PLURAL,
        body: testRun,
      });
      logger.info(`TestRun ${testRun.metadata.name} created in namespace ${configMapResult.namespace}`);
    } catch (error) {
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to create TestRun ${testRun.metadata.name} in namespace ${configMapResult.namespace}: ${errorMessage}`);
    }
    return testRun;
  }

  async deleteTestRun(testRunName: string, namespace: string = "default"): Promise<void> {
    try {
      const response = await this.k8sCustomApi.deleteNamespacedCustomObject({
        group: K6_GROUP,
        version: K6_VERSION,
        namespace,
        plural: K6_PLURAL,
        name: testRunName,
      });
      logger.info(`TestRun ${testRunName} deleted from namespace ${namespace}`);
      logger.debug(`Delete response: ${JSON.stringify(response)}`);
    } catch (error) {
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to delete TestRun ${testRunName} from namespace ${namespace}: ${errorMessage}`);
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

function buildRunnerEnv(
  cfg: K6Config,
  envFromLoader?: Record<string, string>
): RunnerEnvVar[] | undefined {
  const envMap = new Map<string, string>();
  if (envFromLoader) {
    for (const [key, value] of Object.entries(envFromLoader)) {
      if (value !== undefined && value !== null) {
        envMap.set(key, String(value));
      }
    }
  }
  if (cfg.prometheus?.serverUrl) {
    envMap.set(K6_PROMETHEUS_RW_SERVER_URL, cfg.prometheus.serverUrl);
    if (cfg.prometheus.trendStats?.length) {
      envMap.set(K6_PROMETHEUS_RW_TREND_STATS, cfg.prometheus.trendStats.join(","));
    }
  }
  const envArray: RunnerEnvVar[] = Array.from(envMap.entries()).map(([name, value]) => ({
    name,
    value,
  }));
  return envArray.length > 0 ? envArray : undefined;
}

function buildArgumentsString(args: string[] | undefined, cfg: K6Config, name: string): string | undefined {
  const finalArgs = [...(args ?? [])];
  if (cfg.prometheus?.serverUrl) {
    const hasOut = finalArgs.includes(ARG_OUT);
    if (!hasOut) {
      finalArgs.push(ARG_OUT);
    }
    const hasPrometheusOut = finalArgs.includes(ARG_OUT_PROMETHEUS);
    if (!hasPrometheusOut) {
      finalArgs.push(ARG_OUT_PROMETHEUS);
    }
    finalArgs.push(ARG_TAG, `testid=${name}`);
  }
  if (finalArgs.length === 0) {
    return undefined;
  }
  return finalArgs.join(" ");
}