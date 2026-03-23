import { createDefaultKubernetesService } from '../services/kubernetes.service';
import { loadLastRun } from '../utils/lastRunStore';
import logger from '../utils/logger';

interface LogsOptions {
  namespace?: string;
  container?: string;
}

export async function logs(options: LogsOptions) {
  const lastRun = await loadLastRun();
  if (!lastRun) {
    logger.error('No last run found. Run a test first with: k6ctl run <script>');
    process.exit(1);
  }

  const namespace = options.namespace ?? lastRun.namespace;
  logger.info(`Fetching logs for TestRun: ${lastRun.testRunName} (namespace: ${namespace})`);

  const kubernetesService = createDefaultKubernetesService();
  const podList = await kubernetesService.getPodsForTestRun(lastRun.testRunName, namespace);
  const pods = podList.items ?? [];

  if (pods.length === 0) {
    logger.warn(`No pods found for TestRun ${lastRun.testRunName}. The run may have already cleaned up.`);
    return;
  }

  for (const pod of pods) {
    const podName = pod.metadata?.name ?? 'unknown';
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Pod: ${podName}`);
    console.log('─'.repeat(60));
    try {
      const podLogs = await kubernetesService.getPodLogs(podName, namespace, options.container);
      console.log(podLogs);
    } catch (error) {
      logger.error(`Failed to get logs for pod ${podName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
