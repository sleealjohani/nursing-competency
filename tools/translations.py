#!/usr/bin/env python3
"""
Manage the Arabic reading aid for the competency forms.

The English extraction in data/competencies.json is the record and is never
touched. Arabic sits beside it in data/competencies.ar.json, keyed by form id
and by the same "<sectionIndex>.<itemNo>" keys the answers use, so a
translation can be corrected or removed without disturbing the source.

    python3 tools/translations.py status        coverage report
    python3 tools/translations.py check         exit 1 if keys do not line up
    python3 tools/translations.py dump FORM_ID  print a form's English items
    python3 tools/translations.py todo          list forms still untranslated
    python3 tools/translations.py merge         merge a JSON batch from stdin
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'data', 'competencies.json')
TARGET = os.path.join(ROOT, 'data', 'competencies.ar.json')


def load_source():
    with open(SOURCE) as fh:
        return json.load(fh)['forms']


def load_target():
    if not os.path.exists(TARGET):
        return {'language': 'ar', 'forms': {}}
    with open(TARGET) as fh:
        return json.load(fh)


def save_target(data):
    data['forms'] = {key: data['forms'][key] for key in sorted(data['forms'])}
    with open(TARGET, 'w') as fh:
        json.dump(data, fh, indent=1, ensure_ascii=False, sort_keys=False)
        fh.write('\n')


def item_keys(form):
    """The same keys the exam answers use."""
    return [f'{index}.{item["no"]}'
            for index, section in enumerate(form['sections'])
            for item in section['items']]


def coverage():
    forms = load_source()
    target = load_target()['forms']
    rows = []
    for form in forms:
        keys = item_keys(form)
        got = target.get(form['id'], {})
        translated = sum(1 for key in keys if got.get('items', {}).get(key))
        rows.append((form['id'], translated, len(keys), bool(got.get('title'))))
    return rows


def cmd_status():
    rows = coverage()
    done = sum(t for _, t, _, _ in rows)
    total = sum(n for _, _, n, _ in rows)
    for form_id, translated, count, has_title in sorted(rows):
        mark = 'ok ' if translated == count and has_title else '   '
        print(f'  {mark} {translated:>3}/{count:<3} {form_id}')
    print(f'\n{done}/{total} items translated '
          f'({done * 100 // total if total else 0}%)')
    return 0


def cmd_todo():
    for form_id, translated, count, has_title in sorted(coverage()):
        if translated < count or not has_title:
            print(form_id)
    return 0


def cmd_check():
    forms = {form['id']: form for form in load_source()}
    target = load_target()['forms']
    problems = []

    for form_id, entry in target.items():
        if form_id not in forms:
            problems.append(f'{form_id}: no such competency in the extraction')
            continue
        expected = set(item_keys(forms[form_id]))
        actual = set(entry.get('items', {}))
        for key in sorted(actual - expected):
            problems.append(f'{form_id}: "{key}" is not an item on this form')
        for key in sorted(expected - actual):
            problems.append(f'{form_id}: "{key}" has no Arabic')
        if not entry.get('title'):
            problems.append(f'{form_id}: no Arabic title')
        for key, text in entry.get('items', {}).items():
            if not str(text).strip():
                problems.append(f'{form_id}/{key}: empty translation')

    for form_id in forms:
        if form_id not in target:
            problems.append(f'{form_id}: no translations at all')

    if problems:
        print('PROBLEMS:', file=sys.stderr)
        for problem in problems:
            print('  ' + problem, file=sys.stderr)
        return 1
    total = sum(len(entry['items']) for entry in target.values())
    print(f'Arabic aid complete: {len(target)} forms, {total} items.')
    return 0


def cmd_merge():
    """Merge a JSON batch from stdin: {"form-id": {"title": ..., "items": {...}}}"""
    batch = json.load(sys.stdin)
    data = load_target()
    for form_id, entry in batch.items():
        current = data['forms'].setdefault(form_id, {'title': '', 'items': {}})
        if entry.get('title'):
            current['title'] = entry['title']
        current['items'].update(entry.get('items', {}))
        current['items'] = {key: current['items'][key]
                            for key in sorted(current['items'],
                                              key=lambda k: [int(part) for part
                                                             in k.split('.')])}
    save_target(data)
    added = sum(len(entry.get('items', {})) for entry in batch.values())
    print(f'merged {added} item(s) across {len(batch)} form(s)')
    return 0


def cmd_dump(form_id):
    forms = {form['id']: form for form in load_source()}
    if form_id not in forms:
        print(f'No such competency: {form_id}', file=sys.stderr)
        return 1
    form = forms[form_id]
    print(f'# {form["id"]}  ({form["category"]})')
    print(f'TITLE: {form["title"]}')
    for index, section in enumerate(form['sections']):
        print(f'\n## {section["roman"]}. {section["name"]}')
        for item in section['items']:
            print(f'{index}.{item["no"]}: {item["text"]}')
    return 0


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    command = sys.argv[1]
    if command == 'status':
        return cmd_status()
    if command == 'todo':
        return cmd_todo()
    if command == 'check':
        return cmd_check()
    if command == 'merge':
        return cmd_merge()
    if command == 'dump':
        return cmd_dump(sys.argv[2] if len(sys.argv) > 2 else '')
    print(f'Unknown command: {command}', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
