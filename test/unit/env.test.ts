import * as fs from "fs";
import * as path from "path";
import {
  loadAndValidateEnv,
} from "../../src/utils/env";

// Mock de fs
jest.mock("fs");
const mockedFs = fs as jest.Mocked<typeof fs>;

describe("loadAndValidateEnv", () => {
  const mockEnvPath = ".env";
  const absolutePath = path.resolve(process.cwd(), mockEnvPath);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("debe cargar y validar un archivo .env válido", () => {
    const envContent = "API_KEY=test123\nPORT=3000\nDEBUG=true";
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv(mockEnvPath);

    expect(result).toEqual({
      API_KEY: "test123",
      PORT: "3000",
      DEBUG: "true",
    });
  });

  it("debe lanzar error si el archivo no existe", () => {
    mockedFs.existsSync.mockReturnValue(false);

    expect(() => loadAndValidateEnv(mockEnvPath)).toThrow(
      `Archivo .env no encontrado: ${absolutePath}`
    );
  });

  it("debe lanzar error si no puede leer el archivo", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error("Permission denied");
    });

    expect(() => loadAndValidateEnv(mockEnvPath)).toThrow(
      "Error al leer el archivo .env: Permission denied"
    );
  });

  it("debe rechazar nombres de variables en minúsculas", () => {
    const envContent = "api_key=test123";
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    expect(() => loadAndValidateEnv(mockEnvPath)).toThrow(
      /Nombre inválido: "api_key"/
    );
  });

  it("debe rechazar nombres de variables con caracteres especiales", () => {
    const envContent = "API-KEY=test123";
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    expect(() => loadAndValidateEnv(mockEnvPath)).toThrow(
      /Nombre inválido: "API-KEY"/
    );
  });

  it("debe rechazar variables vacías", () => {
    const envContent = "API_KEY=";
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    expect(() => loadAndValidateEnv(mockEnvPath)).toThrow(
      /Variable "API_KEY" no tiene valor/
    );
  });

  it("debe aceptar valores con espacios", () => {
    const envContent = "MESSAGE=Hello World";
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv(mockEnvPath);

    expect(result).toEqual({
      MESSAGE: "Hello World",
    });
  });

  it("debe aceptar nombres con números y guiones bajos", () => {
    const envContent = "API_KEY_V2=test123\nDB_HOST_1=localhost";
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv(mockEnvPath);

    expect(result).toEqual({
      API_KEY_V2: "test123",
      DB_HOST_1: "localhost",
    });
  });

  it("debe manejar múltiples errores a la vez", () => {
    const envContent = "api_key=test\nVALID_VAR=value\nEMPTY_VAR=";
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    expect(() => loadAndValidateEnv(mockEnvPath)).toThrow(
      /Errores en variables de ambiente/
    );
  });

  it("debe usar ruta absoluta si se proporciona", () => {
    const absoluteEnvPath = "/absolute/path/.env";
    const envContent = "TEST_VAR=value";
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    loadAndValidateEnv(absoluteEnvPath);

    expect(mockedFs.existsSync).toHaveBeenCalledWith(absoluteEnvPath);
  });

  it("debe aceptar reglas personalizadas", () => {
    const envContent = "api_key=test123";
    const customRules = {
      keyPattern: /^[a-z_]+$/,
      valuePattern: /^[\x20-\x7E]*$/,
    };
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv(mockEnvPath, customRules);

    expect(result).toEqual({
      api_key: "test123",
    });
  });
});

