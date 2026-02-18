import * as fs from "fs";
import * as path from "path";
import { parse } from "dotenv";

/**
 * Configura tus patrones de validación aquí
 */
const DEFAULT_RULES = {
  // Valida nombres tipo ENV clásico: MAYUSCULAS_NUMEROS_GUIONBAJO
  keyPattern: /^[A-Z][A-Z0-9_]*$/,

  // Valores permitidos: ASCII imprimible (no control chars). Permite espacios.
  valuePattern: /^[\x20-\x7E]*$/,
};

type Rules = typeof DEFAULT_RULES;

/**
 * Almacena las variables de entorno cargadas globalmente
 */
let cachedEnv: Record<string, string> | null = null;


/**
 * Lee y valida un archivo .env
 * @param envFilePath - Ruta del archivo .env a cargar
 * @param rules - Reglas de validación personalizadas (opcional)
 * @returns Objeto con las variables de entorno validadas
 */
export function loadAndValidateEnv(
  envFilePath: string = ".env",
  rules: Rules = DEFAULT_RULES
): Record<string, string> {
  const errors: string[] = [];
  const result: Record<string, string> = {};

  // Validar que el archivo existe
  const absolutePath = path.isAbsolute(envFilePath) 
    ? envFilePath 
    : path.resolve(process.cwd(), envFilePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Archivo .env no encontrado: ${absolutePath}`);
  }

  // Leer el archivo .env
  let fileContent: string;
  try {
    fileContent = fs.readFileSync(absolutePath, "utf-8");
  } catch (error) {
    throw new Error(`Error al leer el archivo .env: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Parsear el contenido del archivo .env
  let envVars: Record<string, string>;
  try {
    envVars = parse(fileContent);
  } catch (error) {
    throw new Error(`Error al parsear el archivo .env: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Validar cada variable
  for (const [key, val] of Object.entries(envVars)) {
    // Validar nombre de la variable
    if (!rules.keyPattern.test(key)) {
      errors.push(`Nombre inválido: "${key}" (no cumple el patrón ${rules.keyPattern})`);
      continue;
    }

    // Validar que el valor no esté vacío
    if (val == null || val === "") {
      errors.push(`Variable "${key}" no tiene valor`);
      continue;
    }

    // Validar caracteres del valor
    if (!rules.valuePattern.test(val)) {
      errors.push(`Valor inválido en "${key}" (contiene caracteres no permitidos)`);
      continue;
    }

    result[key] = val;
  }

  if (errors.length > 0) {
    throw new Error(
      "Errores en variables de ambiente:\n" + errors.map(e => `- ${e}`).join("\n")
    );
  }

  // Cachear las variables cargadas
  cachedEnv = result;
  
  return result;
}

/**
 * Inicializa las variables de entorno (carga automáticamente si no se han cargado)
 */
function ensureEnvLoaded(): Record<string, string> {
  if (!cachedEnv) {
    cachedEnv = loadAndValidateEnv();
  }
  return cachedEnv;
}

/**
 * Resetea el caché de variables de entorno (útil para testing)
 */
export function resetEnvCache(): void {
  cachedEnv = null;
}

/**
 * Obtiene una variable de entorno de forma segura (carga automáticamente el .env)
 * @param key - Nombre de la variable
 * @param defaultValue - Valor por defecto si no existe
 * @returns El valor de la variable o el valor por defecto
 */
export function getEnvVar(
  key: string,
  defaultValue?: string
): string | undefined {
  const env = ensureEnvLoaded();
  return env[key] ?? defaultValue;
}

/**
 * Obtiene una variable de entorno como string (lanza error si no existe)
 * @param key - Nombre de la variable
 * @returns El valor de la variable
 */
export function requireEnvVar(
  key: string
): string {
  const env = ensureEnvLoaded();
  const value = env[key];
  if (!value) {
    throw new Error(`Variable de entorno requerida no encontrada: ${key}`);
  }
  return value;
}

/**
 * Obtiene una variable de entorno como número
 * @param key - Nombre de la variable
 * @param defaultValue - Valor por defecto si no existe o no es válido
 * @returns El valor numérico o el valor por defecto
 */
export function getEnvNumber(
  key: string,
  defaultValue?: number
): number | undefined {
  const value = getEnvVar(key);
  if (!value) return defaultValue;

  const num = Number(value);
  if (isNaN(num)) {
    console.warn(`La variable ${key} no es un número válido: "${value}"`);
    return defaultValue;
  }
  return num;
}

/**
 * Obtiene una variable de entorno como booleano
 * @param key - Nombre de la variable
 * @param defaultValue - Valor por defecto si no existe
 * @returns true/false según el valor
 */
export function getEnvBoolean(
  key: string,
  defaultValue: boolean = false
): boolean {
  const value = getEnvVar(key)?.toLowerCase();
  if (!value) return defaultValue;

  return value === "true" || value === "1" || value === "yes" || value === "on";
}

/**
 * Obtiene todas las variables de entorno como objeto
 * @returns Objeto con todas las variables validadas
 */
export function getAllEnvVars(): Record<string, string> {
  const env = ensureEnvLoaded();
  return { ...env };
}

/**
 * Verifica si una variable de entorno existe
 * @param key - Nombre de la variable
 * @returns true si la variable existe
 */
export function hasEnvVar(
  key: string
): boolean {
  const env = ensureEnvLoaded();
  return key in env;
}
/**
 * Objeto proxy para acceder a las variables de entorno directamente
 * Uso: env.K8S_NAMESPACE, env.API_KEY, etc.
 * Las variables se cargan automáticamente la primera vez que se accede al objeto
 */
export const env = new Proxy({} as Record<string, string>, {
  get(_target, prop: string) {
    const envVars = ensureEnvLoaded();
    return envVars[prop];
  },
  has(_target, prop: string) {
    const envVars = ensureEnvLoaded();
    return prop in envVars;
  },
  ownKeys(_target) {
    const envVars = ensureEnvLoaded();
    return Object.keys(envVars);
  },
  getOwnPropertyDescriptor(_target, prop: string) {
    const envVars = ensureEnvLoaded();
    if (prop in envVars) {
      return {
        enumerable: true,
        configurable: true,
        value: envVars[prop],
      };
    }
    return undefined;
  },
});