/**
 * Shared domain constants. These values must stay in sync with the database
 * checks in database/migrations. They are the single source of truth for the
 * API authorization layer and the web routing layer.
 */

export const ROLES = Object.freeze({
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
  TEACHER: "teacher",
  STUDENT: "student"
});

export const ALL_ROLES = Object.freeze(Object.values(ROLES));

export const ROLE_LABELS = Object.freeze({
  [ROLES.SUPER_ADMIN]: "Super Admin",
  [ROLES.ADMIN]: "Administrator",
  [ROLES.TEACHER]: "Teacher",
  [ROLES.STUDENT]: "Student"
});

/** Landing route for each role after sign-in. */
export const ROLE_HOME = Object.freeze({
  [ROLES.SUPER_ADMIN]: "/admin",
  [ROLES.ADMIN]: "/admin",
  [ROLES.TEACHER]: "/teacher",
  [ROLES.STUDENT]: "/student"
});

/** Roles that may use the administration area. */
export const ADMIN_ROLES = Object.freeze([ROLES.SUPER_ADMIN, ROLES.ADMIN]);

/**
 * Permission catalogue. Phase 1 enforces the role -> permission mapping below
 * on the server; later phases add resource-level checks (batch ownership).
 */
export const PERMISSIONS = Object.freeze({
  USERS_READ: "users:read",
  USERS_WRITE: "users:write",
  ADMINS_MANAGE: "admins:manage",
  STUDENTS_READ: "students:read",
  STUDENTS_WRITE: "students:write",
  TEACHERS_READ: "teachers:read",
  TEACHERS_WRITE: "teachers:write",
  COURSES_MANAGE: "courses:manage",
  BATCHES_MANAGE: "batches:manage",
  FEES_READ: "fees:read",
  FEES_WRITE: "fees:write",
  EXAMS_MANAGE: "exams:manage",
  EXAMS_EVALUATE: "exams:evaluate",
  ATTENDANCE_WRITE: "attendance:write",
  CONTENT_WRITE: "content:write",
  ANNOUNCEMENTS_WRITE: "announcements:write",
  AUDIT_READ: "audit:read",
  SETTINGS_MANAGE: "settings:manage",
  EXAMS_ATTEMPT: "exams:attempt",
  SELF_READ: "self:read"
});

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.SUPER_ADMIN]: Object.freeze(ALL_PERMISSIONS),
  [ROLES.ADMIN]: Object.freeze([
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_WRITE,
    PERMISSIONS.STUDENTS_READ,
    PERMISSIONS.STUDENTS_WRITE,
    PERMISSIONS.TEACHERS_READ,
    PERMISSIONS.TEACHERS_WRITE,
    PERMISSIONS.COURSES_MANAGE,
    PERMISSIONS.BATCHES_MANAGE,
    PERMISSIONS.FEES_READ,
    PERMISSIONS.FEES_WRITE,
    PERMISSIONS.EXAMS_MANAGE,
    PERMISSIONS.ATTENDANCE_WRITE,
    PERMISSIONS.CONTENT_WRITE,
    PERMISSIONS.ANNOUNCEMENTS_WRITE,
    PERMISSIONS.SELF_READ
  ]),
  [ROLES.TEACHER]: Object.freeze([
    PERMISSIONS.STUDENTS_READ,
    PERMISSIONS.EXAMS_MANAGE,
    PERMISSIONS.EXAMS_EVALUATE,
    PERMISSIONS.ATTENDANCE_WRITE,
    PERMISSIONS.CONTENT_WRITE,
    PERMISSIONS.ANNOUNCEMENTS_WRITE,
    PERMISSIONS.SELF_READ
  ]),
  [ROLES.STUDENT]: Object.freeze([PERMISSIONS.EXAMS_ATTEMPT, PERMISSIONS.SELF_READ])
});

/** Does any of the given roles grant the permission? Server-side only. */
export function rolesHavePermission(roles, permission) {
  if (!Array.isArray(roles) || roles.length === 0) return false;
  return roles.some((role) => (ROLE_PERMISSIONS[role] ?? []).includes(permission));
}

/** Route prefix for an authenticated user, or "/login" when unknown. */
export function homeRouteForRoles(roles) {
  if (!Array.isArray(roles)) return "/login";
  if (roles.includes(ROLES.SUPER_ADMIN) || roles.includes(ROLES.ADMIN)) return ROLE_HOME[ROLES.ADMIN];
  if (roles.includes(ROLES.TEACHER)) return ROLE_HOME[ROLES.TEACHER];
  if (roles.includes(ROLES.STUDENT)) return ROLE_HOME[ROLES.STUDENT];
  return "/login";
}

export const ATTENDANCE_STATUS = Object.freeze({
  PRESENT: "present",
  ABSENT: "absent",
  LATE: "late"
});

export const EXAM_TYPES = Object.freeze({
  MCQ: "mcq",
  SUBJECTIVE: "subjective",
  MIXED: "mixed"
});

export const NOTIFICATION_TYPES = Object.freeze({
  ANNOUNCEMENT: "announcement",
  EXAM: "exam",
  LECTURE: "lecture",
  ASSIGNMENT: "assignment",
  FEE: "fee",
  SYSTEM: "system"
});

export const SESSION_COOKIE_NAME = "cp_session";
export const PASSWORD_MIN_LENGTH = 8;
