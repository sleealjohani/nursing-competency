'use strict';

/** Shared helpers: fetch wrapper, DOM building, formatting, nurse session. */

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('json') ? await response.json() : null;
  if (!response.ok) {
    // Carry the machine-readable code so the message can be shown in the
    // reader's language rather than the server's English.
    const error = new Error(payload?.error || `Request failed (${response.status})`);
    error.code = payload?.code;
    error.details = payload?.details;
    error.status = response.status;
    throw error;
  }
  return payload;
}

/** The translated message for a failed api() call. */
function errorText(error) {
  return translateError(error);
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

function showMessage(container, text, kind = 'error') {
  const target = typeof container === 'string'
    ? document.getElementById(container) : container;
  if (!target) return;
  target.innerHTML = '';
  if (text) target.append(el('div', { class: `msg msg-${kind}`, text }));
}

/**
 * Arabic month names, but always Latin digits: a job number, a score and a
 * date must read the same to everyone handling the paper afterwards.
 */
function dateLocale() {
  return isRtl() ? 'ar-u-nu-latn' : 'en-GB';
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(dateLocale(),
    { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Dates printed onto the competency form. Fixed to the form's own format
 * whatever language the site is being read in — the paper is the hospital's
 * record and must not change with a UI preference.
 */
function formatFormDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB',
    { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatFormDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(dateLocale(), {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function today() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function percentText(value) {
  return value === null || value === undefined ? '—' : `${value}%`;
}

function resultBadge(result) {
  const cls = result === 'Met' ? 'badge-met'
    : result === 'Not Met' ? 'badge-notmet' : 'badge-na';
  return el('span', { class: `badge ${cls}`, text: t(`value.${result}`) });
}

function categoryBadge(category) {
  return el('span', { class: 'badge badge-cat', text: t(`category.${category}`) });
}

/**
 * A heading for a section of the paper form: the source name verbatim, with
 * a short Arabic gloss beside it when reading in Arabic.
 */
function sectionHeading(roman, name) {
  const node = el('span', {}, [
    el('span', { dir: 'ltr', text: `${roman}. ${name}` }),
  ]);
  const arabic = gloss(`section.${name}`);
  if (arabic) node.append(el('span', { class: 'gloss', text: ` — ${arabic}` }));
  return node;
}

/**
 * Warns up front when the deployment has no working database, rather than
 * letting the first save fail with nothing to act on.
 *
 * @returns {Promise<boolean>} true when storage is healthy
 */
async function checkStorageHealth(containerId) {
  try {
    const health = await api('/api/health');
    if (health.ok) return true;
    showMessage(containerId,
      t('error.storageSetup', { detail: health.error || '' }).trim(), 'error');
    return false;
  } catch (error) {
    const isSetup = error.code === 'storage_unavailable'
      || /database|Postgres/.test(error.message);
    showMessage(containerId, isSetup
      ? t('error.storageSetup', { detail: error.message })
      : t('error.unreachable', { detail: error.message }), 'error');
    return false;
  }
}

/** The nurse's identity for this browser, so they need not retype it. */
const nurseSession = {
  key: 'competency.nurse',
  get() {
    try { return JSON.parse(localStorage.getItem(this.key) || 'null'); }
    catch { return null; }
  },
  set(nurse, examDate) {
    localStorage.setItem(this.key, JSON.stringify({ ...nurse, examDate }));
  },
  clear() { localStorage.removeItem(this.key); },
};
