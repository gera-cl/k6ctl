import { describe, expect, test } from '@jest/globals';
import * as fs from "fs";
import * as path from "path";
import { loadAndValidateEnv } from '../../src/utils/env';

describe("Env integration tests", () => {
  test("should load and print all variables from the .env file", () => {
    // create a temporary .env file before each test
    const envVariables = {
      API_KEY: "12345",
      DB_HOST: "localhost"
    };
    createTempEnvFile(envVariables);
    const env = loadAndValidateEnv(".env");
    expect(env).toEqual(envVariables);
    deleteTempEnvFile();
  });
});

function createTempEnvFile(env: Record<string, string>) {
  const envPath = path.resolve(__dirname, "../../.env");
  const envContent = Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  fs.writeFileSync(envPath, envContent);
}

function deleteTempEnvFile() {
  const envPath = path.resolve(__dirname, "../../.env");
  if (fs.existsSync(envPath)) {
    fs.unlinkSync(envPath);
  }
}