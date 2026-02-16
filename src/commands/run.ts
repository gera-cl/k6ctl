interface RunOptions {
  config: string;
  namespace?: string;
  parallelism?: number;
}

export async function runTest(scriptPath: string, options: RunOptions) {
  console.log(`Running k6 test: ${scriptPath}`);
  console.log(`Using config: ${JSON.stringify(options.config, null, 2)}`);
}
