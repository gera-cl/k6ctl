import * as k8s from '@kubernetes/client-node';
import { printColumnar, truncateMiddle } from './table.util';
import { TestRunManifest } from '../types/testRunManifest.types';

const RUNNER_COLLAPSE_THRESHOLD = 5;

function fmt(v: any) {
  return v ?? "N/A";
}

function getNamespace(obj: any) {
  return obj?.metadata?.namespace ?? "default";
}

function getName(obj: any) {
  return obj?.metadata?.name ?? "unknown";
}

export function ageSince(isoDate: any): string {
  if (!isoDate) return "N/A";
  const created = new Date(isoDate).getTime();
  const now = Date.now();
  let s = Math.max(0, Math.floor((now - created) / 1000));
  const days = Math.floor(s / 86400); s %= 86400;
  const hrs = Math.floor(s / 3600); s %= 3600;
  const mins = Math.floor(s / 60);
  if (days > 0) return `${days}d${hrs}h`;
  if (hrs > 0) return `${hrs}h${mins}m`;
  return `${mins}m`;
}

export function classifyPod(podName: string): 'runner' | 'initializer' | 'starter' {
  if (/initializer/i.test(podName)) return 'initializer';
  if (/starter/i.test(podName)) return 'starter';
  return 'runner';
}

export function podCommonPrefix(names: string[]): string {
  if (names.length === 0) return '';
  let prefix = names[0];
  for (const name of names.slice(1)) {
    while (!name.startsWith(prefix)) {
      const idx = prefix.lastIndexOf('-');
      if (idx <= 0) return '';
      prefix = prefix.slice(0, idx);
    }
  }
  return prefix;
}

export function printPodsTable(data: k8s.V1PodList, opts: { verbose?: boolean } = {}): void {
  const pods = data.items ?? [];
  const headers = ['POD', 'STATUS', 'CPU (req/lim)', 'MEMORY (req/lim)'];
  if (opts.verbose) headers.push('NODE');

  const buildRow = (pod: k8s.V1Pod): string[] => {
    const podName = getName(pod);
    const phase = pod.status?.phase ?? 'unknown';
    const statusEmoji = phase === 'Succeeded' ? '🟢' : phase === 'Failed' ? '🔴' : '🟡';
    const c = pod.spec?.containers?.[0];
    const req = c?.resources?.requests ?? {};
    const lim = c?.resources?.limits ?? {};
    const row = [
      opts.verbose ? truncateMiddle(podName, 40) : podName,
      `${statusEmoji} ${phase}`,
      `${fmt(req.cpu)}/${fmt(lim.cpu)}`,
      `${fmt(req.memory)}/${fmt(lim.memory)}`,
    ];
    if (opts.verbose) row.push(truncateMiddle(pod.spec?.nodeName ?? 'N/A', 35));
    return row;
  };

  const runnerPods = pods.filter(p => classifyPod(getName(p)) === 'runner');
  const otherPods = pods.filter(p => classifyPod(getName(p)) !== 'runner');
  const rows: string[][] = otherPods.map(buildRow);

  if (!opts.verbose && runnerPods.length > RUNNER_COLLAPSE_THRESHOLD) {
    const total = runnerPods.length;
    const phaseCounts = new Map<string, number>();
    for (const p of runnerPods) {
      const phase = p.status?.phase ?? 'Unknown';
      phaseCounts.set(phase, (phaseCounts.get(phase) ?? 0) + 1);
    }
    const phaseEmoji: Record<string, string> = {
      Succeeded: '🟢', Running: '🟡', Pending: '🟡', Failed: '🔴', Unknown: '⚪',
    };
    const [dominantPhase, dominantCount] = [...phaseCounts.entries()]
      .sort((a, b) => b[1] - a[1])[0];
    const emoji = phaseEmoji[dominantPhase] ?? '⚪';
    const prefix = podCommonPrefix(runnerPods.map(getName));
    const statusCell = `${emoji} ${dominantPhase} ${dominantCount}/${total}`;
    const rc = runnerPods[0]?.spec?.containers?.[0];
    const rreq = rc?.resources?.requests ?? {};
    const rlim = rc?.resources?.limits ?? {};
    const row = [prefix, statusCell, `${fmt(rreq.cpu)}/${fmt(rlim.cpu)}`, `${fmt(rreq.memory)}/${fmt(rlim.memory)}`];
    rows.push(row);
  } else {
    for (const pod of runnerPods) rows.push(buildRow(pod));
  }

  printColumnar(headers, rows, 'Pods');
}

export function printConfigMapsTable(data: k8s.V1ConfigMapList): void {
  const cms = data.items ?? [];
  const headers = ['NAME', 'NAMESPACE', 'DATA KEYS', 'BINARY KEYS', 'AGE'];
  const rows: string[][] = cms.map(cm => [
    getName(cm),
    getNamespace(cm),
    Object.keys(cm.data ?? {}).length ? Object.keys(cm.data ?? {}).join(", ") : "0",
    Object.keys(cm.binaryData ?? {}).length ? Object.keys(cm.binaryData ?? {}).join(", ") : "0",
    ageSince(cm.metadata?.creationTimestamp),
  ]);
  printColumnar(headers, rows, 'ConfigMaps');
}

export function printTestRunsTable(testRuns: TestRunManifest[]): void {
  const headers = ['NAME', 'PARALLELISM', 'AGE'];
  const rows: string[][] = testRuns.map(tr => [
    tr.metadata?.name ?? 'unknown',
    String(tr.spec?.parallelism ?? 'N/A'),
    ageSince((tr as any)?.metadata?.creationTimestamp),
  ]);
  printColumnar(headers, rows, 'TestRuns');
}