describe("loadAndValidateEnv - Pruebas de Rutas", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("debe cargar .env desde la raíz del proyecto por defecto", () => {
    const envContent = "DEFAULT_VAR=value1";
    const expectedPath = path.resolve(process.cwd(), ".env");
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    loadAndValidateEnv();

    expect(mockedFs.existsSync).toHaveBeenCalledWith(expectedPath);
    expect(mockedFs.readFileSync).toHaveBeenCalledWith(expectedPath, "utf-8");
  });

  it("debe cargar .env.development desde ruta relativa", () => {
    const envContent = "DEV_VAR=dev_value";
    const expectedPath = path.resolve(process.cwd(), ".env.development");
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv(".env.development");

    expect(mockedFs.existsSync).toHaveBeenCalledWith(expectedPath);
    expect(result).toEqual({ DEV_VAR: "dev_value" });
  });

  it("debe cargar .env.production desde ruta relativa", () => {
    const envContent = "PROD_VAR=prod_value";
    const expectedPath = path.resolve(process.cwd(), ".env.production");
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv(".env.production");

    expect(mockedFs.existsSync).toHaveBeenCalledWith(expectedPath);
    expect(result).toEqual({ PROD_VAR: "prod_value" });
  });

  it("debe cargar .env.test desde ruta relativa", () => {
    const envContent = "TEST_VAR=test_value";
    const expectedPath = path.resolve(process.cwd(), ".env.test");
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv(".env.test");

    expect(mockedFs.existsSync).toHaveBeenCalledWith(expectedPath);
    expect(result).toEqual({ TEST_VAR: "test_value" });
  });

  it("debe cargar desde subdirectorio (config/.env)", () => {
    const envContent = "CONFIG_VAR=config_value";
    const expectedPath = path.resolve(process.cwd(), "config/.env");
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv("config/.env");

    expect(mockedFs.existsSync).toHaveBeenCalledWith(expectedPath);
    expect(result).toEqual({ CONFIG_VAR: "config_value" });
  });

  it("debe cargar desde subdirectorio profundo (config/env/.env.local)", () => {
    const envContent = "LOCAL_VAR=local_value";
    const expectedPath = path.resolve(process.cwd(), "config/env/.env.local");
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv("config/env/.env.local");

    expect(mockedFs.existsSync).toHaveBeenCalledWith(expectedPath);
    expect(result).toEqual({ LOCAL_VAR: "local_value" });
  });

  it("debe manejar ruta absoluta en Unix/Linux/Mac", () => {
    const absolutePath = "/home/user/project/.env";
    const envContent = "UNIX_VAR=unix_value";
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv(absolutePath);

    expect(mockedFs.existsSync).toHaveBeenCalledWith(absolutePath);
    expect(result).toEqual({ UNIX_VAR: "unix_value" });
  });

  it("debe manejar ruta absoluta en Windows", () => {
    const absolutePath = "C:\\Users\\Admin\\project\\.env";
    const envContent = "WINDOWS_VAR=windows_value";
    
    // En sistemas no-Windows, path.isAbsolute() puede no reconocer rutas de Windows
    // pero la función debería intentar usarla tal cual
    const isWindows = process.platform === "win32";
    const expectedPath = path.isAbsolute(absolutePath) 
      ? absolutePath 
      : path.resolve(process.cwd(), absolutePath);
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv(absolutePath);

    expect(mockedFs.existsSync).toHaveBeenCalledWith(expectedPath);
    expect(result).toEqual({ WINDOWS_VAR: "windows_value" });
  });

  it("debe cargar archivo con nombre personalizado (my-vars.env)", () => {
    const envContent = "CUSTOM_VAR=custom_value";
    const expectedPath = path.resolve(process.cwd(), "my-vars.env");
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv("my-vars.env");

    expect(mockedFs.existsSync).toHaveBeenCalledWith(expectedPath);
    expect(result).toEqual({ CUSTOM_VAR: "custom_value" });
  });

  it("debe lanzar error con ruta relativa si el archivo no existe", () => {
    const relativePath = "config/.env.missing";
    const expectedPath = path.resolve(process.cwd(), relativePath);
    
    mockedFs.existsSync.mockReturnValue(false);

    expect(() => loadAndValidateEnv(relativePath)).toThrow(
      `Archivo .env no encontrado: ${expectedPath}`
    );
  });

  it("debe lanzar error con ruta absoluta si el archivo no existe", () => {
    const absolutePath = "/absolute/path/to/.env.missing";
    
    mockedFs.existsSync.mockReturnValue(false);

    expect(() => loadAndValidateEnv(absolutePath)).toThrow(
      `Archivo .env no encontrado: ${absolutePath}`
    );
  });

  it("debe resolver correctamente rutas con '..'", () => {
    const relativePath = "../parent/.env";
    const expectedPath = path.resolve(process.cwd(), relativePath);
    const envContent = "PARENT_VAR=parent_value";
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv(relativePath);

    expect(mockedFs.existsSync).toHaveBeenCalledWith(expectedPath);
    expect(result).toEqual({ PARENT_VAR: "parent_value" });
  });

  it("debe resolver correctamente rutas con './'", () => {
    const relativePath = "./.env.local";
    const expectedPath = path.resolve(process.cwd(), relativePath);
    const envContent = "LOCAL_VAR=local_value";
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv(relativePath);

    expect(mockedFs.existsSync).toHaveBeenCalledWith(expectedPath);
    expect(result).toEqual({ LOCAL_VAR: "local_value" });
  });

  it("debe manejar rutas con espacios en el nombre", () => {
    const pathWithSpaces = "my config/.env.local";
    const expectedPath = path.resolve(process.cwd(), pathWithSpaces);
    const envContent = "SPACE_VAR=space_value";
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv(pathWithSpaces);

    expect(mockedFs.existsSync).toHaveBeenCalledWith(expectedPath);
    expect(result).toEqual({ SPACE_VAR: "space_value" });
  });

  it("debe distinguir entre diferentes archivos .env en la misma ruta", () => {
    const envContent1 = "VAR_DEV=dev";
    const envContent2 = "VAR_PROD=prod";
    
    mockedFs.existsSync.mockReturnValue(true);
    
    // Primer archivo
    mockedFs.readFileSync.mockReturnValueOnce(envContent1);
    const result1 = loadAndValidateEnv(".env.development");
    
    // Segundo archivo
    mockedFs.readFileSync.mockReturnValueOnce(envContent2);
    const result2 = loadAndValidateEnv(".env.production");

    expect(result1).toEqual({ VAR_DEV: "dev" });
    expect(result2).toEqual({ VAR_PROD: "prod" });
  });

  it("debe cargar desde carpeta environments con .env.staging", () => {
    const envContent = "STAGING_API=https://staging.api.com\nSTAGING_PORT=8080";
    const expectedPath = path.resolve(process.cwd(), "environments/.env.staging");
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv("environments/.env.staging");

    expect(mockedFs.existsSync).toHaveBeenCalledWith(expectedPath);
    expect(result).toEqual({ 
      STAGING_API: "https://staging.api.com",
      STAGING_PORT: "8080"
    });
  });

  it("debe cargar desde carpeta config/envs/.env.qa", () => {
    const envContent = "QA_DATABASE=qa-db.example.com\nQA_USER=qauser";
    const expectedPath = path.resolve(process.cwd(), "config/envs/.env.qa");
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv("config/envs/.env.qa");

    expect(mockedFs.existsSync).toHaveBeenCalledWith(expectedPath);
    expect(result).toEqual({ 
      QA_DATABASE: "qa-db.example.com",
      QA_USER: "qauser"
    });
  });

  it("debe cargar .env.secrets desde subcarpeta secure", () => {
    const envContent = "API_SECRET=super_secret_key\nDB_PASSWORD=encrypted_pass";
    const expectedPath = path.resolve(process.cwd(), "secure/.env.secrets");
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv("secure/.env.secrets");

    expect(mockedFs.existsSync).toHaveBeenCalledWith(expectedPath);
    expect(result).toEqual({ 
      API_SECRET: "super_secret_key",
      DB_PASSWORD: "encrypted_pass"
    });
  });

  it("debe cargar .env.k8s desde carpeta kubernetes", () => {
    const envContent = "K8S_CLUSTER=prod-cluster\nK8S_TOKEN=abc123xyz";
    const expectedPath = path.resolve(process.cwd(), "kubernetes/.env.k8s");
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv("kubernetes/.env.k8s");

    expect(mockedFs.existsSync).toHaveBeenCalledWith(expectedPath);
    expect(result).toEqual({ 
      K8S_CLUSTER: "prod-cluster",
      K8S_TOKEN: "abc123xyz"
    });
  });

  it("debe cargar desde ruta con múltiples niveles de subdirectorios", () => {
    const envContent = "DEEP_VAR=deep_value";
    const expectedPath = path.resolve(process.cwd(), "a/b/c/d/.env.deep");
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv("a/b/c/d/.env.deep");

    expect(mockedFs.existsSync).toHaveBeenCalledWith(expectedPath);
    expect(result).toEqual({ DEEP_VAR: "deep_value" });
  });

  it("debe cargar .env.docker desde carpeta docker", () => {
    const envContent = "DOCKER_IMAGE=myapp:latest\nDOCKER_PORT=3000";
    const expectedPath = path.resolve(process.cwd(), "docker/.env.docker");
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv("docker/.env.docker");

    expect(mockedFs.existsSync).toHaveBeenCalledWith(expectedPath);
    expect(result).toEqual({ 
      DOCKER_IMAGE: "myapp:latest",
      DOCKER_PORT: "3000"
    });
  });

  it("debe cargar vars.env con nombre no estándar", () => {
    const envContent = "CUSTOM_VAR_1=value1\nCUSTOM_VAR_2=value2";
    const expectedPath = path.resolve(process.cwd(), "vars.env");
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv("vars.env");

    expect(mockedFs.existsSync).toHaveBeenCalledWith(expectedPath);
    expect(result).toEqual({ 
      CUSTOM_VAR_1: "value1",
      CUSTOM_VAR_2: "value2"
    });
  });

  it("debe cargar environment.conf con extensión no estándar", () => {
    const envContent = "CONF_VAR=conf_value";
    const expectedPath = path.resolve(process.cwd(), "environment.conf");
    
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv("environment.conf");

    expect(mockedFs.existsSync).toHaveBeenCalledWith(expectedPath);
    expect(result).toEqual({ CONF_VAR: "conf_value" });
  });

  it("debe lanzar error para ruta profunda inexistente", () => {
    const deepPath = "config/envs/prod/.env.missing";
    const expectedPath = path.resolve(process.cwd(), deepPath);
    
    mockedFs.existsSync.mockReturnValue(false);

    expect(() => loadAndValidateEnv(deepPath)).toThrow(
      `Archivo .env no encontrado: ${expectedPath}`
    );
  });
});

