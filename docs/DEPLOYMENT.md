# Deployment and free-tier reality check

Everything below was checked against the providers' own documentation on **2026-11-12**.
Free plans change; re-verify before you promise a cost to the institute.

## 1. Verified infrastructure

### Neon PostgreSQL — Free plan (database)

| Item | Value (verified 2026-11-12) |
| --- | --- |
| Price | **$0/month**, permanent free plan, **no credit card required** |
| Projects | 100 (each project has its own quotas) |
| Branches per project | 10 |
| Compute | 100 CU-hours per project per month; autoscales 0.25–2 CU; scales to zero after 5 min idle |
| Storage | 1 GB Postgres per project, 20 GB total across all free projects |
| Public transfer | 5 GB per project per month |
| Backups | 6-hour instant restore (≤1 GB changes), 1 manual snapshot |
| Managed Better Auth | included, up to 60,000 MAU per project (AWS regions only) |
| Connection pooling | built-in pooler, up to 10,000 pooled connections per compute |
| Support | community |

**What happens at the limit:** running out of CU-hours or egress suspends the compute
until the next billing period; hitting storage limits blocks writes; hitting 10 branches
blocks branch creation. **No data is deleted**, and upgrading lifts a limit immediately.

**Can it be replaced?** Any PostgreSQL 15+ instance — self-hosted, or another free
Postgres provider. The schema is plain PostgreSQL; no Neon-specific feature is used.

Sources: <https://neon.com/faqs/free-plan-limits-and-quotas>,
<https://neon.com/docs/introduction/plans>, <https://neon.com/pricing>.

### Neon Functions — why the API is not hosted there yet

Neon Functions run **JavaScript/TypeScript on a Fetch-style handler**
(`export default { fetch(request) { return new Response(...) } }`), not an Express
`(req, res)` server. They are free-plan eligible (the plan tables list Functions on all
plans, with a free allowance of 1 million invocations per project per month) and cannot
host the website itself.

Our API is Express. Running it unchanged on Neon Functions is **not possible**; it would
need a Hono/Web-standard port or an adapter. Options for Phase 7:

1. Port the API to a `fetch` handler (Hono or hand-written router) and deploy it as a
   Neon Function in a supported region (AWS us-east-1/us-east-2/eu-central-1/ap-southeast-1).
2. Keep Express on a free Node host (Render/Fly/Koyeb free tiers exist but their terms
   and sleep behaviour must be verified first — not verified in this build).
3. Self-host on hardware the institute already owns, behind a `cloudflared`/tailscale
   tunnel is **not** allowed by the project's no-Cloudflare rule; use a direct port or a
   free tunnel alternative after verification.

This document does not claim any of these are a permanent free host.

### Frontend hosting

The API already serves the built PWA from `apps/web/dist`, so **one origin is enough**:
no separate static host and no cross-site cookie configuration.

If a static host is preferred:

- **Firebase Hosting Spark** is free but requires SPA rewrites to `index.html`; Firebase
  must not be used for auth or data. Verify current Spark quotas first.
- **GitHub Pages** is free for public repositories only and cannot rewrite arbitrary SPA
  routes, so deep links would 404. Not suitable as-is.

Splitting origins requires `VITE_API_URL`, `APP_ORIGIN`, and CORS + `SameSite=None;
Secure` cookies. That is a security downgrade compared with the same-origin setup, so it
is not the default.

### Everything else

| Component | Used for | Cost | Notes |
| --- | --- | --- | --- |
| Node.js 20+ | API runtime | free, open source | needs a host |
| pnpm | package manager | free | enforced in the repo |
| React, Vite, Express, zod | app stack | free, open source | no paid UI or chart libs |
| YouTube unlisted videos | lectures | free | link-accessible, **not** DRM; IDs only in the DB |
| Google Drive share links | notes/PDFs | free (15 GB account quota) | large files never go into Postgres |
| PWA | Android install | free | installable web app, not a Play Store build |
| Email / SMS / WhatsApp | password reset, notices | **not implemented** | in-app notifications only; free SMS/email is not assumed |

## 2. Deployment checklist

1. **Create the Neon project** in a region near the institute (Mumbai/Singapore are
   closest for India; Functions require one of the supported regions).
2. **Set the pooled connection string** as `DATABASE_URL` on the API host. Never put it
   in the browser bundle or in a `VITE_*` variable.
