#!/usr/bin/env node
'use strict';

/**
 * Nursing Competency Exam — Alhadithah General Hospital.
 *
 * A zero-dependency Node server: nurses register and sit a competency form,
 * the admin reviews submissions and prints them as the hospital's paper form.
 *
 *   node server.js                        # http://localhost:3000
 *   PORT=8080 ADMIN_PASSWORD=... node server.js
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');

const { Store, nowIso } = require('./lib/db');
const scoring = require('./lib/scoring');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'competency.db');
const PUBLIC_DIR = path.join(ROOT, 'public');
const COOKIE = 'competency_admin';

// --- competency forms -------------------------------------------------------

const FORMS_FILE = path.join(ROOT, 'data', 'competencies.json');
if (!fs.existsSync(FORMS_FILE)) {
  console.error(`Missing ${FORMS_FILE}. Run: python3 tools/extract_competencies.py`);
  process.exit(1);
}
const FORMS = JSON.parse(fs.readFileSync(FORMS_FILE, 'utf8')).forms;
const FORMS_BY_ID = new Map(FORMS.map((form) => [form.id, form]));

/** The list view only needs headline details, not all 792 items. */
const FORM_INDEX = FORMS.map((form) => ({
  id: form.id,
  title: form.title,
  category: form.category,
  form_type: form.form_type,
  total_items: form.total_items,
  sections: form.sections.map((s) => ({ name: s.name, count: s.items.length })),
}));

// --- storage ----------------------------------------------------------------

const store = new Store(DB_FILE);

if (!store.hasAdminPassword()) {
  const password = process.env.ADMIN_PASSWORD || 'admin';
  store.setAdminPassword(password);
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('\n  !!  No ADMIN_PASSWORD set — the admin password is "admin".');
    console.warn('  !!  Change it before real use:  node server.js --set-password NEW\n');
  }
} else if (process.env.ADMIN_PASSWORD) {
  store.setAdminPassword(process.env.ADMIN_PASSWORD);
}

// --- helpers ----------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key) out[key] = decodeURIComponent(rest.join('='));
  }
  return out;
}

function isAdmin(req) {
  return store.validSession(parseCookies(req)[COOKIE]);
}

function requireAdmin(req) {
  if (!isAdmin(req)) throw new HttpError(401, 'Not signed in');
}

function str(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

/** Simple per-IP throttle so the admin password cannot be ground down. */
const loginAttempts = new Map();
function throttleLogin(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, until: 0 };
  if (entry.until > now) {
    throw new HttpError(429, 'Too many attempts. Try again in a minute.');
  }
  return {
    fail() {
      entry.count += 1;
      if (entry.count >= 5) {
        entry.until = now + 60_000;
        entry.count = 0;
      }
      loginAttempts.set(ip, entry);
    },
    reset() { loginAttempts.delete(ip); },
  };
}

