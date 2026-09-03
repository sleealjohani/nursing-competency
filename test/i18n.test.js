#!/usr/bin/env node
'use strict';

/**
 * Checks the Arabic interface without a browser:
 *   - every key exists in both languages, with matching placeholders
 *   - no competency wording from the PDFs has leaked into the dictionary
 *   - every data-i18n key used in the pages is defined
 *   - the printed form stays fixed to the source wording and direction
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const i18nSource = fs.readFileSync(path.join(PUBLIC, 'js/i18n.js'), 'utf8');
// The module is written for the browser; evaluate its dictionary here.
const STRINGS = (() => {
  const start = i18nSource.indexOf('const STRINGS = {');
  const end = i18nSource.indexOf('\nconst STORAGE_KEY');
  const body = i18nSource.slice(start, end).replace('const STRINGS = ', '');
  // eslint-disable-next-line no-eval
  return eval(`(${body.replace(/;\s*$/, '')})`);
})();

const forms = require('../data/competencies.json').forms;
const translations = require('../data/competencies.ar.json').forms;

let failures = 0;
let total = 0;
function check(name, fn) {
  total += 1;
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${error.message}`);
  }
}

function placeholders(text) {
  return (String(text).match(/\{(\w+)\}/g) || []).sort().join(',');
}

console.log('\nArabic interface checks\n');

check('both languages define the same keys', () => {
  const en = Object.keys(STRINGS.en).sort();
  const ar = Object.keys(STRINGS.ar).sort();
  const missingAr = en.filter((k) => !(k in STRINGS.ar));
  const extraAr = ar.filter((k) => !(k in STRINGS.en));
  assert.deepStrictEqual(missingAr, [], `not translated: ${missingAr}`);
  assert.deepStrictEqual(extraAr, [], `only in Arabic: ${extraAr}`);
  assert.ok(en.length > 100, `expected a full dictionary, got ${en.length} keys`);
});

check('translations keep the same placeholders', () => {
  for (const key of Object.keys(STRINGS.en)) {
    assert.strictEqual(placeholders(STRINGS.ar[key]), placeholders(STRINGS.en[key]),
      `${key}: placeholders differ`);
  }
});

check('Arabic strings are actually Arabic', () => {
  const arabic = /[؀-ۿ]/;
  const exempt = new Set(['lang.name', 'lang.switchTo', 'print.button',
    'admin.exportCsv', 'err.password_from_env']);
  const untranslated = Object.keys(STRINGS.ar).filter((key) =>
    !exempt.has(key) && !arabic.test(STRINGS.ar[key]));
  assert.deepStrictEqual(untranslated, [],
    `left in English: ${untranslated.join(', ')}`);
});

check('no competency wording was copied into the dictionary', () => {
  // Item text belongs to the PDFs; it must be rendered from the data, never
  // restated (and so never quietly reworded) in a translation file.
  const itemTexts = new Set();
  for (const form of forms) {
    for (const section of form.sections) {
      for (const item of section.items) {
        if (item.text.length > 25) itemTexts.add(item.text.slice(0, 40));
      }
    }
  }
  for (const lang of ['en', 'ar']) {
    for (const [key, value] of Object.entries(STRINGS[lang])) {
      for (const snippet of itemTexts) {
        assert.ok(!String(value).includes(snippet),
          `${lang}.${key} contains competency wording`);
      }
    }
  }
});

check('competency titles are not translated anywhere', () => {
  const titles = forms.map((form) => form.title);
  for (const lang of ['en', 'ar']) {
    for (const [key, value] of Object.entries(STRINGS[lang])) {
      for (const title of titles) {
        assert.ok(!String(value).includes(title),
          `${lang}.${key} restates the competency title "${title}"`);
      }
    }
  }
});

check('every data-i18n key used in the pages is defined', () => {
  const used = new Set();
  for (const file of fs.readdirSync(PUBLIC)) {
    if (!file.endsWith('.html')) continue;
    const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    for (const match of html.matchAll(
      /data-i18n(?:-placeholder|-title|-html)?="([^"]+)"/g)) {
      used.add(match[1]);
    }
  }
  assert.ok(used.size > 50, `expected the pages to be marked up, found ${used.size}`);
  const undefinedKeys = [...used].filter((key) => !(key in STRINGS.en));
  assert.deepStrictEqual(undefinedKeys, [],
    `used in HTML but not defined: ${undefinedKeys.join(', ')}`);
});

check('every t() key used in the scripts is defined', () => {
  const missing = new Set();
  for (const file of fs.readdirSync(path.join(PUBLIC, 'js'))) {
    if (file === 'i18n.js') continue;
    const js = fs.readFileSync(path.join(PUBLIC, 'js', file), 'utf8');
    for (const match of js.matchAll(/\bt\('([a-zA-Z][\w.]*)'/g)) {
      if (!(match[1] in STRINGS.en)) missing.add(`${file}: ${match[1]}`);
    }
  }
  assert.deepStrictEqual([...missing], [], `undefined keys: ${[...missing]}`);
});

check('every competency item has an Arabic rendering', () => {
  let items = 0;
  for (const form of forms) {
    const entry = translations[form.id];
    assert.ok(entry, `${form.id} has no Arabic`);
    assert.ok(entry.title && /[\u0600-\u06FF]/.test(entry.title),
      `${form.id} has no Arabic title`);
    form.sections.forEach((section, index) => {
      for (const item of section.items) {
        const key = `${index}.${item.no}`;
        const text = entry.items[key];
        assert.ok(text && text.trim(), `${form.id}/${key} has no Arabic`);
        assert.ok(/[\u0600-\u06FF]/.test(text),
          `${form.id}/${key} is not Arabic: ${text}`);
        items += 1;
      }
    });
  }
  assert.strictEqual(items, 792, `expected 792 items, checked ${items}`);
});

check('the Arabic overlay adds nothing the extraction does not have', () => {
  // A stray key would mean the aid and the record had drifted apart.
  for (const [formId, entry] of Object.entries(translations)) {
    const form = forms.find((f) => f.id === formId);
    assert.ok(form, `${formId} is not a competency in the extraction`);
    const valid = new Set();
    form.sections.forEach((section, index) => {
      for (const item of section.items) valid.add(`${index}.${item.no}`);
    });
    for (const key of Object.keys(entry.items)) {
      assert.ok(valid.has(key), `${formId}: "${key}" is not an item on this form`);
    }
  }
  assert.strictEqual(Object.keys(translations).length, forms.length);
});

check('the English extraction is never overwritten by the aid', () => {
  // The record must still read exactly as the PDF; the Arabic is a separate
  // file and the two must not have been merged.
  const raw = fs.readFileSync(
    path.join(ROOT, 'data', 'competencies.json'), 'utf8');
  assert.ok(!/[\u0600-\u06FF]/.test(raw),
    'Arabic text has leaked into data/competencies.json');
  for (const form of forms) {
    for (const section of form.sections) {
      for (const item of section.items) {
        assert.ok(/[A-Za-z]/.test(item.text),
          `${form.id} item ${item.no} lost its English wording`);
      }
    }
  }
});

check('the printed form carries no Arabic rendering', () => {
  const js = fs.readFileSync(path.join(PUBLIC, 'js/print.js'), 'utf8');
  // Whole words only: an English word that merely contains one of these is
  // not a use of the reading aid.
  assert.ok(!/\b(translation|arabic|showAid|renderAid)\b/i.test(js),
    'print.js must render the source wording only');
  assert.ok(!/competencies\.ar/i.test(js),
    'print.js must not read the Arabic overlay');
  // The letterhead is the hospital's own mark; Arabic there is part of the
  // logo image, not translated text.
  assert.ok(!/[\u0600-\u06FF]/.test(js),
    'print.js must contain no Arabic text');
});

check('a submission stores the English wording only', () => {
  const api = fs.readFileSync(path.join(ROOT, 'lib', 'api.js'), 'utf8');
  const submit = api.slice(api.indexOf("pathname === '/api/submissions'"),
    api.indexOf('/api/submissions/'));
  assert.ok(!/translation/.test(submit),
    'a stored submission must not carry the reading aid');
});

check('the pages start in Arabic and declare direction', () => {
  for (const file of ['index.html', 'exam.html', 'admin.html', 'print.html']) {
    const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    assert.match(html, /<html lang="ar" dir="rtl">/, `${file} is not RTL by default`);
    assert.match(html, /js\/i18n\.js/, `${file} does not load the translations`);
    assert.match(html, /id="lang-slot"/, `${file} has no language toggle`);
  }
});

check('the printed form never mirrors or re-aligns', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'css/print.css'), 'utf8');
  assert.match(css, /\.sheet\s*\{[^}]*direction:\s*ltr/,
    'the competency sheet must stay left-to-right');
});

check('printed dates do not change with the interface language', () => {
  const js = fs.readFileSync(path.join(PUBLIC, 'js/print.js'), 'utf8');
  const sheet = js.slice(js.indexOf('function renderSheet('));
  assert.ok(!/[^m]\bformatDate\(/.test(sheet),
    'the form must use formatFormDate, which is fixed to the form\'s format');
  assert.ok(!/[^m]\bformatDateTime\(/.test(sheet),
    'the form must use formatFormDateTime');
});

console.log(`\n${total - failures}/${total} checks passed`
  + `${failures ? ` — ${failures} FAILED` : ''}\n`);
process.exit(failures ? 1 : 0);
