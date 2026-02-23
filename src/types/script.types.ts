export interface ArchiveResult {
  archivePath: string;
  archiveFilename: string;
  scriptPath: string;
  scriptFilename: string;
}

export type ExecFn = (cmd: string) => Promise<{ stdout: string; stderr: string }>;