describe("Imprimir todas las variables de ambiente", () => {
  it("debe cargar e imprimir todas las variables del archivo .env", () => {
    // TODO: Es una prueba de integración
    // TODO: Debe crear .env como precondición
    // Usar fs real temporalmente
    const realFs = jest.requireActual("fs");
    
    mockedFs.existsSync.mockImplementation(realFs.existsSync);
    mockedFs.readFileSync.mockImplementation(realFs.readFileSync);

    const env = loadAndValidateEnv(".env");
    
    console.log("\n========================================");
    console.log("📋 Variables de ambiente cargadas:");
    console.log("========================================");
    
    // Imprimir todas las variables
    Object.entries(env).forEach(([key, value]) => {
      console.log(`${key} = ${value}`);
    });
    
    console.log("========================================");
    console.log(`Total: ${Object.keys(env).length} variables\n`);
    
    // También imprimir en formato tabla
    console.table(env);
    
    // Verificar que se cargó al menos una variable
    expect(Object.keys(env).length).toBeGreaterThan(0);
  });
});


describe("Validación de valores especiales", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("debe aceptar URLs como valores", () => {
    const envContent = "API_URL=https://api.example.com:8080/v1/users?limit=10";
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.API_URL).toBe("https://api.example.com:8080/v1/users?limit=10");
  });

  it("debe aceptar rutas de archivos Unix", () => {
    const envContent = "LOG_PATH=/var/log/app/error.log";
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.LOG_PATH).toBe("/var/log/app/error.log");
  });

  it("debe aceptar rutas de archivos Windows", () => {
    const envContent = "LOG_PATH=C:\\Users\\Admin\\logs\\app.log";
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.LOG_PATH).toBe("C:\\Users\\Admin\\logs\\app.log");
  });

  it("debe aceptar direcciones de email", () => {
    const envContent = "ADMIN_EMAIL=admin@example.com";
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.ADMIN_EMAIL).toBe("admin@example.com");
  });

  it("debe aceptar valores con símbolos especiales ASCII (sin #)", () => {
    // Nota: # se interpreta como comentario en dotenv, por lo que no se incluye
    const envContent = "SPECIAL_CHARS=!@$%^&*()_+-=[]{}|;:,.<>?";
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.SPECIAL_CHARS).toBe("!@$%^&*()_+-=[]{}|;:,.<>?");
  });

  it("debe aceptar JSON como valor", () => {
    const envContent = 'JSON_CONFIG={"name":"test","value":123}';
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.JSON_CONFIG).toBe('{"name":"test","value":123}');
  });

  it("debe aceptar valores sin comillas (plain)", () => {
    const envContent = "PLAIN_VALUE=simple_text_without_quotes";
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.PLAIN_VALUE).toBe("simple_text_without_quotes");
  });

  it("debe aceptar valores envueltos en comillas simples", () => {
    const envContent = "QUOTED_VALUE='valor con espacios'";
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.QUOTED_VALUE).toBe("valor con espacios");
  });

  it("debe aceptar valores envueltos en comillas dobles", () => {
    const envContent = 'DOUBLE_QUOTED="valor con espacios"';
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.DOUBLE_QUOTED).toBe("valor con espacios");
  });

  it("debe aceptar valores con comillas simples dentro del texto", () => {
    const envContent = "MESSAGE=It's working!";
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.MESSAGE).toBe("It's working!");
  });

  it("debe aceptar valores con comillas dobles dentro del texto", () => {
    const envContent = 'QUOTE=He said "Hello"';
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.QUOTE).toBe('He said "Hello"');
  });

  it("debe manejar comillas escapadas según el comportamiento de dotenv", () => {
    // Nota: dotenv preserva las barras invertidas en el parsing
    const envContent = 'ESCAPED="He said \\"Hello\\""';
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    // dotenv mantiene las barras invertidas tal como están
    expect(result.ESCAPED).toBe('He said \\"Hello\\"');
  });

  it("debe aceptar conexión strings de base de datos", () => {
    const envContent = "DB_CONNECTION=postgresql://user:pass@localhost:5432/mydb";
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.DB_CONNECTION).toBe("postgresql://user:pass@localhost:5432/mydb");
  });

  it("debe aceptar tokens y hashes largos", () => {
    const envContent = "JWT_SECRET=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0";
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.JWT_SECRET).toBe("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0");
  });

  it("debe aceptar códigos base64", () => {
    const envContent = "ENCODED_DATA=SGVsbG8gV29ybGQ=";
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.ENCODED_DATA).toBe("SGVsbG8gV29ybGQ=");
  });

  it("debe aceptar valores numéricos negativos", () => {
    const envContent = "TEMPERATURE=-15";
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.TEMPERATURE).toBe("-15");
  });

  it("debe aceptar valores con múltiples espacios", () => {
    const envContent = "MULTI_SPACE=Hello     World";
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.MULTI_SPACE).toBe("Hello     World");
  });

  it("debe trimear espacios al inicio (comportamiento de dotenv)", () => {
    // Nota: dotenv hace trim automático de los espacios al inicio y final
    const envContent = "LEADING_SPACE=   value";
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.LEADING_SPACE).toBe("value");
  });

  it("debe trimear espacios al final (comportamiento de dotenv)", () => {
    // Nota: dotenv hace trim automático de los espacios al inicio y final
    const envContent = "TRAILING_SPACE=value   ";
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.TRAILING_SPACE).toBe("value");
  });
});

