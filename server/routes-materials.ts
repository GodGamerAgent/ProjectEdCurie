import { Router } from "express";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import type { Pool } from "pg";
import { HttpError } from "./auth";
import { cleanString, courseAccess, currentUser, teacherCourse, uuid } from "./access";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
async function resourceById(db: Pool, id: string) {
  uuid(id);
  const result = await db.query("SELECT id,course_id,title,text,status,extraction_status,file_name,mime_type,version,(file_data IS NOT NULL) AS has_file FROM resources WHERE id=$1", [id]);
  if (!result.rowCount) throw new HttpError(404, "Resource not found.");
  return result.rows[0];
}
async function assessmentById(db: Pool, id: string) {
  uuid(id);
  const result = await db.query("SELECT id,course_id,status FROM assessments WHERE id=$1", [id]);
  if (!result.rowCount) throw new HttpError(404, "Assessment not found.");
  return result.rows[0];
}
export function materialRoutes(db: Pool) {
  const router = Router();
  router.post("/api/courses/:id/resources", async (req, res, next) => {
    try { await teacherCourse(db, currentUser(res), String(req.params.id)); next(); } catch (error) { next(error); }
  }, upload.single("file"), async (req, res) => {
    const title = cleanString(req.body.title, "Resource title", 200);
    let text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (text.length > 500_000) throw new HttpError(400, "Resource text is too long.");
    let extraction = text ? "manual" : "pending";
    let mime: string | null = null;
    if (req.file) {
      const isPdf = req.file.buffer.subarray(0, 5).toString() === "%PDF-";
      const isText = req.file.mimetype === "text/plain" && !req.file.buffer.includes(0);
      if (!isPdf && !isText) throw new HttpError(400, "Upload a PDF or plain text file.");
      mime = isPdf ? "application/pdf" : "text/plain";
      if (!text) {
        try {
          if (isPdf) {
            const parser = new PDFParse({ data: req.file.buffer });
            try {
              const result = await parser.getText();
              text = result.pages.map((page) => `[Page ${page.num}]\n${page.text.trim()}`).join("\n\n").trim();
              if (!result.pages.some((page) => page.text.trim())) text = "";
            } finally { await parser.destroy(); }
          } else text = new TextDecoder("utf-8", { fatal: true }).decode(req.file.buffer).trim();
          extraction = text ? "complete" : "error";
        } catch { extraction = "error"; }
      }
    } else if (!text) throw new HttpError(400, "Provide text or upload a PDF or text file.");
    if (text.length > 500_000) throw new HttpError(400, "Extracted text is too long; provide a shorter excerpt.");
    const user=currentUser(res),client=await db.connect();
    try{
      await client.query("BEGIN");
      const result = await client.query(`INSERT INTO resources (course_id,title,text,extraction_status,file_name,mime_type,file_data)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,title,status,extraction_status AS "extractionStatus",text,version`,
        [req.params.id, title, text, extraction, req.file?.originalname ?? null, mime, req.file?.buffer ?? null]);
      const resource=result.rows[0];
      await client.query(`INSERT INTO resource_versions (resource_id,version,title,text,status,extraction_status,file_name,mime_type,file_data,created_by)
        VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9)`,[resource.id,title,text,"draft",extraction,req.file?.originalname??null,mime,req.file?.buffer??null,user.id]);
      await client.query("COMMIT");res.status(201).json(resource);
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  });
  router.patch("/api/resources/:id", async (req, res) => {
    const resource = await resourceById(db, req.params.id);
    await teacherCourse(db, currentUser(res), resource.course_id);
    const title = cleanString(req.body.title, "Resource title", 200);
    const text = cleanString(req.body.text, "Resource text", 500_000);
    const user=currentUser(res),client=await db.connect();
    try{
      await client.query("BEGIN");
      const locked=await client.query("SELECT * FROM resources WHERE id=$1 FOR UPDATE",[resource.id]);
      const current=locked.rows[0],version=Number(current.version)+1;
      const result=await client.query(`UPDATE resources SET title=$2,text=$3,extraction_status='manual',status='draft',version=$4 WHERE id=$1
        RETURNING id,title,status,extraction_status AS "extractionStatus",text,version`,[resource.id,title,text,version]);
      await client.query(`INSERT INTO resource_versions (resource_id,version,title,text,status,extraction_status,file_name,mime_type,file_data,created_by)
        VALUES ($1,$2,$3,$4,'draft','manual',$5,$6,$7,$8)`,[resource.id,version,title,text,current.file_name,current.mime_type,current.file_data,user.id]);
      await client.query("COMMIT");res.json(result.rows[0]);
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  });
  router.post("/api/resources/:id/publish", async (req, res) => {
    const resource = await resourceById(db, req.params.id);
    await teacherCourse(db, currentUser(res), resource.course_id);
    if (!resource.text.trim()) throw new HttpError(400, "Add usable text before publishing this resource.");
    const client=await db.connect();
    try{await client.query("BEGIN");await client.query("UPDATE resources SET status='published' WHERE id=$1",[resource.id]);await client.query("UPDATE resource_versions SET status='published' WHERE resource_id=$1 AND version=$2",[resource.id,resource.version]);await client.query("COMMIT");res.json({status:"published"});}
    catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  });
  router.post("/api/resources/:id/archive",async(req,res)=>{
    const resource=await resourceById(db,req.params.id);await teacherCourse(db,currentUser(res),resource.course_id);
    await db.query("UPDATE resources SET status='archived' WHERE id=$1",[resource.id]);res.json({status:"archived"});
  });
  router.get("/api/resources/:id/versions",async(req,res)=>{
    const resource=await resourceById(db,req.params.id);await teacherCourse(db,currentUser(res),resource.course_id);
    const versions=await db.query(`SELECT id,version,title,status,extraction_status AS "extractionStatus",created_at AS "createdAt"
      FROM resource_versions WHERE resource_id=$1 ORDER BY version DESC`,[resource.id]);
    res.json({versions:versions.rows});
  });
  router.get("/api/resources/:id/file", async (req, res) => {
    const resource = await resourceById(db, req.params.id);
    const access = await courseAccess(db, currentUser(res), resource.course_id);
    if (!access.teacher && (resource.status !== "published" || !resource.text.trim())) throw new HttpError(404, "Resource not found.");
    if (!resource.has_file) throw new HttpError(404, "No original file is available.");
    const file = await db.query("SELECT file_data FROM resources WHERE id=$1", [resource.id]);
    const filename = String(resource.file_name || "resource").replace(/[^a-zA-Z0-9._-]/g, "_");
    res.setHeader("Content-Type", resource.mime_type);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(file.rows[0].file_data);
  });
  router.get("/api/resources/:id/excerpt",async(req,res)=>{
    const resource=await resourceById(db,String(req.params.id));
    const access=await courseAccess(db,currentUser(res),resource.course_id);
    if (!access.teacher && (resource.status !== "published" || !resource.text.trim())) throw new HttpError(404, "Resource not found.");
    const versionId=typeof req.query.version==="string"?uuid(req.query.version):null;
    const version=versionId?await db.query("SELECT id,title,text,status FROM resource_versions WHERE id=$1 AND resource_id=$2",[versionId,resource.id]):await db.query("SELECT id,title,text,status FROM resource_versions WHERE resource_id=$1 AND version=$2",[resource.id,resource.version]);
    if(!version.rowCount||(!access.teacher&&(version.rows[0].status!=="published"||!String(version.rows[0].text).trim())))throw new HttpError(404,"Resource source version not found.");
    const location=typeof req.query.location==="string"?req.query.location:"";
    if(!/^Page \d+$/.test(location)&&location!=="Section 1")throw new HttpError(400,"Choose a valid source section.");
    const parts=String(version.rows[0].text).split(/(?=\[Page \d+\])/).filter((x)=>x.trim());
    const text=location==="Section 1"?(parts.find((x)=>!x.match(/^\[Page \d+\]/))||parts[0]):parts.find((x)=>x.match(/^\[Page (\d+)\]/)?.[1]===location.slice(5));
    if(!text)throw new HttpError(404,"That source section is not available.");
    res.json({title:version.rows[0].title,versionId:version.rows[0].id,location,text:text.slice(0,20000)});
  });
  router.post("/api/courses/:id/assessments", async (req, res) => {
    await teacherCourse(db, currentUser(res), req.params.id);
    const title = cleanString(req.body.title, "Assessment title", 200);
    const result = await db.query("INSERT INTO assessments (course_id,title) VALUES ($1,$2) RETURNING id,title,status", [req.params.id, title]);
    res.status(201).json(result.rows[0]);
  });
  router.post("/api/assessments/:id/questions", async (req, res) => {
    const assessment = await assessmentById(db, req.params.id);
    await teacherCourse(db, currentUser(res), assessment.course_id);
    const prompt = cleanString(req.body.prompt, "Question", 5000);
    const answer = cleanString(req.body.answer, "Expected answer", 5000);
    const resourceId = uuid(cleanString(req.body.resourceId, "Source resource", 36));
    const source = await db.query(`SELECT r.version,rv.id AS "resourceVersionId" FROM resources r JOIN resource_versions rv ON rv.resource_id=r.id AND rv.version=r.version WHERE r.id=$1 AND r.course_id=$2`, [resourceId, assessment.course_id]);
    if (!source.rowCount) throw new HttpError(400, "The source resource must belong to this course.");
    const conceptId = req.body.conceptId ? uuid(cleanString(req.body.conceptId, "Concept", 36)) : null;
    if (conceptId && !(await db.query("SELECT 1 FROM concepts WHERE id=$1 AND course_id=$2", [conceptId, assessment.course_id])).rowCount) throw new HttpError(400, "The concept must belong to this course.");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`INSERT INTO questions (assessment_id,resource_id,prompt,answer,concept_id,resource_version_id)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,prompt,answer,resource_id AS "resourceId",concept_id AS "conceptId",version,resource_version_id AS "resourceVersionId"`, [assessment.id, resourceId, prompt, answer, conceptId,source.rows[0].resourceVersionId]);
      await client.query(`INSERT INTO question_versions (question_id,version,prompt,answer,resource_version_id,concept_id,created_by)
        VALUES ($1,1,$2,$3,$4,$5,$6)`,[result.rows[0].id,prompt,answer,source.rows[0].resourceVersionId,conceptId,currentUser(res).id]);
      await client.query("UPDATE assessments SET status='draft' WHERE id=$1", [assessment.id]);
      await client.query("COMMIT");
      res.status(201).json(result.rows[0]);
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  });
  router.patch("/api/questions/:id",async(req,res)=>{
    const question=await db.query(`SELECT q.*,a.course_id FROM questions q JOIN assessments a ON a.id=q.assessment_id WHERE q.id=$1`,[uuid(req.params.id)]);
    if(!question.rowCount)throw new HttpError(404,"Question not found.");
    const user=currentUser(res);await teacherCourse(db,user,question.rows[0].course_id);
    const prompt=cleanString(req.body.prompt,"Question",5000),answer=cleanString(req.body.answer,"Expected answer",5000);
    const conceptId=req.body.conceptId?uuid(cleanString(req.body.conceptId,"Concept",36)):null;
    const resourceId=req.body.resourceId?uuid(cleanString(req.body.resourceId,"Source resource",36)):question.rows[0].resource_id;
    const source=await db.query(`SELECT r.id,rv.id AS "resourceVersionId" FROM resources r JOIN resource_versions rv ON rv.resource_id=r.id AND rv.version=r.version
      WHERE r.id=$1 AND r.course_id=$2`,[resourceId,question.rows[0].course_id]);
    if(!source.rowCount)throw new HttpError(400,"Choose a source resource from this course.");
    if(conceptId&&!(await db.query("SELECT 1 FROM concepts WHERE id=$1 AND course_id=$2",[conceptId,question.rows[0].course_id])).rowCount)throw new HttpError(400,"Choose a concept in this course.");
    const client=await db.connect();
    try{
      await client.query("BEGIN");
      const locked=await client.query("SELECT * FROM questions WHERE id=$1 FOR UPDATE",[req.params.id]),q=locked.rows[0],version=Number(q.version)+1;
      const updated=await client.query(`UPDATE questions SET prompt=$2,answer=$3,concept_id=$4,version=$5,resource_id=$6,resource_version_id=$7 WHERE id=$1
        RETURNING id,prompt,answer,version,resource_id AS "resourceId",resource_version_id AS "resourceVersionId",concept_id AS "conceptId"`,[q.id,prompt,answer,conceptId,version,resourceId,source.rows[0].resourceVersionId]);
      await client.query("UPDATE assessments SET status='draft' WHERE id=$1",[q.assessment_id]);
      await client.query("INSERT INTO question_versions (question_id,version,prompt,answer,resource_version_id,concept_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [q.id,version,prompt,answer,source.rows[0].resourceVersionId,conceptId,user.id]);
      await client.query("COMMIT");res.json(updated.rows[0]);
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  });
  router.get("/api/questions/:id/versions",async(req,res)=>{
    const question=await db.query("SELECT a.course_id FROM questions q JOIN assessments a ON a.id=q.assessment_id WHERE q.id=$1",[uuid(req.params.id)]);
    if(!question.rowCount)throw new HttpError(404,"Question not found.");
    await teacherCourse(db,currentUser(res),question.rows[0].course_id);
    const versions=await db.query(`SELECT qv.version,qv.prompt,qv.answer,qv.resource_version_id AS "resourceVersionId",qv.created_at AS "createdAt"
      FROM question_versions qv WHERE qv.question_id=$1 ORDER BY qv.version DESC`,[req.params.id]);
    res.json({versions:versions.rows});
  });
  router.post("/api/assessments/:id/publish", async (req, res) => {
    const assessment = await assessmentById(db, req.params.id);
    await teacherCourse(db, currentUser(res), assessment.course_id);
    const valid = await db.query(`SELECT 1 FROM questions q JOIN resources r ON r.id=q.resource_id
      JOIN resource_versions rv ON rv.id=q.resource_version_id AND rv.resource_id=r.id
      WHERE q.assessment_id=$1 AND r.course_id=$2 AND r.status='published' AND length(btrim(r.text))>0
      AND rv.status='published' AND length(btrim(rv.text))>0
      AND length(btrim(q.prompt))>0 AND length(btrim(q.answer))>0 LIMIT 1`, [assessment.id, assessment.course_id]);
    if (!valid.rowCount) throw new HttpError(400, "Add a valid question linked to published, usable material in this course before publishing.");
    await db.query("UPDATE assessments SET status='published' WHERE id=$1", [assessment.id]);
    res.json({ status: "published" });
  });
  return router;
}
