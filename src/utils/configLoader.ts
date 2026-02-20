import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import logger from './logger';

const BASE_IMAGE = "grafana/k6:latest";
const DEFAULT_NAMESPACE = "default";
const DEFAULT_CONFIG_PATH = "k6ctl.config.json";
const PROMETHEUS_DEFAULT_TREND_STATS = ["avg", "p(95)", "p(99)", "min", "max"];

const ResourcesSchema = z.object({
    limits: z.object({
        cpu: z.string(),
        memory: z.string(),
    }),
    requests: z.object({
        cpu: z.string(),
        memory: z.string(),
    }),
});

const RunnerSchema = z
    .object({
        image: z.string(),
        resources: ResourcesSchema.optional(),
    })
    .default({ image: BASE_IMAGE });

const PrometheusSchema = z
    .object({
        serverUrl: z.string(),
        trendStats: z.array(z.string()).default(PROMETHEUS_DEFAULT_TREND_STATS),
    });

const K6ConfigSchema = z.object({
    namespace: z.string().default(DEFAULT_NAMESPACE),
    parallelism: z.number().int().positive().default(1),
    arguments: z
        .array(z.string())
        .optional(),
    cleanup: z.boolean().default(true),
    quiet: z.boolean().default(true),
    separate: z.boolean().default(false),
    runner: RunnerSchema,
    prometheus: PrometheusSchema.optional(),
});

export type K6ConfigParsed = z.infer<typeof K6ConfigSchema>;

export function loadK6Config(path = DEFAULT_CONFIG_PATH): K6ConfigParsed {
    if (!existsSync(path)) {
        logger.warn(`Config file '${path}' doesn't exist, using default values.`);
        return K6ConfigSchema.parse({});
    }
    const raw = readFileSync(path, "utf-8");
    let obj: unknown;
    try {
        obj = JSON.parse(raw);
    } catch (e) {
        throw new Error(`Config file '${path}' exists but is not valid JSON: ${(e as Error).message}`);
    }
    logger.info(`Loaded config from '${path}'`);
    return K6ConfigSchema.parse(obj);
}
