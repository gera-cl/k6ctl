import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { createDefaultKubernetesService } from '../services/kubernetes.service';
import { ScriptService } from '../services/script.service';
import { HooksService } from '../services/hooks.service';
import { loadK6Config } from '../utils/configLoader';
import { loadAndValidateEnv } from '../utils/env';
import logger, { setLogLevel } from '../utils/logger';
import { buildTestRunManifest, buildTestRunManifestWithVolumeClaim } from '../utils/testRunManifestBuilder';
import { saveLastRun } from '../utils/lastRunStore';
import { K6StageMetrics, K6ScenarioOptions, K6ScenarioMetrics, K6InspectResult } from "../types/script.types";
import type { HookContext } from '../services/hooks.service';

const DEFAULT_VUS_PER_POD = 200;
const MAX_ITERATION_DURATION = 30;

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
  smart?: boolean;
  defaultVusPerPod?: number;
  maxIterationDuration?: number;
  skipHooks?: boolean;
  skipPreHooks?: boolean;
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
    const hooksService = new HooksService();

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

    // Build hook context (testRunName will be set after test creation)
    const hookContext: HookContext = {
      scriptPath,
      namespace: config.namespace,
      parallelism: config.parallelism,
      phase: 'preRun',
    };

    // === PRE-RUN HOOKS ===
    if (!options.skipHooks && !options.skipPreHooks && config.hooks.preRun.length > 0) {
      logger.info('Executing pre-run hooks...');
      const results = await hooksService.executeHooks(config.hooks.preRun, hookContext);
      const failed = results.filter(r => !r.success);
      if (failed.length > 0) {
        logger.warn(`${failed.length} pre-run hook(s) failed (continueOnError=true)`);
      }
    }

    // Load test script (with environment variables for k6 archive)
    let archive = await scriptService.archiveTest(scriptPath, undefined, envVars);

    const inspectResult = await scriptService.inspectScript(scriptPath);
    const scenarioMetrics: K6ScenarioMetrics[] = await analyzeScript(inspectResult);

    // Analyze script if smart option is enabled
    if (options.smart) {
      logger.info(`Analyzing script: ${scriptPath}`);
      if (!options.defaultVusPerPod) {
        options.defaultVusPerPod = DEFAULT_VUS_PER_POD;
      }
      if (!options.maxIterationDuration) {
        options.maxIterationDuration = MAX_ITERATION_DURATION;
      }
      if (scenarioMetrics) {
        const estimatedTotalIterations = scenarioMetrics.reduce((sum, metrics) => sum + (metrics?.totalIterations ?? 0), 0);
        const totalRecommendedMaxVUs = scenarioMetrics.reduce((sum, metrics) => sum + (metrics?.recommendedMaxVUs ?? 0), 0);
        const parallelism = Math.ceil(totalRecommendedMaxVUs / (options.defaultVusPerPod)) || 1;
        const peakTps = scenarioMetrics.reduce((max, metrics) => Math.max(max, metrics?.peakTps ?? 0), 0);

        config.parallelism = parallelism;

        const headers = ['Scenarios', 'Peak TPS', 'Iterations', 'Max Iteration', 'Safety', 'VUs/Pod', 'Parallelism'];
        const rows = [
          [
            scenarioMetrics.length.toString(),
            peakTps.toFixed(2),
            Math.round(estimatedTotalIterations).toLocaleString(),
            `${options.maxIterationDuration}s`,
            '1.2x',
            options.defaultVusPerPod.toString(),
            parallelism.toString(),
          ]
        ];
        printData("Execution Plan", headers, rows);
        archive = await scriptService.extractModifyAndRecompress(archive, scenarioMetrics);
      }
    } else {
      logger.info('Smart scenario analysis is disabled. Running test without previous analysis.');
    }

    // Show execution summary and confirm
    if (scenarioMetrics && scenarioMetrics.length > 0 && scenarioMetrics[0]) {
      const confirmed = await showExecutionSummaryAndConfirm(scenarioMetrics);
      if (!confirmed) {
        logger.info('Test execution cancelled by user.');
        return;
      }
    } else if (!scenarioMetrics || scenarioMetrics.length === 0) {
      logger.info('No scenarios found. Proceeding with test execution.');
    }

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

