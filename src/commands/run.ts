import { env } from "../utils/env";

interface RunOptions {
  config: string;
  namespace?: string;
  parallelism?: number;
}

/**
 * Demo: Carga y usa variables de entorno desde .env
 */
export function demoEnvUsage() {
  console.log("🔧 Demo: Uso de variables de entorno\n");

  try {
    // 1. Acceso directo con env.VARIABLE ✨
    console.log("1️⃣  Acceso directo con env.VARIABLE:");
    console.log(`   - env.K8S_NAMESPACE = ${env.K8S_NAMESPACE}`);
    console.log(`   - env.K8S_CONTEXT = ${env.K8S_CONTEXT}`);
    console.log(`   - env.K6_RUNNER_IMAGE = ${env.K6_RUNNER_IMAGE}`);
    console.log(`   - env.K6_PARALLELISM = ${env.K6_PARALLELISM}`);
    console.log(`   - env.K6_CLEANUP = ${env.K6_CLEANUP}\n`);

    // 2. Ver todas las variables
    console.log("2️⃣  Ver todas las variables:");
    console.log(`   - Total de variables: ${Object.keys(env).length}`);
    console.table(env);
    console.log();

    // 3. Ejemplo práctico: usando env directamente
    console.log("3️⃣  Ejemplo de uso práctico:");
    const k6Config = {
      namespace: env.K8S_NAMESPACE,
      context: env.K8S_CONTEXT,
      parallelism: Number(env.K6_PARALLELISM),
      cleanup: env.K6_CLEANUP === "true",
      
      runner: {
        image: env.K6_RUNNER_IMAGE,
        resources: {
          limits: {
            cpu: env.K6_CPU_LIMIT,
            memory: env.K6_MEMORY_LIMIT,
          },
          requests: {
            cpu: env.K6_CPU_REQUEST,
            memory: env.K6_MEMORY_REQUEST,
          },
        },
      },
      
      prometheus: env.PROMETHEUS_SERVER_URL ? {
        serverUrl: env.PROMETHEUS_SERVER_URL,
        trendStats: env.PROMETHEUS_TREND_STATS,
      } : undefined,
    };
    console.log(JSON.stringify(k6Config, null, 2));

  } catch (error) {
    console.error("\n❌ Error al cargar variables de entorno:");
    console.error(error instanceof Error ? error.message : String(error));
  }
}

export async function runTest(scriptPath: string, options: RunOptions) {
  console.log(`Running k6 test: ${scriptPath}`);
  console.log(`Using config: ${JSON.stringify(options.config, null, 2)}`);
  
  // Demo opcional: descomentar para probar
  console.log("\n" + "=".repeat(60));
  demoEnvUsage();
  console.log("=".repeat(60) + "\n");
}
