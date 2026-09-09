'use strict';

/**
 * The print page: renders the chosen submissions as competency forms and hands
 * them to the browser's own print dialog. The form itself is built by
 * form-render.js, which the ZIP export uses too.
 */

mountLanguageToggle(document.getElementById('lang-slot'));

document.getElementById('print-now').addEventListener('click', () => window.print());
document.getElementById('close').addEventListener('click', () => window.close());

load();

async function load() {
  const ids = new URLSearchParams(location.search).get('ids') || '';
  if (!ids) return fail(t('print.none'));

  let data;
  try {
    data = await api(`/api/admin/print?ids=${encodeURIComponent(ids)}`);
  } catch (error) {
    return fail(errorText(error));
  }

  const container = document.getElementById('sheets');
  container.innerHTML = '';
  // The logos must be decoded before anything is measured, or the letterhead
  // has no height yet and every page is laid out a few millimetres short.
  await preloadLogos();

  for (const submission of data.submissions) {
    const form = data.forms[submission.form_id];
    if (form) renderSubmission(container, submission, form);
  }

  document.getElementById('count').textContent =
    t('print.count', { count: data.submissions.length });
  document.title = data.submissions.length === 1
    ? `${data.submissions[0].nurse_name} — ${data.submissions[0].form_title}`
    : `Competency forms (${data.submissions.length})`;
}

function fail(message) {
  document.getElementById('count').textContent = message;
  document.getElementById('sheets').append(
    el('div', { class: 'sheet' }, [el('p', { text: message })]));
}

