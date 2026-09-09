'use strict';

/**
 * Builds one PDF per employee — every competency they submitted, in the
 * hospital's own form — and packs the lot into a ZIP.
 *
 * The forms are rendered off-screen by form-render.js, the same code the print
 * page uses, so an exported PDF is the same paper the admin would have
 * printed. Capturing them in the browser is what keeps Arabic names, units and
 * comments correctly shaped.
 */

const stage = document.getElementById('stage');
const peopleList = document.getElementById('people');
const progressBar = document.getElementById('progress');
const statusLine = document.getElementById('status');
const downloadButton = document.getElementById('download');

let archive = null;

mountLanguageToggle(document.getElementById('lang-slot'));
start();

async function start() {
  const params = new URLSearchParams(location.search);
  let data;
  try {
    data = await api(`/api/admin/export-groups?${params}`);
  } catch (error) {
    return showMessage('msg', errorText(error));
  }

  const { groups, forms } = data;
  const totalSheets = groups.reduce(
    (n, group) => n + group.submissions.length, 0);

  const rows = new Map();
  for (const group of groups) {
    const row = el('div', { class: 'review-item' }, [
      el('span', { class: 'grow' }, [
        el('strong', { text: group.name }),
        el('div', {
          class: 'm',
          text: t('export.forms', { count: group.submissions.length }),
        }),
      ]),
      el('span', { class: 'r', text: '…' }),
    ]);
    rows.set(group, row);
    peopleList.append(row);
  }

  await preloadLogos();

  const files = [];
  let done = 0;
  const used = new Set();

  for (const group of groups) {
    const row = rows.get(group);
    row.querySelector('.r').textContent = '⋯';
    statusLine.textContent = t('export.working', { name: group.name });

    const pages = [];
    for (const submission of group.submissions) {
      const form = forms[submission.form_id];
      if (!form) continue;
      stage.innerHTML = '';
      renderSubmission(stage, submission, form);
      // Let the browser lay the sheets out before they are measured.
      await nextFrame();
      for (const sheet of stage.querySelectorAll('.sheet')) {
        pages.push(await captureSheet(sheet));
      }
      done += 1;
      progressBar.style.width = `${(done / totalSheets) * 100}%`;
    }
    stage.innerHTML = '';

    const pdf = buildPdf(pages, `${group.name} - competency forms`);
    files.push({ name: uniqueName(group, used), data: pdf });
    row.querySelector('.r').textContent = t('export.pages', {
      count: pages.length,
    });
  }

  archive = buildZip(files);
  statusLine.textContent = t('export.ready', {
    files: files.length,
    size: (archive.length / (1024 * 1024)).toFixed(1),
  });
  progressBar.style.width = '100%';
  downloadButton.hidden = false;
  downloadButton.focus();
}

/** "Name - job number.pdf", kept unique even if two nurses share a name. */
function uniqueName(group, used) {
  const base = safeFileName(
    [group.name, group.jobNumber].filter(Boolean).join(' - '), 'employee');
  let name = `${base}.pdf`;
  let n = 2;
  while (used.has(name)) {
    name = `${base} (${n})`.concat('.pdf');
    n += 1;
  }
  used.add(name);
  return name;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

downloadButton.addEventListener('click', () => {
  if (!archive) return;
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([archive], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: `competency-forms-${stamp}.zip` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