// describe("Pruebas de números avanzadas", () => {
//   beforeEach(() => {
//     resetEnvCache();
//     jest.clearAllMocks();
//   });

//   it("debe manejar números negativos", () => {
//     const envContent = "TEMPERATURE=-25\nBALANCE=-100.50";
//     mockedFs.existsSync.mockReturnValue(true);
//     mockedFs.readFileSync.mockReturnValue(envContent);

//     expect(getEnvNumber("TEMPERATURE")).toBe(-25);
//     expect(getEnvNumber("BALANCE")).toBe(-100.50);
//   });

//   it("debe manejar el número cero", () => {
//     const envContent = "ZERO=0\nZERO_FLOAT=0.0";
//     mockedFs.existsSync.mockReturnValue(true);
//     mockedFs.readFileSync.mockReturnValue(envContent);

//     expect(getEnvNumber("ZERO")).toBe(0);
//     expect(getEnvNumber("ZERO_FLOAT")).toBe(0);
//   });

//   it("debe manejar números muy grandes", () => {
//     const envContent = "BIG_NUMBER=999999999999";
//     mockedFs.existsSync.mockReturnValue(true);
//     mockedFs.readFileSync.mockReturnValue(envContent);

//     expect(getEnvNumber("BIG_NUMBER")).toBe(999999999999);
//   });

