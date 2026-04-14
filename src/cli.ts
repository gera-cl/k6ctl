#!/usr/bin/env node

import { Argument, Command } from 'commander';
import { runTest } from './commands/run';
import { list } from './commands/list';
import { logs } from './commands/logs';
import { status } from './commands/status';
import { deleteLastRun } from './commands/delete';
import { version } from '../package.json';

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
  .description('Delete the last test run (TestRun + ConfigMap)')
  .option('-n, --namespace <namespace>', 'Kubernetes namespace (overrides saved value)')
  .option('--keep-configmap', 'Skip deletion of the associated ConfigMap')
  .option('-p, --pod <name>', 'Delete a specific pod instead of those associated with the last TestRun')
  .option('-t, --testrun <name>', 'Delete a specific TestRun by name instead of the last one')
  .option('-c, --configmap <name>', 'Delete a specific ConfigMap by name instead of the one associated with the last TestRun')
  .action(deleteLastRun);

program.parse();
