'use strict';

/**
 * The exam: one competency item on screen at a time, rated with a single
 * click (or the 1/2/3 keys). Answering auto-advances to the next item, so a
 * whole form is a run of single clicks rather than a page of writing.
 * Answers are kept in localStorage so a closed tab does not lose the sitting.
 */

const params = new URLSearchParams(location.search);
const formId = params.get('form');

const nurse = nurseSession.get();
let form = null;
let translation = null;
let ratings = [];
let showAid = true;
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

mountLanguageToggle(document.getElementById('lang-slot'));

init();

async function init() {
  if (!formId) return fail(t('exam.noneSelected'));
  if (!nurse?.jobNumber) {
    return fail(t('exam.registerFirst'), true);
  }
  try {
    const data = await api(`/api/competencies/${encodeURIComponent(formId)}`);
    form = data.form;
    translation = data.translation;
    ratings = data.ratings;
  } catch (error) {
    return fail(errorText(error));
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
        arabic: translation?.items?.[`${sectionIndex}.${item.no}`] || '',
      });
    });
  });

  draftKey = `competency.draft.${nurse.jobNumber}.${form.id}`;
  restoreDraft();

  nodes.loading.hidden = true;
  nodes.head.hidden = false;
  // The competency title is the hospital's wording; it stays as the PDF has it.
  const titleNode = document.getElementById('exam-title');
  titleNode.textContent = form.title;
  sourceText(titleNode);
  if (isRtl() && translation) {
    aidToggle.hidden = false;
    aidToggle.textContent = t('exam.hideAid');
  }
  document.getElementById('keyhint').textContent = t('exam.keyHint', {
    keys: ratings.map((r, i) => `${i + 1}=${r}`).join('  '),
  });

  if (form.notes?.length) {
    // A transcription note from the source scan — shown as written.
    showMessage('msg', form.notes.join(' '), 'info');
    const note = document.querySelector('#msg .msg');
    if (note) sourceText(note);
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
  const sectionNode = document.getElementById('q-section');
  sectionNode.innerHTML = '';
  sectionNode.append(sectionHeading(item.sectionRoman, item.sectionName));
  document.getElementById('q-number').textContent = t('exam.itemPosition', {
    no: item.no, count: item.sectionCount,
    index: position + 1, total: items.length,
  });
  // The competency item itself is quoted from the PDF and stays as written.
  const textNode = document.getElementById('q-text');
  textNode.textContent = item.text;
  sourceText(textNode);
  renderAid(item);

  nodes.rateRow.innerHTML = '';
  ratings.forEach((rating, index) => {
    const selected = answers[item.key] === rating;
    nodes.rateRow.append(el('button', {
      type: 'button',
      class: `rate${selected ? ` sel-${rating}` : ''}`,
      onclick: () => choose(rating),
    }, [
      // The rating code is the form's own; the label beside it is a reading aid.
      el('span', { class: 'code', dir: 'ltr', text: rating }),
      el('span', { class: 'lbl', text: t(`rating.${rating}`) }),
      el('span', { class: 'key', text: t('exam.pressKey', { key: index + 1 }) }),
    ]));
  });

  const arrowBack = isRtl() ? '→' : '←';
  const arrowNext = isRtl() ? '←' : '→';
  document.getElementById('prev').disabled = position === 0;
  document.getElementById('prev').textContent = `${arrowBack} ${t('exam.previous')}`;
  document.getElementById('next').textContent = position === items.length - 1
    ? `${t('exam.toReview')} ${arrowNext}`
    : `${t('exam.skip')} ${arrowNext}`;
  document.getElementById('back-to-questions').textContent =
    `${arrowBack} ${t('exam.backToQuestions')}`;

  updateProgress();
}

/**
 * The Arabic rendering of the item, shown under the English rather than in
 * place of it: the English is the wording the nurse is assessed against and
 * the wording that is printed, so it stays in front of them.
 */
function renderAid(item) {
  const host = document.getElementById('q-aid');
  host.innerHTML = '';
  host.hidden = !(isRtl() && item.arabic && showAid);
  if (host.hidden) return;
  host.append(
    el('div', { class: 'aid-label', text: t('exam.aidLabel') }),
    el('div', { class: 'aid-text', dir: 'rtl', lang: 'ar', text: item.arabic }),
  );
}