//   it("debe manejar números en notación científica", () => {
//     const envContent = "SCIENTIFIC=1.5e10";
//     mockedFs.existsSync.mockReturnValue(true);
//     mockedFs.readFileSync.mockReturnValue(envContent);

//     expect(getEnvNumber("SCIENTIFIC")).toBe(1.5e10);
//   });

//   it("debe retornar undefined para strings vacíos cuando se esperan números", () => {
//     const envContent = "API_KEY=valid";
//     mockedFs.existsSync.mockReturnValue(true);
//     mockedFs.readFileSync.mockReturnValue(envContent);

//     expect(getEnvNumber("NONEXISTENT")).toBeUndefined();
//   });

//   it("debe rechazar valores con espacios como números inválidos", () => {
//     const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
//     const envContent = "SPACED_NUMBER=10 20";
//     mockedFs.existsSync.mockReturnValue(true);
//     mockedFs.readFileSync.mockReturnValue(envContent);

//     expect(getEnvNumber("SPACED_NUMBER", 0)).toBe(0);
//     expect(consoleWarnSpy).toHaveBeenCalled();
    
//     consoleWarnSpy.mockRestore();
//   });
// });

// describe("Pruebas de booleanos avanzadas", () => {
//   beforeEach(() => {
//     resetEnvCache();
//     jest.clearAllMocks();
//   });

