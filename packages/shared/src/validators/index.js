import { z } from "zod";
import { ALL_ROLES, PASSWORD_MIN_LENGTH } from "../constants/index.js";

export const emailSchema = z
  .string({ required_error: "Email is required" })
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(254, "Email is too long");

export const passwordSchema = z
  .string({ required_error: "Password is required" })
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(200, "Password is too long")
  .regex(/[A-Za-z]/, "Password must contain at least one letter")
  .regex(/[0-9]/, "Password must contain at least one number");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ required_error: "Password is required" }).min(1, "Password is required").max(200)
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required").max(200),
    newPassword: passwordSchema
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ["newPassword"],
    message: "The new password must differ from the current password"
  });

export const uuidSchema = z.string().uuid("Expected a valid id");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional()
});

export const roleSchema = z.enum(ALL_ROLES);

export const personNameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(120, "Name is too long");

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[0-9+\s()-]{7,20}$/, "Enter a valid phone number");

export const createUserSchema = z.object({
  fullName: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema.optional().or(z.literal("")),
  role: roleSchema.refine((value) => value !== "super_admin", {
    message: "Super admin accounts can only be created by a super admin script"
  })
});

export const createCourseSchema = z.object({
  code: z.string().trim().min(2).max(30).regex(/^[A-Z0-9-]+$/i, "Use letters, numbers and dashes"),
  name: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  durationMonths: z.coerce.number().int().min(1).max(72)
});

export const createSubjectSchema = z.object({
  code: z.string().trim().min(2).max(30).regex(/^[A-Z0-9-]+$/i, "Use letters, numbers and dashes"),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional().or(z.literal(""))
});

export const batchFields = z.object({
  courseId: uuidSchema,
  code: z.string().trim().min(2).max(30),
  name: z.string().trim().min(3).max(120),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  capacity: z.coerce.number().int().min(1).max(1000).optional(),
  schedule: z.string().trim().max(500).optional().or(z.literal(""))
});

export const createBatchSchema = batchFields.refine((value) => value.endDate > value.startDate, {
  path: ["endDate"],
  message: "End date must be after the start date"
});

/** A single row of a student CSV import (headers are normalised by the importer). */
export const studentImportRowSchema = z.object({
  full_name: personNameSchema,
  email: emailSchema,
  enrollment_no: z.string().trim().min(1).max(40),
  phone: phoneSchema.optional().or(z.literal("")),
  guardian_name: z.string().trim().max(120).optional().or(z.literal("")),
  guardian_phone: phoneSchema.optional().or(z.literal("")),
  admission_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .or(z.literal("")),
  batch_code: z.string().trim().max(40).optional().or(z.literal(""))
});

/* ------------------------------------------------------------------ Phase 2 */

const optionalText = (max = 500) => z.string().trim().max(max).optional().or(z.literal(""));
const optionalDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .optional()
  .or(z.literal(""));

export const userStatusSchema = z.enum(["active", "inactive", "suspended"]);

export const adminStudentCreateSchema = z.object({
  fullName: personNameSchema,
  email: emailSchema,
  password: passwordSchema.optional().or(z.literal("")),
  enrollmentNo: z.string().trim().min(1, "Enrolment number is required").max(40),
  phone: phoneSchema.optional().or(z.literal("")),
  admissionDate: optionalDate,
  dateOfBirth: optionalDate,
  gender: z.enum(["male", "female", "other"]).optional().or(z.literal("")),
  address: optionalText(500),
  city: optionalText(80),
  state: optionalText(80),
  pincode: optionalText(12),
  guardianName: optionalText(120),
  guardianPhone: phoneSchema.optional().or(z.literal("")),
  batchId: uuidSchema.optional().or(z.literal(""))
});

export const adminStudentUpdateSchema = adminStudentCreateSchema
  .omit({ password: true })
  .partial()
  .extend({ status: userStatusSchema.optional() });

/** Create a guardian login for a student and link it to their primary guardian row. */
export const guardianAccessSchema = z.object({
  email: emailSchema,
  name: optionalText(120)
});

