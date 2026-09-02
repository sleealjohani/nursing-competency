#!/usr/bin/env node
'use strict';

/**
 * End-to-end smoke test. Boots the server against a throwaway database,
 * walks the nurse and admin journeys, and checks the scoring rules.
 *
 *   npm test
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3987;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'competency-')), 'test.db');
const PASSWORD = 'smoke-test-password';

let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed += 1; console.log(`  ok  ${name}`); })
    .catch((error) => {
      console.error(`  FAIL  ${name}\n        ${error.message}`);
      process.exitCode = 1;
    });
}

let cookie = '';
async function call(pathname, { method, body, admin } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin && cookie) headers.Cookie = cookie;
  const response = await fetch(BASE + pathname, {
    method: method || (body ? 'POST' : 'GET'),
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const type = response.headers.get('content-type') || '';
  return {
    status: response.status,
    body: type.includes('json') ? await response.json() : await response.text(),
  };
}

function answerAll(form, pick) {
  const answers = {};
  form.sections.forEach((section, sectionIndex) => {
    section.items.forEach((item, i) => {
      answers[`${sectionIndex}.${item.no}`] = pick(i, section, item);
    });
  });
  return answers;
}

async function main() {
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_FILE, ADMIN_PASSWORD: PASSWORD },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  server.on('error', (error) => { throw error; });

  // Wait for the port to answer.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(`${BASE}/api/competencies`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  try {
    console.log('\nNursing Competency Exam — smoke test\n');

    let forms;
    await check('all competency forms load', async () => {
      const { status, body } = await call('/api/competencies');
      assert.strictEqual(status, 200);
      forms = body.forms;
      assert.ok(forms.length >= 40, `expected 40+ forms, got ${forms.length}`);
      for (const form of forms) {
        assert.ok(form.title, `${form.id} has no title`);
        assert.ok(form.total_items > 0, `${form.id} has no items`);
      }
    });

    await check('every form has unique, complete item keys', async () => {
      for (const summary of forms) {
        const { body } = await call(`/api/competencies/${summary.id}`);
        const keys = [];
        body.form.sections.forEach((section, index) => {
          section.items.forEach((item) => {
            assert.ok(item.text.length > 3, `${summary.id} item ${item.no} is empty`);
            keys.push(`${index}.${item.no}`);
          });
        });
        assert.strictEqual(new Set(keys).size, keys.length,
          `${summary.id} has duplicate item keys`);
        assert.strictEqual(keys.length, summary.total_items,
          `${summary.id} item count mismatch`);
      }
    });

    await check('nurse registration is required before submitting', async () => {
      const { status } = await call('/api/submissions', {
        body: { formId: 'triage', jobNumber: 'GHOST-1', answers: {} },
      });
      assert.strictEqual(status, 400);
    });

    await check('nurse registers and is found again by job number', async () => {
      const { status, body } = await call('/api/nurses', {
        body: {
          jobNumber: 'TEST-1', name: 'Test Nurse',
          jobTitle: 'Staff Nurse', unit: 'Emergency', contractDate: '2024-01-01',
        },
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(body.nurse.name, 'Test Nurse');
      const again = await call('/api/nurses/TEST-1');
      assert.strictEqual(again.body.nurse.job_number, 'TEST-1');
    });

    await check('a partly answered form is rejected', async () => {
      const { status, body } = await call('/api/submissions', {
        body: { formId: 'triage', jobNumber: 'TEST-1', answers: { '0.1': 'M' } },
      });
      assert.strictEqual(status, 400);
      assert.match(body.error, /unanswered/);
    });

    await check('an invalid rating is rejected', async () => {
      const { body: data } = await call('/api/competencies/triage');
      const { status } = await call('/api/submissions', {
        body: {
          formId: 'triage', jobNumber: 'TEST-1',
          answers: answerAll(data.form, () => 'BOGUS'),
        },
      });
      assert.strictEqual(status, 400);
    });

    let allMetId;
    await check('all Met scores 100% and reads as Met', async () => {
      const { body: data } = await call('/api/competencies/triage');
      const { status, body } = await call('/api/submissions', {
        body: {
          formId: 'triage', jobNumber: 'TEST-1', examDate: '2026-01-15',
          answers: answerAll(data.form, () => 'M'),
        },
      });
      assert.strictEqual(status, 201);
      assert.strictEqual(body.score.percent, 100);
      assert.strictEqual(body.score.result, 'Met');
      allMetId = body.submission.id;
    });

    await check('NA is deducted from the total score, per the form', async () => {
      const { body: data } = await call('/api/competencies/shock');
      const total = data.form.total_items;
      // One NA, the rest Met: raw = total-1, total score = total-1 => 100%.
      const { body } = await call('/api/submissions', {
        body: {
          formId: 'shock', jobNumber: 'TEST-1',
          answers: answerAll(data.form, (i, s, item) =>
            (i === 0 && s.name === 'KNOWLEDGE' && item.no === 1) ? 'NA' : 'M'),
        },
      });
      assert.strictEqual(body.score.naCount, 1);
      assert.strictEqual(body.score.totalScore, total - 1);
      assert.strictEqual(body.score.rawScore, total - 1);
      assert.strictEqual(body.score.percent, 100);
    });

    await check('below 90% reads as Not Met and flags remedial', async () => {
      const { body: data } = await call('/api/competencies/infection-control');
      let n = 0;
      const { body } = await call('/api/submissions', {
        body: {
          formId: 'infection-control', jobNumber: 'TEST-1',
          // Fail every third item — comfortably under the 90% pass mark.
          answers: answerAll(data.form, () => (n++ % 3 === 0 ? 'NM' : 'M')),
        },
      });
      assert.ok(body.score.percent < 90, `expected <90%, got ${body.score.percent}`);
      assert.strictEqual(body.score.result, 'Not Met');
      assert.strictEqual(body.score.needsRemedial, true);
    });

    await check('the equipment checklist uses its own VT/RD/UEC scale', async () => {
      const { body: data } = await call('/api/competencies/equipment-checklist');
      assert.deepStrictEqual(data.ratings, ['VT', 'RD', 'UEC', 'NA']);
      // M is not a rating on this form.
      const bad = await call('/api/submissions', {
        body: {
          formId: 'equipment-checklist', jobNumber: 'TEST-1',
          answers: answerAll(data.form, () => 'M'),
        },
      });
      assert.strictEqual(bad.status, 400);
      const good = await call('/api/submissions', {
        body: {
          formId: 'equipment-checklist', jobNumber: 'TEST-1',
          answers: answerAll(data.form, () => 'UEC'),
        },
      });
      assert.strictEqual(good.status, 201);
      assert.strictEqual(good.body.score.percent, 100);
    });

    await check('admin endpoints reject an unauthenticated caller', async () => {
      const saved = cookie;
      cookie = '';
      const { status } = await call('/api/admin/submissions', { admin: true });
      assert.strictEqual(status, 401);
      cookie = saved;
    });

    await check('admin sign-in rejects a wrong password', async () => {
      const { status } = await call('/api/admin/login', { body: { password: 'nope' } });
      assert.strictEqual(status, 401);
    });

    await check('admin signs in and sees every submission', async () => {
      const login = await call('/api/admin/login', { body: { password: PASSWORD } });
      assert.strictEqual(login.status, 200);
      const { status, body } = await call('/api/admin/submissions', { admin: true });
      assert.strictEqual(status, 200);
      assert.strictEqual(body.total, 4);
      assert.strictEqual(body.stats.nurses, 1);
    });

    await check('admin filters narrow the list', async () => {
      const notMet = await call('/api/admin/submissions?result=Not%20Met', { admin: true });
      assert.strictEqual(notMet.body.total, 1);
      const search = await call('/api/admin/submissions?search=TEST-1', { admin: true });
      assert.strictEqual(search.body.total, 4);
      const none = await call('/api/admin/submissions?search=nobody', { admin: true });
      assert.strictEqual(none.body.total, 0);
    });

    await check('admin records the evaluator name, dates and comments', async () => {
      const { status, body } = await call(`/api/admin/submissions/${allMetId}`, {
        method: 'PATCH', admin: true,
        body: {
          evaluator_name: 'Dr. Evaluator', evaluator_job_number: 'DOC-9',
          evaluated_date: '2026-01-16', evaluator_comments: 'Well done.',
          remedial_date: '2026-02-01', reviewed: true,
        },
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(body.submission.evaluator_name, 'Dr. Evaluator');
      assert.strictEqual(body.submission.evaluated_date, '2026-01-16');
      assert.strictEqual(body.submission.reviewed, true);
    });

    await check('the print endpoint returns answers plus the form text', async () => {
      const { body } = await call('/api/admin/submissions', { admin: true });
      const ids = body.rows.map((row) => row.id).join(',');
      const print = await call(`/api/admin/print?ids=${ids}`, { admin: true });
      assert.strictEqual(print.status, 200);
      assert.strictEqual(print.body.submissions.length, 4);
      for (const submission of print.body.submissions) {
        const form = print.body.forms[submission.form_id];
        assert.ok(form, `missing form for ${submission.form_id}`);
        assert.strictEqual(Object.keys(submission.answers).length, form.total_items);
      }
    });

    await check('CSV export carries a row per submission', async () => {
      const response = await fetch(`${BASE}/api/admin/export.csv`, { headers: { Cookie: cookie } });
      assert.strictEqual(response.status, 200);
      const lines = (await response.text()).trim().split('\r\n');
      assert.strictEqual(lines.length, 5); // header + 4 submissions
      assert.match(lines[0], /Name.*Job Number.*% Rating/);
    });

    await check('admin deletes a submission', async () => {
      const { status } = await call(`/api/admin/submissions/${allMetId}`, {
        method: 'DELETE', admin: true,
      });
      assert.strictEqual(status, 200);
      const { body } = await call('/api/admin/submissions', { admin: true });
      assert.strictEqual(body.total, 3);
    });

    await check('static files stay inside public/', async () => {
      const response = await fetch(`${BASE}/../server.js`);
      assert.ok(response.status >= 400, 'path traversal was not blocked');
    });

    console.log(`\n${passed} check(s) passed`
      + `${process.exitCode ? ' — with failures above' : ''}\n`);
  } finally {
    server.kill();
    fs.rmSync(path.dirname(DB_FILE), { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