//   it("debe manejar 'TRUE' en mayúsculas", () => {
//     const envContent = "FLAG=TRUE";
//     mockedFs.existsSync.mockReturnValue(true);
//     mockedFs.readFileSync.mockReturnValue(envContent);

//     expect(getEnvBoolean("FLAG")).toBe(true);
//   });

//   it("debe manejar 'Yes' en mixed case", () => {
//     const envContent = "FLAG=Yes";
//     mockedFs.existsSync.mockReturnValue(true);
//     mockedFs.readFileSync.mockReturnValue(envContent);

//     expect(getEnvBoolean("FLAG")).toBe(true);
//   });

//   it("debe manejar 'ON' en mayúsculas", () => {
//     const envContent = "FLAG=ON";
//     mockedFs.existsSync.mockReturnValue(true);
//     mockedFs.readFileSync.mockReturnValue(envContent);

//     expect(getEnvBoolean("FLAG")).toBe(true);
//   });

//   it("debe retornar false para 'no'", () => {
//     const envContent = "FLAG=no";
//     mockedFs.existsSync.mockReturnValue(true);
//     mockedFs.readFileSync.mockReturnValue(envContent);

//     expect(getEnvBoolean("FLAG")).toBe(false);
//   });

//   it("debe retornar false para 'off'", () => {
//     const envContent = "FLAG=off";
//     mockedFs.existsSync.mockReturnValue(true);
//     mockedFs.readFileSync.mockReturnValue(envContent);

