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
   DATABASE_URL=postgresql://…-pooler…?sslmode=require
   COOKIE_SECURE=true
   SESSION_TTL_DAYS=7
   ```
4. **Migrate** with a one-off job: `pnpm db:migrate`. Do **not** run the dev seed against
   the production branch.
5. **Create the real super admin**:
   `pnpm create-admin -- --email owner@… --name "Owner"` — the script prints a one-time
   password; sign in and change it.
6. **Build and start**:
   ```bash
   pnpm install --frozen-lockfile
   pnpm build
   NODE_ENV=production pnpm --filter @coaching/api start
   ```
   The API serves `apps/web/dist`, including the manifest and service worker.
7. **Verify** `GET /api/health` → `{"status":"ok"}`, then sign in with each role and
   confirm `/api/student/dashboard` returns 403 for an admin session.
8. **HTTPS is mandatory** in production: the session cookie is `Secure`, and service
   workers only register on secure origins.

## 3. Security checklist for go-live

- [ ] `DATABASE_URL` present only in the server environment.
- [ ] `APP_ORIGIN` set to the exact public origin (no trailing slash) — CSRF checks use it.
- [ ] `COOKIE_SECURE=true` and HTTPS terminated correctly (`TRUST_PROXY=true` if behind a
      reverse proxy, so `req.ip` is the client).
- [ ] Dev seed accounts deleted or passwords rotated.
- [ ] Neon manual snapshot taken before the first migration.
- [ ] `pnpm test` and `pnpm lint` pass on the deployment commit.
- [ ] Neon usage alerts configured (compute/egress) to avoid a surprise suspension.
- [ ] Audit logs reviewed after the first week.

## 4. Performance and capacity — honest position

Implemented: SQL aggregates, indexes, connection pooling, pagination primitives, PWA
asset caching, vendor chunk splitting.

**Not measured:** no load test has been run, because that requires a provisioned Neon
branch and a load generator. Registered students (5,000) is not a capacity number.

Load-test plan (k6 or autocannon), to be executed in Phase 7:

| Scenario | Shape | What to watch |
| --- | --- | --- |
| 100 concurrent users | 10 rps for 5 min, 70% dashboard GETs | p95 < 500 ms, no 5xx |
| 500 concurrent users | 50 rps for 5 min, mix of dashboards + login | p95 < 1 s, connection pool saturation |
| 1,000 concurrent users | 100 rps for 5 min, plus 200 simultaneous exam autosaves | Neon CU autoscaling, pool waits, error rate |

Expected bottlenecks and mitigations:

- **Neon Free compute** (0.25–2 CU) autoscales; a burst of 1,000 concurrent users will
  queue. Cache dashboards briefly, keep queries indexed, and avoid per-request writes.
- **Single API process** — add instances behind the host's proxy; sessions already live
  in Postgres, so horizontal scaling works. Rate limiting then needs a shared store.
- **Exam autosave** should upsert one row per answer with an attempt-ownership predicate;
  never load the whole paper on each save.
- **Egress (5 GB/month)** — JSON dashboards are small, but avoid returning full tables.

Report real numbers after testing; do not infer capacity from user counts.

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

A PWA is installable but is **not** a Play Store application. A Capacitor shell can reuse
this exact build later.