export const adminTeacherCreateSchema = z.object({
  fullName: personNameSchema,
  email: emailSchema,
  password: passwordSchema.optional().or(z.literal("")),
  employeeCode: z.string().trim().min(1, "Employee code is required").max(40),
  phone: phoneSchema.optional().or(z.literal("")),
  qualification: optionalText(160),
  specialization: optionalText(160),
  joiningDate: optionalDate
});

export const adminTeacherUpdateSchema = adminTeacherCreateSchema
  .omit({ password: true })
  .partial()
  .extend({ status: userStatusSchema.optional() });

export const statusChangeSchema = z.object({ status: userStatusSchema });

export const resetPasswordSchema = z.object({
  password: passwordSchema.optional().or(z.literal(""))
});

export const assignEnrollmentSchema = z.object({ batchId: uuidSchema });

export const assignTeacherSchema = z.object({
  batchId: uuidSchema,
  subjectId: uuidSchema.optional().or(z.literal(""))
});

export const courseSubjectsSchema = z.object({
  subjectIds: z.array(uuidSchema).max(50)
});

export const batchSubjectSchema = z.object({ subjectId: uuidSchema });

export const batchTeacherSchema = z.object({
  teacherId: uuidSchema,
  subjectId: uuidSchema.optional().or(z.literal(""))
});

export const batchScheduleSchema = z
  .object({
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    startTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
    endTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
    subjectId: uuidSchema.optional().or(z.literal("")),
    teacherId: uuidSchema.optional().or(z.literal("")),
    room: optionalText(60)
  })
  .refine((value) => value.endTime > value.startTime, {
    path: ["endTime"],
    message: "End time must be after the start time"
  });

export const courseUpdateSchema = createCourseSchema
  .partial()
  .extend({ status: z.enum(["active", "inactive", "archived"]).optional() });

export const subjectUpdateSchema = createSubjectSchema
  .partial()
  .extend({ status: z.enum(["active", "inactive"]).optional() });

export const batchUpdateSchema = batchFields
  .partial()
  .extend({ status: z.enum(["upcoming", "active", "completed", "cancelled"]).optional() });

export const csvImportSchema = z.object({
  csv: z.string().min(1, "Paste or choose a CSV file first").max(2_000_000)
});

/* ------------------------------------------------------------------ Phase 3 */

const youtubeIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{11}$/, "Use the 11-character YouTube video id")
  .optional()
  .or(z.literal(""));

