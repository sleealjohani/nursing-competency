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
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  return payload;
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

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB',
    { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB', {
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
  return el('span', { class: `badge ${cls}`, text: result });
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
