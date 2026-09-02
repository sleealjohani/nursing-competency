'use strict';

/**
 * The competency forms, extracted from the source PDFs by
 * tools/extract_competencies.py.
 *
 * Loaded with require() rather than fs.readFileSync so that serverless
 * bundlers (Vercel included) trace the JSON as a dependency and ship it
 * with the function.
 */

const scoring = require('./scoring');

const FORMS = require('../data/competencies.json').forms;
const FORMS_BY_ID = new Map(FORMS.map((form) => [form.id, form]));

/**
 * An Arabic reading aid for the same items, kept in its own file so the
 * extraction above is never touched. It is shown beside the English in the
 * exam, and never on the printed form or in a stored submission.
 */
const TRANSLATIONS = require('../data/competencies.ar.json').forms;

function translationFor(formId) {
  return TRANSLATIONS[formId] || null;
}

/** The picker only needs headline details, not all 792 items. */
const FORM_INDEX = FORMS.map((form) => ({
  id: form.id,
  title: form.title,
  title_ar: TRANSLATIONS[form.id]?.title || '',
  category: form.category,
  form_type: form.form_type,
  total_items: form.total_items,
  sections: form.sections.map((s) => ({ name: s.name, count: s.items.length })),
}));

const TOTAL_ITEMS = FORMS.reduce((sum, form) => sum + form.total_items, 0);

function getForm(id) {
  return FORMS_BY_ID.get(id) || null;
}

function formType(form) {
  return form.form_type || 'competency';
}

module.exports = {
  FORMS, FORM_INDEX, TOTAL_ITEMS, TRANSLATIONS,
  getForm, formType, translationFor, scoring,
};
