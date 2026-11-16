# Project rules — Coaching Management Platform

## Test accounts (development database only)

These accounts exist in the development Neon database and are used for testing every
role. They share one password and **must be deleted before real use** (see
`docs/DEPLOYMENT.md` → cleanup SQL). Do not reuse these credentials anywhere else.

| Email | Role | Password |
| --- | --- | --- |
| `admin@coaching.local` | super_admin | `admin123` |
| `office@coaching.local` | admin | `admin123` |
| `meera.iyer@coaching.local` | teacher | `admin123` |
| `aarav.sharma@student.local` | student | `admin123` |
| `guardian.aarav@guardian.local` | guardian (read-only, linked to Aarav) | `admin123` |

Other seeded students (same password): `diya.patel@student.local`,
`kabir.singh@student.local`, `ananya.rao@student.local`, `rohan.mehta@student.local`,
`ishita.nair@student.local`, `vivaan.gupta@student.local`, `saanvi.joshi@student.local`.
Other teachers: `rahul.verma@coaching.local`, `farah.khan@coaching.local`.

Expected authorization behaviour: student, teacher and guardian sessions must get **403** on
`/api/admin/*`; admin sessions must get **403** on `/api/student/*` and `/api/guardian/*`;
a guardian gets **404** for a student they are not linked to.

## Non-negotiable constraints

- **pnpm only** — never npm/yarn for installs or scripts.
- **JavaScript, ES modules** — no TypeScript build step.
- **Zero recurring cost** — no paid services, no trials treated as permanent. Neon Free,
  YouTube unlisted links and Google Drive links only. Never add Cloudflare, Supabase,
  Firebase (as a backend), AWS/Azure or paid APIs.
- **No secrets in the frontend.** The browser talks only to `/api`; `DATABASE_URL` is
  server-side in `.env` (gitignored).
- **Never connect the browser to PostgreSQL.**
- **Authorization is server-side.** Hiding a button is not authorization. Roles come from
  the database session, never from the request body/header/localStorage. Student/teacher
  scoping is done in SQL (`student_id`/`batch_teachers`), never from a client id.
- **Answer keys stay private** (`exam_answer_keys`) until results are published.
- No mock data in production paths; sample data only through `database/seeds/dev-seed.js`.

## Architecture conventions

- Monorepo: `apps/web` (React+Vite PWA), `apps/api` (Express), `packages/shared`
  (roles, permissions, zod, CSV), `packages/auth` (scrypt/tokens), `packages/db`
  (pg ↔ PGlite adapter).
- **Wrap every async Express handler in `asyncHandler`** — Express 4 does not catch
  rejected promises.
- Validate payloads with zod schemas from `packages/shared/src/validators`.
- Capitalise API responses as camelCase in admin services; raw SQL results stay snake_case.
- Lists always paginate server-side (`page`, `pageSize ≤ 100`, default 20) with
  `{ items, page, pageSize, total }`.
- Mutations write an `audit_logs` row through `audit.record(...)`.
- New schema changes = new numbered file in `database/migrations/`; never edit an applied
  migration.
- After changing code: `pnpm lint`, `pnpm test`, `pnpm build`.

## Commands

```bash
pnpm install
pnpm db:migrate
pnpm db:seed          # development only
pnpm dev              # API :4000 + web :5173
pnpm lint && pnpm test && pnpm build
pnpm build && pnpm smoke:ui   # dependency-free headless browser smoke test
pnpm create-admin -- --email you@example.com --name "Your Name"
pnpm check:db
pnpm check:env        # production readiness: env, HTTPS origin, cookies, build artifacts
pnpm load:test -- --base http://localhost:4001 --email you@example.com --password ... --concurrency 10 --duration 15
```

## Status

- Phase 1: complete (schema, auth, RBAC, dashboards, PWA shell).
- Phase 2: complete — admin login/user management is not built yet, but students, teachers, courses,
  subjects, batches and enrolment are managed end-to-end from `/admin` (UI + API + tests).
