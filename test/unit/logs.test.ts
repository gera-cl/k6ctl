import { beforeEach, afterEach, describe, expect, jest, test } from '@jest/globals';
import { logs, getPodType, getPodDisplayName, parseLogLine } from '../../src/commands/logs';
import { loadLastRun } from '../../src/utils/lastRunStore';
import logger from '../../src/utils/logger';

// Mock lastRunStore
jest.mock('../../src/utils/lastRunStore', () => ({
  loadLastRun: jest.fn(),
}));

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock kubernetes service
const mockGetPodsForTestRun = jest.fn();
const mockGetPodLogs = jest.fn();
const mockStreamPodLogs = jest.fn();

jest.mock('../../src/services/kubernetes.service', () => ({
  createDefaultKubernetesService: jest.fn(() => ({
    getPodsForTestRun: mockGetPodsForTestRun,
    getPodLogs: mockGetPodLogs,
    streamPodLogs: mockStreamPodLogs,
  })),
}));

describe('logs command helpers', () => {
  test('getPodType classifies pods correctly', () => {
    // String fallback / name parsing
    expect(getPodType('my-run-initializer')).toBe('initializer');
    expect(getPodType('my-run-starter')).toBe('starter');
    expect(getPodType('test-geo-intl-cyber-smoke-test-1781823032181-1-bsqdk')).toBe('runner');

    // Pod object with labels
    expect(getPodType({ metadata: { labels: { runner: 'true' } } })).toBe('runner');

    // Pod object with labels as booleans
    expect(getPodType({ metadata: { labels: { runner: true } } })).toBe('runner');

    // Pod object without labels (fallback to name check)
    expect(getPodType({ metadata: { name: 'test-geo-intl-cyber-smoke-test-1781823032181-1-bsqdk' } })).toBe('runner');
    expect(getPodType({ metadata: { name: 'my-run-initializer' } })).toBe('initializer');
    expect(getPodType({ metadata: { name: 'my-run-starter' } })).toBe('starter');
    expect(getPodType({ metadata: {} })).toBe('unknown');
  });

  test('getPodDisplayName formats display name correctly', () => {
    expect(getPodDisplayName('my-run-runner-abcde', 'my-run')).toBe('runner-abcde');
    expect(getPodDisplayName('my-run-initializer', 'my-run')).toBe('initializer');
    expect(getPodDisplayName('some-other-pod', 'my-run')).toBe('some-other-pod');
  });

  test('parseLogLine extracts timestamps and contents', () => {
    expect(parseLogLine('2026-06-18T22:58:24.123Z log message'))
      .toEqual({ timestamp: '2026-06-18T22:58:24.123Z', content: 'log message' });

    expect(parseLogLine('not-a-timestamp message'))
      .toEqual({ content: 'not-a-timestamp message' });

    expect(parseLogLine('simple-line'))
      .toEqual({ content: 'simple-line' });
  });
});

