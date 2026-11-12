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

export const createBatchSchema = z
  .object({
    courseId: uuidSchema,
    code: z.string().trim().min(2).max(30),
    name: z.string().trim().min(3).max(120),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    capacity: z.coerce.number().int().min(1).max(1000).optional(),
    schedule: z.string().trim().max(500).optional().or(z.literal(""))
  })
  .refine((value) => value.endDate > value.startDate, {
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

export function formatZodError(error) {
  const details = error.issues.map((issue) => ({
    field: issue.path.join(".") || "body",
    message: issue.message
  }));
  return { message: details[0]?.message ?? "Invalid input", details };
}
