import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { loadK6Config } from "../../src/utils/configLoader";
import { existsSync, readFileSync } from "node:fs";

jest.mock("node:fs", () => ({
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
}));

const mockedExistsSync = existsSync as unknown as jest.Mock;
const mockedReadFileSync = readFileSync as unknown as jest.Mock;

describe("loadK6Config", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("File does not exist, returns defaults", () => {
        mockedExistsSync.mockReturnValue(false);
        const cfg = loadK6Config("k6ctl.config.json");
        expect(cfg.namespace).toBe("default");
        expect(cfg.cleanup).toBe(true);
        expect(cfg.quiet).toBe(true);
        expect(cfg.separate).toBe(false);
        expect(cfg.parallelism).toBe(1);
        expect(cfg.runner.image).toBe("grafana/k6:latest");
        expect(cfg.arguments).toBeUndefined();
    });
    
    test("File exists, applies JSON + defaults", () => {
        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue(
            JSON.stringify({
                namespace: "performance",
                parallelism: 40,
                prometheus: { serverUrl: "http://prom-rw:9090" },
            })
        );
        const cfg = loadK6Config("k6ctl.config.json");
        expect(cfg.namespace).toBe("performance");
        expect(cfg.parallelism).toBe(40);
        expect(cfg.cleanup).toBe(true);
        expect(cfg.runner.image).toBe("grafana/k6:latest");
        expect(cfg.prometheus?.serverUrl).toBe("http://prom-rw:9090");
        expect(cfg.prometheus?.trendStats).toEqual(["avg", "p(95)", "p(99)", "min", "max"]);
    });

    test("If JSON is invalid, throws error with clear message", () => {
        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue("{ invalid json");
        expect(() => loadK6Config("k6ctl.config.json")).toThrow(/Config file 'k6ctl.config.json' exists but is not valid JSON: Expected property name or '}' in JSON at position 2 \(line 1 column 3\)/i);
    });
});
