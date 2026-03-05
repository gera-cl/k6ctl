const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  testMatch: [
    '**/test/integration/**/*.test.ts'
  ],
  transform: {
    ...tsJestTransformCfg,
    '^.+\\.js$': ['ts-jest', {
      useESM: false,
    }],
  },
  testPathIgnorePatterns: [
    '/test/integration/env.test.ts',
    '/test/integration/script.service.test.ts',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(@kubernetes/client-node|openid-client|oauth4webapi|jose))'
  ],
};