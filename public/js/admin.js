'use strict';

/**
 * Admin: every submitted competency in one table. The admin fills in the
 * evaluator name, comments and dates, then prints the chosen records as the
 * hospital's paper form.
 */

const loginView = document.getElementById('login-view');
const adminView = document.getElementById('admin-view');
const rowsNode = document.getElementById('rows');
const dialog = document.getElementById('edit-dialog');

const filterIds = ['search', 'form', 'category', 'result', 'reviewed', 'from', 'to'];
let rows = [];
let selected = new Set();
let editingId = null;
let passwordFromEnv = false;
let usingDefaultPassword = false;

mountLanguageToggle(document.getElementById('lang-slot'));

start();

async function start() {
  if (!await checkStorageHealth('login-msg')) {
    loginView.hidden = false;
    return;
  }
  const session = await api('/api/admin/session');
  passwordFromEnv = !!session.passwordFromEnv;
  usingDefaultPassword = !!session.usingDefaultPassword;
  if (session.signedIn) enterAdmin();
  else loginView.hidden = false;
}

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage('login-msg', '');
  try {
    await api('/api/admin/login', {
      method: 'POST',
      body: { password: document.getElementById('password').value },
    });
    loginView.hidden = true;
    const session = await api('/api/admin/session');
    usingDefaultPassword = !!session.usingDefaultPassword;
    passwordFromEnv = !!session.passwordFromEnv;
    enterAdmin();
  } catch (error) {
    showMessage('login-msg', errorText(error));
  }
});

document.getElementById('logout').addEventListener('click', async (event) => {
  event.preventDefault();
  await api('/api/admin/logout', { method: 'POST' });
  location.reload();
});

document.getElementById('change-password').addEventListener('click', async (event) => {
  event.preventDefault();
  const password = prompt(t('admin.newPasswordPrompt'));
  if (!password) return;
  try {
    await api('/api/admin/password', { method: 'POST', body: { password } });
    showMessage('admin-msg', t('admin.passwordUpdated'), 'ok');
  } catch (error) {
    showMessage('admin-msg', errorText(error));
  }
});

function enterAdmin() {
  adminView.hidden = false;
  document.getElementById('logout').hidden = false;
  // When ADMIN_PASSWORD is set (as on Vercel) the environment owns the
  // password, so offering to change it here would only mislead.
  document.getElementById('change-password').hidden = passwordFromEnv;
  if (usingDefaultPassword) {
    showMessage('admin-msg', t('admin.defaultPassword'), 'error');
  }
  for (const id of filterIds) {
    const node = document.getElementById(`f-${id}`);
    node.addEventListener(id === 'search' ? 'input' : 'change', debounce(load, 250));
  }
  document.getElementById('f-clear').addEventListener('click', () => {
    for (const id of filterIds) document.getElementById(`f-${id}`).value = '';
    load();
  });
  load();
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function filterQuery() {
  const params = new URLSearchParams();
  for (const id of filterIds) {
    const value = document.getElementById(`f-${id}`).value.trim();
    if (!value) continue;
    params.set(id === 'form' ? 'formId' : id, value);
  }
  return params;
}

async function load() {
  const params = filterQuery();
  params.set('limit', '500');
  let data;
  try {
    data = await api(`/api/admin/submissions?${params}`);
  } catch (error) {
    return showMessage('admin-msg', errorText(error));
  }
  rows = data.rows;
  selected = new Set([...selected].filter((id) => rows.some((r) => r.id === id)));

  renderStats(data.stats);
  fillFormFilter(data.forms);
  renderRows();
  document.getElementById('page-info').textContent =
    t('admin.showing', { shown: rows.length, total: data.total });
}

function renderStats(stats) {
  const node = document.getElementById('stats');
  node.innerHTML = '';
  const tiles = [
    [stats.submissions, t('admin.stat.submissions')],
    [stats.nurses, t('admin.stat.nurses')],
    [stats.met, t('admin.stat.met')],
    [stats.notMet, t('admin.stat.notMet')],
    [stats.pendingReview, t('admin.stat.pending')],
  ];
  for (const [number, label] of tiles) {
    node.append(el('div', { class: 'stat' }, [
      el('div', { class: 'n', text: String(number) }),
      el('div', { class: 'l', text: label }),
    ]));
  }
}

let formFilterReady = false;
function fillFormFilter(forms) {
  if (formFilterReady) return;
  const select = document.getElementById('f-form');
  for (const form of forms) {
    // Competency titles are the hospital's own wording, shown as they are.
    select.append(el('option', { value: form.id, text: form.title }));
  }
  formFilterReady = true;
}

function renderRows() {
  rowsNode.innerHTML = '';
  document.getElementById('no-rows').hidden = rows.length > 0;

  for (const row of rows) {
    const checkbox = el('input', { type: 'checkbox' });
    checkbox.checked = selected.has(row.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(row.id);
      else selected.delete(row.id);
      updateSelectedCount();
    });

    rowsNode.append(el('tr', {}, [
      el('td', {}, [checkbox]),
      el('td', {}, [el('strong', { text: row.nurse_name })]),
      el('td', { dir: 'ltr', text: row.nurse_job_number }),
      el('td', { text: row.nurse_unit || '—' }),
      sourceText(el('td', { text: row.form_title })),
      el('td', {}, [categoryBadge(row.form_category)]),
      el('td', { class: 'num', dir: 'ltr', text: `${row.raw_score}/${row.total_score}` }),
      el('td', { class: 'num', dir: 'ltr', text: percentText(row.percent) }),
      el('td', {}, [resultBadge(row.result)]),
      el('td', { text: formatDate(row.exam_date) }),
      el('td', { text: row.evaluator_name || '—' }),
      el('td', { text: row.reviewed ? t('table.yes') : t('table.no') }),
      el('td', { class: 'actions' }, [
        el('button', {
          class: 'btn-sm', text: t('table.details'),
          onclick: () => openEditor(row),
        }),
        ' ',
        el('button', {
          class: 'btn-sm', text: t('table.print'),
          onclick: () => openPrint([row.id]),
        }),
      ]),
    ]));
  }
  updateSelectedCount();
}

