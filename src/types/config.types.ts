export interface K6Config {
  namespace?: string;
  parallelism?: number;
  arguments?: string[];
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
}