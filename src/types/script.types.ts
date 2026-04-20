export interface ArchiveResult {
  archivePath: string;
  archiveFilename: string;
  archiveSize: number;
  scriptPath: string;
  scriptFilename: string;
}

export type ExecFn = (cmd: string) => Promise<{ stdout: string; stderr: string }>;