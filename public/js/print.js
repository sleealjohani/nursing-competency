'use strict';

/**
 * Renders each submission as the hospital's own competency form: the same
 * letterhead and logos, field grid, bordered assessment table and pair of
 * footer boxes as the source PDF, with the nurse's answers ticked into the
 * M / NM / NA boxes.
 *
 * Pages are filled by measurement rather than left to the browser, so a long
 * form breaks where the paper does: the letterhead and the column headers
 * repeat on every sheet, and the signature boxes sit at the end.
 *
 * Nothing here is translated. The form is the hospital's record, so it is
 * always reproduced in its own wording, direction and date format whatever
 * language the site is being read in.
 */

const RATING_COLUMNS = {
  competency: ['M', 'NM', 'NA'],
  equipment: ['VT', 'RD', 'UEC', 'NA'],
};

const COLUMN_HEADS = {
  M: ['M', '(1)'], NM: ['NM', '(0)'], NA: ['NA', ''],
  VT: ['VT', ''], RD: ['RD', ''], UEC: ['UEC', ''],
};

const HOSPITAL_LOGO = '/img/hospital-logo.png';
const CLUSTER_LOGO = '/img/cluster-logo.png';

/** Space kept clear at the foot of every sheet for the page footer. */
const FOOT_RESERVE_MM = 17;
const mm = (value) => value * (96 / 25.4);

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

function preloadLogos() {
  return Promise.all([HOSPITAL_LOGO, CLUSTER_LOGO].map((src) => new Promise(
    (resolve) => {
      const img = new Image();
      img.onload = img.onerror = resolve;
      img.src = src;
    })));
}

function fail(message) {
  document.getElementById('count').textContent = message;
  document.getElementById('sheets').append(
    el('div', { class: 'sheet' }, [el('p', { text: message })]));
}

// --- page building ----------------------------------------------------------

/**
 * Fills A4 sheets with the form's rows, starting a new sheet whenever the
 * current one is full.
 */
function renderSubmission(container, submission, form) {
  const columns = RATING_COLUMNS[submission.form_type] || RATING_COLUMNS.competency;
  const pages = [];
  let page = null;
  let body = null;

  const startPage = (withTitle) => {
    page = el('div', { class: 'sheet' });
    container.append(page);
    pages.push(page);
    page.append(letterhead(submission));
    if (withTitle) {
      page.append(el('div', { class: 'form-title', text: form.title }));
      page.append(detailsGrid(submission));
    }
    const table = el('table', { class: 'grid items' },
      [itemsHead(columns), body = el('tbody')]);
    page.append(table);
  };

  /**
   * True while the sheet still has room. Measured from where the content
   * actually ends — scrollHeight is never smaller than the box, so it cannot
   * tell a nearly empty page from a full one.
   */
  const fits = () => {
    const box = page.getBoundingClientRect();
    const blocks = [...page.children]
      .filter((node) => !node.classList.contains('pagefoot'));
    const last = blocks[blocks.length - 1];
    if (!last) return true;
    const used = last.getBoundingClientRect().bottom - box.top;
    return used <= box.height - mm(FOOT_RESERVE_MM);
  };

  startPage(true);
  for (const row of itemRows(submission, form, columns)) {
    body.append(row);
    if (!fits()) {
      body.removeChild(row);
      startPage(false);
      body.append(row);
    }
  }

  // The signature boxes go on the last sheet, or a fresh one if they do not fit.
  const feet = footerBlocks(submission, form);
  for (const block of feet) page.append(block);
  if (!fits()) {
    for (const block of feet) page.removeChild(block);
    startPage(false);
    for (const block of feet) page.append(block);
  }

  pages.forEach((sheet, index) => {
    sheet.append(pageFoot(submission, form, index + 1, pages.length));
  });
}

function letterhead(submission) {
  return el('div', { class: 'head' }, [
    el('div', { class: 'head-text' }, [
      'Alhadithah General Hospital', el('br'),
      'Nursing Service Department', el('br'),
      `${submission.form_category.toUpperCase()} COMPETENCY`,
    ]),
    el('img', { class: 'head-logo', src: HOSPITAL_LOGO, alt: '' }),
  ]);
}

