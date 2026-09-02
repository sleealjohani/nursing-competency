# Nursing Competency Exam

A website for the Alhadithah General Hospital Nursing Service Department.
A nurse registers their details, sits a competency as an on-screen test —
one item at a time, answered with a single click — and submits it. The
administrator sees every submitted competency in one list, adds the
evaluator's name, comments and dates, and prints the records as the
hospital's competency forms, ready for signature.

The 46 competency PDFs in this repository are the source of truth for the
exam content. Nothing is typed twice: `tools/extract_competencies.py`
reads them into `data/competencies.json`, and the site renders both the
exam and the printed form from that file.

## Does it need a database?

Yes — and it has one. A submitted competency is a staff record that must
outlive the browser that created it: the admin has to find it weeks later,
add the evaluator's signature details, and print it. That cannot live in
the page.

The database is **SQLite**, in a single file at `data/competency.db`,
using Node's built-in `node:sqlite`. There is no database server to
install, no cloud account, and no npm packages at all — copy the folder,
run `node server.js`, and it works. Backing up the records is copying one
file; see [Backups](#backups).

## Requirements

- **Node.js 22.5 or newer** — nothing else. Check with `node -v`.
- Python 3 with `pypdf` only if you need to re-read the PDFs
  (`pip install pypdf`), which is not needed for day-to-day use.

## Running it

```bash
git clone <this repository>
cd nursing-competency

# Set the admin password on first run (do not leave it as the default).
ADMIN_PASSWORD='choose-a-strong-password' node server.js
```

Then open:

| Page | Address | Who |
| --- | --- | --- |
| Competency exam | `http://<server>:3000/` | Nurses |
| Admin records | `http://<server>:3000/admin` | Nursing administration |

For other machines on the hospital network to reach it, use the server's
address rather than `localhost`, e.g. `http://192.168.1.20:3000/`.

Settings, all optional:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | Interface to bind |
| `ADMIN_PASSWORD` | `admin` on first run | Admin password |
| `DB_FILE` | `data/competency.db` | Where records are stored |

To change the password later, either use **Change password** in the admin
header, or stop the server and run:

```bash
node server.js --set-password 'a-new-password'
```

## How a nurse uses it

1. Opens the site and enters their **job number, name, job title, unit and
   contract date**. Returning staff only type their job number — the rest
   fills in.
2. Picks a competency. All 46 are listed, grouped as Mandatory, Specific
   and General, with a search box. Competencies already submitted show
   their previous result.
3. Sits the exam. One competency item fills the screen at a time with
   **M (Met) / NM (Not Met) / NA (Not Applicable)** as big buttons — one
   click answers it and moves straight to the next, so a whole form is a
   run of single clicks. Keys `1` `2` `3` do the same, and `←` `→` move
   between items.
4. Reviews every answer on one page, changes any of them, and submits.
5. Sees the result immediately: raw score, total score, % rating, and Met
   or Not Met.

An unfinished exam is kept in the browser, so closing the tab by accident
does not lose the sitting. The form cannot be submitted until every item
is answered.

## How the administrator uses it

Sign in at `/admin` to get every submitted competency in one table: nurse
name, job number, unit, competency, score, % rating, result, and the exam
date.

- **Filter** by name or job number, competency, category, result, sign-off
  state and exam date range.
- **Details** opens the foot of the paper form for that record — the
  evaluator's name and job number, evaluated date, comments, staff nurse
  comments, needs-remedial and remedial date, conformed date — and marks
  it signed off.
- **Print selected forms** (or **Print all shown**) opens the chosen
  records as the hospital's competency form, one per sheet, with the
  nurse's answers ticked in the M / NM / NA columns and the scores and
  dates filled in. Print the page, or save it as PDF, and the papers are
  ready for signature.
- **Export CSV** gives the same list as a spreadsheet.

## How a competency is scored

Straight from the forms:

```
Raw Score   = number of items rated Met
Total Score = number of items, less those rated NA
              ("NA entries to be deducted from the total score")
% Rating    = Raw Score / Total Score x 100

Met     = 90% - 100%
Not Met = 89% and below, and remedial once
```

Two points worth confirming with the department:

- **`equipment-checklist.pdf`** is not an M/NM/NA form. It rates 18 pieces
  of equipment as **VT** (vendor training), **RD** (repeat demonstration
  with little supervision) or **UEC** (uses the equipment independently),
  with NA for equipment not in the area. The source form gives no point
  values, so the site treats **UEC as the competent level** (scoring 1)
  and VT and RD as not yet competent (scoring 0), with NA deducted as
  usual. If the hospital scores it differently, change `MET_RATING` in
  `lib/scoring.js`.
- **`ambulance-transport-variant-2.pdf`** is an orphan continuation page
  in the source scan: it carries only SKILLS and ATTITUDE, and its
  KNOWLEDGE page is missing. It is published as its own competency, and
  the note printed on the form says so. If it is really the same
  competency as `ambulance-transport.pdf`, delete the PDF and re-run the
  extraction.

## Re-reading the PDFs

Only needed if a competency form changes.

```bash
pip install pypdf
python3 tools/extract_competencies.py     # rewrites data/competencies.json
npm test
```

The extractor checks each form as it goes and reports any whose title,
sections or item numbering did not come out cleanly.

## Tests

```bash
npm test
```

Boots the server against a throwaway database and walks the whole journey:
every form loads with unique items, registration, rejected and accepted
submissions, the NA deduction, the 90% pass mark, the equipment scale,
admin authentication, filters, evaluator details, the print payload, CSV
export, deletion, and that static files cannot escape `public/`.

## Backups

Every record is in `data/competency.db`. To back it up, stop the server
and copy that file (with `-wal` and `-shm` alongside it if present):

```bash
cp data/competency.db* /path/to/backup/
```

Restore by copying it back. Keep backups somewhere access-controlled — the
file holds staff names, job numbers and assessment results.

## Before putting it in front of staff

- Set `ADMIN_PASSWORD`. The default is `admin` and the server warns about
  it on startup.
- Put it behind HTTPS (a reverse proxy such as nginx or Caddy) if it is
  reachable beyond the hospital's internal network. The admin session
  cookie is `HttpOnly` and `SameSite=Strict`, but the password itself
  travels in the clear over plain HTTP.
- Keep the server running across reboots with a service manager
  (`systemd`, `pm2`, or Windows Task Scheduler).

## Layout

```
server.js                       HTTP server, API, static files (no dependencies)
lib/db.js                       SQLite schema and queries
lib/scoring.js                  Raw / total / % rating and the 90% pass mark
data/competencies.json          The 46 forms, extracted from the PDFs
data/competency.db              The records (created on first run, not in git)
public/index.html               Nurse: register and choose a competency
public/exam.html                Nurse: the one-click exam
public/admin.html               Admin: records, evaluator details, printing
public/print.html               The printable competency forms
tools/extract_competencies.py   PDF -> data/competencies.json
test/smoke.js                   End-to-end test
*.pdf                           The original competency forms (source of truth)
```