function updateSelectedCount() {
  document.getElementById('selected-count').textContent =
    t('admin.selected', { count: selected.size });
  document.getElementById('print-selected').disabled = selected.size === 0;
  const all = document.getElementById('select-all');
  all.checked = rows.length > 0 && rows.every((row) => selected.has(row.id));
}

document.getElementById('select-all').addEventListener('change', (event) => {
  for (const row of rows) {
    if (event.target.checked) selected.add(row.id);
    else selected.delete(row.id);
  }
  renderRows();
});

// --- printing ---------------------------------------------------------------

function openPrint(ids) {
  if (!ids.length) return;
  window.open(`/print?ids=${ids.join(',')}`, '_blank');
}

document.getElementById('print-selected').addEventListener('click',
  () => openPrint([...selected]));

document.getElementById('print-all').addEventListener('click', async () => {
  try {
    const { ids } = await api(`/api/admin/submission-ids?${filterQuery()}`);
    if (!ids.length) {
      return showMessage('admin-msg', t('admin.nothingToPrint'), 'info');
    }
    openPrint(ids);
  } catch (error) {
    showMessage('admin-msg', errorText(error));
  }
});

document.getElementById('export-csv').addEventListener('click', () => {
  location.href = `/api/admin/export.csv?${filterQuery()}`;
});

// --- evaluator details ------------------------------------------------------

function openEditor(row) {
  editingId = row.id;
  const title = document.getElementById('edit-title');
  title.textContent = row.form_title;
  sourceText(title);
  document.getElementById('edit-sub').textContent = t('editor.subtitle', {
    name: row.nurse_name, jobNumber: row.nurse_job_number,
    date: formatDate(row.exam_date), percent: percentText(row.percent),
    result: t(`value.${row.result}`),
  });
  document.getElementById('e-evaluator').value = row.evaluator_name || '';
  document.getElementById('e-evaluator-job').value = row.evaluator_job_number || '';
  document.getElementById('e-evaluated-date').value = row.evaluated_date || '';
  document.getElementById('e-conformed-date').value = row.conformed_date || '';
  document.getElementById('e-remedial').value = row.needs_remedial ? '1' : '0';
  document.getElementById('e-remedial-date').value = row.remedial_date || '';
  document.getElementById('e-comments').value = row.evaluator_comments || '';
  document.getElementById('e-staff-comments').value = row.staff_comments || '';
  document.getElementById('e-reviewed').checked = !!row.reviewed;
  dialog.showModal();
}

document.getElementById('edit-cancel').addEventListener('click', () => dialog.close());

document.getElementById('edit-delete').addEventListener('click', async () => {
  const row = rows.find((r) => r.id === editingId);
  if (!confirm(t('editor.confirmDelete', {
    title: row.form_title, name: row.nurse_name,
  }))) return;
  try {
    await api(`/api/admin/submissions/${editingId}`, { method: 'DELETE' });
    selected.delete(editingId);
    dialog.close();
    showMessage('admin-msg', t('editor.deleted'), 'ok');
    load();
  } catch (error) {
    alert(errorText(error));
  }
});

document.getElementById('edit-save').addEventListener('click', async () => {
  try {
    await api(`/api/admin/submissions/${editingId}`, {
      method: 'PATCH',
      body: {
        evaluator_name: document.getElementById('e-evaluator').value,
        evaluator_job_number: document.getElementById('e-evaluator-job').value,
        evaluated_date: document.getElementById('e-evaluated-date').value,
        conformed_date: document.getElementById('e-conformed-date').value,
        needs_remedial: document.getElementById('e-remedial').value === '1',
        remedial_date: document.getElementById('e-remedial-date').value,
        evaluator_comments: document.getElementById('e-comments').value,
        staff_comments: document.getElementById('e-staff-comments').value,
        reviewed: document.getElementById('e-reviewed').checked,
      },
    });
    dialog.close();
    showMessage('admin-msg', t('editor.saved'), 'ok');
    load();
  } catch (error) {
    alert(errorText(error));
  }
});
