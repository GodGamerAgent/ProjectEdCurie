import { pdfPageCount, pdfPageImage } from "./pdf-input";
import { Router } from "express";
import type { Pool } from "pg";
import { cleanString, currentUser, normalizeEmail, teacherCourse, uuid } from "./access";
import { HttpError } from "./auth";
import { aiText, analyzePdf, demoAI, object, readAISettings } from "./demo-ai";

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

type AnalysisPart = { page?: number; summary: string; problems: {prompt:string;answer:string;quote:string}[] };
function analysisPart(output:Record<string,unknown>,page?:number):AnalysisPart {
  if (!Array.isArray(output.problems)) throw new HttpError(502,"The AI omitted the problem list. Retry this section.");
  return {
    page, summary:aiText(output.summary,7500),
    problems:output.problems.map(item=>{
      const problem=object(item);
      return {prompt:aiText(problem.prompt,6500),quote:aiText(problem.quote,6500),
        answer:typeof problem.answer==="string"?problem.answer.replaceAll("\u0000","").slice(0,3500):""};
    }),
  };
}

export function demoContentRoutes(db: Pool) {
  const router = Router();
  const base = "/api/demo/courses/:courseId";
  router.get(base + "/teacher", async (req,res) => {
    const id=String(req.params.courseId);
    const {course} = await teacherCourse(db,currentUser(res),id);
    const [topics,resources,students,baseline] = await Promise.all([
      db.query("SELECT id,title FROM demo_topics WHERE course_id=$1 AND deleted_at IS NULL ORDER BY created_at,id",[id]),
      db.query(`SELECT r.id,r.topic_id AS "topicId",r.title,r.text,r.status,r.version,r.extraction_status AS "extractionStatus",
        (r.file_data IS NOT NULL) AS "hasFile",r.pdf_pages AS "pdfPages",r.mime_type='application/pdf' AS "isPdf",
        CASE WHEN r.mime_type IS DISTINCT FROM 'application/pdf' OR a.input_mode<>'text' THEN a.parts END AS parts
        FROM resources r LEFT JOIN demo_resource_analyses a ON a.resource_id=r.id AND a.version=r.version
        WHERE r.course_id=$1 AND r.status<>'archived' ORDER BY r.created_at,r.id`,[id]),
      db.query(`SELECT email,name,date_of_birth::text AS "dateOfBirth",enrolled_on::text AS "enrolledOn"
        FROM enrollments WHERE course_id=$1 ORDER BY email`,[id]),
      db.query(`SELECT draft,published IS NOT NULL AS published,revision,draft_version AS "draftVersion"
        FROM demo_baselines WHERE course_id=$1`,[id]),
    ]);
    res.json({course,topics:topics.rows,students:students.rows,
      resources:resources.rows.map(r=>({...r, sectionCount:r.isPdf?(r.pdfPages??1):sections(r.text).length})),
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

  router.post("/api/demo/resources/:id/process",async (req,res)=>{
    const id=uuid(String(req.params.id));
    const source=(await db.query(`SELECT r.course_id,r.title,r.text,r.version,r.mime_type,r.pdf_pages,r.file_name,a.parts,a.input_mode
      FROM resources r LEFT JOIN demo_resource_analyses a ON a.resource_id=r.id AND a.version=r.version
      WHERE r.id=$1 AND r.status<>'archived'`,[id])).rows[0];
    if (!source) throw new HttpError(404,"Resource not found.");
    await teacherCourse(db,currentUser(res),source.course_id);
    const isPdf=source.mime_type==="application/pdf";
    const settings=await readAISettings(db);
    const mode=isPdf?(settings.pdfMode==="file"?"pdf-file":"pdf-pages"):"text";
    const parts: AnalysisPart[]=source.input_mode===mode?source.parts??[]:[];
    let newParts: AnalysisPart[];
    let total: number;
    if (isPdf) {
      if (source.pdf_pages && parts.length>=source.pdf_pages) return res.json({remaining:0});
      const stored=await db.query("SELECT file_data FROM resources WHERE id=$1 AND version=$2 AND status<>'archived'",[id,source.version]);
      const bytes=stored.rows[0]?.file_data;
      if (!Buffer.isBuffer(bytes)) throw new HttpError(409,"The PDF changed or its original file is unavailable.");
      total=source.pdf_pages ?? await pdfPageCount(bytes);
      const page=parts.length+1;
      const prompt="Review the actual PDF content visually. Read every heading, paragraph, example, diagram, table, equation, and code block on the requested pages. Return JSON {pages:[{page,summary,problems:[{prompt,answer,quote}]}]} with one entry for each page listed in expectedPages, in order. When the entire PDF is attached but only one page is requested, use the other pages for context and return only the requested page. Use the actual PDF page numbers (1-based). Summarize every topic and subtopic taught on each requested page, including definitions, methods, formulas, examples, and conclusions. For a blank or title-only page, say so. Extract only exercises, lab tasks, or worked questions that actually appear. Preserve numbering, every subpart, constraints, variables, equations, inputs and outputs, and code. Put the verbatim printed statement in quote and use Markdown and LaTeX in prompt. Leave answer empty unless the document explicitly gives the answer. Never invent or solve a problem. If a question continues on another page, keep the visible portion and mark the continuation in prompt. Use an empty problems array on pages without questions.";
      const pdf={filename:source.file_name||"resource.pdf",bytes};
      const data={title:source.title,totalPages:total};
      const wholeFileInput={...data,expectedPages:`1 through ${total}`};
      const singlePageInput={...data,expectedPages:[page]};
      const original={wholeFileInput,singlePageInput,pdf,firstPage:page===1};
      const analysis=mode==="pdf-file"
        ? await analyzePdf(db,prompt,page===1?wholeFileInput:singlePageInput,settings,{pdf},original)
        : await analyzePdf(db,prompt,singlePageInput,settings,{image:await pdfPageImage(bytes,page)},original);
      const result=object(analysis.result);
      const expected=analysis.wholeFile?Array.from({length:total},(_,i)=>i+1):[page];
      if (!Array.isArray(result.pages) || result.pages.length!==expected.length) throw new HttpError(502,"The AI response omitted pages. Retry, or use Page images for long PDFs.");
      newParts=result.pages.map((value,i)=>{
        const entry=object(value);
        if(entry.page!==expected[i]) throw new HttpError(502,"The AI response returned pages out of order. Retry this request.");
        return analysisPart(entry,expected[i]);
      });
    } else {
      const chunks=sections(source.text);
      if (!source.text.trim()) throw new HttpError(400,"Add readable resource text in Review and edit, then process it.");
      total=chunks.length;
      if (parts.length>=total) return res.json({remaining:0});
      const excerpt=chunks[parts.length];
      const result=object(await demoAI(db,
        "Cover every topic, formula, example and method in this section. Return {summary:string,problems:[{prompt:string,answer:string,quote:string}]}. Extract only exercises actually in the section. Keep all subparts and the exact source quote. Leave the answer empty if it is not printed. Use [] when there are no problems.",
        {title:source.title,part:parts.length+1,excerpt},undefined,undefined,settings));
      const part=analysisPart(result);
      if (part.problems.some(problem=>!normalized(excerpt).includes(normalized(problem.quote)))) throw new HttpError(502,"The AI returned a problem without a matching source quote. Retry this section.");
      newParts=[part];
    }
    const updatedParts=[...parts,...newParts];
    const client=await db.connect();
    try {
      await client.query("BEGIN");
      const current=(await client.query("SELECT version,status,text,extraction_status FROM resources WHERE id=$1 FOR UPDATE",[id])).rows[0];
      if (!current || current.version!==source.version || current.status==="archived") throw new HttpError(409,"The resource changed. Process the current version.");
      const saved=(await client.query("SELECT parts FROM demo_resource_analyses WHERE resource_id=$1 AND version=$2 AND input_mode=$3",[id,source.version,mode])).rows[0]?.parts ?? [];
      if (saved.length!==parts.length) throw new HttpError(409,"This section was already processed. Continue from the saved progress.");
      await client.query(`INSERT INTO demo_resource_analyses(resource_id,version,parts,input_mode) VALUES($1,$2,$3,$4)
        ON CONFLICT(resource_id) DO UPDATE SET version=excluded.version,parts=excluded.parts,input_mode=excluded.input_mode`,
      [id,source.version,JSON.stringify(updatedParts),mode]);
      if (isPdf) {
        await client.query("UPDATE resources SET pdf_pages=$2 WHERE id=$1",[id,total]);
        if (updatedParts.length===total && current.status==="draft" && (current.extraction_status==="pending" || !current.text.trim())) {
          const markdown=updatedParts.map(part=>`## Page ${part.page}\n\n${part.summary}`+
            (part.problems.length?"\n\n### Problems\n\n"+part.problems.map(p=>p.prompt).join("\n\n"):"")).join("\n\n");
          if (markdown.length>500000) throw new HttpError(422,"The AI summary is too long. Split this PDF into smaller resources.");
          await client.query("UPDATE resources SET text=$2,extraction_status='complete' WHERE id=$1",[id,markdown]);
          await client.query("UPDATE resource_versions SET text=$3,extraction_status='complete' WHERE resource_id=$1 AND version=$2",[id,source.version,markdown]);
        }
      }
      await client.query("COMMIT");
    } catch(error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    res.json({remaining:total-updatedParts.length});
  });
  return router;
}
