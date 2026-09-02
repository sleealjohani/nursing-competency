'use strict';

/**
 * The exam: one competency item on screen at a time, rated with a single
 * click (or the 1/2/3 keys). Answering auto-advances to the next item, so a
 * whole form is a run of single clicks rather than a page of writing.
 * Answers are kept in localStorage so a closed tab does not lose the sitting.
 */

const RATING_LABELS = {
  M: 'Met', NM: 'Not Met', NA: 'Not Applicable',
  VT: 'Vendor Training', RD: 'Repeat Demonstration',
  UEC: 'Uses Equipment Competently',
};

const params = new URLSearchParams(location.search);
const formId = params.get('form');

const nurse = nurseSession.get();
let form = null;
let ratings = [];
let items = [];          // flattened { key, sectionName, no, text, indexInSection }
let answers = {};
let position = 0;
let startedAt = Date.now();
let draftKey = '';

const nodes = {
  head: document.getElementById('exam-head'),
  loading: document.getElementById('loading'),
  question: document.getElementById('question-card'),
  review: document.getElementById('review-card'),
  result: document.getElementById('result-card'),
  rateRow: document.getElementById('rate-row'),
  progress: document.getElementById('progress'),
};

init();

async function init() {
  if (!formId) return fail('No competency selected.');
  if (!nurse?.jobNumber) {
    return fail('Please register your details first.', true);
  }
  try {
    const data = await api(`/api/competencies/${encodeURIComponent(formId)}`);
    form = data.form;
    ratings = data.ratings;
  } catch (error) {
    return fail(error.message);
  }

  items = [];
  form.sections.forEach((section, sectionIndex) => {
    section.items.forEach((item, i) => {
      items.push({
        key: `${sectionIndex}.${item.no}`,
        sectionName: section.name,
        sectionRoman: section.roman,
        no: item.no,
        text: item.text,
        indexInSection: i,
        sectionCount: section.items.length,
      });
    });
  });

  draftKey = `competency.draft.${nurse.jobNumber}.${form.id}`;
  restoreDraft();

  nodes.loading.hidden = true;
  nodes.head.hidden = false;
  document.getElementById('exam-title').textContent = form.title;
  document.getElementById('exam-meta').textContent =
    `${form.category} competency · ${nurse.name} · Job number ${nurse.jobNumber}`;
  document.getElementById('keyhint').textContent =
    `Keys: ${ratings.map((r, i) => `${i + 1}=${r}`).join('  ')}  ·  ←/→ to move`;

  if (form.notes?.length) {
    showMessage('msg', form.notes.join(' '), 'info');
  }

  renderQuestion();
}

function fail(message, backHome = false) {
  nodes.loading.hidden = true;
  showMessage('msg', message);
  if (backHome) setTimeout(() => { location.href = '/'; }, 1800);
}

// --- draft persistence ------------------------------------------------------

function restoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
    if (draft?.answers) {
      answers = draft.answers;
      startedAt = draft.startedAt || Date.now();
      // Resume at the first unanswered item.
      const next = items.findIndex((item) => !answers[item.key]);
      position = next === -1 ? items.length - 1 : next;
    }
  } catch { /* a corrupt draft just starts fresh */ }
}

function saveDraft() {
  try {
    localStorage.setItem(draftKey, JSON.stringify({ answers, startedAt }));
  } catch { /* storage full or blocked — the exam still works in-memory */ }
}

// --- question view ----------------------------------------------------------

function renderQuestion() {
  nodes.question.hidden = false;
  nodes.review.hidden = true;
  nodes.result.hidden = true;

  const item = items[position];
  document.getElementById('q-section').textContent =
    `${item.sectionRoman}. ${item.sectionName}`;
  document.getElementById('q-number').textContent =
    `Item ${item.no} of ${item.sectionCount} in this section`
    + `  ·  question ${position + 1} of ${items.length}`;
  document.getElementById('q-text').textContent = item.text;

  nodes.rateRow.innerHTML = '';
  ratings.forEach((rating, index) => {
    const selected = answers[item.key] === rating;
    nodes.rateRow.append(el('button', {
      type: 'button',
      class: `rate${selected ? ` sel-${rating}` : ''}`,
      onclick: () => choose(rating),
    }, [
      el('span', { class: 'code', text: rating }),
      el('span', { class: 'lbl', text: RATING_LABELS[rating] || rating }),
      el('span', { class: 'key', text: `press ${index + 1}` }),
    ]));
  });

  document.getElementById('prev').disabled = position === 0;
  document.getElementById('next').textContent =
    position === items.length - 1 ? 'Review answers →' : 'Skip →';

  updateProgress();
}

function updateProgress() {
  const answered = items.filter((item) => answers[item.key]).length;
  nodes.progress.style.width = `${(answered / items.length) * 100}%`;
  document.getElementById('exam-meta').textContent =
    `${form.category} competency · ${nurse.name} · `
    + `${answered} of ${items.length} answered`;
}

