#!/usr/bin/env node

import { Command } from 'commander';
import { runTest } from './commands/run';

const program = new Command();

program
  .name('k6ctl')
  .description('CLI tool to run k6 tests on Kubernetes using k6-operator')
  .version('0.1.0');

program
  .command('run <script>')
  .description('Run a k6 test script')
  .option('-c, --config <path>', 'Path to config file', 'k6ctl.config.js')
  .option('-n, --namespace <namespace>', 'Kubernetes namespace')
  .option('-p, --parallelism <number>', 'Number of parallel test pods')
  .action(runTest);

program.parse();
