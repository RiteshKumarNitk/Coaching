# Architecture

## 1. System shape

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│  Student PWA (Android/web)   │        │  Admin & teacher web app     │
│  React 18 + Vite, JS         │        │  Same bundle, role routing   │
└───────────────┬──────────────┘        └───────────────┬──────────────┘
                │  fetch, credentials: include          │
                │  HttpOnly session cookie              │
                ▼                                       ▼
        ┌─────────────────────────────────────────────────────┐
        │  Express REST API (Node.js 20+, JavaScript)         │
        │  security headers · origin check · rate limit       │
        │  session auth · RBAC · zod validation · audit log   │
        └──────────────────────────┬──────────────────────────┘
                                   │ pg Pool (TLS, pooled URL)
                                   ▼
        ┌─────────────────────────────────────────────────────┐
        │  PostgreSQL (Neon Free in production)               │
        │  34 tables · FKs · unique + check constraints       │
        │  indexes · transactions · migrations                │
        └─────────────────────────────────────────────────────┘
```

External content is referenced, not stored: lecture videos are YouTube unlisted IDs and
study material are Google Drive share links. Neon stores metadata only.

## 2. Runtime decisions

| Concern | Decision | Why |
| --- | --- | --- |
| API runtime | A single Node.js process running Express | Works locally and on any free Node host; full control of middleware |
| Neon Functions | **Not used for Phase 1** | Neon Functions execute Web-standard `fetch(request) → Response` handlers, not Express/`req,res`. Porting would require Hono or an adapter and is deferred until deployment (Phase 7) |
| Local database | Embedded PGlite (WASM PostgreSQL) | Zero install, zero cost, same SQL and migrations as Neon |
| Production database | Neon PostgreSQL via pooled connection string | Permanent free plan, no card, scale-to-zero |
| Auth | Self-hosted sessions in PostgreSQL | No vendor lock-in, no MAU pricing, works with the free DB; Neon Managed Better Auth is documented as an alternative |
| Frontend hosting | Express serves the Vite build (single origin) | Simplest secure cookie setup; static-host split is documented but not required |

Keeping the browser on one origin means `SameSite=Lax` cookies, no CORS credentials
dance, and no token in `localStorage`.

## 3. Request lifecycle

1. **Security headers** and CORS allow-list (`APP_ORIGIN`, loopback dev origins).
2. **JSON parsing** with a 256 kB limit.
3. **Origin check** for `POST/PUT/PATCH/DELETE /api/*` (CSRF defence).
4. **Session resolution**: read `cp_session`, hash it (SHA-256), load the session, user
   and aggregated roles in one query. Sessions are rejected if revoked, expired or the
   account is not active.
5. **Rate limiting** (global 600/min/IP; login 30/15 min/IP).
6. **Route middleware**: `requireAuth` → `requireRole` / `requirePermission`.
7. **Validation**: zod schemas from `@coaching/shared` replace `req.body`.
8. **Controller → service → SQL** with bound parameters inside one connection.
9. **Errors** funnel to one handler that maps `AppError`, zod and PostgreSQL codes
   (`23505` → 409, `23503` → 409, `22P02` → 400) and never leaks internals on 5xx.
10. **Audit** writes for authentication and administrative events (best-effort; never
    breaks the business operation).

## 4. Authorization

Two layers:

- **Role permissions** declared once in `packages/shared/src/constants/index.js`
  (`ROLE_PERMISSIONS`). The API enforces them; the web app only uses roles to choose a
  layout. Hiding a button is never treated as authorization.
- **Row ownership** in SQL. Every student query filters by `req.user.id`
  (`student_profiles.user_id = $1`), never by a client-supplied id. Teacher queries join
  `batch_teachers` so only assigned batches are visible. Guardian queries require a
  `guardian_profiles` row with `user_id = req.user.id` and the requested `student_id`, and
  answer 404 otherwise (they do not reveal whether the child exists). This pattern is what
  Phase 2 CRUD routes must follow.

| Capability | super_admin | admin | teacher | student |
| --- | --- | --- | --- | --- |
| Admin dashboard | ✅ | ✅ | — | — |
| Manage admins/settings/audit | ✅ | — | — | — |
| Students, courses, batches, fees | ✅ | ✅ | — | — |
| Own batch content, attendance, exams | ✅ | ✅ | ✅ | — |
| Attempt exams, own records | — | — | — | ✅ |
| Child's attendance, fees, published results (read-only) | — | — | — | guardian |

## 5. Session and password handling

- `scrypt` (N=16384, r=8, p=1, 64-byte key, random 16-byte salt), encoded as
  `scrypt$N$r$p$salt$hash`, compared with `timingSafeEqual`.
- Login failures are counted per account; 8 failures lock the account for 15 minutes.
  Unknown accounts still run a full scrypt verification against a dummy hash.
- 256-bit random session token, base64url. Stored is only `sha256(token)`.
- Logout revokes the session row. Password change revokes every other session.
- A wrong password returns the same message for unknown and known accounts.

## 6. PWA and offline behaviour

- `manifest.webmanifest` with 192/512/maskable icons and standalone display.
- Service worker: network-first navigations with cached app shell fallback; static
  assets stale-while-revalidate; `/api/*` is **never** cached (per-student data).
- `offline.html` fallback page; safe-area insets for Android/iOS.
- Registration only in production builds so dev never serves a stale shell.

This is an installable web app, **not** a Play Store native app. Capacitor can wrap the
same `apps/web` build later without a second frontend.

## 7. Performance plan (5,000+ students)

Implemented now:

- Pooled connections (`max: 10` per instance, Neon pooler supports up to 10,000 pooled
  connections per compute).
- Dashboard aggregates computed in SQL (single round trip per panel).
- Indexes on every FK used in filters, on `lower(email)`, `lower(enrollment_no)`, dates,
  and partial indexes for unread notifications and active sessions.
- PWA asset caching, code-split vendor/data chunks, gzip.
- TanStack Query caching with `staleTime: 60s` and no window-focus refetch.

Required in later phases (not yet implemented): every list route must paginate
(`pageSize ≤ 100`, default 20), use server-side search, and never `SELECT *` across all
students. Exam autosave must upsert per question with attempt ownership checks.

## 8. Known limitations (current)

- No password-reset email flow: sending email requires an external provider. Offices
  reset passwords through the admin screens or CLI; reset tokens are intentionally absent
  rather than half-built.
- In-memory rate limiting is per process. A multi-instance deployment needs a shared
  counter (or a single instance).
- No refresh-token rotation; sessions are fixed 7-day opaque tokens with revocation.
- File uploads are link-based (Drive), so no object storage is required.
- Instalments are a schedule attached to one invoice (`fee_installments`): payments post
  against the invoice and pay the schedule down in order, so a part-payment cannot be
  attributed to a specific instalment.
- Notifications are in-app only (bell). No email/SMS/push delivery, so fee reminders are
  copied from the Reminders tab and sent by the office through its own channel.
- Reports are summary tables plus CSV; there is no scheduled report delivery.
- Load capacity is **not** measured beyond the mixed-request benchmark in
  `docs/DEPLOYMENT.md`. Registered students ≠ concurrent users.

## 9. Adding a Phase 2 module (conventions)

1. Add/extend a migration in `database/migrations/` (never edit an applied migration).
2. Add zod schemas to `packages/shared/src/validators/index.js`.
3. Add `services/<domain>.service.js` with SQL and ownership filters.
4. Add a controller + router; wrap every async handler in `asyncHandler`.
5. Enforce `requireAuth` + `requirePermission` on the router, not in the component.
6. Add a `page`/`pageSize` query with server-side search; return `{ items, page, pageSize, total }`.
7. Add an API integration test for the authorization boundary (403 for the wrong role).
