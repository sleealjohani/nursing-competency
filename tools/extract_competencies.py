#!/usr/bin/env python3
"""
Parse the Alhadithah General Hospital nursing competency PDFs into
data/competencies.json, which is the single source of truth the web app
renders the exams from.

Usage:  python3 tools/extract_competencies.py [--pdf-dir DIR] [--out FILE]

Re-run this whenever the source PDFs change.
"""
import argparse
import glob
import json
import os
import re
import sys
import unicodedata

from pypdf import PdfReader

CATEGORY_RE = re.compile(r'^(MANDATORY|SPECIFIC|GENERAL) COMPETENCY$')
PAGE_HDR_RE = re.compile(r'^(.*?)\s+·\s+page\s+(\d+)$')
SECTION_NO_RE = re.compile(r'^(I|II|III|IV|V)\.$')
SECTION_INLINE_RE = re.compile(r'^(I|II|III|IV|V)\.\s+([A-Z][A-Z /&-]+)$')
ITEM_NO_RE = re.compile(r'^(\d{1,2})\.$')
ITEM_INLINE_RE = re.compile(r'^(\d{1,2})\.\s+(\S.*)$')
SECTION_NAMES = {'KNOWLEDGE', 'SKILLS', 'ATTITUDE'}

# Boilerplate that repeats on every page of every form.
NOISE = {
    'alhadithah general hospital',
    'nursing service department',
    'competencies',
    'evaluator assessment',
    'm', '(1)', 'nm', '(0)', 'na',
    'name:', 'unit:', 'contract date:', 'job number:', 'job title:', 'rating:',
    'evaluation key:', 'm- met', 'nm- not met', 'na- not applicable',
    'method of evaluation:', 'knowledge:', 'skills:', 'attitude:',
    'exam(written/oral)', 'demonstration/discussion', 'observation',
    'rating scale:', 'met: 90% - 100%',
    'not met: 89% & below and remedial once', 'na-( not applicable)',
    '– entries to be deducted from the total score',
    'm- met nm- not met na- not applicable',
    'knowledge: exam(written/oral)   skills: demonstration/discussion   attitude: observation',
    'rating scale:  met: 90% - 100%    not met: 89% & below and remedial once  '
    'na-( not applicable) – entries to be deducted from the total score',
}
END_MARKERS = ('raw score', 'formula:')


def clean(text):
    """Normalise unicode oddities the PDF text layer carries."""
    text = unicodedata.normalize('NFKC', text)
    return text.replace('’', "'").replace('ﬁ', 'fi').replace('\xa0', ' ')


def read_pdf(path):
    reader = PdfReader(path)
    return [clean(page.extract_text() or '') for page in reader.pages]


# The equipment checklist is rated on its own scale instead of M / NM / NA.
EQUIPMENT_LEVELS = [
    {'code': 'VT', 'label': 'Vendor Training',
     'description': 'Training given to staff by the vendor'},
    {'code': 'RD', 'label': 'Repeat Demonstration',
     'description': 'Employee is able to repeat a demonstration of equipment '
                    'with little supervision. Refers malfunctioning equipment '
                    'to the relevant department. For example BIOMED department '
                    'with minimal guidance and supervision'},
    {'code': 'UEC', 'label': 'Uses Equipment Competently',
     'description': 'Employee is able to independently use the equipment in '
                    'their clinical area of practice. Initiate referral of '
                    'malfunctioning equipment to the relevant personnel, for '
                    'example BIOMED without any guidance or supervision.'},
    {'code': 'NA', 'label': 'Not Applicable',
     'description': 'Not applicable. Equipment is not available in the area '
                    'of practice'},
]
EQUIPMENT_LEVEL_CODES = {level['code'] for level in EQUIPMENT_LEVELS}


def parse_equipment(body):
    """Read the 'N / equipment name' rows of the equipment checklist."""
    items = []
    lines = [line.strip() for line in body]
    try:
        start = lines.index('EQUIPMENT') + 1
    except ValueError:
        return []
    j = start
    while j < len(lines):
        line = lines[j]
        j += 1
        if not line or line in EQUIPMENT_LEVEL_CODES:
            continue
        m = re.match(r'^(\d{1,2})$', line)
        if m and j < len(lines) and lines[j]:
            items.append({'no': int(m.group(1)), 'text': lines[j]})
            j += 1
    return items


