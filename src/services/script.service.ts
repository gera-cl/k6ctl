import { exec } from 'child_process';
import { existsSync, statSync } from 'fs';
import { promises as fsPromises } from 'node:fs';
import { dirname, basename, join, parse } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'util';
import logger from '../utils/logger';

import type { ArchiveResult, ExecFn, K6InspectResult, K6ScenarioMetrics } from '../types/script.types';

const defaultExecAsync = promisify(exec);

export class ScriptService {
  constructor(private readonly execCmd: ExecFn = defaultExecAsync) { }

  async archiveTest(scriptPath: string, outputDirectory?: string): Promise<ArchiveResult> {
    // Check if the script file exists
    if (!existsSync(scriptPath)) throw new Error(`Script file not found at path: ${scriptPath}`);

    if (outputDirectory) {
      // Check if the output directory exists
      if (!existsSync(outputDirectory)) {
        throw new Error(`Output directory does not exist at path: ${outputDirectory}`);
      }
    }

    // Check if k6 is installed
    try {
      await this.execCmd('k6 version');
    } catch {
      throw new Error('k6 is not installed. Please install k6 to archive scripts.');
    }

    // Archive the script using k6
    try {
      // Get the script name without extension to use as prefix for the archive file
      const scriptName = parse(scriptPath).name;
      const sanitizedScriptName = sanitizeText(scriptName);
      const archiveOutput = join(outputDirectory ?? '.', `archive-${sanitizedScriptName}-${Date.now()}.tar`);
      const archiveCommand = `k6 archive -v -O ${archiveOutput} ${scriptPath}`;
      logger.debug(`Archiving script with command: ${archiveCommand}`);
      const { stdout, stderr } = await this.execCmd(archiveCommand);
      logger.debug(`Standard Output: ${stdout}`);
      logger.debug(`Standard Error: ${stderr}`);

      // Check if the file was created successfully
      if (!existsSync(archiveOutput)) {
        throw new Error(`Failed to create archive: ${stderr}`);
      }
      const archiveSize = statSync(archiveOutput).size;
      logger.info(`Archive created successfully at: ${archiveOutput} (size: ${archiveSize} bytes)`);
      return {
        archivePath: archiveOutput,
        archiveFilename: basename(archiveOutput),
        archiveSize,
        scriptPath: scriptPath,
        scriptFilename: basename(scriptPath),
      };
    } catch (error) {
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to archive the script: ${errorMessage}`);
    }
  }

  async inspectScript(scriptPath: string): Promise<K6InspectResult> {
    const { stdout, stderr } = await this.execCmd(`k6 inspect ${scriptPath}`);
    if (stderr) {
      logger.error(`Error inspecting script: ${stderr}`);
      throw new Error(`Failed to inspect the script: ${stderr}`);
    }
    return JSON.parse(stdout) as K6InspectResult;
  }

  async extractModifyAndRecompress(archive: ArchiveResult, scenarioMetrics: K6ScenarioMetrics[]): Promise<ArchiveResult> {
    if (!existsSync(archive.archivePath)) {
      throw new Error(`Archive file not found at path: ${archive.archivePath}`);
    }

    const tempRoot = await fsPromises.mkdtemp(join(tmpdir(), 'k6ctl-archive-'));
    const extractDir = join(tempRoot, 'extracted');

    try {
      await fsPromises.mkdir(extractDir, { recursive: true });

      const extractCommand = `tar -xf ${shellQuote(archive.archivePath)} -C ${shellQuote(extractDir)}`;
      await this.execCmd(extractCommand);

      const metadataPath = join(extractDir, 'metadata.json');
      if (!existsSync(metadataPath)) {
        throw new Error(`metadata.json not found in extracted archive: ${archive.archiveFilename}`);
      }

      const metadataRaw = await fsPromises.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
      const updatedMetadata = updateMetadata(metadata, scenarioMetrics);
      await fsPromises.writeFile(metadataPath, `${JSON.stringify(updatedMetadata, null, 2)}\n`, 'utf8');

      const outputArchivePath = join(dirname(archive.archivePath), `${parse(archive.archiveFilename).name}.tar`);

      const recompressCommand = `tar -cf ${shellQuote(outputArchivePath)} -C ${shellQuote(extractDir)} metadata.json data file`;
      await this.execCmd(recompressCommand);

      if (!existsSync(outputArchivePath)) {
        throw new Error(`Failed to create modified archive at path: ${outputArchivePath}`);
      }

      logger.info(`Archive metadata updated successfully: ${outputArchivePath}`);

      return {
        archivePath: outputArchivePath,
        archiveFilename: basename(outputArchivePath),
        scriptPath: archive.scriptPath,
        scriptFilename: archive.scriptFilename,
        archiveSize: statSync(outputArchivePath).size,
      };
    } catch (error) {
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to extract, modify, and recompress archive: ${errorMessage}`);
    } finally {
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  }
}

export function createDefaultScriptService(): ScriptService {
  return new ScriptService();
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function sanitizeText(text: string): string {
  let sanitized = text.toLowerCase();
  sanitized = sanitized.replace(/_/g, '-');
  sanitized = sanitized.replace(/[^a-z0-9.-]/g, '-');
  sanitized = sanitized.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  sanitized = sanitized.replace(/[-]+/g, '-');
  sanitized = sanitized.replace(/[.]+/g, '-');
  sanitized = sanitized.replace(/^[.-]+|[.-]+$/g, '');
  return sanitized;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function updateMetadata(metadata: Record<string, unknown>, scenarioMetrics: K6ScenarioMetrics[]): Record<string, unknown> {
  if (isRecord(metadata.options) && isRecord(metadata.options.scenarios)) {
    applyScenarioMetricsToScenarios(metadata.options.scenarios, scenarioMetrics);
  }
  return metadata;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function applyScenarioMetricsToScenarios(
  scenarios: Record<string, unknown>,
  scenarioMetrics: K6ScenarioMetrics[]
) {
  for (const metric of scenarioMetrics) {
    const scenario = scenarios[metric.name];
    if (!isRecord(scenario)) {
      continue;
    }
    const recommendedMaxVUs = Math.ceil(metric.recommendedMaxVUs);
    scenario.maxVUs = recommendedMaxVUs;
    scenario.preAllocatedVUs = Math.max(1, Math.ceil(recommendedMaxVUs * 0.7));
  }
}