3. **Set environment variables** on the host:
   ```
   NODE_ENV=production
   PORT=<provided by host>
   APP_ORIGIN=https://your-domain
   DATABASE_URL=postgresql://…-pooler…
   DATABASE_SSL=verify-full
   COOKIE_SECURE=true
   TRUST_PROXY=true
   SESSION_TTL_DAYS=7
   ```
   `DATABASE_SSL` is resolved by the API, not by `pg`: the adapter strips `sslmode=`
   from `DATABASE_URL` and sets the TLS mode explicitly, which is why the boot log no
   longer carries the `pg-connection-string` sslmode warning. `verify-full` is the
   default for any non-local host and verifies the certificate chain *and* the
   hostname; `require`, `prefer`, `verify-ca` and `allow` are aliases for it (the same
   behaviour `pg-connection-string` v2 has today, pinned here so the v3 switch to
   weaker libpq semantics cannot change it); `no-verify` encrypts without verifying
   the certificate, and `disable` turns TLS off. See §2a for self-hosted Postgres.
4. **Migrate** with a one-off job: `pnpm db:migrate`. Do **not** run the dev seed against
   the production branch.
5. **Remove the demo data** (never run the dev seed against the production branch):
   ```bash
   pnpm db:clean -- --dry-run   # shows the tables and row counts
   pnpm db:clean -- --yes       # truncates every demo table
   ```
   Role definitions and the migration history are kept; everything else (users, courses,
   fees, exams, content, audit trail) is removed. Take the Neon snapshot first — this
   cannot be undone.
6. **Create the real super admin**:
   `pnpm create-admin -- --email owner@… --name "Owner"` — the script prints a one-time
   password; sign in and change it (the app forces a password change on first use).
7. **Build and start**:
   ```bash
   pnpm install --frozen-lockfile
   pnpm build
   NODE_ENV=production pnpm --filter @coaching/api start
   ```
   The API serves `apps/web/dist`, including the manifest and service worker.
8. **Verify** `GET /api/health` → `{"status":"ok"}`, then sign in with each role and
   confirm `/api/student/dashboard` returns 403 for an admin session.
9. **HTTPS is mandatory** in production: the session cookie is `Secure`, and service
   workers only register on secure origins.

### 2a. Self-hosted Postgres

The adapter defaults to `verify-full` because a remote database and the application
usually do not share a network. Two self-hosted shapes are supported:

- **Postgres on the same machine, no TLS.** Set `DATABASE_URL` to `127.0.0.1` (the
  adapter then defaults to `disable`) or set `DATABASE_SSL=disable` explicitly. Traffic
  never leaves the host, so TLS adds nothing; keep the port bound to loopback.
- **Self-hosted Postgres with TLS.** Set `DATABASE_SSL=verify-full` and, if the server
  uses a private CA, point `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/institute-ca.pem` at the
  CA bundle in the API's environment. Only fall back to `no-verify` (encrypted, no
  certificate check — vulnerable to a man-in-the-middle) when you cannot install the CA
  and cannot use a verified certificate.

An unsupported value fails at startup with the list of valid modes rather than
silently connecting without TLS.

## 3. Security checklist for go-live

- [ ] `DATABASE_URL` present only in the server environment.
- [ ] `APP_ORIGIN` set to the exact public origin (no trailing slash) — CSRF checks use it.
- [ ] `COOKIE_SECURE=true` and HTTPS terminated correctly (`TRUST_PROXY=true` if behind a
      reverse proxy, so `req.ip` is the client).
- [ ] `pnpm db:clean -- --yes` run (after the snapshot) so no demo account or sample
      fee/exam row survives go-live, and the real super admin created afterwards. It keeps
      `roles` and `schema_migrations`; verify a post-wipe `pnpm create-admin` succeeds.
- [ ] Neon manual snapshot taken before the first migration.
- [ ] `pnpm test` and `pnpm lint` pass on the deployment commit.
- [ ] `pnpm check:env` passes with the production environment loaded (it blocks on a
      missing `APP_ORIGIN`, non-HTTPS origin, insecure cookies and missing build files).
- [ ] Neon usage alerts configured (compute/egress) to avoid a surprise suspension.
- [ ] Audit logs reviewed after the first week.

## 4. Performance and capacity — honest position

Implemented: SQL aggregates, indexes, connection pooling, pagination primitives, PWA
asset caching, vendor chunk splitting.

**Measured 2026-11-13** with `pnpm load:test` (dependency-free harness, read-only admin
GETs). Laptop client → the Neon dev branch, one API process, default pool of 10.

Round trips per request used to be: admin dashboard 8 (eight pool connections), exam list
2, fee dues 3. Each now returns its whole result set as one `json_build_object` row. Same
machine, same data, back-to-back runs (old code on :4001, new code on :4002):

