import { Router } from "express";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import type { Pool } from "pg";
import { HttpError } from "./auth";
import { cleanString, courseAccess, currentUser, teacherCourse, uuid } from "./access";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
async function resourceById(db: Pool, id: string) {
  uuid(id);
  const result = await db.query("SELECT id,course_id,title,text,status,extraction_status,file_name,mime_type,(file_data IS NOT NULL) AS has_file FROM resources WHERE id=$1", [id]);
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
    const result = await db.query(`INSERT INTO resources (course_id,title,text,extraction_status,file_name,mime_type,file_data)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,title,status,extraction_status AS "extractionStatus",text`,
      [req.params.id, title, text, extraction, req.file?.originalname ?? null, mime, req.file?.buffer ?? null]);
    res.status(201).json(result.rows[0]);
  });
  router.patch("/api/resources/:id", async (req, res) => {
    const resource = await resourceById(db, req.params.id);
    await teacherCourse(db, currentUser(res), resource.course_id);
    const title = cleanString(req.body.title, "Resource title", 200);
    const text = cleanString(req.body.text, "Resource text", 500_000);
    const result = await db.query(`UPDATE resources SET title=$2,text=$3,extraction_status='manual',status='draft' WHERE id=$1
      RETURNING id,title,status,extraction_status AS "extractionStatus",text`, [resource.id, title, text]);
    res.json(result.rows[0]);
  });
  router.post("/api/resources/:id/publish", async (req, res) => {
    const resource = await resourceById(db, req.params.id);
    await teacherCourse(db, currentUser(res), resource.course_id);
    if (!resource.text.trim()) throw new HttpError(400, "Add usable text before publishing this resource.");
    await db.query("UPDATE resources SET status='published' WHERE id=$1", [resource.id]);
    res.json({ status: "published" });
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
    const source = await db.query("SELECT 1 FROM resources WHERE id=$1 AND course_id=$2", [resourceId, assessment.course_id]);
    if (!source.rowCount) throw new HttpError(400, "The source resource must belong to this course.");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`INSERT INTO questions (assessment_id,resource_id,prompt,answer)
        VALUES ($1,$2,$3,$4) RETURNING id,prompt,answer,resource_id AS "resourceId"`, [assessment.id, resourceId, prompt, answer]);
      await client.query("UPDATE assessments SET status='draft' WHERE id=$1", [assessment.id]);
      await client.query("COMMIT");
      res.status(201).json(result.rows[0]);
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  });
  router.post("/api/assessments/:id/publish", async (req, res) => {
    const assessment = await assessmentById(db, req.params.id);
    await teacherCourse(db, currentUser(res), assessment.course_id);
    const valid = await db.query(`SELECT 1 FROM questions q JOIN resources r ON r.id=q.resource_id
      WHERE q.assessment_id=$1 AND r.course_id=$2 AND r.status='published' AND length(btrim(r.text))>0
      AND length(btrim(q.prompt))>0 AND length(btrim(q.answer))>0 LIMIT 1`, [assessment.id, assessment.course_id]);
    if (!valid.rowCount) throw new HttpError(400, "Add a valid question linked to published, usable material in this course before publishing.");
    await db.query("UPDATE assessments SET status='published' WHERE id=$1", [assessment.id]);
    res.json({ status: "published" });
  });
  return router;
}
