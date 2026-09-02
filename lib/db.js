'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nurses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job_number     TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  job_title      TEXT NOT NULL DEFAULT '',
  unit           TEXT NOT NULL DEFAULT '',
  contract_date  TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  nurse_id          INTEGER NOT NULL REFERENCES nurses(id) ON DELETE CASCADE,
  form_id           TEXT NOT NULL,
  form_title        TEXT NOT NULL,
  form_category     TEXT NOT NULL,
  form_type         TEXT NOT NULL DEFAULT 'competency',
  -- The nurse's details as given at the time of this sitting, so a later
  -- profile edit never rewrites a form that was already submitted.
  nurse_name        TEXT NOT NULL,
  nurse_job_number  TEXT NOT NULL,
  nurse_job_title   TEXT NOT NULL DEFAULT '',
  nurse_unit        TEXT NOT NULL DEFAULT '',
  nurse_contract_date TEXT NOT NULL DEFAULT '',
  answers           TEXT NOT NULL,
  raw_score         INTEGER NOT NULL,
  total_score       INTEGER NOT NULL,
  na_count          INTEGER NOT NULL,
  item_count        INTEGER NOT NULL,
  percent           REAL,
  result            TEXT NOT NULL,
  exam_date         TEXT NOT NULL,
  submitted_at      TEXT NOT NULL,
  duration_seconds  INTEGER,
  -- Filled in by the admin afterwards, mirroring the foot of the paper form.
  evaluator_name    TEXT NOT NULL DEFAULT '',
  evaluator_job_number TEXT NOT NULL DEFAULT '',
  evaluator_comments   TEXT NOT NULL DEFAULT '',
  evaluated_date    TEXT NOT NULL DEFAULT '',
  staff_comments    TEXT NOT NULL DEFAULT '',
  conformed_date    TEXT NOT NULL DEFAULT '',
  needs_remedial    INTEGER NOT NULL DEFAULT 0,
  remedial_date     TEXT NOT NULL DEFAULT '',
  reviewed          INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_submissions_nurse ON submissions(nurse_id);
CREATE INDEX IF NOT EXISTS idx_submissions_form ON submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_submissions_date ON submissions(exam_date);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const SESSION_DAYS = 7;

function nowIso() {
  return new Date().toISOString();
}

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

class Store {
  constructor(file) {
    this.db = open(file);
  }

  close() {
    this.db.close();
  }

  // --- nurses ------------------------------------------------------------

  /** Register a nurse, or update their details if the job number is known. */
  upsertNurse({ jobNumber, name, jobTitle = '', unit = '', contractDate = '' }) {
    const now = nowIso();
    this.db.prepare(`
      INSERT INTO nurses (job_number, name, job_title, unit, contract_date,
                          created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_number) DO UPDATE SET
        name = excluded.name,
        job_title = excluded.job_title,
        unit = excluded.unit,
        contract_date = excluded.contract_date,
        updated_at = excluded.updated_at
    `).run(jobNumber, name, jobTitle, unit, contractDate, now, now);
    return this.nurseByJobNumber(jobNumber);
  }

  nurseByJobNumber(jobNumber) {
    return this.db.prepare('SELECT * FROM nurses WHERE job_number = ?')
      .get(jobNumber) || null;
  }

  nurseById(id) {
    return this.db.prepare('SELECT * FROM nurses WHERE id = ?').get(id) || null;
  }

  listNurses() {
    return this.db.prepare(`
      SELECT n.*, COUNT(s.id) AS submission_count
      FROM nurses n LEFT JOIN submissions s ON s.nurse_id = n.id
      GROUP BY n.id ORDER BY n.name COLLATE NOCASE
    `).all();
  }

  // --- submissions -------------------------------------------------------

