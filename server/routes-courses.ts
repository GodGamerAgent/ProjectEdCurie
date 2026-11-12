import { Router } from "express";
import type { Pool } from "pg";
import { HttpError } from "./auth";
import { cleanString, currentUser, requireRole } from "./access";

export function courseRoutes(db: Pool) {
  const router = Router();
  router.get("/api/courses", async (_req, res) => {
    const user = currentUser(res);
    if (user.role === "admin") return res.json({ courses: [] });
    if (!user.instituteId) throw new HttpError(403, "Your account is not associated with an institute.");
    const result = user.role === "teacher"
      ? await db.query("SELECT c.id,c.title,c.description FROM courses c JOIN course_teachers ct ON ct.course_id=c.id WHERE ct.user_id=$1 AND c.institute_id=$2 ORDER BY c.created_at", [user.id, user.instituteId])
      : await db.query("SELECT c.id,c.title,c.description FROM courses c JOIN enrollments e ON e.course_id=c.id WHERE e.email=$1 AND c.institute_id=$2 ORDER BY c.created_at", [user.email, user.instituteId]);
    res.json({ courses: result.rows.map((course) => ({ ...course, role: user.role })) });
  });
  router.post("/api/courses", async (req, res) => {
    const user = currentUser(res); requireRole(user, "teacher");
    if (!user.instituteId) throw new HttpError(403, "Your account is not associated with an institute.");
    const title = cleanString(req.body.title, "Course title", 200);
    const description = typeof req.body.description === "string" ? req.body.description.trim().slice(0, 2000) : "";
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("INSERT INTO courses (title,description,institute_id) VALUES ($1,$2,$3) RETURNING id,title,description", [title, description, user.instituteId]);
      await client.query("INSERT INTO course_teachers (course_id,user_id) VALUES ($1,$2)", [result.rows[0].id, user.id]);
      await client.query("COMMIT");
      res.status(201).json(result.rows[0]);
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  });
  return router;
}
