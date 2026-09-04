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

Which database depends on where it runs, and the site picks automatically:

| Where it runs | Storage | Why |
| --- | --- | --- |
| **Vercel** (or any serverless host) | **Postgres** | Serverless functions have no disk that survives a request, so records must live in a managed database |
| **A hospital server or laptop** | **SQLite** file | One file, no database server, no npm packages at all |

Set a Postgres connection string (`POSTGRES_URL` or `DATABASE_URL`) and it
uses Postgres; leave it unset and it uses a SQLite file at
`var/competency.db`. Nothing else changes — same pages, same API, same
printed forms. The schema is created on first run either way.

## Deploying to Vercel

**1. Create the database.** In your Vercel project, open the **Storage**
tab → **Create Database**. Under *Marketplace Database Providers* choose
**Neon** (Serverless Postgres) and continue. Pick the same region as the
project so the site stays fast, and connect it to the project for all
environments. Vercel and Neon then set the connection variables
automatically — nothing to copy.

The site reads `POSTGRES_URL` or `DATABASE_URL`, preferring the **pooled**
endpoint: each serverless invocation opens its own connection, so a direct
one would exhaust the database's connection limit under load.

Any other Postgres works too (Supabase, Railway, a hospital-hosted
server): add its connection string as `DATABASE_URL` instead.

**2. Set the admin password.** In **Settings → Environment Variables**,
add:

| Name | Value |
| --- | --- |
| `ADMIN_PASSWORD` | a strong password of your choosing |

**Then redeploy.** Vercel only gives a variable to builds that run after it
was set, so adding it does not change the running site on its own:
Deployments → the latest one → ⋯ → **Redeploy**. Until that happens the
site keeps whatever password it already had — on a fresh install that is
the default `admin`, and the admin page says so in red once you sign in.

**3. Deploy.** Import the repository (**Add New… → Project**) and deploy.
There is no build step and no framework to pick — `vercel.json` already
describes everything. The first request creates the database tables.

That is all. `https://<your-project>.vercel.app/` is the nurse site and
`/admin` is the records page.

**Checking a deployment.** Open `/api/health`. A working site answers:

```json
{ "ok": true, "storage": "postgres", "connected": true, "forms": 46, "items": 792 }
```

If it answers `503` with `"storage": "none"`, step 1 was skipped — the
project has no database yet. The message names what to do, and both the
nurse and admin pages show it rather than failing silently.

Notes:

- `ADMIN_PASSWORD` is the source of truth once set: change it in Vercel
  and redeploy to change the password. The admin page hides its own
  **Change password** link while the variable is set, so the two cannot
  disagree.
- The exam content ships inside the deployment as `data/competencies.json`.
  If a competency form changes, re-run the extractor (below), commit, and
  Vercel redeploys.
- Vercel serves HTTPS, so the admin session cookie is marked `Secure`
  automatically.

## Running it on your own server

Use this to self-host on a hospital machine, or to work on the site
locally.

- **Node.js 22.5 or newer** — nothing else. Check with `node -v`.
- Python 3 with `pypdf` only if you need to re-read the PDFs
  (`pip install pypdf`), which is not needed for day-to-day use.

```bash
git clone <this repository>
cd nursing-competency
npm install                 # only needed if you will use Postgres

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
| `POSTGRES_URL` / `DATABASE_URL` | unset | Use Postgres instead of a SQLite file |
| `DB_FILE` | `var/competency.db` | Where the SQLite file lives |

To change the password later, either use **Change password** in the admin
header, or stop the server and run:

```bash
node server.js --set-password 'a-new-password'
```

## Language

The site opens in **Arabic**, laid out right-to-left, with a toggle in the
header to switch to English. The choice is remembered per browser.

What is translated is the site: buttons, labels, headings, messages, the
admin table, dates and the result wording.

**The questions are available in Arabic too.** Every one of the 792
competency items has an Arabic rendering, shown directly under the English
in the exam and under each item in the review list. A button in the exam
header hides or shows it.

What is **never replaced** is the wording taken from the competency PDFs.
The English item stays above the Arabic, in the reader's eye, because it is
the wording the nurse is assessed against and the wording that gets
printed. The same holds for the form titles, section names and the
M / NM / NA rating codes; in Arabic those are marked left-to-right so the
English reads correctly on a right-to-left page, with short Arabic glosses
beside the fixed vocabulary (`I. KNOWLEDGE — المعرفة`, `M — مستوفى`).

The Arabic lives in its own file, `data/competencies.ar.json`, keyed by
form id and by the same item keys the answers use. The extraction in
`data/competencies.json` is never touched — a test fails if a single
Arabic character appears in it. Nothing Arabic is stored in a submission
or printed on a form.

> **The Arabic renderings were produced by AI and have not been reviewed by
> a clinician.** They are a reading aid, and the English remains the
> assessed wording, but the Nursing Service Department should read them
> through before the site goes in front of staff. To correct one, edit its
> entry in `data/competencies.ar.json`; `python3 tools/translations.py check`
> confirms the file still lines up with the extraction.

**The printed form does not change with the language.** It is the
hospital's own document, so it is always reproduced left-to-right, in
English, with its own date format — printing from the Arabic interface
produces exactly the same paper as printing from the English one. This is
checked by the test suite.

Scores, percentages, job numbers and dates always use Latin digits, so a
record reads the same to everyone handling the paper afterwards.

To change interface wording, edit `public/js/i18n.js`; the two languages
are side by side and `npm test` fails if a key is missing from either. To
change a question's Arabic, edit `data/competencies.ar.json`.

```bash
python3 tools/translations.py status   # coverage, form by form
python3 tools/translations.py check    # keys line up with the extraction
python3 tools/translations.py dump ID  # a form's English items
```

## The training video

`tools/record-walkthrough.js` records a walkthrough for nurses by driving the
real site on a phone-sized screen: registration, choosing a competency,
answering with one tap per item, reviewing and submitting. Arabic captions
are drawn over the page and a ripple marks every tap. Nothing is mocked up.

```bash
node server.js &                      # port 3111, empty database
npm i --no-save playwright-core
node tools/record-walkthrough.js      # -> video/walkthrough.webm
ffmpeg -i video/walkthrough.webm -c:v libx264 -pix_fmt yuv420p \
       -preset slow -crf 23 -movflags +faststart video/nurse-guide-ar.mp4
