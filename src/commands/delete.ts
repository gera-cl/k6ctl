import { createDefaultKubernetesService } from '../services/kubernetes.service';
import { loadLastRun, clearLastRun } from '../utils/lastRunStore';
import logger from '../utils/logger';

interface DeleteOptions {
  namespace?: string;
  keepConfigmap?: boolean;
  pod?: string;
  testrun?: string;
  configmap?: string;
}

export async function deleteLastRun(options: DeleteOptions) {
  const kubernetesService = createDefaultKubernetesService();

  const lastRun = !options.namespace ? await loadLastRun() : null;
  const namespace = options.namespace ?? lastRun?.namespace ?? 'default';

  if (options.pod) {
    logger.info(`Deleting Pod: ${options.pod} (namespace: ${namespace})`);
    await kubernetesService.deletePodByName(options.pod, namespace);
    return;
  }

  if (options.testrun) {
    logger.info(`Deleting TestRun: ${options.testrun} (namespace: ${namespace})`);
    await kubernetesService.deleteTestRunByName(options.testrun, namespace);
    return;
  }

  if (options.configmap) {
    logger.info(`Deleting ConfigMap: ${options.configmap} (namespace: ${namespace})`);
    await kubernetesService.deleteConfigMap(options.configmap, namespace);
    return;
  }

  if (!lastRun) {
    logger.error('No last run found. Run a test first with: k6ctl run <script>');
    process.exit(1);
  }

  logger.info(`Deleting TestRun: ${lastRun.testRunName} (namespace: ${namespace})`);
  await kubernetesService.deleteTestRunByName(lastRun.testRunName, namespace);

  if (!options.keepConfigmap) {
    logger.info(`Deleting ConfigMap: ${lastRun.configMapName} (namespace: ${namespace})`);
    await kubernetesService.deleteConfigMap(lastRun.configMapName, namespace);
  }

  await clearLastRun();
  logger.info('Last run state cleared.');
}