//     expect(getEnvBoolean("FLAG")).toBe(false);
//   });

//   it("debe retornar false para valores numéricos diferentes de 1", () => {
//     const envContent = "FLAG=2";
//     mockedFs.existsSync.mockReturnValue(true);
//     mockedFs.readFileSync.mockReturnValue(envContent);

//     expect(getEnvBoolean("FLAG")).toBe(false);
//   });

//   it("debe retornar false para valores aleatorios", () => {
//     const envContent = "FLAG=random";
//     mockedFs.existsSync.mockReturnValue(true);
//     mockedFs.readFileSync.mockReturnValue(envContent);

//     expect(getEnvBoolean("FLAG")).toBe(false);
//   });
// });

// describe("Test de caché y reseteo", () => {
//   beforeEach(() => {
//     resetEnvCache();
//     jest.clearAllMocks();
//   });

//   it("debe resetear el caché correctamente", () => {
//     const envContent = "VAR1=value1";
//     mockedFs.existsSync.mockReturnValue(true);
//     mockedFs.readFileSync.mockReturnValue(envContent);

//     // Cargar una vez
//     getEnvVar("VAR1");
//     expect(mockedFs.readFileSync).toHaveBeenCalledTimes(1);

//     // Resetear el caché
//     resetEnvCache();

//     // Cargar de nuevo debería leer el archivo otra vez
//     const envContent2 = "VAR1=value2";
//     mockedFs.readFileSync.mockReturnValue(envContent2);
    
//     const value = getEnvVar("VAR1");
//     expect(value).toBe("value2");
//     expect(mockedFs.readFileSync).toHaveBeenCalledTimes(2);
//   });

//   it("debe cargar solo una vez sin resetear el caché", () => {
//     const envContent = "VAR1=value1";
//     mockedFs.existsSync.mockReturnValue(true);
//     mockedFs.readFileSync.mockReturnValue(envContent);

//     // Múltiples llamadas
//     getEnvVar("VAR1");
//     getEnvVar("VAR1");
//     hasEnvVar("VAR1");
//     getAllEnvVars();
    
//     // Solo una lectura de archivo
//     expect(mockedFs.readFileSync).toHaveBeenCalledTimes(1);
//   });

//   it("debe permitir cambiar entre diferentes archivos .env después de resetear", () => {
//     // Cargar .env.development
//     const devContent = "ENV=development";
//     mockedFs.existsSync.mockReturnValue(true);
//     mockedFs.readFileSync.mockReturnValue(devContent);
    
//     loadAndValidateEnv(".env.development");
//     expect(getEnvVar("ENV")).toBe("development");
    
//     // Resetear y cargar .env.production
//     resetEnvCache();
//     const prodContent = "ENV=production";
//     mockedFs.readFileSync.mockReturnValue(prodContent);
    
//     loadAndValidateEnv(".env.production");
//     expect(getEnvVar("ENV")).toBe("production");
//   });
// });

describe("Pruebas de edge cases", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("debe manejar nombres de variables con muchos guiones bajos", () => {
    const envContent = "MY_SUPER_LONG_VAR_NAME_WITH_UNDERSCORES_123=value";
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.MY_SUPER_LONG_VAR_NAME_WITH_UNDERSCORES_123).toBe("value");
  });

  it("debe manejar valores muy largos", () => {
    const longValue = "a".repeat(1000);
    const envContent = `LONG_VALUE=${longValue}`;
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.LONG_VALUE).toBe(longValue);
    expect(result.LONG_VALUE.length).toBe(1000);
  });

  it("debe manejar múltiples variables (100+)", () => {
    const vars = Array.from({ length: 100 }, (_, i) => `VAR_${i}=value${i}`).join("\n");
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(vars);

    const result = loadAndValidateEnv();
    expect(Object.keys(result).length).toBe(100);
    expect(result.VAR_0).toBe("value0");
    expect(result.VAR_99).toBe("value99");
  });

  it("debe rechazar nombres que empiezan con número", () => {
    const envContent = "1ST_VAR=value";
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    expect(() => loadAndValidateEnv()).toThrow(/Nombre inválido: "1ST_VAR"/);
  });

  it("debe rechazar nombres que empiezan con guion bajo", () => {
    const envContent = "_PRIVATE=value";
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    expect(() => loadAndValidateEnv()).toThrow(/Nombre inválido: "_PRIVATE"/);
  });

  it("debe aceptar nombres que terminan con números", () => {
    const envContent = "API_KEY_V2=value";
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.API_KEY_V2).toBe("value");
  });

  it("debe manejar valores que parecen asignaciones", () => {
    const envContent = "EQUATION=x=y+z";
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(envContent);

    const result = loadAndValidateEnv();
    expect(result.EQUATION).toBe("x=y+z");
  });
});