| Endpoint set | Concurrency | Before | After |
| --- | --- | --- | --- |
| `/api/admin/dashboard` only | 1 | 4.7 rps · p50 196 ms · p95 198 ms | 6.4 rps · p50 157 ms · p95 159 ms |
| `/api/admin/dashboard` only | 10 | 12.3 rps · p50 780 ms · p95 960 ms | 54.3 rps · p50 180 ms · p95 214 ms |
| dashboard + exams + dues | 10 | 20.7 rps · p50 452 ms · p95 685 ms | 55.3 rps · p50 159 ms · p95 220 ms |

No 5xx and no 429s in any run (the limiter was raised for the tests only). The mixed set
went 20.7 → 37.7 rps from the dashboard change alone, then 37.7 → 55.3 rps once the two
list endpoints were batched too.

What this says:

- Dropping the per-request query fan-out is a concurrency win: **4.4× throughput and 4.5×
  p95** on the dashboard at 10 concurrent users. At concurrency 1 the gain is only ~20%
  because the old eight queries already ran in parallel — the win is not needing eight
  pool connections per request.
- All three measured endpoints are now one round trip. What is left is database execution
  time and Neon round-trip latency per request (~150–180 ms here), not query count.
- The p95 < 500 ms target at 10 concurrent is met for all three. A 100-concurrent run is
  still untested; Neon Free compute and a single API process remain the ceiling.
- Batched responses are JSON aggregates, so timestamps are normalised to ISO in the exam
  mapper and `due_date` now arrives as a plain date (`2026-11-02`) instead of a UTC-shifted
timestamp — the frontend `formatDate` renders both the same.

Reproduce it:

```bash
cd apps/api && PORT=4001 API_RATE_LIMIT_MAX=100000 node src/server.js   # scratch instance
pnpm load:test -- --base http://localhost:4001 --email admin@coaching.local --password admin123 \
  --concurrency 10 --duration 15 --paths "/api/admin/dashboard,/api/admin/exams?page=1,/api/admin/fees/dues"
```

`API_RATE_LIMIT_MAX` (default 600 requests/minute per IP) has to be raised for a load
test, otherwise the limiter answers 429 long before the app is stressed. Keep it at the
default in production.

Still unmeasured: exam autosave under concurrent attempts (the harness only sends GETs),
login storms (the 10-per-15-minute login limiter is deliberately strict), and any
multi-instance shape.

Next steps: place the API in the same region as Neon (the remaining latency is per-request
round-trip time), then run the 100-concurrent profile before quoting a capacity number to
the institute.

### Local production-shape check (no host required)

```bash
pnpm build
NODE_ENV=production PORT=4003 APP_ORIGIN=http://localhost:4003 COOKIE_SECURE=false \
  node apps/api/src/server.js
```

Verified on 2026-11-16 against that instance: `/` and deep links (`/admin/reports`,
`/student/fees`) serve the SPA, hashed assets come back with
`Cache-Control: public, max-age=31536000`, the manifest/service worker/offline page are
served, CSP + nosniff + frame denial are set, HSTS appears because
`NODE_ENV=production`, login + `/api/admin/dashboard`, `/api/admin/reports/overview`,
`/api/admin/settings` and `/api/me/notifications/unread-count` work on one origin, both
cross-role checks (admin→student, student→admin) return 403, and a foreign `Origin` on
login returns 403. `COOKIE_SECURE=false` is only for this local HTTP check —
`pnpm check:env` rejects it for a real deployment.

## 5. PWA / Android testing

1. `pnpm build && NODE_ENV=production pnpm start`.
2. Open the site over HTTPS (or `localhost`, which is treated as secure) in Chrome on
   Android → menu → **Install app**.
3. Check the manifest in DevTools → Application: name, icons (including maskable),
   standalone display, theme colour.
4. Turn on airplane mode: the shell and the offline page load; `/api` calls fail with the
   app's network error state (expected).
5. Test on a small screen (360×640) and with the keyboard open — the login form and the
   bottom navigation must stay usable.

Verified on 2026-11-16 in desktop Chromium against the production build: manifest parses
(`Coaching Institute`, short name `Coaching`, `display: standalone`, `start_url: /`,
theme `#16204a`), all three icons decode at their declared sizes (192×192, 512×512 and a
512×512 maskable), the service worker is active and controlling `/` with caches
`coaching-shell-v1` / `coaching-assets-v1` holding `/`, `/index.html`, `/offline.html`,
the manifest, both icons and `/student`, and the student app at 360×640 has no horizontal
overflow with a 68 px six-item bottom navigation.

Not verified without a device: the install prompt itself, standalone launch, airplane-mode
behaviour after a real install, and the on-screen keyboard state.

A PWA is installable but is **not** a Play Store application. A Capacitor shell can reuse
this exact build later.
