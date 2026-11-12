import { Router } from "express";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import type { Pool } from "pg";
import { HttpError } from "./auth";
import { cleanString, courseAccess, currentUser, requireRole, teacherCourse, uuid } from "./access";

const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:1}});
const misconceptionCodes=new Set(["concept_gap","procedure_error","misread_question","units_or_notation","source_use","other"]);
export function assignmentRoutes(db:Pool) {
  const router=Router();
  router.get("/api/courses/:id/assignments",async(req,res)=>{
    const user=currentUser(res),courseId=uuid(req.params.id);
    if(user.role==="teacher"){
      await teacherCourse(db,user,courseId);
      const rows=await db.query(`SELECT a.id,a.title,a.instructions,a.concept_id AS "conceptId",c.name AS "conceptName",
        a.due_at AS "dueAt",a.rubric,a.status,a.created_at AS "createdAt",count(s.id)::int AS "submissionCount"
        FROM assignments a LEFT JOIN assignment_submissions s ON s.assignment_id=a.id LEFT JOIN concepts c ON c.id=a.concept_id
        WHERE a.course_id=$1 GROUP BY a.id,c.name ORDER BY a.created_at DESC`,[courseId]);
      return res.json({assignments:rows.rows});
    }
    requireRole(user,"student");await courseAccess(db,user,courseId);
    const rows=await db.query(`SELECT a.id,a.title,a.instructions,a.concept_id AS "conceptId",c.name AS "conceptName",a.due_at AS "dueAt",a.rubric,a.status,
      s.id AS "submissionId",s.response,s.diagnosis,s.confidence,s.status AS "submissionStatus",
      s.file_name AS "fileName",s.mime_type AS "mimeType",s.extraction_status AS "extractionStatus",
      CASE WHEN s.status='reviewed' THEN s.score END AS score,
      CASE WHEN s.status='reviewed' THEN s.rubric_scores END AS "rubricScores",
      CASE WHEN s.status='reviewed' THEN s.misconception END AS misconception,
      CASE WHEN s.status='reviewed' THEN s.misconception_code END AS "misconceptionCode",
      CASE WHEN s.status='reviewed' THEN s.verified_evidence END AS "verifiedEvidence",
      CASE WHEN s.status='reviewed' THEN s.teacher_feedback END AS "teacherFeedback",
      s.submitted_at AS "submittedAt",s.reviewed_at AS "reviewedAt"
      FROM assignments a LEFT JOIN concepts c ON c.id=a.concept_id LEFT JOIN assignment_submissions s ON s.assignment_id=a.id AND s.user_id=$2
      WHERE a.course_id=$1 AND a.status='published' ORDER BY a.due_at NULLS LAST,a.created_at`,[courseId,user.id]);
    res.json({assignments:rows.rows});
  });
  router.post("/api/courses/:id/assignments",async(req,res)=>{
    const user=currentUser(res),courseId=uuid(req.params.id);await teacherCourse(db,user,courseId);
    const title=cleanString(req.body?.title,"Assignment title",160),instructions=cleanString(req.body?.instructions,"Instructions",10000);
    const conceptId=req.body?.conceptId?uuid(req.body.conceptId):null;
    if(conceptId&&!((await db.query("SELECT 1 FROM concepts WHERE id=$1 AND course_id=$2",[conceptId,courseId])).rowCount))throw new HttpError(400,"Choose a concept from this course.");
    const dueAt=req.body?.dueAt?new Date(req.body.dueAt):null;
    if(dueAt&&Number.isNaN(dueAt.getTime()))throw new HttpError(400,"Due date is invalid.");
    const rubric=req.body?.rubric??[];
    if(!Array.isArray(rubric)||rubric.length>8||rubric.some((x:any)=>typeof x!=="string"||!x.trim()||x.length>240))throw new HttpError(400,"Rubric must contain up to eight short criteria.");
    const result=await db.query(`INSERT INTO assignments(course_id,concept_id,created_by,title,instructions,due_at,rubric)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id,title,instructions,concept_id AS "conceptId",due_at AS "dueAt",rubric,status`,
      [courseId,conceptId,user.id,title,instructions,dueAt,JSON.stringify(rubric)]);
    res.status(201).json(result.rows[0]);
  });
  router.post("/api/assignments/:id/publish",async(req,res)=>{
    const user=currentUser(res),id=uuid(req.params.id);
    const assignment=(await db.query("SELECT course_id FROM assignments WHERE id=$1",[id])).rows[0];
    if(!assignment)throw new HttpError(404,"Assignment not found.");
    await teacherCourse(db,user,assignment.course_id);
    const result=await db.query(`UPDATE assignments SET status='published',published_at=COALESCE(published_at,now())
      WHERE id=$1 AND status IN('draft','published') RETURNING id,status,published_at AS "publishedAt"`,[id]);
    res.json(result.rows[0]);
  });
  router.post("/api/assignments/:id/submissions",upload.single("file"),async(req,res)=>{
    const user=currentUser(res);requireRole(user,"student");const id=uuid(String(req.params.id));
    let response=typeof req.body?.response==="string"?req.body.response.trim():"";
    let extractionStatus="manual",mimeType:string|null=null;
    if(req.file){
      const isPdf=req.file.buffer.subarray(0,5).toString()==="%PDF-";
      const isText=req.file.mimetype==="text/plain"&&!req.file.buffer.includes(0);
      if(!isPdf&&!isText)throw new HttpError(400,"Upload a PDF or plain text file.");
      mimeType=isPdf?"application/pdf":"text/plain";
      try{
        let extracted="";
        if(isPdf){
          const parser=new PDFParse({data:req.file.buffer});
          try{const parsed=await parser.getText();extracted=parsed.pages.map(page=>`[Page ${page.num}]\n${page.text.trim()}`).join("\n\n").trim();}
          finally{await parser.destroy();}
        }else extracted=new TextDecoder("utf-8",{fatal:true}).decode(req.file.buffer).trim();
        if(!extracted)throw new HttpError(400,"This file has no extractable text. Submit a text-based PDF or plain text file.");
        response=response?`${response}\n\n[Attached file text]\n${extracted}`:extracted;extractionStatus="complete";
      }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,"The attachment could not be read. Upload a text PDF or plain text file.");}
    }
    if(!response.trim())throw new HttpError(400,"Write a response or attach a text PDF or plain text file.");
    if(response.length>(req.file?500000:20000))throw new HttpError(400,"The assignment response is too long.");
    if(!req.file)response=cleanString(response,"Assignment response",20000);
    const diagnosis=req.body?.diagnosis==null||req.body.diagnosis===""?"":cleanString(req.body.diagnosis,"What felt difficult",1000);
    const confidence=Number(req.body?.confidence);
    if(!Number.isInteger(confidence)||confidence<1||confidence>5)throw new HttpError(400,"Confidence must be between 1 and 5.");
    const assignment=(await db.query("SELECT course_id,status,due_at FROM assignments WHERE id=$1",[id])).rows[0];
    if(!assignment||assignment.status!=="published")throw new HttpError(404,"Published assignment not found.");
    await courseAccess(db,user,assignment.course_id);
    const client=await db.connect();
    try{
      await client.query("BEGIN");
      const prior=(await client.query("SELECT * FROM assignment_submissions WHERE assignment_id=$1 AND user_id=$2 FOR UPDATE",[id,user.id])).rows[0];
      if(prior?.status==="reviewed")throw new HttpError(409,"This submission has been reviewed and cannot be replaced.");
      const saved=prior
        ?await client.query(`UPDATE assignment_submissions SET response=$3,diagnosis=$4,confidence=$5,file_name=$6,mime_type=$7,file_data=$8,extraction_status=$9,submitted_at=now()
          WHERE assignment_id=$1 AND user_id=$2 RETURNING id,status,submitted_at AS "submittedAt"`,
          [id,user.id,response,diagnosis,confidence,req.file?.originalname.slice(0,255)??null,mimeType,req.file?.buffer??null,extractionStatus])
        :await client.query(`INSERT INTO assignment_submissions(assignment_id,user_id,response,diagnosis,confidence,file_name,mime_type,file_data,extraction_status)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,status,submitted_at AS "submittedAt"`,[id,user.id,response,diagnosis,confidence,req.file?.originalname.slice(0,255)??null,mimeType,req.file?.buffer??null,extractionStatus]);
      await client.query("COMMIT");res.status(prior?200:201).json({...saved.rows[0],fileName:req.file?.originalname??null,extractionStatus});
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  });
  router.get("/api/assignments/:id/submissions",async(req,res)=>{
    const user=currentUser(res),id=uuid(req.params.id);
    const assignment=(await db.query("SELECT course_id,rubric FROM assignments WHERE id=$1",[id])).rows[0];
    if(!assignment)throw new HttpError(404,"Assignment not found.");
    await teacherCourse(db,user,assignment.course_id);
    const submissions=await db.query(`SELECT s.id,s.user_id AS "userId",u.email,s.response,s.diagnosis,s.confidence,s.status,
      s.file_name AS "fileName",s.extraction_status AS "extractionStatus",
      s.score,s.rubric_scores AS "rubricScores",s.misconception,s.misconception_code AS "misconceptionCode",
      s.verified_evidence AS "verifiedEvidence",s.teacher_feedback AS "teacherFeedback",
      s.submitted_at AS "submittedAt",s.reviewed_at AS "reviewedAt"
      FROM assignment_submissions s JOIN users u ON u.id=s.user_id WHERE s.assignment_id=$1 ORDER BY s.submitted_at`,[id]);
    res.json({rubric:assignment.rubric,submissions:submissions.rows});
  });
  router.get("/api/assignment-submissions/:id/file",async(req,res)=>{
    const user=currentUser(res),id=uuid(req.params.id);
    const row=(await db.query(`SELECT s.user_id,a.course_id,s.file_data,s.file_name,s.mime_type
      FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id WHERE s.id=$1`,[id])).rows[0];
    if(!row||!row.file_data)throw new HttpError(404,"Submission file not found.");
    if(user.role==="student"){
      if(user.id!==row.user_id)throw new HttpError(404,"Submission file not found.");
      await courseAccess(db,user,row.course_id);
    }else await teacherCourse(db,user,row.course_id);
    const filename=String(row.file_name||"submission").replace(/["\\\r\n]/g,"_");
    res.setHeader("Content-Type",row.mime_type||"application/octet-stream");
    res.setHeader("Content-Disposition",`attachment; filename="${filename}"`);
    res.send(row.file_data);
  });
  router.post("/api/assignment-submissions/:id/review",async(req,res)=>{
    const user=currentUser(res),id=uuid(req.params.id);
    const score=Number(req.body?.score),feedback=cleanString(req.body?.feedback,"Teacher feedback",4000);
    const misconception=req.body?.misconception==null||req.body.misconception===""?"":cleanString(req.body.misconception,"Misconception",240);
    const misconceptionCode=req.body?.misconceptionCode==null||req.body.misconceptionCode===""?null:cleanString(req.body.misconceptionCode,"Error category",40);
    if(misconceptionCode&&!misconceptionCodes.has(misconceptionCode))throw new HttpError(400,"Choose a supported error category.");
    const includeEvidence=req.body?.includeEvidence===true;
    const found=(await db.query(`SELECT s.assignment_id,a.course_id,a.concept_id AS "conceptId",a.rubric FROM assignment_submissions s
      JOIN assignments a ON a.id=s.assignment_id WHERE s.id=$1`,[id])).rows[0];
    if(!found)throw new HttpError(404,"Submission not found.");
    await teacherCourse(db,user,found.course_id);
    if(!Number.isInteger(score)||score<0||score>100)throw new HttpError(400,"Score must be a whole number from 0 to 100.");
    if(includeEvidence&&!found.conceptId)throw new HttpError(400,"Link this assignment to a course concept before including it as verified evidence.");
    const rubric=Array.isArray(found.rubric)?found.rubric:JSON.parse(found.rubric);
    const scores=req.body?.rubricScores;
    if(!Array.isArray(scores)||scores.length!==rubric.length||scores.some((x:any)=>!Number.isInteger(x)||x<0||x>4))throw new HttpError(400,"Provide a 0–4 score for each rubric criterion.");
    const client=await db.connect();
    try{
      await client.query("BEGIN");
      const result=await client.query(`UPDATE assignment_submissions SET status='reviewed',score=$2,rubric_scores=$3::jsonb,
        misconception=NULLIF($4,''),misconception_code=$5,verified_evidence=$6,teacher_feedback=$7,reviewed_by=$8,reviewed_at=now()
        WHERE id=$1 RETURNING id,status,score,rubric_scores AS "rubricScores",misconception,
        misconception_code AS "misconceptionCode",verified_evidence AS "verifiedEvidence",
        teacher_feedback AS "teacherFeedback",reviewed_at AS "reviewedAt"`,
        [id,score,JSON.stringify(scores),misconception,misconceptionCode,includeEvidence,feedback,user.id]);
      if(includeEvidence){
        await client.query(`INSERT INTO assignment_evidence(submission_id,user_id,course_id,concept_id,score,misconception_code,reviewed_by)
          SELECT s.id,s.user_id,a.course_id,a.concept_id,$2,$3,$4 FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id
          WHERE s.id=$1 ON CONFLICT(submission_id) DO UPDATE SET score=excluded.score,misconception_code=excluded.misconception_code,reviewed_by=excluded.reviewed_by,created_at=now()`,
          [id,score,misconceptionCode,user.id]);
      }else await client.query("DELETE FROM assignment_evidence WHERE submission_id=$1",[id]);
      await client.query("COMMIT");res.json(result.rows[0]);
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  });
  return router;
}
