#!/usr/bin/env node

import { Argument, Command } from 'commander';
import { runTest } from './commands/run';
import { list } from './commands/list';
import { version } from '../package.json';

const program = new Command();

program
  .name('k6ctl')
  .description('CLI tool to run k6 tests on Kubernetes using k6-operator')
  .version(version);

program
  .command('run <script>')
  .description('Run a k6 test script')
  .option('-c, --config <path>', 'Path to config file', 'k6ctl.config.js')
  .option('-n, --namespace <namespace>', 'Kubernetes namespace')
  .option('-p, --parallelism <number>', 'Number of parallel test pods')
  .option('-v, --verbose', 'enable debug logging')
  .action(runTest);

program
  .command('list')
  .description('List all resources')
  .addArgument(new Argument('[type]', 'Resource type').choices(['pods', 'testruns', 'configmaps']).default('all'))
  .option('-n, --namespace <namespace>', 'Kubernetes namespace', 'default')
  .action(list);

program.parse();