def parse(path):
    pages = read_pdf(path)
    lines = []
    for page in pages:
        for raw in page.split('\n'):
            lines.append(raw.rstrip())


    title = category = None
    notes = []
    body = []
    seen_competencies_header = False

    i = 0
    while i < len(lines):
        raw_line = lines[i]
        line = raw_line.strip()
        low = line.lower()
        i += 1
        if not line:
            continue

        m = CATEGORY_RE.match(line)
        if m:
            category = m.group(1).title()
            continue

        m = PAGE_HDR_RE.match(line)
        if m:
            title = title or m.group(1).strip()
            continue

        if low == 'competencies':
            seen_competencies_header = True
            continue

        # A transcription note carried in the source scan; it wraps over lines.
        if low.startswith('note:') and not seen_competencies_header:
            note = [line]
            while i < len(lines) and lines[i].strip() and \
                    lines[i].strip().lower() not in ('competencies',):
                note.append(lines[i].strip())
                i += 1
            notes.append(' '.join(note))
            continue

        if low in NOISE:
            continue
        # The standalone title line repeats the page-header title.
        if title and low == title.lower():
            continue
        if any(low.startswith(marker) for marker in END_MARKERS):
            break

        body.append(raw_line)

    sections = []
    current_section = None
    current_item = None

    def flush_item():
        nonlocal current_item
        if current_item and current_section is not None:
            text = ' '.join(current_item['parts']).strip()
            text = re.sub(r'\s{2,}', ' ', text)
            if text:
                current_section['items'].append(
                    {'no': current_item['no'], 'text': text})
        current_item = None

    j = 0
    while j < len(body):
        line = body[j]
        stripped = line.strip()

        m = SECTION_INLINE_RE.match(stripped)
        if m and m.group(2).strip() in SECTION_NAMES:
            flush_item()
            current_section = {'roman': m.group(1), 'name': m.group(2).strip(),
                               'items': []}
            sections.append(current_section)
            j += 1
            continue

        if SECTION_NO_RE.match(stripped) and j + 1 < len(body) \
                and body[j + 1].strip() in SECTION_NAMES:
            flush_item()
            current_section = {'roman': stripped[:-1], 'name': body[j + 1].strip(),
                               'items': []}
            sections.append(current_section)
            j += 2
            continue

        m = ITEM_NO_RE.match(stripped)
        if m and current_section is not None:
            flush_item()
            current_item = {'no': int(m.group(1)), 'parts': []}
            j += 1
            continue

        m = ITEM_INLINE_RE.match(stripped)
        # Only treat "N. text" as a new item when the number continues the
        # sequence; otherwise it is a numbered sub-point inside the current item.
        if m and current_section is not None:
            expected = (current_item['no'] + 1) if current_item \
                else (current_section['items'][-1]['no'] + 1
                      if current_section['items'] else 1)
            if int(m.group(1)) == expected and not line.startswith(' '):
                flush_item()
                current_item = {'no': int(m.group(1)), 'parts': [m.group(2)]}
                j += 1
                continue

        if current_item is not None:
            current_item['parts'].append(stripped)
        j += 1

    flush_item()

    slug = os.path.basename(path)[:-4]
    if not sections:
        equipment = parse_equipment(body)
        if equipment:
            return {
                'id': slug,
                'title': title,
                'category': category or 'General',
                'form_type': 'equipment',
                'source_pdf': os.path.basename(path),
                'notes': notes,
                'levels': EQUIPMENT_LEVELS,
                'sections': [{'roman': 'I', 'name': 'EQUIPMENT',
                              'items': equipment}],
                'total_items': len(equipment),
            }
    return {
        'id': slug,
        'title': title,
        'category': category or 'General',
        'form_type': 'competency',
        'source_pdf': os.path.basename(path),
        'notes': notes,
        'sections': [s for s in sections if s['items']],
        'total_items': sum(len(s['items']) for s in sections),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf-dir', default='.')
    ap.add_argument('--out', default='data/competencies.json')
    args = ap.parse_args()

    forms = []
    problems = []
    for path in sorted(glob.glob(os.path.join(args.pdf_dir, '*.pdf'))):
        form = parse(path)
        forms.append(form)
        names = [s['name'] for s in form['sections']]
        if not form['title'] or form['total_items'] == 0:
            problems.append(f"{form['id']}: title/items missing")
        if len(names) != len(set(names)):
            problems.append(f"{form['id']}: duplicate sections {names}")
        for section in form['sections']:
            expected = list(range(1, len(section['items']) + 1))
            actual = [item['no'] for item in section['items']]
            if actual != expected:
                problems.append(
                    f"{form['id']}/{section['name']}: numbering {actual}")

    forms.sort(key=lambda f: (f['category'], f['title']))
    os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
    with open(args.out, 'w') as fh:
        json.dump({'forms': forms}, fh, indent=1, ensure_ascii=False)
        fh.write('\n')

    total = sum(f['total_items'] for f in forms)
    print(f'{len(forms)} forms, {total} items -> {args.out}')
    for form in forms:
        print(f"  {form['category']:<9} {form['total_items']:>3} items  "
              f"{'/'.join(s['name'][:4] for s in form['sections'])}  {form['title']}")
    if problems:
        print('\nPROBLEMS:', file=sys.stderr)
        for problem in problems:
            print('  ' + problem, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
