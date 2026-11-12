import { Router } from "express";
import type { Pool } from "pg";
import { HttpError } from "./auth";
import { cleanString, courseAccess, currentUser, eligibility, normalizeEmail, requireRole, teacherCourse, uuid } from "./access";

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
  router.get("/api/courses/:id", async (req, res) => {
    const user = currentUser(res);
    const { course, teacher } = await courseAccess(db, user, req.params.id);
    const resources = await db.query(`SELECT id,title,status,extraction_status AS "extractionStatus",text,version,(file_data IS NOT NULL) AS "hasFile"
      FROM resources WHERE course_id=$1 ${teacher ? "" : "AND status='published' AND length(btrim(text))>0"} ORDER BY created_at`, [course.id]);
    const assessments = await db.query(`SELECT id,title,status FROM assessments WHERE course_id=$1 ${teacher ? "" : "AND status='published'"} ORDER BY created_at`, [course.id]);
    const enriched = [];
    for (const a of assessments.rows) {
      const q = teacher ? await db.query("SELECT id,prompt,answer,version,resource_id AS \"resourceId\",resource_version_id AS \"resourceVersionId\",concept_id AS \"conceptId\" FROM questions WHERE assessment_id=$1 ORDER BY id", [a.id]) : { rows: [] };
      enriched.push({ ...a, questions: q.rows });
    }
    const enrollments = teacher ? await db.query("SELECT email FROM enrollments WHERE course_id=$1 ORDER BY email", [course.id]) : { rows: [] };
    const concepts = await db.query("SELECT id,name,resource_id AS \"resourceId\" FROM concepts WHERE course_id=$1 ORDER BY created_at", [course.id]);
    res.json({ course, resources: resources.rows, assessments: enriched, enrollments: enrollments.rows, concepts: concepts.rows });
  });
  router.post("/api/courses/:id/enrollments", async (req, res) => {
    const user = currentUser(res); const access = await teacherCourse(db, user, req.params.id);
    const email = normalizeEmail(req.body.email);
    const allowed = await db.query("SELECT 1 FROM approved_domains WHERE domain=$1 AND institute_id=$2", [email.split("@")[1], access.instituteId]);
    if (!allowed.rowCount) throw new HttpError(400, "The student's email domain must be approved by an administrator.");
    await db.query("INSERT INTO enrollments (course_id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING", [req.params.id, email]);
    res.status(201).json({ email });
  });
  router.get("/api/courses/:id/onboarding", async (req, res) => {
    const user = currentUser(res); requireRole(user, "student");
    await courseAccess(db, user, req.params.id);
    const { state, message } = await eligibility(db, req.params.id);
    const active = await db.query(
      "SELECT 1 FROM assessment_sessions WHERE user_id=$1 AND course_id=$2 AND status='active'",
      [user.id, req.params.id]
    );
    res.json(active.rowCount ? { state, message, hasActiveAssessment: true } : { state, message });
  });
  router.post("/api/courses/:id/assessment/start", async (req, res) => {
    const user = currentUser(res); requireRole(user, "student");
    const courseId = req.params.id;
    await courseAccess(db, user, courseId);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      // Serialize concurrent starts for the same student and course.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`baseline:${user.id}:${courseId}`]);
      const active = await client.query(`SELECT id,questions,answers FROM assessment_sessions
        WHERE user_id=$1 AND course_id=$2 AND status='active'`, [user.id, courseId]);
      if (active.rowCount) {
        const { id, questions, answers } = active.rows[0];
        await client.query("COMMIT");
        return res.json({ sessionId: id, questions: questions.map(({ id, prompt }: { id: string; prompt: string }) => ({ id, prompt })), answers });
      }
      const gate = await eligibility(client, courseId);
      if (!gate.assessmentId) throw new HttpError(403, gate.message);
      const questions = await client.query(`SELECT q.id,q.prompt,q.answer,q.concept_id,q.version,q.resource_version_id FROM questions q JOIN resources r ON r.id=q.resource_id
        JOIN resource_versions rv ON rv.id=q.resource_version_id AND rv.resource_id=r.id
        WHERE q.assessment_id=$1 AND r.course_id=$2 AND r.status='published' AND length(btrim(r.text))>0
        AND rv.status='published' AND length(btrim(rv.text))>0
        AND length(btrim(q.prompt))>0 AND length(btrim(q.answer))>0 ORDER BY q.id`, [gate.assessmentId, courseId]);
      if (!questions.rowCount) throw new HttpError(409, "The available baseline questions changed. Check readiness and try again.");
      const snapshot = questions.rows.map((q) => ({
        id: q.id, prompt: q.prompt, answer: q.answer, conceptId: q.concept_id,
        questionVersion: q.version, resourceVersionId: q.resource_version_id
      }));
      const session = await client.query(`INSERT INTO assessment_sessions (user_id,course_id,assessment_id,questions)
        VALUES ($1,$2,$3,$4::jsonb) RETURNING id`, [user.id, courseId, gate.assessmentId, JSON.stringify(snapshot)]);
      await client.query("COMMIT");
      res.json({ sessionId: session.rows[0].id, questions: snapshot.map(({ id, prompt }) => ({ id, prompt })), answers: {} });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });
  router.put("/api/assessment-sessions/:id/answers", async (req,res)=>{
    const user=currentUser(res);requireRole(user,"student");
    const sessionId=uuid(req.params.id);
    const session=await db.query("SELECT course_id,questions,status FROM assessment_sessions WHERE id=$1 AND user_id=$2",[sessionId,user.id]);
    if(!session.rowCount)throw new HttpError(404,"Assessment session not found.");
    await courseAccess(db,user,session.rows[0].course_id);
    if(session.rows[0].status!=="active")throw new HttpError(409,"This assessment session is already submitted.");
    const answers=req.body.answers;
    const ids=new Set(session.rows[0].questions.map((q:any)=>q.id));
    if(!answers||typeof answers!=="object"||Array.isArray(answers)||Object.entries(answers).some(([id,value])=>!ids.has(id)||typeof value!=="string"||value.length>5000))throw new HttpError(400,"Invalid assessment answers.");
    await db.query("UPDATE assessment_sessions SET answers=answers || $3::jsonb,updated_at=now() WHERE id=$1 AND user_id=$2 AND status='active'",[sessionId,user.id,JSON.stringify(answers)]);
    res.json({saved:true});
  });
  router.post("/api/courses/:id/assessment/submit", async (req, res) => {
    const user = currentUser(res); requireRole(user, "student");
    const sessionId=typeof req.body?.sessionId==="string"?uuid(req.body.sessionId):"";
    const session=await db.query("SELECT id,assessment_id,questions,answers,status,score,total,course_id FROM assessment_sessions WHERE id=$1 AND user_id=$2 AND course_id=$3",[sessionId,user.id,req.params.id]);
    if(!session.rowCount)throw new HttpError(404,"Assessment session not found.");
    await courseAccess(db,user,req.params.id);
    if(session.rows[0].status==="submitted")return res.json({message:"Your baseline was already submitted.",score:session.rows[0].score,total:session.rows[0].total,details:[]});
    const questions={rows:session.rows[0].questions} as any;
    const answers={...session.rows[0].answers,...(req.body.answers||{})};
    if (!answers || typeof answers !== "object" || Array.isArray(answers) || Object.keys(answers).length !== questions.rows.length ||
        questions.rows.some((q:any) => typeof answers[q.id] !== "string" || !answers[q.id].trim() || answers[q.id].length > 5000)) {
      throw new HttpError(400, "Answer every available question before submitting.");
    }
    const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
    const details: { questionId: string; questionVersion:number; resourceVersionId:string|null; conceptId: string | null; correct: boolean }[] = questions.rows.map((q:any) => ({ questionId: q.id,questionVersion:q.questionVersion,resourceVersionId:q.resourceVersionId, conceptId: q.conceptId, correct: normalize(answers[q.id]) === normalize(q.answer) }));
    const score = details.filter((q) => q.correct).length;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const locked=await client.query("SELECT status,score,total FROM assessment_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE",[sessionId,user.id]);
      if(locked.rows[0].status==="submitted"){await client.query("COMMIT");return res.json({message:"Your baseline was already submitted.",score:locked.rows[0].score,total:locked.rows[0].total,details:[]});}
      await client.query("INSERT INTO baseline_submissions (assessment_id,user_id,answers,score,total,details) VALUES ($1,$2,$3::jsonb,$4,$5,$6::jsonb)", [session.rows[0].assessment_id, user.id, JSON.stringify(answers), score, details.length, JSON.stringify(details)]);
      for (const item of details) if (item.conceptId) await client.query("INSERT INTO study_attempts (user_id,course_id,concept_id,kind,correct,assisted) SELECT $1,$2,id,'baseline',$4,false FROM concepts WHERE id=$3 AND course_id=$2", [user.id, req.params.id, item.conceptId, item.correct]);
      await client.query("UPDATE assessment_sessions SET status='submitted',answers=$2::jsonb,score=$3,total=$4,updated_at=now() WHERE id=$1",[sessionId,JSON.stringify(answers),score,details.length]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    res.status(201).json({ message: "Your answers were saved.", score, total: details.length, details });
  });
  router.get("/api/courses/:id/assessment/result", async (req, res) => {
    const user = currentUser(res); requireRole(user, "student"); await courseAccess(db, user, req.params.id);
    const result = await db.query(`SELECT b.score,b.total,b.details,b.created_at AS "createdAt" FROM baseline_submissions b JOIN assessments a ON a.id=b.assessment_id WHERE a.course_id=$1 AND b.user_id=$2 AND b.score IS NOT NULL ORDER BY b.created_at DESC LIMIT 1`, [req.params.id, user.id]);
    res.json({ result: result.rows[0] ?? null });
  });
  return router;
}
