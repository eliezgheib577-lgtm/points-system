# LeMSIC Points

Volunteering points tracking for LeMSIC. Local Officers submit the work their
members did, the VPA reviews it once and approves, and the points land in an
append-only ledger that feeds the Excel workbook.

Two rules shape everything here:

1. **The ledger is append-only.** A point is never edited or deleted. A mistake
   is fixed by writing a reversing entry, so a balance is always a sum over
   history and history never changes under anyone.
2. **Local Officers submit; only the VPA sees totals.** An LO can log an event
   and propose points, and can see whether a submission was approved. They
   cannot see point totals, member balances, rankings or the points sheet —
   their own included. That is enforced on every request, not by hiding links.

## Which build is which

There are three builds of the same platform. All three share one design and,
for the two browser builds, one app source (`artifact/app.template.html`).

| Build | Where it runs | Data and sign-in | Use it for |
|---|---|---|---|
| `docs/index.html` | GitHub Pages | Firebase: one login per position | **LeMSIC's real platform** — see [SETUP.md](SETUP.md) |
| `artifact/lemsic-points.html` | a claude.ai Artifact | the Artifact's database | testing and showing it to people |
| `src/` (Node + Postgres) | any server | Postgres, usernames issued in-app | an alternative if you ever host a server |

`python3 mockups/build-artifact.py` rebuilds the two browser builds and the
server stylesheet.

### Tests for the GitHub Pages build

```bash
npm run test:rules   # firestore.rules, case by case, on Google's Firestore emulator
npm run test:site    # the whole site on the Auth and Firestore emulators
```

Both start Google's emulators (Java required). `test:site` serves the Firebase
SDK from `node_modules/firebase`, the same build the page loads from Google.

## Running it locally

Needs Node 22+ and PostgreSQL 16+.

```bash
createdb lemsic_points
cp .env.example .env          # set DATABASE_URL and SESSION_SECRET
npm install
npm run migrate               # apply migrations/*.sql
npm run seed                  # demo committees, rubric, members and accounts
npm run dev                   # http://localhost:3000
```

`npm run seed` **truncates every table**, so never point it at a database
holding real points.

Demo accounts, all with the password printed by the seed script:

| Username | Role | Sees |
|---|---|---|
| `vpa` | VPA | everything |
| `lo.aub` | Local Officer, LC AUB | their committee's submissions, no figures |
| `lo.usj` | Local Officer, LC USJ | their committee's submissions, no figures |
| `member.lea` | Member | their own points only |

## Tests

```bash
createdb lemsic_points_test
psql lemsic_points_test -f migrations/001_init.sql
npm test
```

The suite covers the invariants rather than the screens: that the ledger
refuses updates and deletes, that a submission row is paid exactly once, that
approving twice is impossible, that a rejected row writes nothing, that the
rubric's ceiling holds, that a refused approval writes nothing at all, and how
one-time passwords and the sign-in limiter behave.

Two browser suites drive the real screens end to end. Start the server first,
then run them — each one reseeds the database:

```bash
npm run dev                 # in one terminal
npm run test:e2e            # in another
```

`tests/e2e/submissions.e2e.cjs` follows one event from the LO's first click to
the ledger; `tests/e2e/credentials.e2e.cjs` issues an account and walks it
through first sign-in, reset, switch-off and a brute-force attempt. They need
Playwright with Chromium installed. Sign-in limits live in the server's memory,
so restart the server if you run the suites several times inside fifteen
minutes.

## How it fits together

```
src/
  server.ts            Express wiring, 404 and error pages
  lib/db.ts            pg pool, query/one/tx helpers
  lib/html.ts          escaping-by-default template tag
  lib/text.ts          name normalising and fuzzy matching for member lookup
  auth/                password hashing, sessions, role gates, CSRF
  domain/core.ts       term, live rubric, audit log
  domain/submissions.ts  the rules: validation, send, approve, return
  routes/              lo.ts, vpa.ts, shared.ts, auth.ts
  views/               layout and small components
migrations/            plain SQL, applied in filename order
public/app.css         design system, extracted from mockups/prototype.html
```