const driveUrlSchema = z.string().trim().max(1000).regex(/^https:\/\//i, "Use a full https:// link");

const lessonFields = {
  subjectId: uuidSchema,
  title: z.string().trim().min(3, "Title is required").max(200),
  description: optionalText(2000),
  chapter: optionalText(120),
  youtubeVideoId: youtubeIdSchema,
  durationMinutes: z.coerce.number().int().min(1).max(600).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  status: z.enum(["draft", "published", "archived"]).optional()
};

export const teacherLessonSchema = z.object(lessonFields);
export const teacherLessonUpdateSchema = z.object(lessonFields).partial();

const materialFields = {
  subjectId: uuidSchema,
  title: z.string().trim().min(3, "Title is required").max(200),
  description: optionalText(2000),
  chapter: optionalText(120),
  kind: z.enum(["notes", "assignment", "reference", "other"]).optional(),
  driveUrl: driveUrlSchema,
  status: z.enum(["draft", "published", "archived"]).optional()
};

export const teacherMaterialSchema = z.object(materialFields);
export const teacherMaterialUpdateSchema = z.object(materialFields).partial();

const assignmentFields = {
  subjectId: uuidSchema,
  title: z.string().trim().min(3, "Title is required").max(200),
  instructions: optionalText(4000),
  dueAt: z.string().trim().max(40).optional().or(z.literal("")),
  maxMarks: z.coerce.number().int().min(1).max(1000).optional(),
  status: z.enum(["draft", "published", "closed"]).optional()
};

export const teacherAssignmentSchema = z.object(assignmentFields);
export const teacherAssignmentUpdateSchema = z.object(assignmentFields).partial();

export const submissionEvaluationSchema = z.object({
  marksAwarded: z.coerce.number().min(0).max(1000),
  feedback: optionalText(2000),
  status: z.enum(["evaluated", "returned"]).optional()
});

export const attendanceSaveSchema = z.object({
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  records: z
    .array(
      z.object({
        studentId: uuidSchema,
        status: z.enum(["present", "absent", "late"]),
        notes: optionalText(200)
      })
    )
    .min(1, "Mark at least one student")
    .max(300)
});

/* ------------------------------------------------------------------ Phase 4 */

export const lessonProgressSchema = z.object({
  positionSeconds: z.coerce.number().min(0).max(86400).optional(),
  completed: z.boolean().optional()
});

export const assignmentSubmitSchema = z
  .object({
    contentText: optionalText(8000),
    fileUrl: z.string().trim().max(1000).regex(/^https:\/\//i, "Use a full https:// link").optional().or(z.literal(""))
  })
  .refine((value) => Boolean(value.contentText) || Boolean(value.fileUrl), {
    message: "Add your answer or a link to your work",
    path: ["contentText"]
  });

/* ------------------------------------------------------------------ Phase 5 */

const isoDateTime = z
  .string()
  .trim()
  .min(10, "Use a date and time")
  .max(40)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "Use a valid date and time");

const examFields = {
  batchId: uuidSchema,
  subjectId: uuidSchema.optional().or(z.literal("")),
  title: z.string().trim().min(3, "Title is required").max(200),
  description: optionalText(2000),
  instructions: optionalText(4000),
  examType: z.enum(["mcq", "subjective", "mixed"]).optional(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  durationMinutes: z.coerce.number().int().min(1).max(480),
  passMarks: z.coerce.number().min(0).max(1000).optional(),
  maxAttempts: z.coerce.number().int().min(1).max(5).optional(),
  shuffleQuestions: z.boolean().optional(),
  status: z.enum(["draft", "scheduled", "published", "closed"]).optional()
};

export const examCreateSchema = z
  .object(examFields)
  .refine((value) => new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime(), {
    message: "The exam must end after it starts",
    path: ["endsAt"]
  });

export const examUpdateSchema = z.object(examFields).partial();

const examOptionSchema = z.object({
  text: z.string().trim().min(1, "Option text is required").max(500),
  isCorrect: z.boolean().optional()
});

const examQuestionFields = {
  questionType: z.enum(["mcq", "subjective"]).optional(),
  questionText: z.string().trim().min(3, "Question text is required").max(4000),
  explanation: optionalText(2000),
  marks: z.coerce.number().min(0.01).max(100),
  negativeMarks: z.coerce.number().min(0).max(100).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  options: z.array(examOptionSchema).max(6).optional(),
  modelAnswer: optionalText(4000)
};

export const examQuestionSchema = z.object(examQuestionFields).superRefine((value, ctx) => {
  const type = value.questionType ?? "mcq";
  if (type === "mcq") {
    const options = value.options ?? [];
    if (options.length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Add at least two options", path: ["options"] });
    }
    if (options.filter((option) => option.isCorrect).length !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Mark exactly one correct option", path: ["options"] });
    }
  } else if (!value.modelAnswer) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Add a model answer", path: ["modelAnswer"] });
  }
});

export const examQuestionUpdateSchema = z.object(examQuestionFields).partial();

export const examAnswerSaveSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: uuidSchema,
        selectedOptionId: uuidSchema.optional().nullable(),
        answerText: optionalText(8000),
        markedForReview: z.boolean().optional()
      })
    )
    .min(1, "Nothing to save")
    .max(300)
});

export const responseEvaluationSchema = z.object({
  awardedMarks: z.coerce.number().min(0).max(1000)
});

/* ------------------------------------------------------------------ Phase 6 */

