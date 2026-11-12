import { Router } from "express";
import type { Pool } from "pg";
import { HttpError } from "./auth";
import { cleanString, courseAccess, currentUser, eligibility, normalizeEmail, requireRole, teacherCourse } from "./access";

export function courseRoutes(db: Pool) {
  const router = Router();
  router.get("/api/courses", async (_req, res) => {
    const user = currentUser(res);
    if (user.role === "admin") return res.json({ courses: [] });
    const result = user.role === "teacher"
      ? await db.query("SELECT c.id,c.title,c.description FROM courses c JOIN course_teachers ct ON ct.course_id=c.id WHERE ct.user_id=$1 ORDER BY c.created_at", [user.id])
      : await db.query("SELECT c.id,c.title,c.description FROM courses c JOIN enrollments e ON e.course_id=c.id WHERE e.email=$1 ORDER BY c.created_at", [user.email]);
    res.json({ courses: result.rows.map((course) => ({ ...course, role: user.role })) });
  });
  router.post("/api/courses", async (req, res) => {
    const user = currentUser(res); requireRole(user, "teacher");
    const title = cleanString(req.body.title, "Course title", 200);
    const description = typeof req.body.description === "string" ? req.body.description.trim().slice(0, 2000) : "";
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("INSERT INTO courses (title,description) VALUES ($1,$2) RETURNING id,title,description", [title, description]);
      await client.query("INSERT INTO course_teachers (course_id,user_id) VALUES ($1,$2)", [result.rows[0].id, user.id]);
      await client.query("COMMIT");
      res.status(201).json(result.rows[0]);
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  });
  router.get("/api/courses/:id", async (req, res) => {
    const user = currentUser(res);
    const { course, teacher } = await courseAccess(db, user, req.params.id);
    const resources = await db.query(`SELECT id,title,status,extraction_status AS "extractionStatus",text,(file_data IS NOT NULL) AS "hasFile"
      FROM resources WHERE course_id=$1 ${teacher ? "" : "AND status='published' AND length(btrim(text))>0"} ORDER BY created_at`, [course.id]);
    const assessments = await db.query(`SELECT id,title,status FROM assessments WHERE course_id=$1 ${teacher ? "" : "AND status='published'"} ORDER BY created_at`, [course.id]);
    const enriched = [];
    for (const a of assessments.rows) {
      const q = teacher ? await db.query("SELECT id,prompt,answer,resource_id AS \"resourceId\" FROM questions WHERE assessment_id=$1 ORDER BY id", [a.id]) : { rows: [] };
      enriched.push({ ...a, questions: q.rows });
    }
    const enrollments = teacher ? await db.query("SELECT email FROM enrollments WHERE course_id=$1 ORDER BY email", [course.id]) : { rows: [] };
    res.json({ course, resources: resources.rows, assessments: enriched, enrollments: enrollments.rows });
  });
  router.post("/api/courses/:id/enrollments", async (req, res) => {
    const user = currentUser(res); await teacherCourse(db, user, req.params.id);
    const email = normalizeEmail(req.body.email);
    const allowed = await db.query("SELECT 1 FROM approved_domains WHERE domain=$1", [email.split("@")[1]]);
    if (!allowed.rowCount) throw new HttpError(400, "The student's email domain must be approved by an administrator.");
    await db.query("INSERT INTO enrollments (course_id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING", [req.params.id, email]);
    res.status(201).json({ email });
  });
  router.get("/api/courses/:id/onboarding", async (req, res) => {
    const user = currentUser(res); requireRole(user, "student");
    await courseAccess(db, user, req.params.id);
    const { state, message } = await eligibility(db, req.params.id);
    res.json({ state, message });
  });
  router.post("/api/courses/:id/assessment/start", async (req, res) => {
    const user = currentUser(res); requireRole(user, "student");
    await courseAccess(db, user, req.params.id);
    const gate = await eligibility(db, req.params.id);
    if (!gate.assessmentId) throw new HttpError(403, gate.message);
    const questions = await db.query(`SELECT q.id,q.prompt FROM questions q JOIN resources r ON r.id=q.resource_id
      WHERE q.assessment_id=$1 AND r.course_id=$2 AND r.status='published' AND length(btrim(r.text))>0
      AND length(btrim(q.prompt))>0 AND length(btrim(q.answer))>0 ORDER BY q.id`, [gate.assessmentId, req.params.id]);
    res.json({ questions: questions.rows });
  });
  router.post("/api/courses/:id/assessment/submit", async (req, res) => {
    const user = currentUser(res); requireRole(user, "student");
    await courseAccess(db, user, req.params.id);
    const gate = await eligibility(db, req.params.id);
    if (!gate.assessmentId) throw new HttpError(403, gate.message);
    const questions = await db.query(`SELECT q.id FROM questions q JOIN resources r ON r.id=q.resource_id
      WHERE q.assessment_id=$1 AND r.course_id=$2 AND r.status='published' AND length(btrim(r.text))>0
      AND length(btrim(q.prompt))>0 AND length(btrim(q.answer))>0`, [gate.assessmentId, req.params.id]);
    const answers = req.body.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers) || Object.keys(answers).length !== questions.rows.length ||
        questions.rows.some((q) => typeof answers[q.id] !== "string" || !answers[q.id].trim() || answers[q.id].length > 5000)) {
      throw new HttpError(400, "Answer every available question before submitting.");
    }
    await db.query("INSERT INTO baseline_submissions (assessment_id,user_id,answers) VALUES ($1,$2,$3::jsonb)", [gate.assessmentId, user.id, JSON.stringify(answers)]);
    res.status(201).json({ message: "Your answers were saved." });
  });
  return router;
}