describe('logs command execution', () => {
  let mockExit: jest.SpiedFunction<typeof process.exit>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockStdoutWrite: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExit = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined): never => {
      throw new Error(`process.exit called with ${code}`);
    });
    mockStdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation((() => true) as any);
  });

  afterEach(() => {
    mockExit.mockRestore();
    mockStdoutWrite.mockRestore();
  });

  test('errors and exits when no last run is found', async () => {
    (loadLastRun as any).mockResolvedValue(null);

    await expect(logs({})).rejects.toThrow('process.exit called with 1');
    expect(logger.error).toHaveBeenCalledWith('No last run found. Run a test first with: k6ctl run <script>');
  });

  test('warns when no pods are found for the last run', async () => {
    (loadLastRun as any).mockResolvedValue({ testRunName: 'my-run', namespace: 'default' });
    (mockGetPodsForTestRun as any).mockResolvedValue({ items: [] });

    await logs({});

    expect(logger.warn).toHaveBeenCalledWith('No pods found for TestRun my-run. The run may have already cleaned up.');
  });

  test('fetches and sorts static logs chronologically (Mode A)', async () => {
    (loadLastRun as any).mockResolvedValue({ testRunName: 'my-run', namespace: 'default' });
    (mockGetPodsForTestRun as any).mockResolvedValue({
      items: [
        { metadata: { name: 'my-run-initializer' } },
        { metadata: { name: 'my-run-runner-0' } },
        { metadata: { name: 'my-run-starter' } },
      ],
    });

    (mockGetPodLogs as any).mockImplementation(async (podName: string) => {
      if (podName === 'my-run-initializer') {
        return '2026-06-18T22:58:00Z init logs';
      }
      if (podName === 'my-run-runner-0') {
        return '2026-06-18T22:58:10Z runner logs';
      }
      if (podName === 'my-run-starter') {
        return '2026-06-18T22:58:05Z starter logs';
      }
      return '';
    });

    await logs({ tail: 50 });

    // Verify option forwarding
    expect(mockGetPodLogs).toHaveBeenCalledWith('my-run-initializer', 'default', undefined, 50, true);

    // Verify sorting in console output (and no timestamps by default)
    const consoleCalls = mockStdoutWrite.mock.calls.map((call: any) => call[0]);
    expect(consoleCalls).toHaveLength(3);

    // 1st: initializer
    expect(consoleCalls[0]).toContain('init logs');
    expect(consoleCalls[0]).toContain('initializer');
    expect(consoleCalls[0]).not.toContain('2026-06-18T22:58');

    // 2nd: starter (sorted before runner)
    expect(consoleCalls[1]).toContain('starter logs');
    expect(consoleCalls[1]).toContain('starter');
    expect(consoleCalls[1]).not.toContain('2026-06-18T22:58');

    // 3rd: runner
    expect(consoleCalls[2]).toContain('runner logs');
    expect(consoleCalls[2]).toContain('runner-0');
    expect(consoleCalls[2]).not.toContain('2026-06-18T22:58');
  });

  test('limits the total combined logs output to tail parameter (sum total)', async () => {
    (loadLastRun as any).mockResolvedValue({ testRunName: 'my-run', namespace: 'default' });
    (mockGetPodsForTestRun as any).mockResolvedValue({
      items: [
        { metadata: { name: 'my-run-initializer' } },
        { metadata: { name: 'my-run-runner-0' } },
      ],
    });

    (mockGetPodLogs as any).mockImplementation(async (podName: string) => {
      if (podName === 'my-run-initializer') {
        return '2026-06-18T22:58:00Z init logs';
      }
      if (podName === 'my-run-runner-0') {
        return '2026-06-18T22:58:10Z runner logs';
      }
      return '';
    });

    await logs({ tail: 1 });

    const consoleCalls = mockStdoutWrite.mock.calls.map((call: any) => call[0]);
    expect(consoleCalls).toHaveLength(1);
    expect(consoleCalls[0]).toContain('runner logs');
    expect(consoleCalls[0]).not.toContain('init logs');
  });

  test('filters pods by pod name filter (--pod)', async () => {
    (loadLastRun as any).mockResolvedValue({ testRunName: 'my-run', namespace: 'default' });
    (mockGetPodsForTestRun as any).mockResolvedValue({
      items: [
        { metadata: { name: 'my-run-initializer' } },
        { metadata: { name: 'my-run-runner-0' } },
      ],
    });
    (mockGetPodLogs as any).mockResolvedValue('2026-06-18T22:58:00Z log');

    await logs({ pod: 'my-run-runner-0' });

    expect(mockGetPodLogs).toHaveBeenCalledTimes(1);
    expect(mockGetPodLogs).toHaveBeenCalledWith('my-run-runner-0', 'default', undefined, 100, true);
  });

  test('filters pods by pod type filter (--type)', async () => {
    (loadLastRun as any).mockResolvedValue({ testRunName: 'my-run', namespace: 'default' });
    (mockGetPodsForTestRun as any).mockResolvedValue({
      items: [
        { metadata: { name: 'my-run-initializer' } },
        { metadata: { name: 'my-run-runner-0' } },
      ],
    });
    (mockGetPodLogs as any).mockResolvedValue('2026-06-18T22:58:00Z log');

    await logs({ type: 'initializer' });

    expect(mockGetPodLogs).toHaveBeenCalledTimes(1);
    expect(mockGetPodLogs).toHaveBeenCalledWith('my-run-initializer', 'default', undefined, 100, true);
  });

  test('streams logs concurrently (Mode B)', async () => {
    (loadLastRun as any).mockResolvedValue({ testRunName: 'my-run', namespace: 'default' });
    (mockGetPodsForTestRun as any).mockResolvedValue({
      items: [
        { metadata: { name: 'my-run-runner-0' } },
      ],
    });

    (mockStreamPodLogs as any).mockImplementation(async (podName: any, namespace: any, container: any, stream: any, options: any) => {
      // options should have follow: true and timestamps: false by default, and sinceSeconds: 1
      expect(options.follow).toBe(true);
      expect(options.timestamps).toBe(false);
      expect(options.tailLines).toBeUndefined();
      expect(options.sinceSeconds).toBe(1);
      
      // Simulate stream outputting log and ending
      stream.write('stream log message\n');
      stream.end();

      return { abort: jest.fn() };
    });

    await logs({ follow: true });

    expect(mockStreamPodLogs).toHaveBeenCalledTimes(1);
    const consoleCalls = mockStdoutWrite.mock.calls.map((call: any) => call[0]);
    expect(consoleCalls).toHaveLength(1);
    expect(consoleCalls[0]).toContain('stream log message');
    expect(consoleCalls[0]).toContain('runner-0');
    expect(consoleCalls[0]).not.toContain('2026-06-18T22:59');
  });

  test('streams logs concurrently with timestamps enabled (Mode B)', async () => {
    (loadLastRun as any).mockResolvedValue({ testRunName: 'my-run', namespace: 'default' });
    (mockGetPodsForTestRun as any).mockResolvedValue({
      items: [
        { metadata: { name: 'my-run-runner-0' } },
      ],
    });

    (mockStreamPodLogs as any).mockImplementation(async (podName: any, namespace: any, container: any, stream: any, options: any) => {
      expect(options.follow).toBe(true);
      expect(options.timestamps).toBe(true);
      expect(options.tailLines).toBeUndefined();
      expect(options.sinceSeconds).toBe(1);
      
      // Simulate stream outputting log and ending
      stream.write('2026-06-18T22:59:00Z stream log message\n');
      stream.end();

      return { abort: jest.fn() };
    });

    await logs({ follow: true, timestamps: true });

    expect(mockStreamPodLogs).toHaveBeenCalledTimes(1);
    const consoleCalls = mockStdoutWrite.mock.calls.map((call: any) => call[0]);
    expect(consoleCalls).toHaveLength(1);
    expect(consoleCalls[0]).toContain('stream log message');
    expect(consoleCalls[0]).toContain('runner-0');
    expect(consoleCalls[0]).toContain('2026-06-18T22:59:00Z');
  });

  test('fetches and displays static logs with timestamps (Mode A)', async () => {
    (loadLastRun as any).mockResolvedValue({ testRunName: 'my-run', namespace: 'default' });
    (mockGetPodsForTestRun as any).mockResolvedValue({
      items: [
        { metadata: { name: 'my-run-runner-0' } },
      ],
    });

    (mockGetPodLogs as any).mockResolvedValue('2026-06-18T22:58:00Z log message');

    await logs({ timestamps: true });

    const consoleCalls = mockStdoutWrite.mock.calls.map((call: any) => call[0]);
    expect(consoleCalls).toHaveLength(1);
    expect(consoleCalls[0]).toContain('log message');
    expect(consoleCalls[0]).toContain('runner-0');
    expect(consoleCalls[0]).toContain('2026-06-18T22:58:00Z');
  });
});
