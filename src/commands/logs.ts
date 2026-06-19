import { PassThrough } from 'stream';
import * as readline from 'readline';
import { createDefaultKubernetesService } from '../services/kubernetes.service';
import { loadLastRun } from '../utils/lastRunStore';
import logger from '../utils/logger';

interface LogsOptions {
  namespace?: string;
  container?: string;
  follow?: boolean;
  tail?: number;
  pod?: string;
  type?: 'runner' | 'initializer' | 'starter';
  timestamps?: boolean;
}

const colorMap: Record<string, string> = {
  initializer: '\x1b[36m', // cyan
  starter: '\x1b[32m',     // green
  runner: '\x1b[33m',      // yellow
  unknown: '\x1b[35m',     // magenta
};
const reset = '\x1b[0m';
const dim = '\x1b[2m';

export function getPodType(pod: any): 'runner' | 'initializer' | 'starter' | 'unknown' {
  const name = typeof pod === 'string' ? pod : (pod?.metadata?.name || '');

  if (name.includes('-initializer')) return 'initializer';
  if (name.includes('-starter')) return 'starter';

  if (typeof pod !== 'string') {
    const labels = pod?.metadata?.labels || {};
    if (labels.runner === 'true' || labels.runner === true) return 'runner';
  }

  // Fallback: If it's a valid pod name from k6-operator list, but not starter/initializer, it's a runner.
  if (name) return 'runner';

  return 'unknown';
}

export function getPodDisplayName(podName: string, testRunName: string): string {
  if (podName.startsWith(testRunName)) {
    let suffix = podName.substring(testRunName.length);
    if (suffix.startsWith('-')) {
      suffix = suffix.substring(1);
    }
    return suffix || podName;
  }
  return podName;
}

export function parseLogLine(line: string): { timestamp?: string; content: string } {
  const spaceIndex = line.indexOf(' ');
  if (spaceIndex > 0) {
    const tsStr = line.substring(0, spaceIndex);
    const time = Date.parse(tsStr);
    if (!isNaN(time)) {
      return {
        timestamp: tsStr,
        content: line.substring(spaceIndex + 1),
      };
    }
  }
  return { content: line };
}

