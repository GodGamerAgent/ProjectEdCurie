import type { Pool } from "pg";
import type { Response } from "express";
import { HttpError, type AppUser } from "./auth";

export const currentUser = (res: Response): AppUser => res.locals.user as AppUser;
export function requireRole(user: AppUser, role: AppUser["role"]) {
  if (user.role !== role) throw new HttpError(403, "You do not have permission for this action.");
}
export function cleanString(value: unknown, label: string, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.includes("\u0000") || value.trim().length > max) throw new HttpError(400, `${label} is required and must be at most ${max} characters.`);
  return value.trim();
}
export function uuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new HttpError(404, "Not found.");
  return value;
}
export function normalizeEmail(value: unknown) {
  const email = cleanString(value, "Email", 254).toLowerCase();
  if (!/^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) throw new HttpError(400, "Enter a valid email address.");
  return email;
}
export async function courseAccess(db: Pool, user: AppUser, courseId: string) {
  uuid(courseId);
  if (!user.instituteId) throw new HttpError(403, "Your account is not associated with an institute.");
  const result = await db.query(
    `SELECT c.id,c.title,c.description,c.institute_id,
       EXISTS (SELECT 1 FROM course_teachers ct WHERE ct.course_id=c.id AND ct.user_id=$2) AS assigned,
       EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id=c.id AND e.email=$3) AS enrolled
     FROM courses c WHERE c.id=$1 AND c.institute_id=$4`, [courseId, user.id, user.email, user.instituteId]
  );
  const course = result.rows[0];
  const teacher = user.role === "teacher" && course?.assigned;
  const student = user.role === "student" && course?.enrolled;
  if (!teacher && !student) throw new HttpError(403, "You are not assigned to or enrolled in this course.");
  return { course: { id: course.id, title: course.title, description: course.description }, instituteId: course.institute_id as string, teacher: Boolean(teacher) };
}
export async function teacherCourse(db: Pool, user: AppUser, courseId: string) {
  const access = await courseAccess(db, user, courseId);
  if (!access.teacher) throw new HttpError(403, "Only an assigned teacher can change this course.");
  return access;
}
export const NO_RESOURCE = "Boarding is not possible as your institute haven't added any resource to question you from.";
export const NO_BASELINE = "Your institute is preparing the baseline assessment";
