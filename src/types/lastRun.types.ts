export interface LastRunState {
  testRunName: string;
  namespace: string;
  configMapName?: string;
  volumeClaimName?: string;
  scriptPath: string;
  createdAt: string;
}
