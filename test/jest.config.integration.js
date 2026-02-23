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
  transformIgnorePatterns: [
    'node_modules/(?!(@kubernetes/client-node|openid-client|oauth4webapi|jose))'
  ],
};