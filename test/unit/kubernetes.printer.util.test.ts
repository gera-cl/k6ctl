import { describe, expect, jest, test } from '@jest/globals';
import { podCommonPrefix, classifyPod, ageSince } from '../../src/utils/kubernetes-printer.util';
import { printColumnar } from '../../src/utils/table.util';

describe('kubernetes-printer.util helper functions', () => {
  describe('podCommonPrefix', () => {
    test('returns empty string for empty array', () => {
      expect(podCommonPrefix([])).toBe('');
    });

    test('returns the full name for a single pod name', () => {
      expect(podCommonPrefix(['k6-loadtest-1'])).toBe('k6-loadtest-1');
    });

    test('extracts common prefix ending with a dash', () => {
      const names = ['k6-test-runner-abcde', 'k6-test-runner-fghij', 'k6-test-runner-klmno'];
      expect(podCommonPrefix(names)).toBe('k6-test-runner');
    });

    test('returns empty string when there is no common prefix', () => {
      const names = ['abc-123', 'xyz-456'];
      expect(podCommonPrefix(names)).toBe('');
    });

    test('handles partial name matches that do not end in a dash', () => {
      const names = ['k6-test-123', 'k5-test-456'];
      // Share 'k' but no dash-separated prefix
      expect(podCommonPrefix(names)).toBe('');
    });
  });

  describe('classifyPod', () => {
    test('classifies pod as initializer when name contains initializer', () => {
      expect(classifyPod('my-test-initializer-abcd')).toBe('initializer');
      expect(classifyPod('initializer-pod')).toBe('initializer');
    });

    test('classifies pod as starter when name contains starter', () => {
      expect(classifyPod('my-test-starter-abcd')).toBe('starter');
      expect(classifyPod('starter-pod')).toBe('starter');
    });

    test('classifies pod as runner by default', () => {
      expect(classifyPod('my-test-runner-abcd')).toBe('runner');
      expect(classifyPod('k6-test-12345')).toBe('runner');
    });
  });

  describe('ageSince', () => {
    test('returns N/A for null or undefined dates', () => {
      expect(ageSince(null)).toBe('N/A');
      expect(ageSince(undefined)).toBe('N/A');
    });

    test('formats ages under an hour in minutes', () => {
      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(ageSince(fiveMinsAgo)).toBe('5m');
    });

    test('formats ages under a day in hours and minutes', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000 - 15 * 60 * 1000).toISOString();
      expect(ageSince(twoHoursAgo)).toBe('2h15m');
    });

    test('formats ages over a day in days and hours', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 - 4 * 60 * 60 * 1000).toISOString();
      expect(ageSince(threeDaysAgo)).toBe('3d4h');
    });
  });
});

describe('table.util printColumnar safe fallback', () => {
  test('does not throw and prints correctly when row has more elements than headers', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const headers = ['A', 'B'];
    const rows = [
      ['val1', 'val2', 'ignored1', 'ignored2'],
    ];

    expect(() => printColumnar(headers, rows)).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