function field(label, value, extra) {
  return el('td', { class: extra || '' }, [
    el('span', { class: 'lbl', text: label }),
    el('span', { class: 'val', text: value || '' }),
  ]);
}

function detailsGrid(submission) {
  const percent = submission.percent === null ? '' : `${submission.percent}%`;
  return el('table', { class: 'grid details' }, [
    el('colgroup', {}, [
      el('col', { class: 'c1' }), el('col', { class: 'c2' }), el('col', { class: 'c3' }),
    ]),
    el('tbody', {}, [
      el('tr', {}, [
        field('Name:', submission.nurse_name),
        field('Job Number:', submission.nurse_job_number),
        el('td', { class: 'rating', rowspan: '3' }, [
          el('span', { class: 'lbl', text: 'Rating:' }),
          el('div', {
            class: 'rating-val',
            text: percent ? `${percent} — ${submission.result}` : '',
          }),
        ]),
      ]),
      el('tr', {}, [
        field('Unit:', submission.nurse_unit),
        field('Job Title:', submission.nurse_job_title),
      ]),
      el('tr', {}, [
        field('Contract Date:', formatFormDate(submission.nurse_contract_date)),
        el('td', {}),
      ]),
      el('tr', {}, [
        el('td', { class: 'keybox' }, [
          el('b', { text: 'Evaluation Key:' }), el('br'),
          el('b', { text: 'M- Met\u2003NM- Not Met\u2003NA- Not Applicable' }),
        ]),
        el('td', { class: 'keybox', colspan: '2' }, [
          el('b', { text: 'Method of Evaluation:' }), el('br'),
          el('b', { text: 'Knowledge:' }), ' Exam(Written/Oral)\u2003',
          el('b', { text: 'Skills:' }), ' Demonstration/Discussion\u2003',
          el('b', { text: 'Attitude:' }), ' Observation',
        ]),
      ]),
      el('tr', {}, [
        el('td', { class: 'scale', colspan: '3' }, [
          el('b', {
            text: 'Rating Scale:\u2003Met: 90% - 100%\u2003Not Met: 89% & below '
              + 'and remedial once\u2003NA-( Not applicable)',
          }),
          ' – entries to be deducted from the total score',
        ]),
      ]),
    ]),
  ]);
}

function itemsHead(columns) {
  return el('thead', {}, [
    el('tr', {}, [
      el('th', {
        class: 'competencies', colspan: '2', rowspan: '2', text: 'COMPETENCIES',
      }),
      el('th', {
        class: 'assessment', colspan: String(columns.length),
        text: 'EVALUATOR ASSESSMENT',
      }),
    ]),
    el('tr', {}, columns.map((code) => el('th', { class: 'rate' },
      COLUMN_HEADS[code][1]
        ? [COLUMN_HEADS[code][0], el('br'), COLUMN_HEADS[code][1]]
        : [COLUMN_HEADS[code][0]]))),
  ]);
}

/** Every row of the assessment table, in order, ready to be paginated. */
function itemRows(submission, form, columns) {
  const rows = [];
  form.sections.forEach((section, sectionIndex) => {
    rows.push(el('tr', { class: 'section' }, [
      el('td', { class: 'no', text: `${section.roman}.` }),
      el('td', { class: 'name', text: section.name }),
      ...columns.map(() => el('td', {})),
    ]));
    for (const item of section.items) {
      const answer = submission.answers[`${sectionIndex}.${item.no}`];
      rows.push(el('tr', {}, [
        el('td', { class: 'no', text: `${item.no}.` }),
        el('td', { class: 'txt', text: item.text }),
        ...columns.map((code) => el('td', { class: 'mark' }, [
          el('span', { class: 'box', text: answer === code ? '✓' : '' }),
        ])),
      ]));
    }
  });

  rows.push(el('tr', { class: 'raw' }, [
    el('td', { class: 'no' }),
    el('td', { class: 'txt', text: 'Raw Score' }),
    ...columns.map((code) => el('td', {
      class: 'mark',
      text: String(countRating(submission, code)),
    })),
  ]));
  return rows;
}