function choose(rating) {
  answers[items[position].key] = rating;
  saveDraft();
  // Auto-advance: a whole form becomes one click per item.
  if (position < items.length - 1) {
    position += 1;
    renderQuestion();
  } else {
    renderQuestion();
    showReview();
  }
}

document.getElementById('prev').addEventListener('click', () => {
  if (position > 0) { position -= 1; renderQuestion(); }
});

document.getElementById('next').addEventListener('click', () => {
  if (position < items.length - 1) { position += 1; renderQuestion(); }
  else showReview();
});

document.getElementById('toggle-view').addEventListener('click', () => {
  if (nodes.review.hidden) showReview();
  else renderQuestion();
});

document.getElementById('back-to-questions').addEventListener('click', () => {
  const next = items.findIndex((item) => !answers[item.key]);
  if (next !== -1) position = next;
  renderQuestion();
});

document.addEventListener('keydown', (event) => {
  if (!nodes.result.hidden || event.target.matches('input, textarea, select')) return;
  if (!nodes.question.hidden) {
    const index = Number(event.key) - 1;
    if (index >= 0 && index < ratings.length) {
      event.preventDefault();
      return choose(ratings[index]);
    }
    if (event.key === 'ArrowLeft' && position > 0) {
      event.preventDefault();
      position -= 1;
      return renderQuestion();
    }
    if (event.key === 'ArrowRight' && position < items.length - 1) {
      event.preventDefault();
      position += 1;
      return renderQuestion();
    }
  }
});

// --- review view ------------------------------------------------------------

function showReview() {
  nodes.question.hidden = true;
  nodes.review.hidden = false;
  document.getElementById('toggle-view').textContent = 'Back to questions';

  const missing = items.filter((item) => !answers[item.key]);
  document.getElementById('review-hint').textContent = missing.length
    ? `${missing.length} item(s) are still unanswered — click one to go to it.`
    : 'All items answered. Check them over, then submit.';

  const list = document.getElementById('review-list');
  list.innerHTML = '';
  let lastSection = null;

  items.forEach((item, index) => {
    if (item.sectionName !== lastSection) {
      lastSection = item.sectionName;
      list.append(el('div', {
        class: 'q-section',
        style: 'margin-top:16px',
        text: `${item.sectionRoman}. ${item.sectionName}`,
      }));
    }
    const rating = answers[item.key];
    list.append(el('div', {
      class: `review-item${rating ? '' : ' unanswered'}`,
      style: 'cursor:pointer',
      onclick: () => { position = index; renderQuestion(); },
    }, [
      el('span', { class: 'n', text: `${item.no}.` }),
      el('span', {
        class: 'grow',
        text: item.text.length > 190 ? `${item.text.slice(0, 190)}…` : item.text,
      }),
      el('span', { class: `r r-${rating || 'none'}`, text: rating || '—' }),
    ]));
  });

  document.getElementById('submit').disabled = missing.length > 0;
  document.getElementById('submit').textContent = missing.length
    ? `${missing.length} item(s) left` : 'Submit competency';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- submit -----------------------------------------------------------------

document.getElementById('submit').addEventListener('click', async () => {
  const button = document.getElementById('submit');
  button.disabled = true;
  button.textContent = 'Submitting…';
  showMessage('msg', '');
  try {
    const { submission, score } = await api('/api/submissions', {
      method: 'POST',
      body: {
        formId: form.id,
        jobNumber: nurse.jobNumber,
        examDate: nurse.examDate || today(),
        answers,
        durationSeconds: Math.round((Date.now() - startedAt) / 1000),
      },
    });
    localStorage.removeItem(draftKey);
    showResult(submission, score);
  } catch (error) {
    showMessage('msg', error.message);
    button.disabled = false;
    button.textContent = 'Submit competency';
  }
});

function showResult(submission, score) {
  nodes.head.hidden = true;
  nodes.question.hidden = true;
  nodes.review.hidden = true;
  nodes.result.hidden = false;
  document.getElementById('result-title').textContent = 'Submitted';

  const body = document.getElementById('result-body');
  body.innerHTML = '';
  body.append(
    el('p', { class: 'hint' }, [
      `${submission.form_title} — submitted for ${submission.nurse_name} `
      + `on ${formatDate(submission.exam_date)}.`,
    ]),
    el('div', { class: 'stats' }, [
      stat(percentText(score.percent), '% Rating'),
      stat(String(score.rawScore), 'Raw Score'),
      stat(String(score.totalScore), 'Total Score'),
      stat(String(score.naCount), 'Not Applicable'),
    ]),
    el('p', {}, [resultBadge(score.result)]),
    el('div', {
      class: `msg ${score.result === 'Met' ? 'msg-ok' : 'msg-info'}`,
      text: score.result === 'Met'
        ? 'Result: Met (90% – 100%). Your evaluator will review and sign the form.'
        : 'Result: Not Met (89% and below). Remedial is required once; your'
          + ' evaluator will set the remedial date.',
    }),
  );
  window.scrollTo({ top: 0 });
}

function stat(number, label) {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'n', text: number }),
    el('div', { class: 'l', text: label }),
  ]);
}
