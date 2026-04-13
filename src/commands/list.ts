import logger, { setLogLevel } from '../utils/logger';
import { createDefaultKubernetesService, printPodsTable, printTestRunsTable, printConfigMapsTable } from '../services/kubernetes.service';

export async function list(type: string, options: { namespace?: string }) {
  const kubernetesService = createDefaultKubernetesService();
  switch (type) {
    case 'all':
      logger.debug(`Listing all resources in namespace: ${options.namespace}`);
      printTestRunsTable(await kubernetesService.listTestRuns(options.namespace));
      printPodsTable(await kubernetesService.listPods(options.namespace));
      printConfigMapsTable(await kubernetesService.listConfigMaps(options.namespace));
      break;
    case 'pods':
      logger.debug(`Listing Pods in namespace: ${options.namespace}`);
      printPodsTable(await kubernetesService.listPods(options.namespace));
      break;
    case 'testruns':
      logger.debug(`Listing TestRuns in namespace: ${options.namespace}`);
      printTestRunsTable(await kubernetesService.listTestRuns(options.namespace));
      break;
    case 'configmaps':
      logger.debug(`Listing ConfigMaps in namespace: ${options.namespace}`);
      printConfigMapsTable(await kubernetesService.listConfigMaps(options.namespace));
      break;
    default:
      logger.debug(`Listing ${type} in namespace: ${options.namespace}`);
      break;
  }
}