export async function logs(options: LogsOptions) {
  const lastRun = await loadLastRun();
  if (!lastRun) {
    logger.error('No last run found. Run a test first with: k6ctl run <script>');
    process.exit(1);
  }

  const namespace = options.namespace ?? lastRun.namespace;
  logger.info(`Fetching logs for TestRun: ${lastRun.testRunName} (namespace: ${namespace})`);

  const kubernetesService = createDefaultKubernetesService();
  const podList = await kubernetesService.getPodsForTestRun(lastRun.testRunName, namespace);
  const pods = podList.items ?? [];

  if (pods.length === 0) {
    logger.warn(`No pods found for TestRun ${lastRun.testRunName}. The run may have already cleaned up.`);
    return;
  }

  let matchingPods = pods;
  if (options.pod) {
    matchingPods = matchingPods.filter(p => p.metadata?.name === options.pod);
  }
  if (options.type) {
    matchingPods = matchingPods.filter(p => {
      return getPodType(p) === options.type;
    });
  }

  if (matchingPods.length === 0) {
    logger.warn('No pods matched the specified filters.');
    return;
  }

  const isFollowing = !!options.follow;
  const showTimestamps = !!options.timestamps;
  // Store last-seen timestamp as a pre-parsed number (epoch ms) so every
  // comparison is a plain integer comparison instead of a Date.parse() call.
  const lastPrintedTimestamps: Record<string, number> = {};

  let tailLines: number | undefined = undefined;
  let sinceSeconds: number | undefined = undefined;

  if (isFollowing) {
    if (options.tail !== undefined) {
      if (options.tail === 0) {
        sinceSeconds = 1;
      } else {
        tailLines = options.tail;
      }
    } else {
      sinceSeconds = 1;
    }
  } else {
    tailLines = options.tail !== undefined ? options.tail : 100;
  }

  interface ParsedLine {
    timestamp?: string;
    time: number;
    content: string;
    podName: string;
    podType: 'runner' | 'initializer' | 'starter' | 'unknown';
  }

  // 1. Fetch history if needed (either not following, or following with tail > 0)
  const needsHistory = !isFollowing || (options.tail !== undefined && options.tail > 0);
  const tailLimit = options.tail !== undefined ? options.tail : (isFollowing ? 0 : 100);

  if (needsHistory && tailLimit > 0) {
    const fetchPromises = matchingPods.map(async (pod) => {
      const podName = pod.metadata?.name ?? 'unknown';
      const podType = getPodType(pod);
      try {
        const rawLogs = await kubernetesService.getPodLogs(
          podName,
          namespace,
          options.container,
          tailLimit,
          true, // ALWAYS fetch timestamps to sort
        );
        return { podName, podType, rawLogs };
      } catch (error) {
        logger.error(`Failed to get logs for pod ${podName}: ${error instanceof Error ? error.message : String(error)}`);
        return { podName, podType, rawLogs: '' };
      }
    });

    const results = await Promise.all(fetchPromises);
    const allLines: ParsedLine[] = [];

    for (const res of results) {
      const lines = res.rawLogs.split('\n');
      let lastTimestampForPod: string | undefined;
      for (const line of lines) {
        if (!line.trim()) continue;
        const { timestamp, content } = parseLogLine(line);
        const time = timestamp ? Date.parse(timestamp) : 0;
        allLines.push({
          timestamp,
          time,
          content,
          podName: res.podName,
          podType: res.podType,
        });
        if (timestamp) lastTimestampForPod = timestamp;
      }
      // Track last known timestamp (as epoch ms) for every pod so the stream
      // dedup filter works correctly even for pods whose lines don't make it
      // into outputLines.
      if (isFollowing && lastTimestampForPod) {
        // line.time is already parsed — find it from allLines for this pod.
        // Re-use lastTimestampForPod string; parse once here.
        const t = Date.parse(lastTimestampForPod);
        if (!isNaN(t)) lastPrintedTimestamps[res.podName] = t;
      }
    }

    allLines.sort((a, b) => a.time - b.time);
    const outputLines = allLines.slice(-tailLimit);

    for (const line of outputLines) {
      // Update lastPrintedTimestamps for lines that are actually printed.
      // line.time is already the pre-parsed epoch ms — no extra Date.parse needed.
      // (For pods not in outputLines, lastPrintedTimestamps was already set above.)
      if (isFollowing) {
        const existing = lastPrintedTimestamps[line.podName];
        if (line.time > 0 && (existing === undefined || line.time > existing)) {
          lastPrintedTimestamps[line.podName] = line.time;
        }
      } else if (line.time > 0) {
        lastPrintedTimestamps[line.podName] = line.time;
      }
      const displayName = getPodDisplayName(line.podName, lastRun.testRunName);
      const color = colorMap[line.podType] || colorMap.unknown;
      const prefix = `${color}[${line.podType}/${displayName}]${reset}`;
      const dimTs = (showTimestamps && line.timestamp) ? `${dim}[${line.timestamp}]${reset} ` : '';
      if (!process.stdout.write(`${dimTs}${prefix} ${line.content}\n`)) {
        await new Promise<void>(resolve => process.stdout.once('drain', resolve));
      }
    }
  }

  // 2. Stream if follow is active
  if (isFollowing) {
    const activeStreams: any[] = [];
    const cleanup = () => {
      for (const s of activeStreams) {
        try {
          if (s && typeof s.abort === 'function') {
            s.abort();
          } else if (s && typeof s.destroy === 'function') {
            s.destroy();
          }
        } catch (err) {
          // ignore
        }
      }
    };

    process.on('SIGINT', () => {
      cleanup();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      cleanup();
      process.exit(0);
    });

    const streamPromises = matchingPods.map(async (pod) => {
      const podName = pod.metadata?.name ?? 'unknown';
      const podType = getPodType(pod);
      const displayName = getPodDisplayName(podName, lastRun.testRunName);
      const color = colorMap[podType] || colorMap.unknown;
      const prefix = `${color}[${podType}/${displayName}]${reset}`;

      try {
        const passThrough = new PassThrough();
        const rl = readline.createInterface({
          input: passThrough,
          crlfDelay: Infinity,
        });

        const drainHandler = () => rl.resume();
        process.stdout.on('drain', drainHandler);

        rl.on('line', (line) => {
          const { timestamp, content } = parseLogLine(line);
          // Parse the timestamp once; reuse the number for both dedup check
          // and for storing — avoids two Date.parse() calls per line.
          const time = timestamp ? Date.parse(timestamp) : NaN;

          // Duplicate detection: skip lines at or before the last seen timestamp.
          const lastTime = lastPrintedTimestamps[podName];
          if (!isNaN(time) && lastTime !== undefined && time <= lastTime) {
            return;
          }

          if (!isNaN(time)) {
            lastPrintedTimestamps[podName] = time;
          }

          const dimTs = (showTimestamps && timestamp) ? `${dim}[${timestamp}]${reset} ` : '';
          if (!process.stdout.write(`${dimTs}${prefix} ${content}\n`)) {
            rl.pause();
          }
        });

        // Always request timestamps from the stream when history was fetched,
        // so the dedup filter can compare timestamps reliably.
        const historyWasFetched = needsHistory && tailLimit > 0;
        const requestTimestamps = showTimestamps || historyWasFetched;

        const controller = await kubernetesService.streamPodLogs(
          podName,
          namespace,
          options.container,
          passThrough,
          {
            follow: true,
            timestamps: requestTimestamps,
            // When history was already fetched and displayed, limit the stream
            // to replay at most 1 line (server-side). The dedup filter handles
            // the overlap. Without this, the stream replays ALL historical logs
            // because sinceSeconds is undefined when -t N is used.
            ...(historyWasFetched
              ? { tailLines: 1 }
              : { sinceSeconds: sinceSeconds }),
          }
        );
        if (controller) {
          activeStreams.push(controller);
        }

        await new Promise<void>((resolve) => {
          const done = () => {
            process.stdout.removeListener('drain', drainHandler);
            resolve();
          };
          rl.on('close', done);
          passThrough.on('error', done);
        });
      } catch (error) {
        logger.error(`Stream error for pod ${podName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    await Promise.all(streamPromises);
    cleanup();
  }
}
