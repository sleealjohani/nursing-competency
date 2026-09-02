'use strict';

/**
 * The end-to-end checks, run against a base URL. test/smoke.js runs this
 * suite against every storage backend and against the Vercel-shaped handler,
 * so the same behaviour is proved on each deployment path.
 */

const assert = require('node:assert');

function makeClient(base) {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    set cookie(value) { cookie = value; },
    async call(pathname, { method, body, raw } = {}) {
      const headers = { 'Content-Type': 'application/json' };
      if (cookie) headers.Cookie = cookie;
      const response = await fetch(base + pathname, {
        method: method || (body ? 'POST' : 'GET'),
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      if (raw) return { status: response.status, body: await response.text() };
      const type = response.headers.get('content-type') || '';
      return {
        status: response.status,
        body: type.includes('json') ? await response.json() : await response.text(),
      };
    },
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

/**
 * @param {string} base      e.g. http://127.0.0.1:3987
 * @param {string} password  the admin password the server was started with
 * @param {object} opts      { suffix } to keep job numbers unique per run
 */
function buildChecks(base, password, { suffix = '' } = {}) {
  const client = makeClient(base);
  const call = (p, o) => client.call(p, o);
  const JOB = `TEST-1${suffix}`;
  const state = {};

  return [
    ['all competency forms load', async () => {
      const { status, body } = await call('/api/competencies');
      assert.strictEqual(status, 200);
      state.forms = body.forms;
      assert.ok(state.forms.length >= 40,
        `expected 40+ forms, got ${state.forms.length}`);
      for (const form of state.forms) {
        assert.ok(form.title, `${form.id} has no title`);
        assert.ok(form.total_items > 0, `${form.id} has no items`);
      }
    }],

    ['every form has unique, complete item keys', async () => {
      for (const summary of state.forms) {
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
    }],

    ['an unknown competency is a 404', async () => {
      const { status } = await call('/api/competencies/not-a-real-form');
      assert.strictEqual(status, 404);
    }],

    ['nurse registration is required before submitting', async () => {
      const { status } = await call('/api/submissions', {
        body: { formId: 'triage', jobNumber: `GHOST${suffix}`, answers: {} },
      });
      assert.strictEqual(status, 400);
    }],

    ['nurse registers and is found again by job number', async () => {
      const { status, body } = await call('/api/nurses', {
        body: {
          jobNumber: JOB, name: 'Test Nurse',
          jobTitle: 'Staff Nurse', unit: 'Emergency', contractDate: '2024-01-01',
        },
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(body.nurse.name, 'Test Nurse');
      const again = await call(`/api/nurses/${JOB}`);
      assert.strictEqual(again.body.nurse.job_number, JOB);
    }],

    ['re-registering updates the nurse instead of duplicating', async () => {
      const { body } = await call('/api/nurses', {
        body: { jobNumber: JOB, name: 'Test Nurse', unit: 'ICU' },
      });
      assert.strictEqual(body.nurse.unit, 'ICU');
      const again = await call('/api/nurses', {
        body: {
          jobNumber: JOB, name: 'Test Nurse',
          jobTitle: 'Staff Nurse', unit: 'Emergency', contractDate: '2024-01-01',
        },
      });
      assert.strictEqual(again.body.nurse.id, body.nurse.id);
      assert.strictEqual(again.body.nurse.unit, 'Emergency');
    }],

    ['a partly answered form is rejected', async () => {
      const { status, body } = await call('/api/submissions', {
        body: { formId: 'triage', jobNumber: JOB, answers: { '0.1': 'M' } },
      });
      assert.strictEqual(status, 400);
      assert.match(body.error, /unanswered/);
    }],

    ['an invalid rating is rejected', async () => {
      const { body: data } = await call('/api/competencies/triage');
      const { status } = await call('/api/submissions', {
        body: {
          formId: 'triage', jobNumber: JOB,
          answers: answerAll(data.form, () => 'BOGUS'),
        },
      });
      assert.strictEqual(status, 400);
    }],

    ['all Met scores 100% and reads as Met', async () => {
      const { body: data } = await call('/api/competencies/triage');
      const { status, body } = await call('/api/submissions', {
        body: {
          formId: 'triage', jobNumber: JOB, examDate: '2026-01-15',
          answers: answerAll(data.form, () => 'M'),
        },
      });
      assert.strictEqual(status, 201);
      assert.strictEqual(body.score.percent, 100);
      assert.strictEqual(body.score.result, 'Met');
      assert.strictEqual(body.submission.nurse_name, 'Test Nurse');
      state.allMetId = body.submission.id;
    }],

    ['NA is deducted from the total score, per the form', async () => {
      const { body: data } = await call('/api/competencies/shock');
      const total = data.form.total_items;
      const { body } = await call('/api/submissions', {
        body: {
          formId: 'shock', jobNumber: JOB,
          answers: answerAll(data.form, (i, s, item) =>
            (s.name === 'KNOWLEDGE' && item.no === 1) ? 'NA' : 'M'),
        },
      });
      assert.strictEqual(body.score.naCount, 1);
      assert.strictEqual(body.score.totalScore, total - 1);
      assert.strictEqual(body.score.rawScore, total - 1);
      assert.strictEqual(body.score.percent, 100);
    }],

    ['below 90% reads as Not Met and flags remedial', async () => {
      const { body: data } = await call('/api/competencies/infection-control');
      let n = 0;
      const { body } = await call('/api/submissions', {
        body: {
          formId: 'infection-control', jobNumber: JOB,
          // Fail every third item — comfortably under the 90% pass mark.
          answers: answerAll(data.form, () => (n++ % 3 === 0 ? 'NM' : 'M')),
        },
      });
      assert.ok(body.score.percent < 90, `expected <90%, got ${body.score.percent}`);
      assert.strictEqual(body.score.result, 'Not Met');
      assert.strictEqual(body.score.needsRemedial, true);
    }],

    ['the equipment checklist uses its own VT/RD/UEC scale', async () => {
      const { body: data } = await call('/api/competencies/equipment-checklist');
      assert.deepStrictEqual(data.ratings, ['VT', 'RD', 'UEC', 'NA']);
      const bad = await call('/api/submissions', {
        body: {
          formId: 'equipment-checklist', jobNumber: JOB,
          answers: answerAll(data.form, () => 'M'),
        },
      });
      assert.strictEqual(bad.status, 400, 'M should not be a rating on this form');
      const good = await call('/api/submissions', {
        body: {
          formId: 'equipment-checklist', jobNumber: JOB,
          answers: answerAll(data.form, () => 'UEC'),
        },
      });
      assert.strictEqual(good.status, 201);
      assert.strictEqual(good.body.score.percent, 100);
    }],

    ['a nurse sees their own previous submissions', async () => {
      const { body } = await call(`/api/my-submissions?jobNumber=${JOB}`);
      assert.strictEqual(body.submissions.length, 4);
      assert.ok(body.submissions.every((s) => s.form_id && s.result));
    }],

    ['admin endpoints reject an unauthenticated caller', async () => {
      const saved = client.cookie;
      client.cookie = '';
      for (const path of ['/api/admin/submissions', '/api/admin/print?ids=1',
        '/api/admin/export.csv', '/api/admin/nurses']) {
        const { status } = await call(path);
        assert.strictEqual(status, 401, `${path} was not protected`);
      }
      client.cookie = saved;
    }],

    ['admin sign-in rejects a wrong password', async () => {
      const saved = client.cookie;
      client.cookie = '';
      const { status } = await call('/api/admin/login', { body: { password: 'nope' } });
      assert.strictEqual(status, 401);
      client.cookie = saved;
    }],

    ['admin signs in and sees every submission', async () => {
      const login = await call('/api/admin/login', { body: { password } });
      assert.strictEqual(login.status, 200);
      const { status, body } = await call('/api/admin/submissions');
      assert.strictEqual(status, 200);
      assert.strictEqual(body.total, 4);
      assert.strictEqual(body.stats.nurses, 1);
      assert.strictEqual(body.stats.met, 3);
      assert.strictEqual(body.stats.notMet, 1);
      assert.strictEqual(body.stats.pendingReview, 4);
      // The list view must not ship every answer.
      assert.ok(body.rows.every((row) => row.answers === undefined));
    }],

    ['admin filters narrow the list', async () => {
      assert.strictEqual(
        (await call('/api/admin/submissions?result=Not%20Met')).body.total, 1);
      assert.strictEqual(
        (await call(`/api/admin/submissions?search=${JOB}`)).body.total, 4);
      assert.strictEqual(
        (await call('/api/admin/submissions?search=nobody')).body.total, 0);
      assert.strictEqual(
        (await call('/api/admin/submissions?formId=triage')).body.total, 1);
      assert.strictEqual(
        (await call('/api/admin/submissions?category=Specific')).body.total, 2);
      assert.strictEqual(
        (await call('/api/admin/submissions?reviewed=no')).body.total, 4);
      assert.strictEqual(
        (await call('/api/admin/submissions?from=2030-01-01')).body.total, 0);
    }],

    ['admin records the evaluator name, dates and comments', async () => {
      const { status, body } = await call(`/api/admin/submissions/${state.allMetId}`, {
        method: 'PATCH',
        body: {
          evaluator_name: 'Dr. Evaluator', evaluator_job_number: 'DOC-9',
          evaluated_date: '2026-01-16', evaluator_comments: 'Well done.',
          staff_comments: 'Thank you.', conformed_date: '2026-01-17',
          needs_remedial: false, remedial_date: '', reviewed: true,
        },
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(body.submission.evaluator_name, 'Dr. Evaluator');
      assert.strictEqual(body.submission.evaluated_date, '2026-01-16');
      assert.strictEqual(body.submission.staff_comments, 'Thank you.');
      assert.strictEqual(body.submission.reviewed, true);
      assert.strictEqual(body.submission.needs_remedial, false);
      assert.strictEqual(
        (await call('/api/admin/submissions?reviewed=yes')).body.total, 1);
    }],

    ['patching an unknown submission is a 404', async () => {
      const { status } = await call('/api/admin/submissions/999999', {
        method: 'PATCH', body: { evaluator_name: 'X' },
      });
      assert.strictEqual(status, 404);
    }],

    ['the print endpoint returns answers plus the form text', async () => {
      const { body } = await call('/api/admin/submissions');
      const ids = body.rows.map((row) => row.id).join(',');
      const print = await call(`/api/admin/print?ids=${ids}`);
      assert.strictEqual(print.status, 200);
      assert.strictEqual(print.body.submissions.length, 4);
      for (const submission of print.body.submissions) {
        const form = print.body.forms[submission.form_id];
        assert.ok(form, `missing form for ${submission.form_id}`);
        assert.strictEqual(Object.keys(submission.answers).length, form.total_items);
      }
      const withEvaluator = print.body.submissions
        .find((s) => s.id === state.allMetId);
      assert.strictEqual(withEvaluator.evaluator_name, 'Dr. Evaluator');
    }],

    ['submission ids honour the same filters as the list', async () => {
      const { body } = await call('/api/admin/submission-ids?result=Not%20Met');
      assert.strictEqual(body.ids.length, 1);
    }],

    ['CSV export carries a row per submission', async () => {
      const { status, body } = await call('/api/admin/export.csv', { raw: true });
      assert.strictEqual(status, 200);
      const lines = body.trim().split('\r\n');
      assert.strictEqual(lines.length, 5); // header + 4 submissions
      assert.match(lines[0], /Name.*Job Number.*% Rating/);
      assert.ok(body.includes('Dr. Evaluator'));
    }],

    ['admin deletes a submission', async () => {
      const { status } = await call(`/api/admin/submissions/${state.allMetId}`, {
        method: 'DELETE',
      });
      assert.strictEqual(status, 200);
      assert.strictEqual((await call('/api/admin/submissions')).body.total, 3);
      assert.strictEqual(
        (await call(`/api/admin/submissions/${state.allMetId}`, {
          method: 'DELETE',
        })).status, 404);
    }],

    ['signing out invalidates the session', async () => {
      await call('/api/admin/logout', { method: 'POST' });
      const { body } = await call('/api/admin/session');
      assert.strictEqual(body.signedIn, false);
      assert.strictEqual((await call('/api/admin/submissions')).status, 401);
    }],

    ['repeated wrong passwords lock the address out', async () => {
      client.cookie = '';
      let locked = false;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const { status } = await call('/api/admin/login', {
          body: { password: `wrong-${attempt}` },
        });
        if (status === 429) { locked = true; break; }
        assert.strictEqual(status, 401);
      }
      assert.ok(locked, 'expected a lockout after repeated failures');
      // The lockout must also refuse the correct password while it stands.
      const { status } = await call('/api/admin/login', { body: { password } });
      assert.strictEqual(status, 429);
    }],
  ];
}

module.exports = { buildChecks, makeClient, answerAll };
