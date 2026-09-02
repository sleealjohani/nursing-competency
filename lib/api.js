'use strict';

/**
 * The HTTP API, shared by the self-hosted server (server.js) and the Vercel
 * serverless function (api/[...path].js). Storage is reached through
 * lib/store.js, so it works over SQLite or Postgres unchanged.
 */

const { getStore, passwordFromEnv, storageHealth } = require('./store');
const { FORM_INDEX, TOTAL_ITEMS, getForm, formType, scoring } = require('./forms');

const COOKIE = 'competency_admin';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// --- request/response helpers ----------------------------------------------

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function readBody(req, limit = 1_000_000) {
  // Vercel parses JSON bodies for us; a plain Node server does not.
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch { throw new HttpError(400, 'Invalid JSON body'); }
    }
    return req.body;
  }
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

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key) out[key] = decodeURIComponent(rest.join('='));
  }
  return out;
}

function str(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

/** Behind Vercel's proxy the socket address is the edge, not the caller. */
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

/** Secure cookies need HTTPS; Vercel always serves it, localhost may not. */
function isSecureRequest(req) {
  return req.headers['x-forwarded-proto'] === 'https'
    || !!process.env.VERCEL;
}

function nowIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

// --- routes -----------------------------------------------------------------

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;
  const q = url.searchParams;

  /**
   * Answers before storage is touched, so it can report a database that is
   * missing or unreachable rather than failing with it.
   */
  if (method === 'GET' && pathname === '/api/health') {
    const health = await storageHealth();
    return sendJson(res, health.ok ? 200 : 503, {
      ...health,
      forms: FORM_INDEX.length,
      items: TOTAL_ITEMS,
    });
  }

  const store = await getStore();

  const isAdmin = async () => store.validSession(parseCookies(req)[COOKIE]);
  const requireAdmin = async () => {
    if (!await isAdmin()) throw new HttpError(401, 'Not signed in');
  };

  // --- public: forms -------------------------------------------------------

  if (method === 'GET' && pathname === '/api/competencies') {
    return sendJson(res, 200, { forms: FORM_INDEX });
  }

  if (method === 'GET' && pathname.startsWith('/api/competencies/')) {
    const form = getForm(decodeURIComponent(pathname.split('/')[3] || ''));
    if (!form) throw new HttpError(404, 'No such competency');
    return sendJson(res, 200, {
      form,
      ratings: scoring.ratingsFor(formType(form)),
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
    const nurse = await store.upsertNurse({
      jobNumber,
      name,
      jobTitle: str(body.jobTitle, 120),
      unit: str(body.unit, 120),
      contractDate: str(body.contractDate, 40),
    });
    return sendJson(res, 200, { nurse });
  }

  if (method === 'GET' && pathname.startsWith('/api/nurses/')) {
    const nurse = await store.nurseByJobNumber(
      decodeURIComponent(pathname.split('/')[3] || ''));
    if (!nurse) throw new HttpError(404, 'Not registered yet');
    return sendJson(res, 200, { nurse });
  }

  /** Which forms this nurse has already submitted, so the UI can mark them. */
  if (method === 'GET' && pathname === '/api/my-submissions') {
    const nurse = await store.nurseByJobNumber(str(q.get('jobNumber'), 60));
    if (!nurse) return sendJson(res, 200, { submissions: [] });
    const { rows } = await store.listSubmissions({
      search: nurse.job_number, limit: 1000,
    });
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
    const form = getForm(str(body.formId, 120));
    if (!form) throw new HttpError(400, 'No such competency');

    const nurse = await store.nurseByJobNumber(str(body.jobNumber, 60));
    if (!nurse) throw new HttpError(400, 'Register your details before submitting');

    const type = formType(form);
    const validKeys = new Set(scoring.itemKeys(form));
    const answers = {};
    for (const [key, rating] of Object.entries(body.answers || {})) {
      if (!validKeys.has(key)) continue;
      if (!scoring.isValidRating(type, rating)) {
        throw new HttpError(400, `Invalid rating "${rating}"`);
      }
      answers[key] = rating;
    }

    const result = scoring.score(form, answers);
    if (!result.complete) {
      throw new HttpError(400, `${result.unanswered} item(s) still unanswered`);
    }

    const submission = await store.createSubmission({
      nurseId: nurse.id,
      formId: form.id,
      formTitle: form.title,
      formCategory: form.category,
      formType: type,
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
      examDate: str(body.examDate, 40) || nowIsoDate(),
      durationSeconds: Number(body.durationSeconds) || null,
      needsRemedial: result.needsRemedial,
    });
    return sendJson(res, 201, { submission, score: result });
  }

  if (method === 'GET' && /^\/api\/submissions\/\d+$/.test(pathname)) {
    const submission = await store.submissionById(Number(pathname.split('/')[3]));
    if (!submission) throw new HttpError(404, 'Not found');
    return sendJson(res, 200, { submission });
  }

  // --- admin: auth ---------------------------------------------------------

  if (method === 'POST' && pathname === '/api/admin/login') {
    const ip = clientIp(req);
    if (await store.isLockedOut(ip)) {
      throw new HttpError(429, 'Too many attempts. Try again in a minute.');
    }
    const body = await readBody(req);
    if (!await store.verifyAdminPassword(String(body.password ?? ''))) {
      await store.recordFailedLogin(ip);
      throw new HttpError(401, 'Wrong password');
    }
    await store.clearFailedLogins(ip);
    const { token, expiresAt } = await store.createSession();
    res.setHeader('Set-Cookie', [
      `${COOKIE}=${token}`, 'HttpOnly', 'SameSite=Strict', 'Path=/',
      `Expires=${expiresAt.toUTCString()}`,
      ...(isSecureRequest(req) ? ['Secure'] : []),
    ].join('; '));
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'POST' && pathname === '/api/admin/logout') {
    await store.destroySession(parseCookies(req)[COOKIE]);
    res.setHeader('Set-Cookie',
      `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/admin/session') {
    return sendJson(res, 200, {
      signedIn: await isAdmin(),
      passwordFromEnv: passwordFromEnv(),
    });
  }

  if (method === 'POST' && pathname === '/api/admin/password') {
    await requireAdmin();
    if (passwordFromEnv()) {
      throw new HttpError(409,
        'The password is set by the ADMIN_PASSWORD environment variable. '
        + 'Change it there and redeploy.');
    }
    const body = await readBody(req);
    const password = String(body.password ?? '');
    if (password.length < 6) {
      throw new HttpError(400, 'Password must be at least 6 characters');
    }
    await store.setAdminPassword(password);
    return sendJson(res, 200, { ok: true });
  }

  // --- admin: submissions --------------------------------------------------

  const filtersFrom = (params) => {
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
  };

  if (method === 'GET' && pathname === '/api/admin/submissions') {
    await requireAdmin();
    const page = await store.listSubmissions(filtersFrom(q));
    return sendJson(res, 200, {
      ...page,
      rows: page.rows.map(({ answers, ...rest }) => rest),
      stats: await store.stats(),
      forms: FORM_INDEX.map(({ id, title, category }) => ({ id, title, category })),
    });
  }

  if (method === 'GET' && pathname === '/api/admin/submission-ids') {
    await requireAdmin();
    return sendJson(res, 200, { ids: await store.submissionIds(filtersFrom(q)) });
  }

  if (method === 'PATCH' && /^\/api\/admin\/submissions\/\d+$/.test(pathname)) {
    await requireAdmin();
    const id = Number(pathname.split('/')[4]);
    if (!await store.submissionById(id)) throw new HttpError(404, 'Not found');
    const body = await readBody(req);
    return sendJson(res, 200, { submission: await store.updateSubmission(id, body) });
  }

  if (method === 'DELETE' && /^\/api\/admin\/submissions\/\d+$/.test(pathname)) {
    await requireAdmin();
    const ok = await store.deleteSubmission(Number(pathname.split('/')[4]));
    if (!ok) throw new HttpError(404, 'Not found');
    return sendJson(res, 200, { ok: true });
  }

  /** Everything the print page needs: the answers plus the form text. */
  if (method === 'GET' && pathname === '/api/admin/print') {
    await requireAdmin();
    const ids = str(q.get('ids'), 20000).split(',')
      .map(Number).filter(Number.isInteger);
    if (!ids.length) throw new HttpError(400, 'No submissions selected');
    const submissions = await store.submissionsByIds(ids);
    const forms = {};
    for (const submission of submissions) {
      const form = getForm(submission.form_id);
      if (form) forms[form.id] = form;
    }
    return sendJson(res, 200, { submissions, forms, passMark: scoring.PASS_MARK });
  }

  if (method === 'GET' && pathname === '/api/admin/export.csv') {
    await requireAdmin();
    const { rows } = await store.listSubmissions({ ...filtersFrom(q), limit: 1000 });
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
    // The BOM makes Excel open the file as UTF-8.
    const csv = '﻿' + lines.join('\r\n') + '\r\n';
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition':
        `attachment; filename="competency-submissions-${nowIsoDate()}.csv"`,
    });
    return res.end(csv);
  }

  if (method === 'GET' && pathname === '/api/admin/nurses') {
    await requireAdmin();
    return sendJson(res, 200, { nurses: await store.listNurses() });
  }

  throw new HttpError(404, 'Unknown endpoint');
}

/** Runs handleApi and turns thrown errors into JSON responses. */
async function serveApi(req, res, url) {
  try {
    await handleApi(req, res, url);
  } catch (error) {
    if (error instanceof HttpError) {
      if (!res.headersSent) sendJson(res, error.status, { error: error.message });
      return;
    }
    if (error.isConfigError) {
      console.error(error.message);
      if (!res.headersSent) sendJson(res, 503, { error: error.message });
      return;
    }
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error' });
  }
}

module.exports = { serveApi, handleApi, HttpError, COOKIE };
