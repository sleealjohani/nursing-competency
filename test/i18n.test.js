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
