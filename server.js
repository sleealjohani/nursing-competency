#!/usr/bin/env node
'use strict';

/**
 * Nursing Competency Exam — Alhadithah General Hospital.
 *
 * Runs the whole site from one process: the API plus the static pages.
 * Use this to self-host on a hospital server or a laptop. On Vercel the
 * static files are served by the CDN and the API runs from
 * api/[...path].js instead — both share lib/api.js.
 *
 *   node server.js                            # http://localhost:3000
 *   PORT=8080 ADMIN_PASSWORD=... node server.js
 *   node server.js --set-password 'new one'
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');

const { serveApi } = require('./lib/api');
const { getStore, createStore, connectionString } = require('./lib/store');
const { FORMS, TOTAL_ITEMS } = require('./lib/forms');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Clean URLs, matching the rewrites in vercel.json. */
const PAGES = {
  '/': 'index.html',
  '/exam': 'exam.html',
  '/admin': 'admin.html',
  '/print': 'print.html',
};

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function serveStatic(req, res, url) {
  let rel = PAGES[url.pathname];
  if (!rel) {
    rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!rel) rel = 'index.html';
  }

  const file = path.join(PUBLIC_DIR, rel);
  // Never serve outside public/ — path traversal guard.
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== PUBLIC_DIR) {
    return sendText(res, 403, 'Forbidden');
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return sendText(res, 404, 'Not found');
  }

  const body = fs.readFileSync(file);
  const etag = `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304);
    return res.end();
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()]
      || 'application/octet-stream',
    'Content-Length': body.length,
    ETag: etag,
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    return serveApi(req, res, url);
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStatic(req, res, url);
  }
  sendText(res, 405, 'Method not allowed');
});

async function main() {
  // `node server.js --set-password NEW` changes the admin password offline.
  const flag = process.argv.indexOf('--set-password');
  if (flag !== -1) {
    const password = process.argv[flag + 1];
    if (!password || password.length < 6) {
      console.error('Usage: node server.js --set-password <at least 6 characters>');
      process.exit(1);
    }
    const store = createStore();
    await store.init();
    await store.setAdminPassword(password);
    await store.close();
    console.log('Admin password updated.');
    return;
  }

  const store = await getStore();

  server.listen(PORT, HOST, () => {
    console.log('\n  Nursing Competency Exam');
    console.log(`  ${FORMS.length} competency forms, ${TOTAL_ITEMS} items`);
    console.log(`  Nurses  http://localhost:${PORT}/`);
    console.log(`  Admin   http://localhost:${PORT}/admin`);
    console.log(`  Data    ${store.kind === 'postgres'
      ? `Postgres (${connectionString().replace(/:[^:@/]*@/, ':****@')})`
      : store.file}\n`);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close(async () => {
        await store.close();
        process.exit(0);
      });
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