  createSubmission(row) {
    const now = nowIso();
    const info = this.db.prepare(`
      INSERT INTO submissions (
        nurse_id, form_id, form_title, form_category, form_type,
        nurse_name, nurse_job_number, nurse_job_title, nurse_unit,
        nurse_contract_date, answers, raw_score, total_score, na_count,
        item_count, percent, result, exam_date, submitted_at,
        duration_seconds, needs_remedial, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      row.nurseId, row.formId, row.formTitle, row.formCategory, row.formType,
      row.nurseName, row.nurseJobNumber, row.nurseJobTitle, row.nurseUnit,
      row.nurseContractDate, JSON.stringify(row.answers), row.rawScore,
      row.totalScore, row.naCount, row.itemCount, row.percent, row.result,
      row.examDate, now, row.durationSeconds ?? null,
      row.needsRemedial ? 1 : 0, now,
    );
    return this.submissionById(Number(info.lastInsertRowid));
  }

  submissionById(id) {
    const row = this.db.prepare('SELECT * FROM submissions WHERE id = ?').get(id);
    return row ? this.#hydrate(row) : null;
  }

  submissionsByIds(ids) {
    if (!ids.length) return [];
    const holes = ids.map(() => '?').join(',');
    return this.db.prepare(
      `SELECT * FROM submissions WHERE id IN (${holes})
       ORDER BY nurse_name COLLATE NOCASE, form_title`,
    ).all(...ids).map((row) => this.#hydrate(row));
  }

  /**
   * @param {object} f  { search, formId, category, result, from, to, reviewed,
   *                      limit, offset }
   */
  listSubmissions(f = {}) {
    const where = [];
    const args = [];
    if (f.search) {
      where.push('(nurse_name LIKE ? OR nurse_job_number LIKE ? '
        + 'OR nurse_unit LIKE ? OR form_title LIKE ?)');
      const like = `%${f.search}%`;
      args.push(like, like, like, like);
    }
    if (f.formId) { where.push('form_id = ?'); args.push(f.formId); }
    if (f.category) { where.push('form_category = ?'); args.push(f.category); }
    if (f.result) { where.push('result = ?'); args.push(f.result); }
    if (f.from) { where.push('exam_date >= ?'); args.push(f.from); }
    if (f.to) { where.push('exam_date <= ?'); args.push(f.to); }
    if (f.reviewed === true) where.push('reviewed = 1');
    if (f.reviewed === false) where.push('reviewed = 0');

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = this.db.prepare(
      `SELECT COUNT(*) AS n FROM submissions ${clause}`).get(...args).n;

    const limit = Math.min(Math.max(Number(f.limit) || 200, 1), 1000);
    const offset = Math.max(Number(f.offset) || 0, 0);
    const rows = this.db.prepare(`
      SELECT * FROM submissions ${clause}
      ORDER BY submitted_at DESC LIMIT ? OFFSET ?
    `).all(...args, limit, offset).map((row) => this.#hydrate(row));

    return { total, limit, offset, rows };
  }

  /** All submission ids matching a filter — used by "print everything shown". */
  submissionIds(f = {}) {
    return this.listSubmissions({ ...f, limit: 1000, offset: 0 })
      .rows.map((row) => row.id);
  }

  updateSubmission(id, fields) {
    const allowed = [
      'evaluator_name', 'evaluator_job_number', 'evaluator_comments',
      'evaluated_date', 'staff_comments', 'conformed_date', 'remedial_date',
      'needs_remedial', 'reviewed',
    ];
    const sets = [];
    const args = [];
    for (const key of allowed) {
      if (!(key in fields)) continue;
      sets.push(`${key} = ?`);
      const value = fields[key];
      args.push(['needs_remedial', 'reviewed'].includes(key)
        ? (value ? 1 : 0) : String(value ?? ''));
    }
    if (!sets.length) return this.submissionById(id);
    sets.push('updated_at = ?');
    args.push(nowIso(), id);
    this.db.prepare(`UPDATE submissions SET ${sets.join(', ')} WHERE id = ?`)
      .run(...args);
    return this.submissionById(id);
  }

  deleteSubmission(id) {
    return this.db.prepare('DELETE FROM submissions WHERE id = ?')
      .run(id).changes > 0;
  }

  stats() {
    const db = this.db;
    return {
      submissions: db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n,
      nurses: db.prepare('SELECT COUNT(*) AS n FROM nurses').get().n,
      met: db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE result='Met'").get().n,
      notMet: db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE result='Not Met'").get().n,
      pendingReview: db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE reviewed=0').get().n,
    };
  }

  #hydrate(row) {
    return {
      ...row,
      answers: JSON.parse(row.answers),
      needs_remedial: !!row.needs_remedial,
      reviewed: !!row.reviewed,
    };
  }

  // --- admin auth --------------------------------------------------------

  setAdminPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    this.db.prepare(`
      INSERT INTO settings (key, value) VALUES ('admin_password', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(`${salt}:${hash}`);
  }

  hasAdminPassword() {
    return !!this.db.prepare("SELECT value FROM settings WHERE key='admin_password'").get();
  }

  verifyAdminPassword(password) {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='admin_password'").get();
    if (!row) return false;
    const [salt, hash] = row.value.split(':');
    const expected = Buffer.from(hash, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length);
    return crypto.timingSafeEqual(expected, actual);
  }

  createSession() {
    const token = crypto.randomBytes(32).toString('hex');
    const created = new Date();
    const expires = new Date(created.getTime() + SESSION_DAYS * 864e5);
    this.db.prepare('INSERT INTO sessions (token, created_at, expires_at) VALUES (?,?,?)')
      .run(token, created.toISOString(), expires.toISOString());
    return { token, expiresAt: expires };
  }

  validSession(token) {
    if (!token) return false;
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
    return !!this.db.prepare('SELECT token FROM sessions WHERE token = ?').get(token);
  }

  destroySession(token) {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
}

module.exports = { Store, nowIso };
