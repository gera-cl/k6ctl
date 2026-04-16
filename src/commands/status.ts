import { createDefaultKubernetesService } from '../services/kubernetes.service';
import { printPodsTable, printTestRunsTable } from '../services/kubernetes.service';
import { loadLastRun } from '../utils/lastRunStore';
import logger from '../utils/logger';

interface StatusOptions {
  namespace?: string;
}

export async function status(options: StatusOptions) {
  const lastRun = await loadLastRun();
  if (!lastRun) {
    logger.error('No last run found. Run a test first with: k6ctl run <script>');
    process.exit(1);
  }

  const namespace = options.namespace ?? lastRun.namespace;
  logger.info(`Status for TestRun: ${lastRun.testRunName} (namespace: ${namespace})`);
  logger.info(`Script: ${lastRun.scriptPath}  |  Started: ${lastRun.createdAt}`);

  const kubernetesService = createDefaultKubernetesService();

  const testRun = await kubernetesService.getTestRun(lastRun.testRunName, namespace);
  if (!testRun) {
    logger.error(`TestRun ${lastRun.testRunName} not found in namespace ${namespace}. It may have been deleted externally.`);
    process.exit(1);
  }
  printTestRunsTable([testRun]);

  const podList = await kubernetesService.getPodsForTestRun(lastRun.testRunName, namespace);
  printPodsTable(podList);
}