function updateProgress() {
  const answered = items.filter((item) => answers[item.key]).length;
  nodes.progress.style.width = `${(answered / items.length) * 100}%`;
  document.getElementById('exam-meta').textContent = t('exam.progress', {
    category: t(`category.${form.category}`), name: nurse.name,
    answered, total: items.length,
  });
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

const aidToggle = document.getElementById('toggle-aid');
aidToggle.addEventListener('click', () => {
  showAid = !showAid;
  aidToggle.textContent = showAid ? t('exam.hideAid') : t('exam.showAid');
  if (nodes.review.hidden) showReview(); else renderQuestion();
});

document.getElementById('toggle-view').addEventListener('click', () => {
  if (nodes.review.hidden) showReview();
  else {
    document.getElementById('toggle-view').textContent = t('exam.reviewAll');
    renderQuestion();
  }
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
  document.getElementById('toggle-view').textContent = t('exam.backToQuestions');

  const missing = items.filter((item) => !answers[item.key]);
  document.getElementById('review-hint').textContent = missing.length
    ? t('exam.reviewMissing', { count: missing.length })
    : t('exam.reviewAllDone');

  const list = document.getElementById('review-list');
  list.innerHTML = '';
  let lastSection = null;

  items.forEach((item, index) => {
    if (item.sectionName !== lastSection) {
      lastSection = item.sectionName;
      list.append(el('div', { class: 'q-section', style: 'margin-top:16px' },
        [sectionHeading(item.sectionRoman, item.sectionName)]));
    }
    const rating = answers[item.key];
    list.append(el('div', {
      class: `review-item${rating ? '' : ' unanswered'}`,
      style: 'cursor:pointer',
      onclick: () => { position = index; renderQuestion(); },
    }, [
      el('span', { class: 'n', dir: 'ltr', text: `${item.no}.` }),
      el('span', { class: 'grow' }, [
        sourceText(el('div', {
          text: item.text.length > 190 ? `${item.text.slice(0, 190)}…` : item.text,
        })),
        (isRtl() && item.arabic && showAid)
          ? el('div', { class: 'aid-text small', dir: 'rtl', lang: 'ar',
              text: item.arabic.length > 190
                ? `${item.arabic.slice(0, 190)}…` : item.arabic })
          : null,
      ]),
      el('span', { class: `r r-${rating || 'none'}`, dir: 'ltr',
        text: rating || '—' }),
    ]));
  });

  document.getElementById('submit').disabled = missing.length > 0;
  document.getElementById('submit').textContent = missing.length
    ? t('exam.itemsLeft', { count: missing.length }) : t('exam.submit');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- submit -----------------------------------------------------------------

document.getElementById('submit').addEventListener('click', async () => {
  const button = document.getElementById('submit');
  button.disabled = true;
  button.textContent = t('exam.submitting');
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
    showMessage('msg', errorText(error));
    button.disabled = false;
    button.textContent = t('exam.submit');
  }
});

function showResult(submission, score) {
  nodes.head.hidden = true;
  nodes.question.hidden = true;
  nodes.review.hidden = true;
  nodes.result.hidden = false;
  document.getElementById('result-title').textContent = t('result.heading');

  const body = document.getElementById('result-body');
  body.innerHTML = '';
  body.append(
    el('p', { class: 'hint' }, [
      t('result.line', {
        title: submission.form_title,
        name: submission.nurse_name,
        date: formatDate(submission.exam_date),
      }),
    ]),
    el('div', { class: 'stats' }, [
      stat(percentText(score.percent), t('result.percent')),
      stat(String(score.rawScore), t('result.raw')),
      stat(String(score.totalScore), t('result.total')),
      stat(String(score.naCount), t('result.na')),
    ]),
    el('p', {}, [resultBadge(score.result)]),
    el('div', {
      class: `msg ${score.result === 'Met' ? 'msg-ok' : 'msg-info'}`,
      text: score.result === 'Met' ? t('result.met') : t('result.notMet'),
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
