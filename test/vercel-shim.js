#!/usr/bin/env node
'use strict';

/**
 * Runs the Vercel serverless function locally under a plain Node server, with
 * the same contract Vercel gives it: JSON bodies already parsed onto req.body,
 * an x-forwarded-for header, and static pages served from public/ by the
 * platform rather than by the function.
 *
 * Used by test/smoke.js to prove the deployed path works, not just server.js.
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const handler = require('../api/[...path].js');

const PORT = Number(process.env.PORT) || 3990;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PAGES = {
  '/': 'index.html', '/exam': 'exam.html',
  '/admin': 'admin.html', '/print': 'print.html',
};

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/api/')) {
    // Stand in for Vercel's CDN, including the vercel.json rewrites.
    const url = new URL(req.url, 'http://localhost');
    const rel = PAGES[url.pathname] || url.pathname.replace(/^\/+/, '');
    const file = path.join(PUBLIC_DIR, rel);
    if (file.startsWith(PUBLIC_DIR) && fs.existsSync(file)
        && fs.statSync(file).isFile()) {
      res.writeHead(200);
      return res.end(fs.readFileSync(file));
    }
    res.writeHead(404);
    return res.end('Not found');
  }

  // Vercel parses a JSON request body before the function runs.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw) {
      try { req.body = JSON.parse(raw); } catch { req.body = raw; }
    } else {
      req.body = {};
    }
  }
  req.headers['x-forwarded-for'] = '203.0.113.9';
  // Vercel always serves HTTPS, so the session cookie is marked Secure there.
  // Locally that would stop a browser storing it over http, so it is opt-in.
  req.headers['x-forwarded-proto'] =
    process.env.SIMULATE_HTTPS === '1' ? 'https' : 'http';

  // Vercel's rewrite can deliver the request as the catch-all's own filename
  // with the real segments in a `path` query parameter. REWRITE_STYLE=path
  // reproduces that shape so the suite covers it too.
  if (process.env.REWRITE_STYLE === 'path') {
    const original = new URL(req.url, 'http://localhost');
    const segments = original.pathname.replace(/^\/api\//, '');
    original.searchParams.set('path', segments);
    req.url = `/api/[...path]?${original.searchParams}`;
  }

  await handler(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  if (process.send) process.send('ready');
});
