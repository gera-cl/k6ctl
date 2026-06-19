export interface HookDefinition {
  name: string;
  command: string;
  timeout?: number;
  continueOnError?: boolean;
  workingDir?: string;
}

export interface HooksConfig {
  preRun?: HookDefinition[];
}

export interface K6Config {
  namespace?: string;
  parallelism?: number;
  arguments?: string[] | undefined;
  cleanup?: boolean;
  quiet?: boolean;
  separate?: boolean;
  runner?: {
    image?: string;
    resources?: {
      limits: {
        cpu: string;
        memory: string;
      };
      requests: {
        cpu: string;
        memory: string;
      };
    };
  }
  prometheus?: {
    serverUrl: string;
    trendStats?: string[];
  }
  hooks?: HooksConfig;
}