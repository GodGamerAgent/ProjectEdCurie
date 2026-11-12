import { Router } from "express";
import type { Pool } from "pg";
import { cleanString, currentUser, normalizeEmail, teacherCourse, uuid } from "./access";
import { HttpError } from "./auth";
import { aiText, demoAI, object } from "./demo-ai";

function dateField(value: unknown, label: string) {
  const date = cleanString(value,label,10);
  const iso = new Date(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+iso) || iso.toISOString().slice(0,10) !== date) {
    throw new HttpError(400,`Choose a valid ${label.toLowerCase()}.`);
  }
  return date;
}
function sections(text: string) {
  const result: string[] = [];
  for (let start=0; start<text.length;) {
    let end = Math.min(start+4600,text.length);
    const newline = text.lastIndexOf("\n",end-1);
    if (end<text.length && newline>start+3000) end=newline+1;
    if (end<text.length && /[\uDC00-\uDFFF]/.test(text[end])) end--;
    result.push(text.slice(start,end));
    start=end;
  }
  return result;
}
const normalized = (text: string) => text.replace(/\s+/g," ").trim();

export function demoContentRoutes(db: Pool) {
  const router = Router();
  const base = "/api/demo/courses/:courseId";
  router.get(base + "/teacher", async (req,res) => {
    const id=String(req.params.courseId);
    const {course} = await teacherCourse(db,currentUser(res),id);
    const [topics,resources,students,baseline] = await Promise.all([
      db.query("SELECT id,title FROM demo_topics WHERE course_id=$1 ORDER BY created_at,id",[id]),
      db.query(`SELECT r.id,r.topic_id AS "topicId",r.title,r.text,r.status,r.version,r.extraction_status AS "extractionStatus",
        (r.file_data IS NOT NULL) AS "hasFile",a.parts
        FROM resources r LEFT JOIN demo_resource_analyses a ON a.resource_id=r.id AND a.version=r.version
        WHERE r.course_id=$1 AND r.status<>'archived' ORDER BY r.created_at,r.id`,[id]),
      db.query(`SELECT email,name,date_of_birth::text AS "dateOfBirth",enrolled_on::text AS "enrolledOn"
        FROM enrollments WHERE course_id=$1 ORDER BY email`,[id]),
      db.query(`SELECT draft,published IS NOT NULL AS published,revision,draft_version AS "draftVersion"
        FROM demo_baselines WHERE course_id=$1`,[id]),
    ]);
    res.json({course,topics:topics.rows,students:students.rows,
      resources:resources.rows.map(r=>({...r, sectionCount:sections(r.text).length})),
      baseline:baseline.rows[0] ?? {draft:[],published:false,revision:0,draftVersion:0}});
  });
  router.post(base + "/topics", async (req,res)=>{
    await teacherCourse(db,currentUser(res),String(req.params.courseId));
    const title = cleanString(req.body.title,"Topic name",200);
    const saved = await db.query("INSERT INTO demo_topics(course_id,title) VALUES($1,$2) RETURNING id,title",[String(req.params.courseId),title]);
    res.status(201).json(saved.rows[0]);
  });
  router.put(base + "/students", async (req,res)=>{
    const id = String(req.params.courseId);
    const {instituteId} = await teacherCourse(db,currentUser(res),id);
    const email = normalizeEmail(req.body.email);
    const previous = req.body.previousEmail ? normalizeEmail(req.body.previousEmail) : null;
    const name = cleanString(req.body.name,"Student name",160);
    const dob = dateField(req.body.dateOfBirth,"Date of birth");
    const enrolled = dateField(req.body.enrolledOn,"Enrollment date");
    if (dob > new Date().toISOString().slice(0,10) || dob > enrolled) throw new HttpError(400,"Date of birth must be on or before the enrollment date and today.");
    if (!(await db.query("SELECT 1 FROM approved_domains WHERE domain=$1 AND institute_id=$2",[email.split("@")[1],instituteId])).rowCount) {
      throw new HttpError(400,"Use an email from an approved institute domain.");
    }
    try {
      if (previous) {
        const updated = await db.query("UPDATE enrollments SET email=$3,name=$4,date_of_birth=$5,enrolled_on=$6 WHERE course_id=$1 AND email=$2",
          [id,previous,email,name,dob,enrolled]);
        if (!updated.rowCount) throw new HttpError(404,"Student enrollment not found.");
      } else {
        await db.query("INSERT INTO enrollments(course_id,email,name,date_of_birth,enrolled_on) VALUES($1,$2,$3,$4,$5)",[id,email,name,dob,enrolled]);
      }
    } catch (error) {
      if (object(error).code === "23505") throw new HttpError(409,"This student is already enrolled.");
      throw error;
    }
    res.json({saved:true});
  });
  router.delete(base + "/students/:email",async (req,res)=>{
    await teacherCourse(db,currentUser(res),String(req.params.courseId));
    const deleted=await db.query("DELETE FROM enrollments WHERE course_id=$1 AND email=$2",[String(req.params.courseId),normalizeEmail(String(req.params.email))]);
    if (!deleted.rowCount) throw new HttpError(404,"Student enrollment not found.");
    res.status(204).end();
  });

  router.post("/api/demo/resources/:id/process",async (req,res)=>{
    const id=uuid(String(req.params.id));
    const source=(await db.query(`SELECT r.course_id,r.title,r.text,r.version,a.parts
      FROM resources r LEFT JOIN demo_resource_analyses a ON a.resource_id=r.id AND a.version=r.version
      WHERE r.id=$1 AND r.status<>'archived'`,[id])).rows[0];
    if (!source) throw new HttpError(404,"Resource not found.");
    await teacherCourse(db,currentUser(res),source.course_id);
    if (!source.text.trim()) throw new HttpError(400,"Add readable resource text in Review and edit, then process it.");
    const chunks=sections(source.text);
    const parts=source.parts ?? [];
    if (parts.length>=chunks.length) return res.json({remaining:0});
    const excerpt=chunks[parts.length];
    const output=object(await demoAI(
      "Summarize this section of the course resource, covering every concept taught here. Return {summary:string, problems:[{prompt:string,answer:string,quote:string}]}. Only extract exercises actually present in this section. Quote each problem verbatim, leave answer empty when the source provides none, and return [] when there are no problems.",
      {title:source.title,part:parts.length+1,excerpt}
    ));
    const summary=aiText(output.summary,7500);
    if (!Array.isArray(output.problems)) throw new HttpError(502,"Groq omitted the problem list. Retry this section.");
    const problems=output.problems.map(item=>{
      const problem=object(item);
      const quote=aiText(problem.quote,4600);
      if (!normalized(excerpt).includes(normalized(quote))) throw new HttpError(502,"Groq returned a problem without a matching source quote. Retry this section.");
      return {prompt:aiText(problem.prompt,3500),answer:typeof problem.answer==="string"?problem.answer.replaceAll("\u0000","").slice(0,3500):"",quote};
    });
    const client=await db.connect();
    try {
      await client.query("BEGIN");
      const current=(await client.query("SELECT version,status FROM resources WHERE id=$1 FOR UPDATE",[id])).rows[0];
      if (!current || current.version!==source.version || current.status==="archived") throw new HttpError(409,"The resource changed. Process the current version.");
      const saved=(await client.query("SELECT parts FROM demo_resource_analyses WHERE resource_id=$1 AND version=$2",[id,source.version])).rows[0]?.parts ?? [];
      if (saved.length!==parts.length) throw new HttpError(409,"This section was already processed. Continue from the saved progress.");
      await client.query(`INSERT INTO demo_resource_analyses(resource_id,version,parts) VALUES($1,$2,$3)
        ON CONFLICT(resource_id) DO UPDATE SET version=excluded.version,parts=excluded.parts`,
      [id,source.version,JSON.stringify([...parts,{summary,problems}])]);
      await client.query("COMMIT");
    } catch(error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    res.json({remaining:chunks.length-parts.length-1});
  });
  return router;
}
