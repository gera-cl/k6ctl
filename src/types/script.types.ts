export interface ArchiveResult {
  archivePath: string;
  archiveFilename: string;
  archiveSize: number;
  scriptPath: string;
  scriptFilename: string;
}

export interface K6ScenarioOptions {
  executor: string;
  startTime?: string;
  gracefulStop?: string;
  env?: Record<string, string>;
  exec?: string;
  tags?: Record<string, string>;
  startRate?: number;
  timeUnit?: string;  // e.g. "1s", "500ms"
  stages?: Array<{ duration: string; target: number }>;
  preAllocatedVUs?: number;
  maxVUs?: number;
}

export interface K6InspectResult {
  scenarios?: Record<string, K6ScenarioOptions>;
}

export interface K6StageMetrics {
  stageIndex: number;
  duration: string;
  durationSeconds: number;
  fromTps: number;
  toTps: number;
  avgTps: number;
  estimatedIterations: number;
  requiredVUsAtTarget: number;
  recommendedVUsAtTarget: number;
}

export interface K6ScenarioMetrics {
  name: string;
  peakTps: number;
  totalIterations: number;
  requiredMaxVUs: number;
  recommendedMaxVUs: number;
  stageMetrics: K6StageMetrics[];
}

export type ExecFn = (cmd: string) => Promise<{ stdout: string; stderr: string }>;