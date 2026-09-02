'use strict';

/**
 * Picks the storage backend.
 *
 *   POSTGRES_URL / DATABASE_URL set  ->  Postgres (Vercel and other
 *                                        serverless hosts, which have no
 *                                        persistent filesystem)
 *   otherwise                        ->  SQLite file (self-hosted server)
 *
 * Both stores expose the same async interface, so nothing above this file
 * needs to know which one is in use.
 */

const path = require('node:path');

const CONNECTION_VARS = [
  'POSTGRES_URL_NON_POOLING', // Vercel/Neon: direct, avoids a pooler hop
  'POSTGRES_URL',             // Vercel Postgres / Neon integration
  'DATABASE_URL',             // Supabase, Railway, Render, plain Postgres
];

function connectionString() {
  for (const name of CONNECTION_VARS) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return null;
}

/** One store per process — serverless invocations reuse a warm instance. */
let cached = null;

function createStore() {
  if (cached) return cached;
  const url = connectionString();
  if (url) {
    const { Store } = require('./store-postgres');
    cached = new Store(url);
    cached.kind = 'postgres';
  } else {
    const { Store } = require('./store-sqlite');
    // Kept out of data/ so the records can never be swept into a deployment
    // bundle alongside data/competencies.json.
    const file = process.env.DB_FILE
      || path.join(__dirname, '..', 'var', 'competency.db');
    cached = new Store(file);
    cached.kind = 'sqlite';
    cached.file = file;
  }
  return cached;
}

/**
 * Returns a store with its schema in place and the admin password seeded.
 * Safe to call on every request: the work happens once per process.
 */
async function getStore() {
  const store = createStore();
  await store.init();
  if (!store.seeded) {
    store.seeded = seedAdminPassword(store);
    store.seeded.catch(() => { store.seeded = null; });
  }
  await store.seeded;
  return store;
}

/**
 * When ADMIN_PASSWORD is set it is the source of truth, so redeploying with a
 * new value changes the password. Without it, the stored password stands and
 * the admin page can change it.
 */
async function seedAdminPassword(store) {
  const fromEnv = process.env.ADMIN_PASSWORD;
  const exists = await store.hasAdminPassword();

  if (!exists) {
    await store.setAdminPassword(fromEnv || 'admin');
    if (!fromEnv) {
      console.warn('No ADMIN_PASSWORD set — the admin password is "admin". '
        + 'Set ADMIN_PASSWORD and redeploy, or change it from the admin page.');
    }
    return;
  }
  if (fromEnv && !await store.verifyAdminPassword(fromEnv)) {
    await store.setAdminPassword(fromEnv);
  }
}

/** True when the password is pinned by the environment, so the UI cannot change it. */
function passwordFromEnv() {
  return !!process.env.ADMIN_PASSWORD;
}

module.exports = {
  createStore, getStore, connectionString, passwordFromEnv, CONNECTION_VARS,
};
