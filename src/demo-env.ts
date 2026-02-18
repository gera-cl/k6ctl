#!/usr/bin/env node

/**
 * Script standalone para probar la función demoEnvUsage()
 * Ejecutar con: npm run demo
 * O directamente: node dist/demo-env.js
 */

import { demoEnvUsage } from './commands/run.js';

console.log("╔════════════════════════════════════════════════════════════╗");
console.log("║  DEMO: Utilidades de Variables de Entorno (.env)           ║");
console.log("╚════════════════════════════════════════════════════════════╝\n");

demoEnvUsage();

console.log("\n✨ Demo completado!");
