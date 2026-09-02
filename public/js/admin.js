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

start();

async function start() {
  const { signedIn } = await api('/api/admin/session');
  if (signedIn) enterAdmin();
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
    enterAdmin();
  } catch (error) {
    showMessage('login-msg', error.message);
  }
});

document.getElementById('logout').addEventListener('click', async (event) => {
  event.preventDefault();
  await api('/api/admin/logout', { method: 'POST' });
  location.reload();
});

document.getElementById('change-password').addEventListener('click', async (event) => {
  event.preventDefault();
  const password = prompt('New admin password (at least 6 characters):');
  if (!password) return;
  try {
    await api('/api/admin/password', { method: 'POST', body: { password } });
    showMessage('admin-msg', 'Admin password updated.', 'ok');
  } catch (error) {
    showMessage('admin-msg', error.message);
  }
});

function enterAdmin() {
  adminView.hidden = false;
  document.getElementById('logout').hidden = false;
  document.getElementById('change-password').hidden = false;
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
    return showMessage('admin-msg', error.message);
  }
  rows = data.rows;
  selected = new Set([...selected].filter((id) => rows.some((r) => r.id === id)));

  renderStats(data.stats);
  fillFormFilter(data.forms);
  renderRows();
  document.getElementById('page-info').textContent =
    `Showing ${rows.length} of ${data.total} submission(s)`;
}

function renderStats(stats) {
  const node = document.getElementById('stats');
  node.innerHTML = '';
  const tiles = [
    [stats.submissions, 'Submissions'],
    [stats.nurses, 'Nurses'],
    [stats.met, 'Met'],
    [stats.notMet, 'Not Met'],
    [stats.pendingReview, 'Awaiting sign-off'],
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
      el('td', { text: row.nurse_job_number }),
      el('td', { text: row.nurse_unit || '—' }),
      el('td', { text: row.form_title }),
      el('td', {}, [el('span', { class: 'badge badge-cat', text: row.form_category })]),
      el('td', { class: 'num', text: `${row.raw_score}/${row.total_score}` }),
      el('td', { class: 'num', text: percentText(row.percent) }),
      el('td', {}, [resultBadge(row.result)]),
      el('td', { text: formatDate(row.exam_date) }),
      el('td', { text: row.evaluator_name || '—' }),
      el('td', { text: row.reviewed ? 'Yes' : 'No' }),
      el('td', { class: 'actions' }, [
        el('button', {
          class: 'btn-sm', text: 'Details',
          onclick: () => openEditor(row),
        }),
        ' ',
        el('button', {
          class: 'btn-sm', text: 'Print',
          onclick: () => openPrint([row.id]),
        }),
      ]),
    ]));
  }
  updateSelectedCount();
}

function updateSelectedCount() {
  document.getElementById('selected-count').textContent =
    `${selected.size} selected`;
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
    if (!ids.length) return showMessage('admin-msg', 'Nothing to print.', 'info');
    openPrint(ids);
  } catch (error) {
    showMessage('admin-msg', error.message);
  }
});

document.getElementById('export-csv').addEventListener('click', () => {
  location.href = `/api/admin/export.csv?${filterQuery()}`;
});

// --- evaluator details ------------------------------------------------------

function openEditor(row) {
  editingId = row.id;
  document.getElementById('edit-title').textContent = row.form_title;
  document.getElementById('edit-sub').textContent =
    `${row.nurse_name} · Job number ${row.nurse_job_number} · `
    + `${formatDate(row.exam_date)} · ${percentText(row.percent)} ${row.result}`;
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
  if (!confirm(`Permanently delete ${row.form_title} for ${row.nurse_name}?`
    + '\n\nThis cannot be undone.')) return;
  try {
    await api(`/api/admin/submissions/${editingId}`, { method: 'DELETE' });
    selected.delete(editingId);
    dialog.close();
    showMessage('admin-msg', 'Submission deleted.', 'ok');
    load();
  } catch (error) {
    alert(error.message);
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
    showMessage('admin-msg', 'Evaluator details saved.', 'ok');
    load();
  } catch (error) {
    alert(error.message);
  }
});