const feeStructureFields = {
  courseId: uuidSchema,
  name: z.string().trim().min(3, "Name is required").max(120),
  academicYear: z.string().trim().min(4, "Academic year is required").max(20),
  totalAmount: z.coerce.number().min(0).max(10_000_000),
  installments: z.coerce.number().int().min(1).max(12).optional(),
  status: z.enum(["active", "inactive"]).optional()
};

export const feeStructureSchema = z.object(feeStructureFields);
export const feeStructureUpdateSchema = z.object(feeStructureFields).partial();

export const feeAssignSchema = z.object({
  studentId: uuidSchema,
  feeStructureId: uuidSchema,
  discountAmount: z.coerce.number().min(0).max(10_000_000).optional(),
  dueDate: z.string().trim().max(40).optional().or(z.literal("")),
  notes: optionalText(500)
});

export const feePaymentSchema = z.object({
  amount: z.coerce.number().min(1, "Enter the amount received").max(10_000_000),
  method: z.enum(["cash", "upi", "bank_transfer", "cheque", "card", "other"]),
  paidAt: z.string().trim().max(40).optional().or(z.literal("")),
  reference: optionalText(120),
  notes: optionalText(500)
});

export const feeCorrectionSchema = z.object({
  reason: z.string().trim().min(3, "Say why this is being corrected").max(300)
});

export const feeUpdateSchema = z.object({
  dueDate: z.string().trim().max(40).optional().or(z.literal("")),
  discountAmount: z.coerce.number().min(0).max(10_000_000).optional(),
  notes: optionalText(500)
});

/* ---------------------------------------------------------------- Phase 11 */

export const adminUserSchema = z.object({
  fullName: personNameSchema,
  email: emailSchema,
  password: passwordSchema.optional().or(z.literal("")),
  phone: phoneSchema.optional().or(z.literal("")),
  roleCode: z.enum(["admin", "super_admin"]).default("admin")
});

export const adminUserUpdateSchema = z.object({
  fullName: personNameSchema.optional(),
  phone: phoneSchema.optional().or(z.literal("")),
  status: userStatusSchema.optional(),
  roleCode: z.enum(["admin", "super_admin"]).optional()
});

const settingText = (max) => z.string().trim().max(max).optional().or(z.literal(""));

export const settingsSchema = z
  .object({
    instituteName: settingText(120),
    instituteAddress: settingText(300),
    institutePhone: settingText(30),
    instituteEmail: settingText(120),
    receiptFooter: settingText(200)
  })
  .partial();

/* ------------------------------------------------------------------ Phase 8 */

const announcementFields = {
  title: z.string().trim().min(3, "Title is required").max(200),
  body: z.string().trim().min(3, "Write the notice").max(4000),
  audience: z.enum(["all", "role", "course", "batch"]).default("all"),
  roleCode: z.enum(["admin", "teacher", "student"]).optional().or(z.literal("")),
  courseId: uuidSchema.optional().or(z.literal("")),
  batchId: uuidSchema.optional().or(z.literal("")),
  isPinned: z.boolean().optional(),
  expiresAt: z.string().trim().max(40).optional().or(z.literal(""))
};

export const announcementSchema = z.object(announcementFields).superRefine((value, ctx) => {
  if (value.audience === "role" && !value.roleCode) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose which role should see this", path: ["roleCode"] });
  }
  if (value.audience === "course" && !value.courseId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose a course", path: ["courseId"] });
  }
  if (value.audience === "batch" && !value.batchId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose a batch", path: ["batchId"] });
  }
});

export const teacherAnnouncementSchema = z.object({
  title: announcementFields.title,
  body: announcementFields.body,
  batchId: uuidSchema,
  isPinned: z.boolean().optional(),
  expiresAt: announcementFields.expiresAt
});

export const announcementUpdateSchema = z
  .object({
    title: announcementFields.title,
    body: announcementFields.body,
    isPinned: z.boolean(),
    expiresAt: announcementFields.expiresAt
  })
  .partial();

export function formatZodError(error) {
  const details = error.issues.map((issue) => ({
    field: issue.path.join(".") || "body",
    message: issue.message
  }));
  return { message: details[0]?.message ?? "Invalid input", details };
}
