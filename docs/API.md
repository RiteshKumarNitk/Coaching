# REST API

Base URL: `/api` (same origin as the web app). All responses are JSON.
Authentication uses the `cp_session` HttpOnly cookie — there is no bearer token.

## Conventions

- **Errors** use one shape:
  ```json
  { "error": { "code": "forbidden", "message": "…", "details": [{ "field": "email", "message": "…" }], "requestId": "…" } }
  ```
  `details` appears only for validation failures. 5xx messages are generic; the
  `requestId` correlates with structured server logs.
- **Status codes**: 400 validation, 401 unauthenticated, 403 wrong role/foreign origin,
  404 unknown route, 409 conflict/duplicate, 423 locked account, 429 rate limited,
  500 unexpected, 503 database unreachable.
- **Caching**: authenticated GETs send `Cache-Control: no-store`.
- **Rate limits**: 600 requests/min/IP overall; 10 login attempts/15 min/IP. Counters are
  in-memory (per API process).
- **CSRF**: `POST/PUT/PATCH/DELETE /api/*` requests that carry an `Origin` or `Referer`
  must match the app origin (or a loopback dev origin). Server-to-server calls without
  those headers pass; browsers always send them.

## Endpoints implemented in Phase 1

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | public | Liveness + database probe |
| POST | `/api/auth/login` | public | Create a session |
| POST | `/api/auth/logout` | any | Revoke the current session |
| GET | `/api/auth/me` | authenticated | Current user, roles, permissions |
| POST | `/api/auth/change-password` | authenticated | Change password, revoke other sessions |
| GET | `/api/me` | authenticated | Role-specific profile record |
| GET | `/api/admin/dashboard` | super_admin, admin | Institute metrics + trends |
| GET | `/api/teacher/dashboard` | teacher (also admin) | Batch-scoped teaching data |
| GET | `/api/student/dashboard` | student | Own schedule, fees, results, notices |

### POST /api/auth/login

```json
{ "email": "student@example.com", "password": "Secret123" }
```

`200` sets the session cookie and returns the user (token is never echoed):

```json
{
  "user": {
    "id": "…",
    "email": "student@example.com",
    "fullName": "Aarav Sharma",
    "roles": ["student"],
    "permissions": ["exams:attempt", "self:read"]
  }
}
```

Failure modes: `401` invalid credentials, `403` inactive account or no role,
`423` locked after repeated failures, `429` rate limited.

### POST /api/auth/change-password

```json
{ "currentPassword": "OldPass123", "newPassword": "NewPass456" }
```

`200 { "ok": true }`. Every other session for the account is revoked.

### GET /api/admin/dashboard

```json
{
  "metrics": {
    "totalStudents": 8, "activeStudents": 8,
    "totalTeachers": 3, "activeTeachers": 3,
    "activeCourses": 2, "activeBatches": 2,
    "upcomingExams": 2, "announcements": 2,
    "attendanceToday": { "present": 8, "marked": 8, "percentage": 100 },
    "pendingFees": { "amount": 225000, "students": 6 }
  },
  "recentAdmissions": [],
  "admissionsTrend": [{ "label": "Jun", "count": 2 }],
  "attendanceTrend": [{ "date": "2026-11-12", "present": 8, "total": 8, "percentage": 100 }],
  "upcomingExams": [],
  "announcements": []
}
```

### GET /api/teacher/dashboard

```json
{
  "metrics": { "batches": 2, "students": 8, "todayClasses": 2, "upcomingExams": 2 },
  "batches": [{ "id": "…", "name": "JEE 2027 — Morning A", "code": "JEE-27-A", "course_name": "JEE Main + Advanced 2027", "student_count": 5 }],
  "todaySchedule": [],
  "upcomingExams": [],
  "recentSubmissions": []
}
```

Scope is enforced in SQL: only batches present in `batch_teachers` for the session user.

### GET /api/student/dashboard

```json
{
  "student": { "fullName": "Aarav Sharma", "enrollmentNo": "ENR-2026-001", "admissionDate": "…" },
  "enrollment": { "course_name": "…", "batch_name": "…", "start_date": "…", "end_date": "…" },
  "todaySchedule": [],
  "announcements": [],
  "upcomingExams": [],
  "recentResults": [],
  "attendance": { "total": 18, "present": 17, "absent": 1, "percentage": 94, "thisMonth": { "total": 8, "present": 8, "percentage": 100 } },
  "fees": { "total": 45000, "paid": 15000, "pending": 30000, "openInvoices": 1, "status": "partial" },
  "unreadNotifications": 2
}
```

The student id is always taken from the session. Passing another student's id is not
possible: the endpoint accepts no id parameter.

## Request examples

```bash
# sign in and keep the cookie
curl -c cookies.txt -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@coaching.local","password":"..."}'

# read the dashboard with that session
curl -b cookies.txt http://localhost:4000/api/admin/dashboard

# wrong role -> 403
curl -b student-cookies.txt http://localhost:4000/api/admin/dashboard
```

## Validation

Schemas live in `packages/shared/src/validators/index.js` and are shared by the API and
the web forms, so client and server rules cannot drift:

- `loginSchema`, `changePasswordSchema` (min 8 chars, letter + number, must differ)
- `paginationSchema` (`page ≥ 1`, `pageSize ≤ 100`)
- `createUserSchema`, `createCourseSchema`, `createSubjectSchema`, `createBatchSchema`
- `studentImportRowSchema` (CSV import)

## Planned endpoints (Phases 2–6)

```
GET/POST/PATCH  /api/admin/students, /teachers, /courses, /subjects, /batches
POST            /api/admin/students/import          (CSV, dedupe by email/enrolment)
GET/POST        /api/admin/fees, /api/admin/payments (receipt numbers, dues)
GET/POST        /api/teacher/batches/:id/lessons, /materials, /attendance
POST            /api/exams/:id/attempts             (server-validated window + ownership)
PATCH           /api/attempts/:id/responses/:qid     (autosave, ownership checked)
POST            /api/attempts/:id/submit             (server-side scoring in a transaction)
POST            /api/exams/:id/publish-results
```

Non-negotiable rules for those routes:

1. Exam windows are checked against the database clock, never the client's timer.
2. Correct answers are never included in any student-facing response before publication.
3. Scoring happens on the server inside a transaction; submitted answers are immutable.
4. Every list endpoint paginates and filters on the server.