// --- API --------------------------------------------------------------------

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;
  const q = url.searchParams;

  // --- public: forms -------------------------------------------------------

  if (method === 'GET' && pathname === '/api/competencies') {
    return sendJson(res, 200, { forms: FORM_INDEX });
  }

  if (method === 'GET' && pathname.startsWith('/api/competencies/')) {
    const form = FORMS_BY_ID.get(decodeURIComponent(pathname.split('/')[3]));
    if (!form) throw new HttpError(404, 'No such competency');
    return sendJson(res, 200, {
      form,
      ratings: scoring.ratingsFor(form.form_type || 'competency'),
      passMark: scoring.PASS_MARK,
    });
  }

  // --- public: nurses ------------------------------------------------------

  if (method === 'POST' && pathname === '/api/nurses') {
    const body = await readBody(req);
    const jobNumber = str(body.jobNumber, 60);
    const name = str(body.name, 120);
    if (!jobNumber) throw new HttpError(400, 'Job number is required');
    if (!name) throw new HttpError(400, 'Name is required');
    const nurse = store.upsertNurse({
      jobNumber,
      name,
      jobTitle: str(body.jobTitle, 120),
      unit: str(body.unit, 120),
      contractDate: str(body.contractDate, 40),
    });
    return sendJson(res, 200, { nurse });
  }

  if (method === 'GET' && pathname.startsWith('/api/nurses/')) {
    const nurse = store.nurseByJobNumber(decodeURIComponent(pathname.split('/')[3]));
    if (!nurse) throw new HttpError(404, 'Not registered yet');
    return sendJson(res, 200, { nurse });
  }

  /** Which forms this nurse has already submitted, so the UI can mark them. */
  if (method === 'GET' && pathname === '/api/my-submissions') {
    const nurse = store.nurseByJobNumber(str(q.get('jobNumber'), 60));
    if (!nurse) return sendJson(res, 200, { submissions: [] });
    const { rows } = store.listSubmissions({ search: nurse.job_number, limit: 1000 });
    return sendJson(res, 200, {
      submissions: rows
        .filter((row) => row.nurse_job_number === nurse.job_number)
        .map((row) => ({
          id: row.id,
          form_id: row.form_id,
          form_title: row.form_title,
          percent: row.percent,
          result: row.result,
          exam_date: row.exam_date,
        })),
    });
  }

  // --- public: submit ------------------------------------------------------

  if (method === 'POST' && pathname === '/api/submissions') {
    const body = await readBody(req);
    const form = FORMS_BY_ID.get(str(body.formId, 120));
    if (!form) throw new HttpError(400, 'No such competency');

    const nurse = store.nurseByJobNumber(str(body.jobNumber, 60));
    if (!nurse) throw new HttpError(400, 'Register your details before submitting');

    const formType = form.form_type || 'competency';
    const validKeys = new Set(scoring.itemKeys(form));
    const answers = {};
    for (const [key, rating] of Object.entries(body.answers || {})) {
      if (!validKeys.has(key)) continue;
      if (!scoring.isValidRating(formType, rating)) {
        throw new HttpError(400, `Invalid rating "${rating}"`);
      }
      answers[key] = rating;
    }

    const result = scoring.score(form, answers);
    if (!result.complete) {
      throw new HttpError(400, `${result.unanswered} item(s) still unanswered`);
    }

    const submission = store.createSubmission({
      nurseId: nurse.id,
      formId: form.id,
      formTitle: form.title,
      formCategory: form.category,
      formType,
      nurseName: nurse.name,
      nurseJobNumber: nurse.job_number,
      nurseJobTitle: nurse.job_title,
      nurseUnit: nurse.unit,
      nurseContractDate: nurse.contract_date,
      answers,
      rawScore: result.rawScore,
      totalScore: result.totalScore,
      naCount: result.naCount,
      itemCount: result.itemCount,
      percent: result.percent,
      result: result.result,
      examDate: str(body.examDate, 40) || nowIso().slice(0, 10),
      durationSeconds: Number(body.durationSeconds) || null,
      needsRemedial: result.needsRemedial,
    });
    return sendJson(res, 201, { submission, score: result });
  }

  if (method === 'GET' && /^\/api\/submissions\/\d+$/.test(pathname)) {
    const submission = store.submissionById(Number(pathname.split('/')[3]));
    if (!submission) throw new HttpError(404, 'Not found');
    return sendJson(res, 200, { submission });
  }

  // --- admin: auth ---------------------------------------------------------

  if (method === 'POST' && pathname === '/api/admin/login') {
    const ip = req.socket.remoteAddress || 'unknown';
    const throttle = throttleLogin(ip);
    const body = await readBody(req);
    if (!store.verifyAdminPassword(String(body.password ?? ''))) {
      throttle.fail();
      throw new HttpError(401, 'Wrong password');
    }
    throttle.reset();
    const { token, expiresAt } = store.createSession();
    res.setHeader('Set-Cookie',
      `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; `
      + `Expires=${expiresAt.toUTCString()}`);
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'POST' && pathname === '/api/admin/logout') {
    store.destroySession(parseCookies(req)[COOKIE]);
    res.setHeader('Set-Cookie',
      `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/admin/session') {
    return sendJson(res, 200, { signedIn: isAdmin(req) });
  }

  if (method === 'POST' && pathname === '/api/admin/password') {
    requireAdmin(req);
    const body = await readBody(req);
    const password = String(body.password ?? '');
    if (password.length < 6) {
      throw new HttpError(400, 'Password must be at least 6 characters');
    }
    store.setAdminPassword(password);
    return sendJson(res, 200, { ok: true });
  }

  // --- admin: submissions --------------------------------------------------

  function filtersFrom(params) {
    const reviewed = params.get('reviewed');
    return {
      search: str(params.get('search'), 120),
      formId: str(params.get('formId'), 120),
      category: str(params.get('category'), 40),
      result: str(params.get('result'), 20),
      from: str(params.get('from'), 40),
      to: str(params.get('to'), 40),
      reviewed: reviewed === 'yes' ? true : reviewed === 'no' ? false : undefined,
      limit: params.get('limit'),
      offset: params.get('offset'),
    };
  }

  if (method === 'GET' && pathname === '/api/admin/submissions') {
    requireAdmin(req);
    const page = store.listSubmissions(filtersFrom(q));
    return sendJson(res, 200, {
      ...page,
      rows: page.rows.map(({ answers, ...rest }) => rest),
      stats: store.stats(),
      forms: FORM_INDEX.map(({ id, title, category }) => ({ id, title, category })),
    });
  }

  if (method === 'GET' && pathname === '/api/admin/submission-ids') {
    requireAdmin(req);
    return sendJson(res, 200, { ids: store.submissionIds(filtersFrom(q)) });
  }

  if (method === 'PATCH' && /^\/api\/admin\/submissions\/\d+$/.test(pathname)) {
    requireAdmin(req);
    const id = Number(pathname.split('/')[4]);
    if (!store.submissionById(id)) throw new HttpError(404, 'Not found');
    const body = await readBody(req);
    return sendJson(res, 200, { submission: store.updateSubmission(id, body) });
  }

  if (method === 'DELETE' && /^\/api\/admin\/submissions\/\d+$/.test(pathname)) {
    requireAdmin(req);
    const ok = store.deleteSubmission(Number(pathname.split('/')[4]));
    if (!ok) throw new HttpError(404, 'Not found');
    return sendJson(res, 200, { ok: true });
  }

  /** Everything the print page needs: the answers plus the form text. */
  if (method === 'GET' && pathname === '/api/admin/print') {
    requireAdmin(req);
    const ids = str(q.get('ids'), 20000).split(',')
      .map(Number).filter(Number.isInteger);
    if (!ids.length) throw new HttpError(400, 'No submissions selected');
    const submissions = store.submissionsByIds(ids);
    const forms = {};
    for (const submission of submissions) {
      const form = FORMS_BY_ID.get(submission.form_id);
      if (form) forms[form.id] = form;
    }
    return sendJson(res, 200, { submissions, forms, passMark: scoring.PASS_MARK });
  }

  if (method === 'GET' && pathname === '/api/admin/export.csv') {
    requireAdmin(req);
    const { rows } = store.listSubmissions({ ...filtersFrom(q), limit: 1000 });
    const header = [
      'ID', 'Name', 'Job Number', 'Job Title', 'Unit', 'Contract Date',
      'Competency', 'Category', 'Raw Score', 'Total Score', 'NA', '% Rating',
      'Result', 'Needs Remedial', 'Remedial Date', 'Exam Date', 'Submitted At',
      'Evaluator', 'Evaluator Job Number', 'Evaluated Date', 'Comments',
    ];
    const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [header.map(cell).join(',')];
    for (const row of rows) {
      lines.push([
        row.id, row.nurse_name, row.nurse_job_number, row.nurse_job_title,
        row.nurse_unit, row.nurse_contract_date, row.form_title,
        row.form_category, row.raw_score, row.total_score, row.na_count,
        row.percent, row.result, row.needs_remedial ? 'YES' : 'NO',
        row.remedial_date, row.exam_date, row.submitted_at,
        row.evaluator_name, row.evaluator_job_number, row.evaluated_date,
        row.evaluator_comments,
      ].map(cell).join(','));
    }
    // The BOM makes Excel open the Arabic/Latin mix as UTF-8.
    const csv = '﻿' + lines.join('\r\n') + '\r\n';
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition':
        `attachment; filename="competency-submissions-${nowIso().slice(0, 10)}.csv"`,
    });
    return res.end(csv);
  }

  if (method === 'GET' && pathname === '/api/admin/nurses') {
    requireAdmin(req);
    return sendJson(res, 200, { nurses: store.listNurses() });
  }

  throw new HttpError(404, 'Unknown endpoint');
}

// --- static files -----------------------------------------------------------

const PAGES = {
  '/': 'index.html',
  '/exam': 'exam.html',
  '/admin': 'admin.html',
  '/print': 'print.html',
};

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

  const ext = path.extname(file).toLowerCase();
  const body = fs.readFileSync(file);
  const etag = `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304);
    return res.end();
  }
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': body.length,
    ETag: etag,
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

// --- server -----------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(req, res, url);
    } else {
      sendText(res, 405, 'Method not allowed');
    }
  } catch (error) {
    if (error instanceof HttpError) {
      if (!res.headersSent) sendJson(res, error.status, { error: error.message });
      return;
    }
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error' });
  }
});

// `node server.js --set-password NEW` changes the admin password offline.
const passwordFlag = process.argv.indexOf('--set-password');
if (passwordFlag !== -1) {
  const password = process.argv[passwordFlag + 1];
  if (!password || password.length < 6) {
    console.error('Usage: node server.js --set-password <at least 6 characters>');
    process.exit(1);
  }
  store.setAdminPassword(password);
  console.log('Admin password updated.');
  process.exit(0);
}

server.listen(PORT, HOST, () => {
  console.log(`\n  Nursing Competency Exam`);
  console.log(`  ${FORMS.length} competency forms, `
    + `${FORMS.reduce((n, f) => n + f.total_items, 0)} items`);
  console.log(`  Nurses  http://localhost:${PORT}/`);
  console.log(`  Admin   http://localhost:${PORT}/admin`);
  console.log(`  Data    ${DB_FILE}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => { store.close(); process.exit(0); });
  });
}
