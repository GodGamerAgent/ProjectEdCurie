import { Router } from "express";
import type { Pool } from "pg";
import { HttpError } from "./auth";
import { currentUser, teacherCourse, uuid } from "./access";
import { studentReady } from "./routes-study";

const normalized = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const problemSql = `SELECT p.id,p.prompt,p.hints,p.concept_id,c.course_id,
  (a.status='published' AND r.status='published' AND rv.status='published' AND length(btrim(rv.text))>0) AS available
  FROM practice_problems p JOIN concepts c ON c.id=p.concept_id
  JOIN questions q ON q.id=p.question_id JOIN assessments a ON a.id=q.assessment_id AND a.course_id=c.course_id
  JOIN question_versions qv ON qv.id=p.question_version_id AND qv.question_id=q.id AND qv.concept_id=c.id
  JOIN resource_versions rv ON rv.id=qv.resource_version_id
  JOIN resources r ON r.id=rv.resource_id AND r.course_id=c.course_id WHERE p.id=$1`;

export function twinRoutes(db: Pool) {
  const router = Router();
  router.get("/api/courses/:id/practice-problems", async (req, res) => {
    await teacherCourse(db, currentUser(res), req.params.id);
    const data = await db.query(`SELECT p.id,p.prompt,p.concept_id AS "conceptId",
      link.twin_problem_id AS "twinProblemId"
      FROM practice_problems p JOIN concepts c ON c.id=p.concept_id
      LEFT JOIN practice_twin_links link ON link.original_problem_id=p.id
      WHERE c.course_id=$1 ORDER BY p.created_at,p.id`, [req.params.id]);
    res.json({ problems: data.rows });
  });
  router.put("/api/practice-problems/:id/twin", async (req, res) => {
    const originalId = uuid(req.params.id), twinId = uuid(String(req.body?.twinProblemId || ""));
    const user = currentUser(res);
    const original = (await db.query(problemSql, [originalId])).rows[0];
    if (!original) throw new HttpError(404, "Practice problem not found.");
    await teacherCourse(db, user, original.course_id);
    const twin = (await db.query(problemSql, [twinId])).rows[0];
    if (!twin || originalId === twinId || twin.course_id !== original.course_id || twin.concept_id !== original.concept_id) {
      throw new HttpError(400, "Choose a different problem assessing the same concept in this course.");
    }
    if (normalized(original.prompt) === normalized(twin.prompt)) throw new HttpError(400, "A twin must have a different prompt, not repeat the original problem.");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`twin-links:${original.course_id}`]);
      const conflict = await client.query(`SELECT 1 FROM practice_twin_links
        WHERE twin_problem_id=$1 OR original_problem_id=$2 OR (twin_problem_id=$2 AND original_problem_id<>$1)`,
      [originalId, twinId]);
      if (conflict.rowCount) throw new HttpError(409, "These problems are already used in another pairing. Choose an unpaired twin.");
      await client.query(`INSERT INTO practice_twin_links(original_problem_id,twin_problem_id,linked_by) VALUES($1,$2,$3)
        ON CONFLICT(original_problem_id) DO UPDATE SET twin_problem_id=$2,linked_by=$3,created_at=now()`,
      [originalId, twinId, user.id]);
      await client.query("COMMIT");
      res.json({ originalProblemId: originalId, twinProblemId: twinId });
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  });
  router.get("/api/courses/:id/twin-followups", async (req, res) => {
    const user = currentUser(res); await studentReady(db, user, req.params.id);
    const data = await db.query(`SELECT s.id AS "originalSessionId",p.prompt AS "originalPrompt",p.concept_id AS "conceptId",
      CASE WHEN ts.submitted THEN 'completed' WHEN ts.id IS NOT NULL THEN 'in_progress'
        WHEN EXISTS(SELECT 1 FROM practice_sessions seen WHERE seen.user_id=$2 AND seen.problem_id=l.twin_problem_id) THEN 'already_seen'
        ELSE 'available' END AS status
      FROM practice_sessions s JOIN practice_problems p ON p.id=s.problem_id JOIN concepts c ON c.id=p.concept_id
      JOIN practice_twin_links l ON l.original_problem_id=p.id
      LEFT JOIN practice_twin_sessions pair ON pair.original_session_id=s.id
      LEFT JOIN practice_sessions ts ON ts.id=pair.twin_session_id AND ts.user_id=$2
      WHERE c.course_id=$1 AND s.user_id=$2 AND s.kind='practice' AND s.submitted=true
      ORDER BY s.created_at DESC LIMIT 30`, [req.params.id, user.id]);
    res.json({ followups: data.rows });
  });
  router.post("/api/practice/:id/twin", async (req, res) => {
    const user = currentUser(res), originalId = uuid(req.params.id);
    const originalSession = (await db.query(`SELECT s.*,c.course_id,p.concept_id FROM practice_sessions s
      JOIN practice_problems p ON p.id=s.problem_id JOIN concepts c ON c.id=p.concept_id
      WHERE s.id=$1 AND s.user_id=$2`, [originalId, user.id])).rows[0];
    if (!originalSession) throw new HttpError(404, "Original practice session not found.");
    await studentReady(db, user, originalSession.course_id);
    if (!originalSession.submitted || originalSession.kind !== "practice") throw new HttpError(409, "Submit the original practice problem before opening its twin.");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`practice:${user.id}`]);
      const existing = (await client.query(`SELECT s.* FROM practice_twin_sessions pair
        JOIN practice_sessions s ON s.id=pair.twin_session_id
        WHERE pair.original_session_id=$1 AND s.user_id=$2`, [originalId, user.id])).rows[0];
      const link = (await client.query("SELECT twin_problem_id FROM practice_twin_links WHERE original_problem_id=$1", [originalSession.problem_id])).rows[0];
      const twinId = existing?.problem_id || link?.twin_problem_id;
      if (!twinId) throw new HttpError(404, "Your teacher has not linked a twin to this problem yet.");
      const twin = (await client.query(problemSql, [twinId])).rows[0];
      if (!twin || !twin.available || twin.course_id !== originalSession.course_id || twin.concept_id !== originalSession.concept_id) {
        throw new HttpError(403, "The linked twin needs published, usable material in this course.");
      }
      let session = existing;
      if (!session) {
        const seen = await client.query("SELECT 1 FROM practice_sessions WHERE user_id=$1 AND problem_id=$2", [user.id, twinId]);
        if (seen.rowCount) throw new HttpError(409, "You have already seen this twin. Ask your teacher for a fresh variation.");
        session = (await client.query("INSERT INTO practice_sessions(user_id,problem_id,kind) VALUES($1,$2,'twin') RETURNING *", [user.id, twinId])).rows[0];
        await client.query("INSERT INTO practice_twin_sessions(original_session_id,twin_session_id) VALUES($1,$2)", [originalId, session.id]);
      }
      await client.query("COMMIT");
      res.json({ sessionId: session.id, prompt: twin.prompt, kind: "twin", submitted: session.submitted,
        hints: twin.hints.slice(0, session.hint_count), result: session.result });
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  });
  return router;
}
