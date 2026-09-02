'use strict';

/**
 * Renders each selected submission as the hospital's competency form, one
 * A4 sheet per form, with the nurse's answers ticked into the M / NM / NA
 * columns. Printing the page produces the papers ready for signature.
 */

const RATING_COLUMNS = {
  competency: ['M', 'NM', 'NA'],
  equipment: ['VT', 'RD', 'UEC', 'NA'],
};

const COLUMN_HEADS = {
  M: ['M', '(1)'], NM: ['NM', '(0)'], NA: ['NA', ''],
  VT: ['VT', ''], RD: ['RD', ''], UEC: ['UEC', ''],
};

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
  for (const submission of data.submissions) {
    const form = data.forms[submission.form_id];
    if (form) container.append(renderSheet(submission, form));
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

function renderSheet(submission, form) {
  const columns = RATING_COLUMNS[submission.form_type] || RATING_COLUMNS.competency;

  return el('div', { class: 'sheet' }, [
    header(submission, form),
    detailsTable(submission),
    keyBox(submission.form_type),
    ...(form.notes || []).map((note) => el('p', { class: 'note', text: note })),
    itemsTable(submission, form, columns),
    // The score, comments and signatures stay together on one page — a
    // signature block orphaned onto a sheet of its own wastes paper.
    el('div', { class: 'formfoot' }, [
      formulaRow(submission),
      commentsBlock(submission),
      signaturesBlock(submission),
      el('div', { class: 'pagefoot' }, [
        el('span', {
          text: `${form.source_pdf} · submission #${submission.id}`,
        }),
        el('span', {
          text: `Submitted ${formatFormDateTime(submission.submitted_at)}`,
        }),
      ]),
    ]),
  ]);
}

function header(submission, form) {
  return el('div', { class: 'hdr' }, [
    el('div', { class: 'hosp', text: 'Alhadithah General Hospital' }),
    el('div', { class: 'dept', text: 'Nursing Service Department' }),
    el('div', {
      class: 'cat',
      text: `${submission.form_category.toUpperCase()} COMPETENCY`,
    }),
    el('div', { class: 'title', text: form.title }),
  ]);
}

function detailsTable(submission) {
  const pairs = [
    ['Name:', submission.nurse_name, 'Unit:', submission.nurse_unit],
    ['Contract Date:', formatFormDate(submission.nurse_contract_date),
      'Job Number:', submission.nurse_job_number],
    ['Job Title:', submission.nurse_job_title,
      'Rating:', ratingText(submission)],
  ];
  return el('table', { class: 'details' }, pairs.map(([l1, v1, l2, v2]) =>
    el('tr', {}, [
      el('td', { class: 'lbl', text: l1 }),
      el('td', { class: 'val', text: v1 || '' }),
      el('td', { class: 'lbl', text: l2 }),
      el('td', { class: 'val', text: v2 || '' }),
    ])));
}

function ratingText(submission) {
  const percent = submission.percent === null ? '—' : `${submission.percent}%`;
  return `${percent}  —  ${submission.result}`;
}

function keyBox(formType) {
  if (formType === 'equipment') {
    return el('div', { class: 'keybox keybox-equipment' }, [
      el('div', { class: 'line', html:
        '<b>VT</b> — Training given to staff by the vendor' }),
      el('div', { class: 'line', html:
        '<b>RD</b> — Employee is able to repeat a demonstration of equipment '
        + 'with little supervision. Refers malfunctioning equipment to the '
        + 'relevant department, for example BIOMED, with minimal guidance and '
        + 'supervision' }),
      el('div', { class: 'line', html:
        '<b>UEC</b> — Employee is able to independently use the equipment in '
        + 'their clinical area of practice. Initiate referral of malfunctioning '
        + 'equipment to the relevant personnel, for example BIOMED, without any '
        + 'guidance or supervision' }),
      el('div', { class: 'line', html:
        '<b>NA</b> — Not applicable. Equipment is not available in the area of '
        + 'practice' }),
    ]);
  }
  return el('div', { class: 'keybox' }, [
    el('div', { class: 'line', html:
      '<b>Evaluation Key:</b> M- Met &nbsp; NM- Not Met &nbsp; NA- Not Applicable' }),
    el('div', { class: 'line', html:
      '<b>Method of Evaluation:</b> Knowledge: Exam (Written/Oral) &nbsp; '
      + 'Skills: Demonstration/Discussion &nbsp; Attitude: Observation' }),
    el('div', { class: 'line', html:
      '<b>Rating Scale:</b> Met: 90% - 100% &nbsp; Not Met: 89% &amp; below and '
      + 'remedial once &nbsp; NA- (Not applicable) – entries to be deducted from '
      + 'the total score' }),
  ]);
}

function itemsTable(submission, form, columns) {
  const head = el('thead', {}, [
    el('tr', {}, [
      el('th', { class: 'competencies', colspan: '2', rowspan: '2',
        text: 'COMPETENCIES' }),
      el('th', { colspan: String(columns.length), text: 'EVALUATOR ASSESSMENT' }),
    ]),
    el('tr', {}, columns.map((code) => el('th', { class: 'rate-col' },
      COLUMN_HEADS[code][1]
        ? [COLUMN_HEADS[code][0], el('br'), COLUMN_HEADS[code][1]]
        : [COLUMN_HEADS[code][0]]))),
  ]);

  const body = el('tbody');
  form.sections.forEach((section, sectionIndex) => {
    body.append(el('tr', { class: 'section' }, [
      el('td', { colspan: String(2 + columns.length),
        text: `${section.roman}. ${section.name}` }),
    ]));
    for (const item of section.items) {
      const answer = submission.answers[`${sectionIndex}.${item.no}`];
      body.append(el('tr', {}, [
        el('td', { class: 'no', text: `${item.no}.` }),
        el('td', { class: 'txt', text: item.text }),
        ...columns.map((code) => el('td', {
          class: 'mark',
          text: answer === code ? '✓' : '',
        })),
      ]));
    }
  });

  // The Raw Score row that closes the paper form.
  body.append(el('tr', { class: 'raw' }, [
    el('td', { class: 'txt', colspan: '2', text: 'Raw Score' }),
    ...columns.map((code) => {
      const counts = countRating(submission, code);
      return el('td', { class: 'mark', text: String(counts) });
    }),
  ]));

  return el('table', { class: 'bordered items' }, [head, body]);
}

function countRating(submission, code) {
  return Object.values(submission.answers).filter((r) => r === code).length;
}

function formulaRow(submission) {
  return el('div', { class: 'formula' }, [
    el('b', { text: 'Formula:' }),
    el('span', { class: 'frac' }, [
      el('div', { class: 'top', text: `Raw Score  ${submission.raw_score}` }),
      el('div', { class: 'bot', text: `Total Score  ${submission.total_score}` }),
    ]),
    el('span', { text: '× 100%  =' }),
    el('span', { class: 'result-box', text: `${ratingText(submission)}` }),
    el('span', { class: 'remedial' }, [
      el('b', { text: 'NEEDS REMEDIAL: ' }),
      'YES ',
      el('span', { class: 'box', text: submission.needs_remedial ? '✓' : '' }),
      '  NO ',
      el('span', { class: 'box', text: submission.needs_remedial ? '' : '✓' }),
      el('span', {
        text: `   REMEDIAL DATE: ${formatFormDate(submission.remedial_date) || '____________'}`,
      }),
    ]),
  ]);
}

function commentsBlock(submission) {
  return el('div', { class: 'comments' }, [
    el('div', { class: 'label', text: "Evaluator's Comments / Recommendations:" }),
    el('div', { class: 'writing', text: submission.evaluator_comments || '' }),
    el('div', { class: 'label', style: 'margin-top:1.6mm',
      text: 'Staff Nurse Comments:' }),
    el('div', { class: 'writing', text: submission.staff_comments || '' }),
  ]);
}

function signaturesBlock(submission) {
  return el('div', { class: 'signatures' }, [
    el('div', { class: 'sig-row' }, [
      el('div', { class: 'sig' }, [
        el('div', { text: 'Evaluated By:' }),
        el('div', { class: 'line', text: signatureLine(submission) }),
        el('div', { class: 'cap', text: "Evaluator's Name / Signature / Job Number" }),
      ]),
      el('div', { class: 'sig', style: 'max-width:45mm' }, [
        el('div', { text: 'Date:' }),
        el('div', { class: 'line', text: formatFormDate(submission.evaluated_date) }),
        el('div', { class: 'cap', text: 'Date' }),
      ]),
    ]),
    el('div', { class: 'sig-row' }, [
      el('div', { class: 'sig' }, [
        el('div', { text: 'Conformed By:' }),
        el('div', { class: 'line', text: submission.nurse_name }),
        el('div', { class: 'cap', text: 'Staff Name / Signature' }),
      ]),
      el('div', { class: 'sig', style: 'max-width:45mm' }, [
        el('div', { text: 'Date:' }),
        el('div', { class: 'line',
          text: formatFormDate(submission.conformed_date) || formatFormDate(submission.exam_date) }),
        el('div', { class: 'cap', text: 'Date' }),
      ]),
    ]),
  ]);
}

function signatureLine(submission) {
  if (!submission.evaluator_name) return '';
  return submission.evaluator_job_number
    ? `${submission.evaluator_name}  /  ${submission.evaluator_job_number}`
    : submission.evaluator_name;
}
