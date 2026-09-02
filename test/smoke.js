#!/usr/bin/env node
'use strict';

/**
 * End-to-end smoke test.
 *
 * Runs the whole suite against every way the site can be deployed:
 *
 *   1. server.js on SQLite         — self-hosted on a hospital server
 *   2. api/[...path].js on SQLite  — the Vercel function's own code path
 *   3. the same, with the URL shape a Vercel rewrite delivers
 *   4. server.js on Postgres       — the storage Vercel uses (needs a URL)
 *   5. api/[...path].js on Postgres — the deployed combination
 *
 * Postgres is skipped unless TEST_DATABASE_URL is set, so `npm test` works
 * offline with no database to hand.
 *
 *   npm test
 *   TEST_DATABASE_URL=postgres://... npm test
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert');

const { buildChecks } = require('./suite');

const ROOT = path.join(__dirname, '..');
const PASSWORD = 'smoke-test-password';
const PG_URL = process.env.TEST_DATABASE_URL || '';

let failures = 0;
let total = 0;

async function waitForPort(base, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with code ${child.exitCode}`);
    }
    try {
      await fetch(`${base}/api/competencies`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`server at ${base} never became ready`);
}

async function runScenario({ label, script, port, env, suffix }) {
  const base = `http://127.0.0.1:${port}`;
  console.log(`\n${label}`);

  const child = spawn(process.execPath, [path.join(ROOT, script)], {
    env: { ...process.env, PORT: String(port), ADMIN_PASSWORD: PASSWORD, ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  try {
    await waitForPort(base, child);
  } catch (error) {
    console.error(`  FAIL  could not start: ${error.message}`);
    if (stderr.trim()) console.error(stderr.trim().split('\n').map((l) => `        ${l}`).join('\n'));
    failures += 1;
    child.kill();
    return;
  }

  for (const [name, fn] of buildChecks(base, PASSWORD, { suffix })) {
    total += 1;
    try {
      await fn();
      console.log(`  ok    ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`  FAIL  ${name}\n        ${error.message}`);
    }
  }

  child.kill();
  await new Promise((resolve) => child.once('exit', resolve));
}

async function resetPostgres(url) {
  const { Client } = require('pg');
  const client = new Client({
    connectionString: url,
    ssl: /\blocalhost\b|\b127\.0\.0\.1\b|sslmode=disable/.test(url)
      ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query(
    'DROP TABLE IF EXISTS submissions, nurses, sessions, settings, login_attempts');
  await client.end();
}

/**
 * A serverless deployment with no database must say so plainly, rather than
 * falling back to a SQLite file it cannot write.
 */
async function checkMisconfigured() {
  console.log('\n6. serverless with no database configured');
  const port = 3994;
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, 'test/vercel-shim.js')], {
    env: {
      ...process.env, PORT: String(port), VERCEL: '1',
      DATABASE_URL: '', POSTGRES_URL: '', POSTGRES_URL_NON_POOLING: '', DB_FILE: '',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  const checks = [
    ['health reports the missing database', async () => {
      const response = await fetch(`${base}/api/health`);
      const body = await response.json();
      assert.strictEqual(response.status, 503);
      assert.strictEqual(body.ok, false);
      assert.strictEqual(body.storage, 'none');
      assert.match(body.error, /Storage tab|DATABASE_URL/);
    }],
    ['other routes explain it too, as 503 not 500', async () => {
      const response = await fetch(`${base}/api/competencies`);
      assert.strictEqual(response.status, 503);
      assert.match((await response.json()).error, /No database is configured/);
    }],
  ];

  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { await fetch(`${base}/api/health`); break; } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    for (const [name, fn] of checks) {
      total += 1;
      try {
        await fn();
        console.log(`  ok    ${name}`);
      } catch (error) {
        failures += 1;
        console.error(`  FAIL  ${name}\n        ${error.message}`);
      }
    }
  } finally {
    child.kill();
  }
}

async function main() {
  console.log('\nNursing Competency Exam — smoke test');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'competency-'));
  try {
    await runScenario({
      label: '1. server.js on SQLite (self-hosted)',
      script: 'server.js',
      port: 3987,
      env: { DB_FILE: path.join(tmp, 'a.db'), DATABASE_URL: '', POSTGRES_URL: '' },
    });

    await runScenario({
      label: '2. api/[...path].js on SQLite (the Vercel function\'s code path)',
      script: 'test/vercel-shim.js',
      port: 3990,
      env: { DB_FILE: path.join(tmp, 'b.db'), DATABASE_URL: '', POSTGRES_URL: '' },
    });

    await runScenario({
      label: '3. api/[...path].js with Vercel\'s rewritten URL shape',
      script: 'test/vercel-shim.js',
      port: 3993,
      env: {
        DB_FILE: path.join(tmp, 'c.db'), DATABASE_URL: '', POSTGRES_URL: '',
        REWRITE_STYLE: 'path',
      },
    });

    if (PG_URL) {
      await resetPostgres(PG_URL);
      await runScenario({
        label: '4. server.js on Postgres (how it runs on Vercel)',
        script: 'server.js',
        port: 3991,
        env: { DATABASE_URL: PG_URL, DB_FILE: '' },
      });

      await resetPostgres(PG_URL);
      await runScenario({
        label: '5. api/[...path].js on Postgres (the deployed combination)',
        script: 'test/vercel-shim.js',
        port: 3992,
        env: { DATABASE_URL: PG_URL, DB_FILE: '', REWRITE_STYLE: 'path' },
      });
    } else {
      console.log('\n4/5. Postgres — skipped '
        + '(set TEST_DATABASE_URL to run the Vercel storage path)');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

    await checkMisconfigured();

  console.log(`\n${total - failures}/${total} checks passed`
    + `${failures ? ` — ${failures} FAILED` : ''}\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
