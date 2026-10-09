#!/usr/bin/env node
// Sets the env a fresh local Convex backend needs for a verification run: Convex Auth signing keys
// (JWT_PRIVATE_KEY, JWKS, SITE_URL) and SOUNDMAP_ALLOW_RESET, so `dev:resetMap` works.
// Run from the repo root while `CONVEX_AGENT_MODE=anonymous npx convex dev` is up:
//   node .claude/skills/verify/scripts/local-backend-env.mjs
// Refuses anything but a local or anonymous deployment. Keys are never printed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { exportJWK, exportPKCS8, generateKeyPair } from 'jose';

const deployment = readFileSync('.env.local', 'utf8').match(/^CONVEX_DEPLOYMENT=(\S+)/m)?.[1] ?? '';
if (!/^(local|anonymous):/.test(deployment)) {
  console.error(`Refusing: CONVEX_DEPLOYMENT is "${deployment}", not a local or anonymous deployment.`);
  process.exit(1);
}

const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
const env = {
  JWT_PRIVATE_KEY: (await exportPKCS8(privateKey)).trimEnd().replace(/\n/g, ' '),
  JWKS: JSON.stringify({ keys: [{ use: 'sig', ...(await exportJWK(publicKey)) }] }),
  SITE_URL: 'http://localhost',
  SOUNDMAP_ALLOW_RESET: 'true',
};
for (const [name, value] of Object.entries(env)) {
  execFileSync('npx', ['convex', 'env', 'set', name, '--', value], { stdio: ['ignore', 'ignore', 'inherit'] });
}
console.log(`Set ${Object.keys(env).join(', ')} on ${deployment}`);