async function analyzeScript(inspectResult: K6InspectResult): Promise<K6ScenarioMetrics[]> {
  if (!inspectResult.scenarios) {
    logger.info('No scenarios found in the script. Smart analysis cannot be performed.');
    return [];
  }
  const allMetrics: K6ScenarioMetrics[] = Object.entries(inspectResult.scenarios).map(([name, scenario]) => {
    return calculateScenarioMetrics(name, scenario) as K6ScenarioMetrics;
  });
  return allMetrics;
}

function calculateScenarioMetrics(
  name: string,
  scenario: K6ScenarioOptions,
  avgIterationDurationSeconds: number = MAX_ITERATION_DURATION,
  safetyFactor: number = 1.2
): K6ScenarioMetrics | null {
  if (scenario.executor !== 'ramping-arrival-rate') {
    return null;
  }
  if (!scenario.stages || scenario.stages.length === 0) {
    return null;
  }
  const timeUnitSeconds = parseTimeUnitToSeconds(scenario.timeUnit);
  let previousRate = scenario.startRate ?? 0;
  let peakTps = previousRate / timeUnitSeconds;
  let totalIterations = 0;
  const stageMetrics: K6StageMetrics[] = scenario.stages.map((stage, index) => {
    const durationSeconds = parseDurationToSeconds(stage.duration);
    const fromTps = previousRate / timeUnitSeconds;
    const toTps = stage.target / timeUnitSeconds;
    const avgTps = (fromTps + toTps) / 2;
    const estimatedIterations = avgTps * durationSeconds;
    totalIterations += estimatedIterations;
    peakTps = Math.max(peakTps, toTps);
    const requiredVUsAtTarget = toTps * avgIterationDurationSeconds;
    const recommendedVUsAtTarget = requiredVUsAtTarget * safetyFactor;
    previousRate = stage.target;
    return {
      stageIndex: index + 1,
      duration: stage.duration,
      durationSeconds,
      fromTps,
      toTps,
      avgTps,
      estimatedIterations,
      requiredVUsAtTarget,
      recommendedVUsAtTarget,
    };
  });
  const requiredMaxVUs = peakTps * avgIterationDurationSeconds;
  const recommendedMaxVUs = requiredMaxVUs * safetyFactor;
  return {
    name,
    peakTps,
    totalIterations,
    requiredMaxVUs,
    recommendedMaxVUs,
    stageMetrics,
  };
}

function parseDurationToSeconds(duration: string): number {
  const regex = /(\d+)(ms|s|m|h)/g;
  let match: RegExpExecArray | null;
  let totalMs = 0;
  while ((match = regex.exec(duration)) !== null) {
    const value = Number(match[1]);
    const unit = match[2];
    switch (unit) {
      case 'h':
        totalMs += value * 60 * 60 * 1000;
        break;
      case 'm':
        totalMs += value * 60 * 1000;
        break;
      case 's':
        totalMs += value * 1000;
        break;
      case 'ms':
        totalMs += value;
        break;
      default:
        throw new Error(`Unsupported duration unit: ${unit}`);
    }
  }
  if (totalMs === 0) {
    throw new Error(`Invalid duration format: ${duration}`);
  }
  return totalMs / 1000;
}

function parseTimeUnitToSeconds(timeUnit?: string): number {
  if (!timeUnit) return 1;
  return parseDurationToSeconds(timeUnit);
}

async function showExecutionSummaryAndConfirm(scenarioMetrics: K6ScenarioMetrics[]): Promise<boolean> {
  const headers = ['Name', 'TPS', 'Iterations', 'Req VUs', 'Rec VUs', 'Stages'];
  const rows = scenarioMetrics.map((metric) => [
    metric.name,
    metric.peakTps.toFixed(0),
    Math.round(metric.totalIterations).toLocaleString(),
    Math.ceil(metric.requiredMaxVUs).toString(),
    Math.ceil(metric.recommendedMaxVUs ?? metric.requiredMaxVUs).toString(),
    (metric.stageMetrics?.length ?? 0).toString(),
  ]);
  printData("Execution Summary", headers, rows);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Proceed with test execution? (yes/no): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

function printData(title: string, headers: string[], rows: string[][]) {
  console.log(`\n${title}:\n`);
  const colWidths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => row[i].length))
  );
  console.log(
    headers
      .map((header, i) => header.padEnd(colWidths[i]))
      .join('   ')
  );
  rows.forEach((row) => {
    console.log(
      row
        .map((cell, i) => {
          const isNumeric = i > 0;
          return isNumeric ? cell.padStart(colWidths[i]) : cell.padEnd(colWidths[i]);
        })
        .join('   ')
    );
  });
  console.log('');
}