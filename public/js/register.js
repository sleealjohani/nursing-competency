'use strict';

/** Home page: register the nurse, then let them pick a competency form. */

const registerCard = document.getElementById('register-card');
const pickerCard = document.getElementById('picker-card');
const registerForm = document.getElementById('register-form');
const listNode = document.getElementById('form-list');
const emptyNode = document.getElementById('picker-empty');
const searchInput = document.getElementById('search');
const categorySelect = document.getElementById('category');

let forms = [];
let doneFormIds = new Map();
let nurse = null;

document.getElementById('examDate').value = today();

mountLanguageToggle(document.getElementById('lang-slot'));
fillDatalists();
checkStorageHealth('register-msg');

/**
 * Suggestions carry a translated label but the value stored on the form stays
 * the same, so a unit reads the same on every record regardless of language.
 */
function fillDatalists() {
  const groups = {
    'job-titles': ['staffNurse', 'chargeNurse', 'headNurse', 'midwife', 'supervisor']
      .map((k) => [t(`jobTitle.${k}`), {
        staffNurse: 'Staff Nurse', chargeNurse: 'Charge Nurse',
        headNurse: 'Head Nurse', midwife: 'Midwife',
        supervisor: 'Nursing Supervisor',
      }[k]]),
    units: ['emergency', 'icu', 'nicu', 'medical', 'surgical', 'labour',
      'paediatrics', 'theatre', 'outpatient'].map((k) => [t(`unit.${k}`), {
        emergency: 'Emergency', icu: 'ICU', nicu: 'NICU',
        medical: 'Medical Ward', surgical: 'Surgical Ward',
        labour: 'Labour & Delivery', paediatrics: 'Paediatrics',
        theatre: 'Operating Theatre', outpatient: 'Outpatient',
      }[k]]),
  };
  for (const [id, entries] of Object.entries(groups)) {
    const list = document.getElementById(id);
    if (!list) continue;
    list.innerHTML = '';
    for (const [label, value] of entries) {
      list.append(el('option', { value, label }));
    }
  }
}

// Prefill from a previous visit on this device.
const saved = nurseSession.get();
if (saved) {
  for (const field of ['jobNumber', 'name', 'jobTitle', 'unit', 'contractDate']) {
    const input = registerForm.elements[field];
    if (input) input.value = saved[field] ?? saved[snake(field)] ?? '';
  }
  if (saved.examDate) document.getElementById('examDate').value = saved.examDate;
}

function snake(camel) {
  return camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** Look up a returning nurse as soon as a known job number is typed. */
document.getElementById('jobNumber').addEventListener('change', async (event) => {
  const jobNumber = event.target.value.trim();
  if (!jobNumber) return;
  try {
    const { nurse: found } = await api(`/api/nurses/${encodeURIComponent(jobNumber)}`);
    for (const [field, value] of Object.entries({
      name: found.name, jobTitle: found.job_title,
      unit: found.unit, contractDate: found.contract_date,
    })) {
      const input = registerForm.elements[field];
      if (input && !input.value) input.value = value || '';
    }
    showMessage('register-msg', t('register.welcomeBack', { name: found.name }), 'ok');
  } catch {
    showMessage('register-msg', '');
  }
});

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(registerForm));
  showMessage('register-msg', '');
  try {
    const response = await api('/api/nurses', { method: 'POST', body: data });
    nurse = response.nurse;
    nurseSession.set({
      jobNumber: nurse.job_number, name: nurse.name,
      jobTitle: nurse.job_title, unit: nurse.unit,
      contractDate: nurse.contract_date,
    }, data.examDate || today());
    await showPicker();
  } catch (error) {
    showMessage('register-msg', errorText(error));
  }
});

document.getElementById('edit-details').addEventListener('click', () => {
  pickerCard.hidden = true;
  registerCard.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

async function showPicker() {
  registerCard.hidden = true;
  pickerCard.hidden = false;
  document.getElementById('picker-who').textContent =
    t('picker.who', { name: nurse.name, jobNumber: nurse.job_number })
    + (nurse.unit ? ` · ${nurse.unit}` : '');

  if (!forms.length) {
    forms = (await api('/api/competencies')).forms;
  }
  try {
    const { submissions } = await api(
      `/api/my-submissions?jobNumber=${encodeURIComponent(nurse.job_number)}`);
    doneFormIds = new Map(submissions.map((s) => [s.form_id, s]));
  } catch {
    doneFormIds = new Map();
  }
  renderList();
  window.scrollTo({ top: 0 });
}

function renderList() {
  const term = searchInput.value.trim().toLowerCase();
  const category = categorySelect.value;
  const matches = forms.filter((form) =>
    (!category || form.category === category)
    && (!term || form.title.toLowerCase().includes(term)));

  listNode.innerHTML = '';
  emptyNode.hidden = matches.length > 0;

  for (const form of matches) {
    const previous = doneFormIds.get(form.id);
    const sections = form.sections
      .map((s) => `${s.count} ${gloss(`section.${s.name}`) || s.name.toLowerCase()}`)
      .join(' · ');
    listNode.append(el('button', {
      class: 'form-item', type: 'button',
      onclick: () => startExam(form),
    }, [
      categoryBadge(form.category),
      el('span', { class: 'grow' }, [
        // The competency title is the hospital's own wording, never translated.
        sourceText(el('div', { class: 't', text: form.title })),
        el('div', {
          class: 'm',
          text: t('picker.itemsSummary', {
            count: form.total_items, sections,
          }),
        }),
      ]),
      previous
        ? el('span', {
          class: 'done',
          text: `${t(`value.${previous.result}`)} ${percentText(previous.percent)}`,
        })
        : null,
    ]));
  }
}

function startExam(form) {
  const previous = doneFormIds.get(form.id);
  if (previous && !confirm(t('picker.retake', {
    title: form.title,
    date: formatDate(previous.exam_date),
    result: t(`value.${previous.result}`),
  }))) {
    return;
  }
  location.href = `/exam?form=${encodeURIComponent(form.id)}`;
}

searchInput.addEventListener('input', renderList);
categorySelect.addEventListener('change', renderList);

// A nurse returning mid-session lands straight on the picker.
if (saved?.jobNumber) {
  api(`/api/nurses/${encodeURIComponent(saved.jobNumber)}`)
    .then(({ nurse: found }) => { nurse = found; return showPicker(); })
    .catch(() => { /* not registered on the server yet — show the form */ });
}