`public/app.css` and `artifact/lemsic-points.html` are generated, not hand-edited:
`python3 mockups/build-artifact.py` rebuilds both from `mockups/prototype.html`'s CSS
(and the artifact's template). Change the design once and both builds follow.

## Status

Built and working:

- credential sign-in with forced password change, sessions, CSRF, role gates
- LO flow: event details → volunteers and points → pre-flight checks → send
- validation: rubric bands, one-per-event category limits, duplicate volunteers,
  the same member credited twice for one date, future dates, missing fields
- VPA flow: queue oldest-first, row-by-row review with reasons, approve, return
- append-only ledger, points sheet by entry / member / committee, audit log
- read-only member view
- accounts: the VPA issues LO, VPA and member accounts with a one-time password
  shown once; first sign-in forces a new one; resets and switch-offs end every
  session the account had; committees can be added and archived
- guard rails: you can't switch off your own account or the last one able to
  approve, and a committee with active officers can't be archived
- sign-in throttling: ten wrong passwords pauses a username for fifteen
  minutes, fifty from one address pauses that address

Not built yet:

- Excel sync to OneDrive/SharePoint via Microsoft Graph
- the one-time import of the existing workbook
- attachments (proof of activity)
- rubric editing in the app (seeded, and read-only for now)

## The published Artifact

`artifact/lemsic-points.html` is a second, self-contained build of the same
platform that runs inside a claude.ai Artifact — no server to host. It is built
from `artifact/app.template.html` with the design CSS inlined:

```bash
npm run build:artifact      # python3 mockups/build-artifact.py
npm run test:artifact       # demo mode + a three-person live run against a rule-enforcing mock
```

It runs in one of two modes, decided per visitor:

- **Live** — the artifact's shared database. The artifact's **owner is the VPA**.
  Local Officers are people invited by email as **Editors**; the first time they
  open the page they ask for a committee, and the VPA approves them on the Access
  screen.
- **Demo** — anyone else (a public link, a signed-out visitor, someone not yet
  invited) gets the full app running only in their own browser with example
  data, so they can try every screen. Nothing they do reaches anyone else.

Who may read and write what is declared in `artifact/db-rules.json` and enforced
by the platform: the ledger, the VPA's decisions and the audit log are readable
by the owner alone; each LO reads and writes only their own submissions; the
rubric, committees and member names are readable by everyone the page admits.
`artifact/live-seed.json` is the starting setup written into a fresh database
(term, committees, a placeholder rubric — no people).

Limits worth knowing, compared with the server build:

- On a personal Claude plan, an outside person can only save changes as an
  **Editor**, and only while sharing by public link is **off**. Turning the public
  link on drops invited LOs to view-only (they get the demo).
- Editors can publish new versions of the page, including looser rules. The rules
  keep LOs out of the numbers in normal use; they do not stop an Editor who sets
  out to rewrite the page. That would show in the artifact's version history.
- The ledger is append-only by the page's own code, not by the database — the
  owner could overwrite an entry with a direct write. The server build enforces
  this with a trigger.
- Only the artifact's owner can be the VPA. Handing the role to next year's VPA
  means transferring the artifact or republishing with different rules.
- The database holds up to 25,000 documents — around ten years of a few thousand
  ledger entries a year.

## Deployment notes

The Excel sync wants a long-lived process — token refresh, a retry queue, an
hourly safety sync — so a small always-on Node host (Fly.io, Railway, Render)
suits it better than serverless. Postgres can be any managed instance; Neon and
Supabase both have free tiers that comfortably fit a few thousand ledger rows a
year.

Set `SESSION_SECRET` to something random (`openssl rand -hex 32`) and run behind
HTTPS: session cookies are marked `secure` when `NODE_ENV=production`.

The sign-in limiter keeps its counts in memory. That is right for one server
process; run more than one and each keeps its own count, so move it to Postgres
or Redis first.

The very first VPA account has to come from somewhere, since only a VPA can
issue accounts. On a fresh production database, create it once by hand with a
bcrypt hash and `must_change_password = true`, then issue everything else from
the Accounts screen.
