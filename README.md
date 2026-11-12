# Coaching Institute Management Platform

A zero-monthly-cost coaching management system for a single institute: a mobile-first
student app (installable PWA), a teacher workspace and an administration dashboard,
backed by an Express REST API and PostgreSQL (Neon in production).

**Current status: Phase 1 (foundation) is implemented and verified.** Administration,
teacher content tools, the full student app and the examination engine are scheduled
in Phases 2–7 — see [Roadmap](#roadmap). Nothing in the UI is a mockup: every number
and list on the dashboards is read from PostgreSQL for the signed-in user.

---

## What works today

| Area | Status |
| --- | --- |
| pnpm monorepo (`apps/web`, `apps/api`, `packages/*`) | ✅ |
| PostgreSQL schema (34 tables, FKs, unique constraints, indexes, triggers) | ✅ |
| SQL migrations + idempotent runner | ✅ |
| Development seed (realistic institute data, dev only) | ✅ |
| Session authentication (scrypt hashes, HttpOnly cookies, DB-backed sessions) | ✅ |
| Role-based access control (super admin, admin, teacher, student) | ✅ |
| Server-side authorization on every protected route | ✅ |
| Admin dashboard with live metrics, attendance/admission charts, lists | ✅ |
| Teacher dashboard with batch-scoped data | ✅ |
| Student dashboard: schedule, attendance, fees, tests, results, notices | ✅ |
| Profile + password change (revokes other sessions) | ✅ |
| PWA: manifest, icons, service worker, offline page | ✅ |
| Admin/teacher/student CLI + CSV import/export scripts | ✅ |
| API integration tests (auth, RBAC, CSRF, dashboards) | ✅ |

Not built yet (planned): student/teacher CRUD screens, attendance marking UI, lecture
player, exam attempt engine, fee receipts, announcements composer. The backend already
has the tables and constraints for them.

---

## Quick start (no external services required)

```bash
pnpm install
pnpm db:migrate     # creates the schema
pnpm db:seed        # development data (prints the shared dev password)
pnpm dev            # API on :4000, web app on :5173
```

Open <http://localhost:5173>. The seed prints four accounts (super admin, admin,
teacher, student) and one generated password. If `SEED_ADMIN_PASSWORD` is set in
`.env`, that value is used instead.

> Local development uses an embedded **PGlite** database in `.local/pglite`, so no
> PostgreSQL server or Neon account is needed to run the project. Setting
> `DATABASE_URL` switches every command and the API to Neon automatically.

### Use Neon PostgreSQL

1. Create a free project at <https://neon.com> (no credit card required).
2. Copy the **pooled** connection string into `.env` as `DATABASE_URL`
   (see `.env.example`).
3. Run `pnpm db:migrate && pnpm create-admin -- --email you@example.com --name "Your Name"`.
4. `pnpm dev`.

Never commit `.env`. The browser never receives a database URL: it talks only to the
Express API over HTTPS, and only through the HttpOnly session cookie.

---

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Runs API + web dev servers together |
| `pnpm build` | Production build of the PWA (`apps/web/dist`) |
| `pnpm start` | Starts the API, which also serves the built PWA |
| `pnpm lint` | ESLint across the workspace |
| `pnpm test` | API integration tests (node:test) |
| `pnpm db:migrate` | Applies pending SQL migrations |
| `pnpm db:seed` | Development-only sample institute data |
| `pnpm check:db` | Connection, migration and row-count report |
| `pnpm create-admin -- --email … --name …` | Safely creates/promotes a super admin |
| `pnpm import-students -- students.csv` | Bulk student import with dedupe + credentials file |
| `pnpm export-database` | NDJSON logical backup (no password hashes) |
| `pnpm icons` | Regenerates the PWA icon set |

---

## Repository layout

```
apps/
  web/            React 18 + Vite PWA (JavaScript)
    public/       manifest, service worker, icons, offline page
    src/app       providers + role-based routes
    src/components, layouts, pages/{auth,admin,teacher,student}, styles
  api/            Express REST API
    src/config, controllers, middleware, routes, services, utils
    test/         integration tests (real Postgres via PGlite)
packages/
  shared/         roles, permissions, zod validators (used by API, web, scripts)
  auth/           scrypt password hashing + opaque session tokens
  db/             unified pg (Neon) / PGlite (local) adapter
database/
  migrations/     ordered .sql files
  seeds/          dev seed + sample CSV
scripts/          create-admin, import-students, export-database, icons
docs/             ARCHITECTURE, DATABASE, API, DEPLOYMENT
```

---

## Security model (summary)

- Passwords hashed with scrypt (`node:crypto`), never stored or logged in plain text.
- Sessions are random 256-bit tokens; only their SHA-256 hash is stored. Cookie is
  `HttpOnly`, `SameSite=Lax`, `Secure` in production, 7-day expiry.
- Roles are loaded from `user_roles` on every request — never from the request body,
  a header or a client-side store. A student id is always taken from the session.
- Zod validates every accepted payload; SQL uses bound parameters only.
- CSRF: origin/referer verification on state-changing API requests plus SameSite cookies.
- Login rate limiting (10 attempts / 15 min / IP) and per-account lockout after 8 failures.
- Security headers incl. CSP, `X-Frame-Options: DENY`, `nosniff`, HSTS in production.
- Audit trail for sign-in, sign-out, password changes, admin creation and imports.
- Answer keys live in `exam_answer_keys`, separate from question/option tables, so they
  cannot leak through a careless query. (Exam APIs arrive in Phase 5.)
- The service worker never caches `/api/*` responses.

Details and remaining risks: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Gemini / cost posture

Everything used here is free and open source: Node.js, pnpm, React, Vite, Express,
PostgreSQL, Neon Free. There is no paid service, no trial dependency and no payment
method requirement. Free-tier limits can still be exhausted — read
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) before promising "unlimited free hosting".

The app is **not** claimed to be free forever or unlimited: Neon's free compute can
suspend when the monthly CU-hour allowance is used up, and a single free API instance
is not sized for 1,000 concurrent exam takers.

---

## Roadmap

- **Phase 1 (done):** foundation, schema, auth, RBAC, layouts, dashboards, PWA shell.
- **Phase 2 (done):** admin management — students, teachers, courses, subjects, batches, enrolment, CSV.
- **Phase 3 (done):** teacher workspace — batches, lectures, materials, assignments, submission evaluation, attendance marking.
- **Phase 4 (done):** student app — courses, lecture player with progress, notes, assignments + submissions, attendance history, announcements.
- **Phase 5:** examinations — question bank, secure attempts, autosave, evaluation, results.
- **Phase 6:** fees — structures, receipts, dues reports, performance reports.
- **Phase 7:** hardening, load tests, deployment, Android install testing.
