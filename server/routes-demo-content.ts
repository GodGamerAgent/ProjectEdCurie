import { Router } from "express";
import type { Pool } from "pg";
import { cleanString, currentUser, normalizeEmail, teacherCourse, uuid } from "./access";
import { HttpError } from "./auth";
import { object } from "./demo-ai";
import { pendingSteps, sections, type AnalysisPart, type ProcessingMode } from "./resource-processing";

function dateField(value: unknown, label: string) {
  const date = cleanString(value,label,10);
  const iso = new Date(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+iso) || iso.toISOString().slice(0,10) !== date) {
    throw new HttpError(400,`Choose a valid ${label.toLowerCase()}.`);
  }
  return date;
}
export function demoContentRoutes(db: Pool) {
  const router = Router();
  const base = "/api/demo/courses/:courseId";
  router.get(base + "/teacher", async (req,res) => {
    const id=String(req.params.courseId);
    const {course} = await teacherCourse(db,currentUser(res),id);
    const [topics,resources,students,baseline,questions] = await Promise.all([
      db.query("SELECT id,title FROM demo_topics WHERE course_id=$1 AND deleted_at IS NULL ORDER BY created_at,id",[id]),
      db.query(`SELECT r.id,r.topic_id AS "topicId",r.title,r.text,r.status,r.version,r.extraction_status AS "extractionStatus",
        (r.file_data IS NOT NULL) AS "hasFile",r.pdf_pages AS "pdfPages",r.mime_type='application/pdf' AS "isPdf",
        r.processing_mode AS "processingMode",r.summary,r.summary_edited AS "summaryEdited",
        CASE WHEN (r.mime_type IS DISTINCT FROM 'application/pdf' OR a.input_mode<>'text')
          AND a.processing_mode IS NOT DISTINCT FROM r.processing_mode THEN a.parts END AS parts,
        coalesce(a.theory_generated,false) AS "theoryGenerated"
        FROM resources r LEFT JOIN demo_resource_analyses a ON a.resource_id=r.id AND a.version=r.version
        WHERE r.course_id=$1 AND r.status<>'archived' ORDER BY r.created_at,r.id`,[id]),
      db.query(`SELECT email,name,date_of_birth::text AS "dateOfBirth",enrolled_on::text AS "enrolledOn"
        FROM enrollments WHERE course_id=$1 ORDER BY email`,[id]),
      db.query(`SELECT draft,published IS NOT NULL AS published,revision,draft_version AS "draftVersion"
        FROM demo_baselines WHERE course_id=$1`,[id]),
      db.query(`SELECT q.id,q.resource_id AS "resourceId",q.origin,q.kind,q.prompt,q.quote,q.source_ref AS "sourceRef",q.answer,
        q.answer_source AS "answerSource",q.coding,q.coding_status AS "codingStatus",q.edited
        FROM demo_resource_questions q JOIN resources r ON r.id=q.resource_id
        WHERE r.course_id=$1 AND r.status<>'archived' ORDER BY q.position,q.created_at,q.id`,[id]),
    ]);
    res.json({course,topics:topics.rows,students:students.rows,
      resources:await Promise.all(resources.rows.map(async r=>{
        const sectionCount=r.isPdf?(r.pdfPages??1):Math.max(1,sections(r.text).length);
        const parts=(r.parts??[]) as AnalysisPart[];
        const steps=parts.length>=sectionCount?await pendingSteps(db,r.id,r.processingMode as ProcessingMode|null,parts,r.theoryGenerated):{theory:0,answers:0};
        const {theoryGenerated:_t,...resource}=r;
        return {...resource,sectionCount,pendingSteps:steps.theory+steps.answers,
          questions:questions.rows.filter(q=>q.resourceId===r.id)};
      })),
      baseline:baseline.rows[0] ?? {draft:[],published:false,revision:0,draftVersion:0}});
  });
  router.post(base + "/topics", async (req,res)=>{
    await teacherCourse(db,currentUser(res),String(req.params.courseId));
    const title = cleanString(req.body.title,"Topic name",200);
    const saved = await db.query("INSERT INTO demo_topics(course_id,title) VALUES($1,$2) RETURNING id,title",[String(req.params.courseId),title]);
    res.status(201).json(saved.rows[0]);
  });
  router.delete(base + "/topics/:topicId", async (req,res) => {
    const courseId=String(req.params.courseId), topicId=uuid(String(req.params.topicId));
    await teacherCourse(db,currentUser(res),courseId);
    const client=await db.connect();
    try {
      await client.query("BEGIN");
      const topic=await client.query("UPDATE demo_topics SET deleted_at=now() WHERE id=$1 AND course_id=$2 AND deleted_at IS NULL RETURNING id",[topicId,courseId]);
      if (!topic.rowCount) throw new HttpError(404,"Topic not found.");
      await client.query("UPDATE resources SET status='archived' WHERE topic_id=$1 AND course_id=$2",[topicId,courseId]);
      await client.query("COMMIT");
    } catch(error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {client.release();}
    res.status(204).end();
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

  return router;
}
