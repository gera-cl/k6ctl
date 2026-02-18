import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { join, resolve } from 'node:path';
import { archiveTest } from '../../src/script/script.service';
import { existsSync } from 'node:fs';
import { mkdir, rmdir, unlink } from 'node:fs/promises';



const samplesPath = resolve(__dirname, '..', 'samples');
const scriptSample1 = join(samplesPath, 'k6_script_sample_1.js');
const scriptSample2 = join(samplesPath, 'k6_script_sample_2.js');
const archivedFiles: string[] = [];
const outputDirectory = resolve(__dirname, '..', 'archive_output');

describe('script.service - archive', () => {
  beforeAll(() => {
    // Create the output directory if it doesn't exist
    if (!existsSync(outputDirectory)) {
      mkdir(outputDirectory, { recursive: true });
    }
  });

  afterAll(async () => {
    // Clean up archived files after tests
    await Promise.all(
      archivedFiles.map(file => unlink(file).catch(error => console.error(`Error deleting file ${file}:`, error)))
    );
    // Clean up output directory after tests
    await rmdir(outputDirectory)
      .catch(error => console.error(`Error deleting output directory ${outputDirectory}:`, error));
  });

  test('throws an error when the script does not exist', async () => {
    await expect(archiveTest('./non_existent_script.js'))
      .rejects.toThrow("Script file not found at path");
  });

  test.skip('throws an error when k6 is not installed', async () => {
    await expect(archiveTest(scriptSample1)).rejects.toThrow("k6 is not installed");
  });

  test('archives the script successfully - sample #1', async () => {
    const archiveOutput = await archiveTest(scriptSample1);
    expect(existsSync(archiveOutput.archivePath)).toBe(true);
    archivedFiles.push(archiveOutput.archivePath);
  });

  test('archives the script successfully - sample #2', async () => {
    const archiveOutput = await archiveTest(scriptSample2);
    expect(existsSync(archiveOutput.archivePath)).toBe(true);
    archivedFiles.push(archiveOutput.archivePath);
  });

  test('non-existent output directory', async () => {
    await expect(archiveTest(scriptSample1, './fake-output'))
      .rejects.toThrow("Output directory does not exist at path");
  });

  test('archives the script successfully using output directory - sample #1', async () => {
    const archiveOutput = await archiveTest(scriptSample1, outputDirectory);
    expect(existsSync(archiveOutput.archivePath)).toBe(true);
    archivedFiles.push(archiveOutput.archivePath);
  });
});