```

Re-run it whenever the pages change, so the video never teaches a screen
that no longer exists. Record against a local instance, never production —
it registers a nurse and submits a competency, which would otherwise land in
the real records.

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
- **Print selected forms** (or **Print all shown**) reproduces the chosen
  records as the hospital's own competency form — the same letterhead and
  logos, field grid, bordered assessment table and pair of signature boxes
  as the source PDF — with the nurse's answers ticked into the
  M / NM / NA boxes and the scores and dates filled in. Print the page, or
  save it as PDF, and the papers are ready for signature.

  Pages are filled by measurement rather than left to the browser, so a
  long form breaks where the paper does: the letterhead and column headers
  repeat on every sheet and the signature boxes sit at the end. The two
  logos in `public/img/` were taken from the source PDFs themselves.
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
npm test                                   # SQLite and the Vercel code path
TEST_DATABASE_URL=postgres://... npm test  # also against real Postgres
```

`npm test` first checks the two languages — that every key exists in both
with matching placeholders, that no competency wording has leaked into the
translation file, and that the printed form stays fixed to the source
wording and direction — then walks the whole journey:

Walks the whole journey — every form loads with unique items,
registration, rejected and accepted submissions, the NA deduction, the 90%
pass mark, the equipment scale, admin authentication, filters, evaluator
details, the print payload, CSV export, deletion and the login lockout —
against every way the site can be deployed:

1. `server.js` on SQLite (self-hosted)
2. `api/[...path].js` on SQLite (the Vercel function's own code)
3. the same, with the URL shape a Vercel rewrite delivers
4. `server.js` on Postgres (the storage Vercel uses)
5. `api/[...path].js` on Postgres (the deployed combination)

Postgres is skipped unless `TEST_DATABASE_URL` is set, so `npm test` works
with no database to hand.

## Backups

The records hold staff names, job numbers and assessment results, so keep
backups somewhere access-controlled.

**On Vercel (Postgres).** Neon and Vercel Postgres keep automatic
point-in-time backups; check the retention on your plan. For a copy you
hold yourself:

```bash
pg_dump "$POSTGRES_URL" > competency-backup.sql
```

**Self-hosted (SQLite).** Stop the server and copy the file, with `-wal`
and `-shm` alongside it if present:

```bash
cp var/competency.db* /path/to/backup/
```

Restore either by loading the dump or copying the file back.

## Before putting it in front of staff

- Set `ADMIN_PASSWORD`. The default is `admin`, and the server says so on
  startup.
- On Vercel, HTTPS is already in place. If you self-host and the site is
  reachable beyond the hospital's internal network, put it behind HTTPS (a
  reverse proxy such as nginx or Caddy): the session cookie is `HttpOnly`
  and `SameSite=Strict`, but the password itself travels in the clear over
  plain HTTP.
- Self-hosting: keep the server running across reboots with a service
  manager (`systemd`, `pm2`, or Windows Task Scheduler).

## Layout

```
vercel.json                     Vercel routing, headers and function settings
api/[...path].js                Vercel entry point — all /api/* requests
server.js                       Self-hosted server: the same API plus static files

lib/api.js                      The API, shared by both entry points
lib/store.js                    Picks Postgres or SQLite from the environment
lib/store-postgres.js           Postgres schema and queries (Vercel)
lib/store-sqlite.js             SQLite schema and queries (self-hosted)
lib/scoring.js                  Raw / total / % rating and the 90% pass mark
lib/forms.js                    Loads the extracted competency forms

data/competencies.json          The 46 forms, extracted from the PDFs
data/competencies.ar.json       Arabic reading aid for the same items
var/competency.db               SQLite records (self-hosted only, not in git)

public/js/i18n.js               Arabic / English interface strings
public/index.html               Nurse: register and choose a competency
public/exam.html                Nurse: the one-click exam
public/admin.html               Admin: records, evaluator details, printing
public/print.html               The printable competency forms

tools/extract_competencies.py   PDF -> data/competencies.json
tools/translations.py           Manage and check the Arabic overlay
test/smoke.js                   End-to-end test across every deployment shape
test/suite.js                   The checks themselves
test/i18n.test.js               Checks both languages, and that the form's own
                                wording is never translated
test/vercel-shim.js             Runs the Vercel function locally for the tests
*.pdf                           The original competency forms (source of truth)
```
