#!/usr/bin/env node

import { Argument, Command } from 'commander';
import { runTest } from './commands/run';
import { list } from './commands/list';
import { logs } from './commands/logs';
import { status } from './commands/status';
import { deleteLastRun } from './commands/delete';
import { version } from '../package.json';
import logger from './utils/logger';

const program = new Command();

program
  .name('k6ctl')
  .description('CLI tool to run k6 tests on Kubernetes using k6-operator')
  .version(version);

program
  .command('run [script]')
  .description('Run a k6 test script (omit to select interactively from ${pwd}/dist/tests)')
  .option('-c, --config <path>', 'Path to config file', 'k6ctl.config.json')
  .option('-n, --namespace <namespace>', 'Kubernetes namespace')
  .option('-p, --parallelism <number>', 'Number of parallel test pods')
  .option('-v, --verbose', 'enable debug logging')
  .option('-d, --dir <path>', 'Folder to search for .js test files', 'dist/tests')
  .option('--smart', 'Enable smart scenario analysis')
  .option('--default-vus-per-pod <number>', 'Default VUs per pod (requires --smart) (default: 200)')
  .option('--max-iteration-duration <number>', 'Max iteration duration in seconds (requires --smart) (default: 30)')
  .option('--skip-hooks', 'Skip all pre and post run hooks')
  .option('--skip-pre-hooks', 'Skip pre-run hooks only')
  .option('--skip-post-hooks', 'Skip post-run hooks only')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (!opts.smart && (opts.defaultVusPerPod || opts.maxIterationDuration)) {
      logger.warn("Options '--default-vus-per-pod' and '--max-iteration-duration' require '--smart'");
      thisCommand.outputHelp();
      process.exit(1);
    }
  })
  .action(runTest);

program
  .command('list')
  .description('List all resources')
  .addArgument(new Argument('[type]', 'Resource type').choices(['pods', 'testruns', 'configmaps']).default('all'))
  .option('-n, --namespace <namespace>', 'Kubernetes namespace', 'default')
  .action(list);

program
  .command('logs')
  .description('Show logs from the last test run pods')
  .option('-n, --namespace <namespace>', 'Kubernetes namespace (overrides saved value)')
  .option('-c, --container <name>', 'Container name to fetch logs from')
  .action(logs);

program
  .command('status')
  .description('Show status of the last test run')
  .option('-n, --namespace <namespace>', 'Kubernetes namespace (overrides saved value)')
  .action(status);

program
  .command('delete')
  .description('Delete the last test run (TestRun + script)')
  .option('-n, --namespace <namespace>', 'Kubernetes namespace (overrides saved value)')
  .option('--keep-script', 'Skip deletion of the associated script in ConfigMap or PVC')
  .option('-p, --pod <name>', 'Delete a specific pod instead of those associated with the last TestRun')
  .option('-t, --testrun <name>', 'Delete a specific TestRun by name instead of the last one')
  .option('-c, --configmap <name>', 'Delete a specific ConfigMap by name instead of the one associated with the last TestRun')
  .action(deleteLastRun);

program.parse();
