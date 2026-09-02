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

/**
 * Pooled connections come first on purpose. Each serverless invocation opens
 * its own connection, so going direct exhausts the database's connection
 * limit under load; the pooled endpoint (pgBouncer) exists for exactly this
 * traffic shape. Nothing here needs a session-mode connection — no prepared
 * statements held between queries, no LISTEN/NOTIFY, no temp tables.
 */
const DEFAULT_PASSWORD = 'admin';

const CONNECTION_VARS = [
  'POSTGRES_URL',             // Vercel Postgres / Neon: pooled
  'DATABASE_URL',             // Neon, Supabase, Railway, Render: pooled
  'POSTGRES_URL_NON_POOLING', // direct — only if no pooled URL is set
  'DATABASE_URL_UNPOOLED',    // Neon's name for the same
];

function connectionString() {
  for (const name of CONNECTION_VARS) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Raised when the deployment has no usable storage. Carries a message that is
 * safe to show the operator — it names the setting to fix, never a secret.
 */
class StorageConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StorageConfigError';
    this.isConfigError = true;
  }
}

/** True on a host whose filesystem cannot keep a SQLite file between requests. */
function isServerless() {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
    || process.env.NETLIFY || process.env.FUNCTIONS_WORKER_RUNTIME);
}

/** One store per process — serverless invocations reuse a warm instance. */
let cached = null;

function createStore() {
  if (cached) return cached;
  const url = connectionString();

  // A serverless filesystem is read-only and does not survive a request, so a
  // SQLite file there would fail on the first write, or silently lose every
  // record. Say what is missing instead.
  if (!url && isServerless()) {
    throw new StorageConfigError(
      'No database is configured. This site needs Postgres when it runs on '
      + 'Vercel: open the project\'s Storage tab, create a Postgres database, '
      + 'then redeploy. Any Postgres works — set DATABASE_URL instead if you '
      + 'have your own.');
  }

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
  try {
    await store.init();
  } catch (error) {
    if (error.isConfigError) throw error;
    throw new StorageConfigError(
      `Could not reach the ${store.kind === 'postgres' ? 'Postgres database'
        : 'database file'}. `
      + (store.kind === 'postgres'
        ? 'Check that the database still exists and that POSTGRES_URL or '
          + 'DATABASE_URL is correct, then redeploy.'
        : `Check that ${store.file} is writable.`)
      + ` (${error.code || error.message})`);
  }
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
  // Trimmed: a value pasted into a hosting dashboard often carries a trailing
  // newline or space, and hashing that invisibly makes the password "not work".
  const fromEnv = process.env.ADMIN_PASSWORD?.trim() || '';
  const exists = await store.hasAdminPassword();

  if (!exists) {
    await store.setAdminPassword(fromEnv || DEFAULT_PASSWORD);
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
  return !!(process.env.ADMIN_PASSWORD || '').trim();
}

/**
 * Whether the site is still on the first-run default password. Only ever
 * reported to an admin who has already signed in — publishing it would be an
 * invitation.
 */
async function usingDefaultPassword() {
  try {
    const store = await getStore();
    return await store.verifyAdminPassword(DEFAULT_PASSWORD);
  } catch {
    return false;
  }
}

/** A safe summary for the health endpoint — never includes the credentials. */
async function storageHealth() {
  const url = connectionString();
  const kind = url ? 'postgres' : (isServerless() ? 'none' : 'sqlite');
  try {
    await getStore();
    return { ok: true, storage: kind, connected: true };
  } catch (error) {
    return {
      ok: false,
      storage: kind,
      connected: false,
      error: error.isConfigError ? error.message : 'Storage is unavailable.',
    };
  }
}

module.exports = {
  createStore, getStore, connectionString, passwordFromEnv,
  usingDefaultPassword, storageHealth, isServerless, StorageConfigError,
  CONNECTION_VARS,
};
