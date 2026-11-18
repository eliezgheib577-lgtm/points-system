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
rubric's ceiling holds, and that a refused approval writes nothing at all.

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

`public/app.css` is generated from the prototype by
`python3 mockups/build-artifact.py`'s sibling extraction step — keep the two in
step, or the prototype stops predicting the real thing.

## Status

Built and working:

- credential sign-in with forced password change, sessions, CSRF, role gates
- LO flow: event details → volunteers and points → pre-flight checks → send
- validation: rubric bands, one-per-event category limits, duplicate volunteers,
  the same member credited twice for one date, future dates, missing fields
- VPA flow: queue oldest-first, row-by-row review with reasons, approve, return
- append-only ledger, points sheet by entry / member / committee, audit log
- read-only member view

Not built yet:

- Excel sync to OneDrive/SharePoint via Microsoft Graph
- the one-time import of the existing workbook
- attachments (proof of activity)
- account management screens for the VPA
- rubric editing in the app (seeded, and read-only for now)

## Deployment notes

The Excel sync wants a long-lived process — token refresh, a retry queue, an
hourly safety sync — so a small always-on Node host (Fly.io, Railway, Render)
suits it better than serverless. Postgres can be any managed instance; Neon and
Supabase both have free tiers that comfortably fit a few thousand ledger rows a
year.

Set `SESSION_SECRET` to something random (`openssl rand -hex 32`) and run behind
HTTPS: session cookies are marked `secure` when `NODE_ENV=production`.
