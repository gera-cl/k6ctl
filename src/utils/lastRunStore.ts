import { promises as fs } from 'fs';
import path from 'path';
import logger from './logger';
import type { LastRunState } from '../types/lastRun.types';

const LAST_RUN_FILE = '.k6ctl-last-run.json';

function getFilePath(): string {
  return path.join(process.cwd(), LAST_RUN_FILE);
}

export async function saveLastRun(state: LastRunState): Promise<void> {
  const filePath = getFilePath();
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
  logger.debug(`Last run state saved to ${filePath}`);
}

export async function loadLastRun(): Promise<LastRunState | null> {
  const filePath = getFilePath();
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as LastRunState;
  } catch {
    return null;
  }
}

export async function clearLastRun(): Promise<void> {
  const filePath = getFilePath();
  try {
    await fs.unlink(filePath);
    logger.debug(`Last run state cleared (${filePath})`);
  } catch {
    logger.info('No last run state to clear.');
  }
}
