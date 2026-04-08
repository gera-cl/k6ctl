import logger from '../utils/logger';
import type { ArchivedFile, ConfigMapResult } from '../types/kubernetes.types';
import { K6Config } from '../types/config.types';
import { TestRunManifest } from '../types/testRunManifest.types';

export type RunnerEnvVar =
    | { name: string; value: string }
    | { name: string; valueFrom: { secretKeyRef: { name: string; key: string } } };
const K6_GROUP = "k6.io";
const K6_VERSION = "v1alpha1";
const K6_KIND = "TestRun";
const K6_CLEANUP_LABEL = "post";
const ARG_OUT = "--out";
const ARG_TAG = "--tag";
const ARG_OUT_PROMETHEUS = "experimental-prometheus-rw";
const K6_PROMETHEUS_RW_SERVER_URL = "K6_PROMETHEUS_RW_SERVER_URL";
const K6_PROMETHEUS_RW_TREND_STATS = "K6_PROMETHEUS_RW_TREND_STATS";

export function buildTestRunManifest(
    configMapResult: ConfigMapResult,
    archiveOutput: ArchivedFile,
    cfg: K6Config,
    envFromLoader?: Record<string, string>
): TestRunManifest {
    const testName = configMapResult.configMapName.replace("archive-", "test-");
    const argumentsString = buildArgumentsString(
        cfg.arguments,
        cfg,
        testName
    );
    logger.debug("Constructed arguments string for TestRun manifest:", argumentsString);
    const testRun: TestRunManifest = {
        apiVersion: `${K6_GROUP}/${K6_VERSION}`,
        kind: K6_KIND,
        metadata: {
            name: testName,
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
    return testRun;
}

function buildRunnerEnv(
    cfg: K6Config,
    envFromLoader?: Record<string, string>
): RunnerEnvVar[] | undefined {
    const envMap = new Map<string, RunnerEnvVar>();
    if (envFromLoader) {
        for (const [key, raw] of Object.entries(envFromLoader)) {
            if (raw === undefined || raw === null) continue;
            addEnvToMap(key, raw, envMap);
        }
    }
    addPrometheusEnvVars(cfg, envMap);
    const envArray: RunnerEnvVar[] = Array.from(envMap.values());
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

function parseSecretPlaceholder(value: string): { secretName: string; secretKey: string } | null {
    const m = /^\{\{SECRETS\.([^.}]+)\.([^.}]+)\}\}$/.exec(value.trim());
    if (!m) return null;
    return { secretName: m[1], secretKey: m[2] };
}

function addEnvToMap(key: string, raw: string, envMap: Map<string, RunnerEnvVar>) {
    const value = String(raw);
    const secret = parseSecretPlaceholder(value);
    if (secret) {
        envMap.set(key, { name: key, valueFrom: { secretKeyRef: { name: secret.secretName, key: secret.secretKey } } });
    } else {
        envMap.set(key, { name: key, value });
    }
}

function addPrometheusEnvVars(cfg: K6Config, envMap: Map<string, RunnerEnvVar>) {
    if (cfg.prometheus?.serverUrl) {
        envMap.set(K6_PROMETHEUS_RW_SERVER_URL, {
            name: K6_PROMETHEUS_RW_SERVER_URL,
            value: cfg.prometheus.serverUrl,
        });
        if (cfg.prometheus.trendStats?.length) {
            envMap.set(K6_PROMETHEUS_RW_TREND_STATS, {
                name: K6_PROMETHEUS_RW_TREND_STATS,
                value: cfg.prometheus.trendStats.join(","),
            });
        }
    }
}
