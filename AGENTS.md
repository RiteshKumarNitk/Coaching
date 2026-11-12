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

Other seeded students (same password): `diya.patel@student.local`,
`kabir.singh@student.local`, `ananya.rao@student.local`, `rohan.mehta@student.local`,
`ishita.nair@student.local`, `vivaan.gupta@student.local`, `saanvi.joshi@student.local`.
Other teachers: `rahul.verma@coaching.local`, `farah.khan@coaching.local`.

Expected authorization behaviour: student and teacher sessions must get **403** on
`/api/admin/*`; admin sessions must get **403** on `/api/student/*`.

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
pnpm create-admin -- --email you@example.com --name "Your Name"
pnpm check:db
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
- Phases 5–7: examinations, fees, deployment.

Before any real deployment: truncate all demo rows, rotate the Neon role password (it was
shared in chat), and create the real super admin.