function countRating(submission, code) {
  return Object.values(submission.answers).filter((r) => r === code).length;
}

// --- footer boxes -----------------------------------------------------------

function footerBlocks(submission) {
  return [scoreRow(submission), signatureRow(submission)];
}

function scoreRow(submission) {
  const percent = submission.percent === null ? '' : `${submission.percent}%`;
  return el('div', { class: 'foot-row' }, [
    el('div', { class: 'foot-box' }, [
      el('div', { class: 'formula' }, [
        el('b', { text: 'Formula:' }),
        el('span', { class: 'frac' }, [
          el('div', { class: 'top', text: `Raw Score  ${submission.raw_score}` }),
          el('div', { class: 'bot', text: `Total Score  ${submission.total_score}` }),
        ]),
        el('span', { text: '× 100%  =' }),
        el('span', {
          class: 'result-val',
          text: percent ? `${percent} — ${submission.result}` : '',
        }),
        el('b', { text: '% Rating' }),
      ]),
    ]),
    el('div', { class: 'foot-box' }, [
      el('div', { class: 'remedial-line' }, [
        el('b', { text: 'NEEDS REMEDIAL:' }),
        el('span', { class: 'box', text: submission.needs_remedial ? '✓' : '' }),
        el('b', { text: 'YES' }),
        el('span', { class: 'box', text: submission.needs_remedial ? '' : '✓' }),
        el('b', { text: 'NO' }),
      ]),
      el('div', { class: 'remedial-date' }, [
        el('b', { text: 'REMEDIAL DATE:' }),
        el('span', {
          class: 'line', text: formatFormDate(submission.remedial_date),
        }),
      ]),
    ]),
  ]);
}

function signatureRow(submission) {
  return el('div', { class: 'foot-row' }, [
    el('div', { class: 'foot-box comments' }, [
      el('div', { class: 'label', text: "Evaluators Comments/Recommendations:" }),
      el('div', { class: 'written', text: submission.evaluator_comments || '' }),
      el('div', { class: 'sign' }, [
        el('div', { class: 'label', text: 'Evaluated By:' }),
        el('div', { class: 'line', text: evaluatorLine(submission) }),
        el('div', { class: 'cap', text: "Evaluator's Name/Signature/Job Number" }),
      ]),
    ]),
    el('div', { class: 'foot-box comments' }, [
      el('div', { class: 'label', text: 'Staff Nurse Comments:' }),
      el('div', { class: 'written', text: submission.staff_comments || '' }),
      el('div', { class: 'sign' }, [
        el('div', { class: 'label', text: 'Conformed By:' }),
        el('div', { class: 'sign-pair' }, [
          el('div', { class: 'who' }, [
            el('div', { class: 'line', text: submission.nurse_name }),
          ]),
          el('div', { class: 'when' }, [
            el('div', {
              class: 'line',
              text: formatFormDate(submission.conformed_date)
                || formatFormDate(submission.exam_date),
            }),
          ]),
        ]),
        el('div', { class: 'cap-row' }, [
          el('span', { text: 'Staff Name/Signature' }),
          el('span', { text: 'Date' }),
        ]),
      ]),
    ]),
  ]);
}

function evaluatorLine(submission) {
  if (!submission.evaluator_name) return '';
  const parts = [submission.evaluator_name, submission.evaluator_job_number]
    .filter(Boolean);
  const dated = formatFormDate(submission.evaluated_date);
  return parts.join(' / ') + (dated ? `    ${dated}` : '');
}

function pageFoot(submission, form, page, pages) {
  return el('div', { class: 'pagefoot' }, [
    el('span', {
      text: `${form.title}  ·  page ${page}${pages > 1 ? ` of ${pages}` : ''}`,
    }),
    el('img', { src: CLUSTER_LOGO, alt: '' }),
  ]);
}
