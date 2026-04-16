export interface ArchivedFile {
  archivePath: string;
  archiveFilename: string;
}

export interface ConfigMapResult {
  namespace: string;
  configMapName: string;
}

export interface VolumeClaimResult {
  namespace: string;
  volumeClaimName: string;
  archiveFilename: string;
}
