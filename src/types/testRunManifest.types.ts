export interface TestRunManifest {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
  };
  spec: {
    parallelism?: number;
    arguments?: string;
    quiet?: boolean;
    cleanup?: boolean;
    separate?: boolean;
    runner?: {
      image?: string;
      env?: Array<{
        name: string;
        value: string;
      }>;
      resources?: {
        limits: {
          cpu: string
          memory: string
        }
        requests: {
          cpu: string
          memory: string
        }
      }
    };
    script: {
      configMap?: {
        name: string;
        file: string;
      };
      volumeClaim?: {
        name: string;
        file: string;
      }
    };
  };
}