- Phase 3: complete — teachers get `/teacher/batches`, batch workspace, attendance marking,
  lectures (YouTube ids), study material (Drive links) and assignments with submission evaluation
  (UI + API + tests). Batch access is limited to `batch_teachers` assignments.
- Phase 4: complete — students get `/student/courses`, `/student/lectures` (+ player with progress),
  `/student/materials`, `/student/assignments` (with submission + evaluation view), `/student/attendance`
  and `/student/announcements` (UI + API + tests). Everything is scoped to active enrolments and
  published content only.
- Phase 5: complete — `/admin/exams` (+ `/teacher/exams`) manage exams, questions with private
  answer keys, attempts review, subjective evaluation and result publishing; students take timed
  attempts at `/student/exams` and `/student/attempts/:id` with autosave. MCQ answers are graded on
  submit, negative marking is applied at score level, and results stay hidden until published.
- Phase 6: complete — `/admin/fees` handles structures, dues, fee assignment and offline payments
  (receipt numbers, overpayment rejected); students see their ledger at `/student/fees`.
- Phase 7: in progress — hardening middleware (CSP/HSTS/CSRF origin check, rate limits,
  body caps, graceful shutdown) is in place, `pnpm check:env` gates go-live configuration and
  `pnpm load:test` is a dependency-free load harness with results recorded in
  `docs/DEPLOYMENT.md` §4 (dashboard and both list endpoints batched into one round trip
each: mixed p95 685 ms → 220 ms at 10 concurrent), plus a verified local single-origin
  production smoke. Remaining: hosted deployment (needs a host + production Neon creds +
  domain) and on-device Android install testing.
- Phase 8: complete — exam integrity: publishing requires at least one question, exams with
  attempts cannot be deleted, expired attempts are swept and graded on the next read,
  zero-mark exams report `pending`, results keep the best attempt and re-evaluation after
  publication clears the published flags, and question edits are validated on the merged row.
- Phase 9: complete — fee corrections: void a receipt with a reason (stays on record, stops
  counting), waive a fee, adjust discount/due date above what was collected, printable
  receipt copy and an overdue-reminders list with copyable messages. Payments lock the
  invoice row so concurrent clerks cannot overpay it. A fee structure with N instalments
  generates a dated schedule on the invoice (`fee_installments`); payments pay it down in
  order and students see the plan in `/student/fees`.
- Phase 10: complete — announcements composer (`/admin/notices`) with audience targeting
  (everyone/role/course/batch), teacher notices limited to their own batches
  (`/teacher/notices`), and an in-app notification bell (`/api/me/notifications`) fed by
  notices, fee assignment and result publication.
- Phase 12: complete — accounts created or reset with a temporary password must set
  their own before using the workspace (`must_change_password`, `password_change_required`,
  `/change-password`); student material search, admin-editable student email and
  production-only CORS are in place.
- Phase 11: complete — super-admin `/admin/team` staff accounts (create, role change,
  deactivate, password reset), `/admin/settings` institute details, `/admin/audit` audit-log
  viewer with search and action filter, and `/admin/reports` fee/attendance/exam summaries
  with CSV exports (`/reports/fees.csv`, `/reports/attendance.csv`).

- UI smoke test: `pnpm smoke:ui` drives a real headless Chrome/Edge over the DevTools
  protocol (no test dependencies) against a temporary PGlite database and the built SPA:
  student login → `/student`, student redirected away from `/admin`, sign-out, admin login
  → `/admin` dashboard. Skips cleanly when no Chromium-based browser is installed.
- Phase 13: complete — read-only guardian portal (`guardian` role, `/api/guardian/children`,
  attendance/fees/published-results scoped by `guardian_profiles.user_id` in SQL); the office
  creates a guardian login from the student page (`POST /admin/students/:id/guardian-access`),
  linked to that student's guardian contact row; link rows also allow several children per
  guardian, and the UI shows a child picker when there is more than one.

Before any real deployment: take a Neon snapshot, run `pnpm db:clean -- --yes` (truncates
all demo rows, keeps the schema), rotate the Neon role password (it was shared in chat),
and create the real super admin with `pnpm create-admin`.
