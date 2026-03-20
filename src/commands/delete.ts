import { createDefaultKubernetesService } from '../services/kubernetes.service';
import { loadLastRun, clearLastRun } from '../utils/lastRunStore';
import logger from '../utils/logger';

interface DeleteOptions {
  namespace?: string;
  keepConfigmap?: boolean;
}

export async function deleteLastRun(options: DeleteOptions) {
  const lastRun = await loadLastRun();
  if (!lastRun) {
    logger.error('No last run found. Run a test first with: k6ctl run <script>');
    process.exit(1);
  }

  const namespace = options.namespace ?? lastRun.namespace;
  logger.info(`Deleting TestRun: ${lastRun.testRunName} (namespace: ${namespace})`);

  const kubernetesService = createDefaultKubernetesService();

  await kubernetesService.deleteTestRunByName(lastRun.testRunName, namespace);

  if (!options.keepConfigmap) {
    logger.info(`Deleting ConfigMap: ${lastRun.configMapName} (namespace: ${namespace})`);
    await kubernetesService.deleteConfigMap(lastRun.configMapName, namespace);
  }

  await clearLastRun();
  logger.info('Last run state cleared.');
}
