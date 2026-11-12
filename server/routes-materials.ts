import { Router } from "express";
import multer from "multer";
import { pdfPageCount } from "./pdf-input";
import type { Pool } from "pg";
import { HttpError } from "./auth";
import { cleanString, currentUser, teacherCourse, uuid } from "./access";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
const databaseText = (value: unknown) => typeof value === "string" ? value.replaceAll("\u0000", "") : "";

async function resourceById(db: Pool, id: string) {
  uuid(id);
  const result = await db.query("SELECT id,course_id,title,text,status,extraction_status,file_name,mime_type,version,(file_data IS NOT NULL) AS has_file FROM resources WHERE id=$1", [id]);
  if (!result.rowCount) throw new HttpError(404, "Resource not found.");
  return result.rows[0];
}
export function materialRoutes(db: Pool) {
  const router = Router();
  router.post("/api/courses/:id/resources", async (req, res, next) => {
    try { await teacherCourse(db, currentUser(res), String(req.params.id)); next(); } catch (error) { next(error); }
  }, upload.single("file"), async (req, res) => {
    const topicId = uuid(cleanString(req.body.topicId, "Topic", 36));
    const title = cleanString(databaseText(req.body.title), "Resource title", 200);
    let text = databaseText(req.body.text);
    if (text.length > 500_000) throw new HttpError(400, "Resource text is too long.");
    let extraction = text.trim() ? "manual" : "pending";
    let mime: string | null = null;
    let pdfPages: number | null = null;
    if (req.file) {
      const isPdf = req.file.buffer.subarray(0, 5).toString() === "%PDF-";
      const isMarkdown = /\.(md|markdown)$/i.test(req.file.originalname) &&
        ["text/markdown", "text/plain", "application/octet-stream"].includes(req.file.mimetype);
      const isText = (isMarkdown || req.file.mimetype === "text/plain") && !req.file.buffer.includes(0);
      if (!isPdf && !isText) throw new HttpError(400, "Upload a PDF, Markdown, or plain text file.");
      mime = isPdf ? "application/pdf" : isMarkdown ? "text/markdown; charset=utf-8" : "text/plain";
      if (isPdf) {
        pdfPages = await pdfPageCount(req.file.buffer);
        extraction = "pending";
      } else if (!text.trim()) {
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(req.file.buffer);
          extraction = text.trim() ? "complete" : "error";
        } catch { extraction = "error"; }
      }
    } else if (!text.trim()) throw new HttpError(400, "Provide text or upload a PDF or text file.");
    text = databaseText(text);
    if (text.length > 500_000) {
      if (!req.file || extraction !== "complete") throw new HttpError(400, "Resource text is too long; provide a shorter excerpt.");
      text = "";
      extraction = "error";
    }
    if (!text.trim() && !pdfPages) { text = ""; extraction = "error"; }
    const user=currentUser(res),client=await db.connect();
    try{
      await client.query("BEGIN");
      const topic=await client.query("SELECT 1 FROM demo_topics WHERE id=$1 AND course_id=$2 AND deleted_at IS NULL FOR SHARE",[topicId,req.params.id]);
      if (!topic.rowCount) throw new HttpError(400,"Choose an active topic in this course.");
      const result = await client.query(`INSERT INTO resources (course_id,title,text,extraction_status,file_name,mime_type,file_data,topic_id,pdf_pages)
        VALUES ($1,$2,$3,$4,$5,$6,decode($7,'base64'),$8,$9) RETURNING id,title,status,extraction_status AS "extractionStatus",text,version,pdf_pages AS "pdfPages"`,
        [req.params.id, title, text, extraction, databaseText(req.file?.originalname).trim() || null, mime, req.file?.buffer.toString("base64") ?? null,topicId,pdfPages]);
      const resource=result.rows[0];
      await client.query(`INSERT INTO resource_versions (resource_id,version,title,text,status,extraction_status,file_name,mime_type,file_data,created_by)
        SELECT id,version,title,text,status,extraction_status,file_name,mime_type,file_data,$2 FROM resources WHERE id=$1`, [resource.id,user.id]);
      await client.query("COMMIT");res.status(201).json(resource);
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  });
  router.patch("/api/resources/:id", async (req, res) => {
    const resource = await resourceById(db, req.params.id);
    await teacherCourse(db, currentUser(res), resource.course_id);
    if (resource.status === "archived") throw new HttpError(404, "Resource not found.");
    const title = cleanString(databaseText(req.body.title), "Resource title", 200);
    const text = databaseText(req.body.text);
    if (!text.trim() || text.length > 500_000) throw new HttpError(400, "Resource text is required and must be at most 500000 characters.");
    const user=currentUser(res),client=await db.connect();
    try{
      await client.query("BEGIN");
      const locked=await client.query("SELECT version,status FROM resources WHERE id=$1 FOR UPDATE",[resource.id]);
      const current=locked.rows[0];
      if (!current || current.status === "archived") throw new HttpError(404, "Resource not found.");
      const version=Number(current.version)+1;
      const result=await client.query(`UPDATE resources SET title=$2,text=$3,extraction_status='manual',status='draft',version=$4 WHERE id=$1
        RETURNING id,title,status,extraction_status AS "extractionStatus",text,version`,[resource.id,title,text,version]);
      await client.query(`INSERT INTO resource_versions (resource_id,version,title,text,status,extraction_status,file_name,mime_type,file_data,created_by)
        SELECT id,version,title,text,status,extraction_status,file_name,mime_type,file_data,$2 FROM resources WHERE id=$1`, [resource.id,user.id]);
      await client.query("COMMIT");res.json(result.rows[0]);
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  });
  router.post("/api/resources/:id/publish", async (req, res) => {
    const resource = await resourceById(db, req.params.id);
    await teacherCourse(db, currentUser(res), resource.course_id);
    if (resource.status === "archived") throw new HttpError(404, "Resource not found.");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const current = (await client.query("SELECT text,version,status FROM resources WHERE id=$1 FOR UPDATE", [resource.id])).rows[0];
      if (!current || current.status === "archived") throw new HttpError(404, "Resource not found.");
      if (!current.text.trim()) throw new HttpError(400, "Add usable text before publishing this resource.");
      await client.query("UPDATE resources SET status='published' WHERE id=$1", [resource.id]);
      await client.query("UPDATE resource_versions SET status='published' WHERE resource_id=$1 AND version=$2", [resource.id,current.version]);
      await client.query("COMMIT");
      res.json({status:"published"});
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
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
  router.get("/api/resources/:id/versions/:versionId", async (req, res) => {
    const resource = await resourceById(db, req.params.id);
    await teacherCourse(db, currentUser(res), resource.course_id);
    if (resource.status === "archived") throw new HttpError(404, "Resource not found.");
    const version = await db.query("SELECT title,version,text FROM resource_versions WHERE id=$1 AND resource_id=$2",
      [uuid(req.params.versionId),resource.id]);
    if (!version.rowCount) throw new HttpError(404, "Resource version not found.");
    res.json(version.rows[0]);
  });
  router.get("/api/resources/:id/file", async (req, res) => {
    const resource = await resourceById(db, req.params.id);
    await teacherCourse(db, currentUser(res), resource.course_id);
    if (resource.status === "archived") throw new HttpError(404, "Resource not found.");
    if (!resource.has_file) throw new HttpError(404, "No original file is available.");
    const file = await db.query("SELECT file_data FROM resources WHERE id=$1", [resource.id]);
    const filename = String(resource.file_name || "resource").replace(/[^a-zA-Z0-9._-]/g, "_");
    res.setHeader("Content-Type", resource.mime_type);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(file.rows[0].file_data);
  });
  return router;
}
