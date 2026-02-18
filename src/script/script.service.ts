import { exec } from "child_process";
import { existsSync, promises as fs_promises } from "fs";
import { basename, join, parse } from 'node:path';
import { promisify } from "util";
import * as k8s from '@kubernetes/client-node';

const execAsync = promisify(exec);

export interface ArchiveResult {
  archivePath: string;
  archiveFilename: string;
  scriptPath: string;
  scriptFilename: string;
}

export interface ConfigMapResult {
  namespace: string;
  configMapName: string;
  archivePath: string;
  archiveFilename: string;
}

export async function archiveTest(scriptPath: string, outputDirectory?: string): Promise<ArchiveResult> {
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
    await execAsync('k6 version');
  } catch (error) {
    throw new Error('k6 is not installed. Please install k6 to archive scripts.');
  }

  // Archive the script using k6
  try {
    // get the script name without extension to use as prefix for the archive file
    const scriptName = parse(scriptPath).name;
    const sanitizedScriptName = sanitizeText(scriptName);
    const archiveOutput = join(outputDirectory ?? '.', `archive-${sanitizedScriptName}-${Date.now()}.tar`);
    const archiveCommand = `k6 archive -v -O ${archiveOutput} ${scriptPath}`;
    console.log(`Archiving script with command: ${archiveCommand}`);
    const { stdout, stderr } = await execAsync(archiveCommand);
    console.log("Standard Output:", stdout);
    console.log("Standard Error:", stderr);

    // Check if the file was created successfully
    if (!existsSync(archiveOutput)) {
      throw new Error(`Failed to create archive: ${stderr}`);
    }
    console.info(`Archive created successfully at: ${archiveOutput}`);
    return {
      archivePath: archiveOutput,
      archiveFilename: basename(archiveOutput),
      scriptPath: scriptPath,
      scriptFilename: basename(scriptPath),
    }
  } catch (error) {
    const errorMessage = (error as Error).message ?? 'Unknown error';
    throw new Error(`Failed to archive the script: ${errorMessage}`);
  }
}

export async function createConfigMap(archiveResult: ArchiveResult, namespace: string): Promise<ConfigMapResult> {
  // check if the archive file exists
  if (!existsSync(archiveResult.archivePath)) throw new Error(`Archive file not found at path: ${archiveResult.archivePath}`);

  // check archive file size (should be less than 1MB for k8s configmap)
  const stats = await fs_promises.stat(archiveResult.archivePath);
  if (stats.size > 1024 * 1024) {
    throw new Error(`Archive file is too large to be stored in a configmap (size: ${stats.size} bytes)`);
  }

  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();

  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

  const configMapName = parse(archiveResult.archiveFilename).name;
  const fileContent = await fs_promises.readFile(archiveResult.archivePath, 'base64');

  const configMap: k8s.V1ConfigMap = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: configMapName,
      namespace: namespace,
    },
    binaryData: {
      [archiveResult.archiveFilename]: fileContent,
    },
  };

  await k8sApi.createNamespacedConfigMap({ namespace, body: configMap });
  console.info(`ConfigMap ${configMapName} created in namespace ${namespace}`);
  return {
    namespace,
    configMapName: configMapName,
    archivePath: archiveResult.archivePath,
    archiveFilename: archiveResult.archiveFilename,
  }
}

export async function deleteConfigMap(configMapName: string, namespace: string): Promise<void> {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();

  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

  try {
    await k8sApi.deleteNamespacedConfigMap({ name: configMapName, namespace });
    console.info(`ConfigMap ${configMapName} deleted from namespace ${namespace}`);
  } catch (error) {
    const errorMessage = (error as Error).message ?? 'Unknown error';
    throw new Error(`Failed to delete ConfigMap ${configMapName} from namespace ${namespace}: ${errorMessage}`);
  }
}

function sanitizeText(text: string): string {
  // Convert to lowercase
  let sanitized = text.toLowerCase();

  // Replace underscores with hyphens
  sanitized = sanitized.replace(/_/g, '-');

  // Replace any character that's not alphanumeric, hyphen, or dot with hyphen
  sanitized = sanitized.replace(/[^a-z0-9.-]/g, '-');

  // Remove leading and trailing non-alphanumeric characters
  sanitized = sanitized.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');

  // Replace multiple consecutive hyphens or dots with a single one
  sanitized = sanitized.replace(/[-]+/g, '-');
  sanitized = sanitized.replace(/[.]+/g, '.');

  // Ensure it doesn't start or end with a hyphen or dot
  sanitized = sanitized.replace(/^[.-]+|[.-]+$/g, '');

  return sanitized;
}
