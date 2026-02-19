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
  
  return result;
}
