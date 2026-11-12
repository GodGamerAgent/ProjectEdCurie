import { pgTable, uuid, text, timestamp, uniqueIndex, jsonb, customType } from "drizzle-orm/pg-core";

const bytes = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const institutes = pgTable("institutes", {
  id: uuid("id").defaultRandom().primaryKey(),
  displayName: text("display_name").notNull(),
  logoData: bytes("logo_data"),
  logoMime: text("logo_mime"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerId: text("provider_id").notNull().unique(),
  email: text("email").notNull().unique(),
  role: text("role").notNull(),
  instituteId: uuid("institute_id").references(() => institutes.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
export const domains = pgTable("approved_domains", {
  domain: text("domain").primaryKey(),
  instituteId: uuid("institute_id").references(() => institutes.id)
});
export const invitations = pgTable("teacher_invitations", {
  email: text("email").primaryKey(),
  invitedBy: uuid("invited_by").notNull().references(() => users.id),
  instituteId: uuid("institute_id").references(() => institutes.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
export const courses = pgTable("courses", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  instituteId: uuid("institute_id").references(() => institutes.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
export const courseTeachers = pgTable("course_teachers", {
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" })
}, (table) => [uniqueIndex("course_teachers_unique").on(table.courseId, table.userId)]);
export const enrollments = pgTable("enrollments", {
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  email: text("email").notNull()
}, (table) => [uniqueIndex("enrollments_unique").on(table.courseId, table.email)]);
export const resources = pgTable("resources", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  text: text("text").notNull().default(""),
  status: text("status").notNull().default("draft"),
  extractionStatus: text("extraction_status").notNull().default("pending"),
  fileName: text("file_name"),
  mimeType: text("mime_type"),
  fileData: bytes("file_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
export const assessments = pgTable("assessments", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
export const questions = pgTable("questions", {
  id: uuid("id").defaultRandom().primaryKey(),
  assessmentId: uuid("assessment_id").notNull().references(() => assessments.id, { onDelete: "cascade" }),
  resourceId: uuid("resource_id").notNull().references(() => resources.id),
  prompt: text("prompt").notNull(),
  answer: text("answer").notNull()
});
export const preferences = pgTable("student_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  availability: text("availability").notNull().default(""),
  feedback: text("feedback").notNull().default(""),
  hints: text("hints").notNull().default(""),
  formats: jsonb("formats").$type<string[]>().notNull().default([])
});
export const baselineSubmissions = pgTable("baseline_submissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  assessmentId: uuid("assessment_id").notNull().references(() => assessments.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  answers: jsonb("answers").$type<Record<string, string>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