describe("Pruebas de errores específicos", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("debe manejar error ENOENT", () => {
    mockedFs.existsSync.mockReturnValue(true);
    const error = new Error("ENOENT: no such file or directory");
    (error as any).code = "ENOENT";
    mockedFs.readFileSync.mockImplementation(() => {
      throw error;
    });

    expect(() => loadAndValidateEnv()).toThrow(
      "Error al leer el archivo .env: ENOENT: no such file or directory"
    );
  });

  it("debe manejar error EACCES (permiso denegado)", () => {
    mockedFs.existsSync.mockReturnValue(true);
    const error = new Error("EACCES: permission denied");
    (error as any).code = "EACCES";
    mockedFs.readFileSync.mockImplementation(() => {
      throw error;
    });

    expect(() => loadAndValidateEnv()).toThrow(
      "Error al leer el archivo .env: EACCES: permission denied"
    );
  });

  it("debe manejar archivo con encoding incorrecto", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error("Invalid character encoding");
    });

    expect(() => loadAndValidateEnv()).toThrow(
      "Error al leer el archivo .env: Invalid character encoding"
    );
  });
});

// describe("Integración de múltiples funciones", () => {
//   beforeEach(() => {
//     resetEnvCache();
//     jest.clearAllMocks();
//   });

//   it("debe combinar getEnvVar, getEnvNumber y getEnvBoolean", () => {
//     const envContent = "APP_NAME=MyApp\nPORT=3000\nDEBUG=true";
//     mockedFs.existsSync.mockReturnValue(true);
//     mockedFs.readFileSync.mockReturnValue(envContent);

//     const name = getEnvVar("APP_NAME");
//     const port = getEnvNumber("PORT");
//     const debug = getEnvBoolean("DEBUG");

//     expect(name).toBe("MyApp");
//     expect(port).toBe(3000);
//     expect(debug).toBe(true);
//   });

//   it("debe usar hasEnvVar antes de requireEnvVar", () => {
//     const envContent = "REQUIRED_VAR=exists";
//     mockedFs.existsSync.mockReturnValue(true);
//     mockedFs.readFileSync.mockReturnValue(envContent);

//     if (hasEnvVar("REQUIRED_VAR")) {
//       const value = requireEnvVar("REQUIRED_VAR");
//       expect(value).toBe("exists");
//     }

//     if (!hasEnvVar("OPTIONAL_VAR")) {
//       const value = getEnvVar("OPTIONAL_VAR", "default");
//       expect(value).toBe("default");
//     }
//   });

//   it("debe usar getAllEnvVars para validar configuración completa", () => {
//     const envContent = "DB_HOST=localhost\nDB_PORT=5432\nDB_NAME=mydb";
//     mockedFs.existsSync.mockReturnValue(true);
//     mockedFs.readFileSync.mockReturnValue(envContent);

//     const allVars = getAllEnvVars();
//     const requiredVars = ["DB_HOST", "DB_PORT", "DB_NAME"];
    
//     requiredVars.forEach(varName => {
//       expect(allVars).toHaveProperty(varName);
//     });
//   });
// });

