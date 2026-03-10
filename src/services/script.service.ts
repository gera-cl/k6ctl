import { exec } from 'child_process';
import { existsSync } from 'fs';
import { basename, join, parse } from 'node:path';
import { promisify } from 'util';
import logger from '../utils/logger';

import type { ArchiveResult, ExecFn } from '../types/script.types';

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
      logger.info(`Archive created successfully at: ${archiveOutput}`);
      return {
        archivePath: archiveOutput,
        archiveFilename: basename(archiveOutput),
        scriptPath: scriptPath,
        scriptFilename: basename(scriptPath),
      };
    } catch (error) {
      const errorMessage = (error as Error).message ?? 'Unknown error';
      throw new Error(`Failed to archive the script: ${errorMessage}`);
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
