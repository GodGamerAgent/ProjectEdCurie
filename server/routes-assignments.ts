import { Router } from "express";
import type { Pool } from "pg";
import { HttpError } from "./auth";
import { cleanString, courseAccess, currentUser, requireRole, teacherCourse, uuid } from "./access";

export function assignmentRoutes(db:Pool) {
  const router=Router();
  router.get("/api/courses/:id/assignments",async(req,res)=>{
    const user=currentUser(res),courseId=uuid(req.params.id);
    if(user.role==="teacher"){
      await teacherCourse(db,user,courseId);
      const rows=await db.query(`SELECT a.id,a.title,a.instructions,a.due_at AS "dueAt",a.rubric,a.status,a.created_at AS "createdAt",
        count(s.id)::int AS "submissionCount" FROM assignments a LEFT JOIN assignment_submissions s ON s.assignment_id=a.id
        WHERE a.course_id=$1 GROUP BY a.id ORDER BY a.created_at DESC`,[courseId]);
      return res.json({assignments:rows.rows});
    }
    requireRole(user,"student");await courseAccess(db,user,courseId);
    const rows=await db.query(`SELECT a.id,a.title,a.instructions,a.due_at AS "dueAt",a.rubric,a.status,
      s.id AS "submissionId",s.response,s.diagnosis,s.confidence,s.status AS "submissionStatus",
      CASE WHEN s.status='reviewed' THEN s.score END AS score,
      CASE WHEN s.status='reviewed' THEN s.rubric_scores END AS "rubricScores",
      CASE WHEN s.status='reviewed' THEN s.misconception END AS misconception,
      CASE WHEN s.status='reviewed' THEN s.teacher_feedback END AS "teacherFeedback",
      s.submitted_at AS "submittedAt",s.reviewed_at AS "reviewedAt"
      FROM assignments a LEFT JOIN assignment_submissions s ON s.assignment_id=a.id AND s.user_id=$2
      WHERE a.course_id=$1 AND a.status='published' ORDER BY a.due_at NULLS LAST,a.created_at`,[courseId,user.id]);
    res.json({assignments:rows.rows});
  });
  router.post("/api/courses/:id/assignments",async(req,res)=>{
    const user=currentUser(res),courseId=uuid(req.params.id);await teacherCourse(db,user,courseId);
    const title=cleanString(req.body?.title,"Assignment title",160),instructions=cleanString(req.body?.instructions,"Instructions",10000);
    const dueAt=req.body?.dueAt?new Date(req.body.dueAt):null;
    if(dueAt&&Number.isNaN(dueAt.getTime()))throw new HttpError(400,"Due date is invalid.");
    const rubric=req.body?.rubric??[];
    if(!Array.isArray(rubric)||rubric.length>8||rubric.some((x:any)=>typeof x!=="string"||!x.trim()||x.length>240))throw new HttpError(400,"Rubric must contain up to eight short criteria.");
    const result=await db.query(`INSERT INTO assignments(course_id,created_by,title,instructions,due_at,rubric)
      VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING id,title,instructions,due_at AS "dueAt",rubric,status`,
      [courseId,user.id,title,instructions,dueAt,JSON.stringify(rubric)]);
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
  router.post("/api/assignments/:id/submissions",async(req,res)=>{
    const user=currentUser(res);requireRole(user,"student");const id=uuid(req.params.id);
    const response=cleanString(req.body?.response,"Assignment response",20000);
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
        ?await client.query(`UPDATE assignment_submissions SET response=$3,diagnosis=$4,confidence=$5,submitted_at=now()
          WHERE assignment_id=$1 AND user_id=$2 RETURNING id,status,submitted_at AS "submittedAt"`,[id,user.id,response,diagnosis,confidence])
        :await client.query(`INSERT INTO assignment_submissions(assignment_id,user_id,response,diagnosis,confidence)
          VALUES($1,$2,$3,$4,$5) RETURNING id,status,submitted_at AS "submittedAt"`,[id,user.id,response,diagnosis,confidence]);
      await client.query("COMMIT");res.status(prior?200:201).json(saved.rows[0]);
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  });
  router.get("/api/assignments/:id/submissions",async(req,res)=>{
    const user=currentUser(res),id=uuid(req.params.id);
    const assignment=(await db.query("SELECT course_id,rubric FROM assignments WHERE id=$1",[id])).rows[0];
    if(!assignment)throw new HttpError(404,"Assignment not found.");
    await teacherCourse(db,user,assignment.course_id);
    const submissions=await db.query(`SELECT s.id,s.user_id AS "userId",u.email,s.response,s.diagnosis,s.confidence,s.status,
      s.score,s.rubric_scores AS "rubricScores",s.misconception,s.teacher_feedback AS "teacherFeedback",
      s.submitted_at AS "submittedAt",s.reviewed_at AS "reviewedAt"
      FROM assignment_submissions s JOIN users u ON u.id=s.user_id WHERE s.assignment_id=$1 ORDER BY s.submitted_at`,[id]);
    res.json({rubric:assignment.rubric,submissions:submissions.rows});
  });
  router.post("/api/assignment-submissions/:id/review",async(req,res)=>{
    const user=currentUser(res),id=uuid(req.params.id);
    const score=Number(req.body?.score),feedback=cleanString(req.body?.feedback,"Teacher feedback",4000);
    const misconception=req.body?.misconception==null||req.body.misconception===""?"":cleanString(req.body.misconception,"Misconception",240);
    const found=(await db.query(`SELECT s.assignment_id,a.course_id,a.rubric FROM assignment_submissions s
      JOIN assignments a ON a.id=s.assignment_id WHERE s.id=$1`,[id])).rows[0];
    if(!found)throw new HttpError(404,"Submission not found.");
    await teacherCourse(db,user,found.course_id);
    if(!Number.isInteger(score)||score<0||score>100)throw new HttpError(400,"Score must be a whole number from 0 to 100.");
    const rubric=Array.isArray(found.rubric)?found.rubric:JSON.parse(found.rubric);
    const scores=req.body?.rubricScores;
    if(!Array.isArray(scores)||scores.length!==rubric.length||scores.some((x:any)=>!Number.isInteger(x)||x<0||x>4))throw new HttpError(400,"Provide a 0–4 score for each rubric criterion.");
    const result=await db.query(`UPDATE assignment_submissions SET status='reviewed',score=$2,rubric_scores=$3::jsonb,
      misconception=NULLIF($4,''),teacher_feedback=$5,reviewed_by=$6,reviewed_at=now()
      WHERE id=$1 RETURNING id,status,score,rubric_scores AS "rubricScores",misconception,
      teacher_feedback AS "teacherFeedback",reviewed_at AS "reviewedAt"`,
      [id,score,JSON.stringify(scores),misconception,feedback,user.id]);
    res.json(result.rows[0]);
  });
  return router;
}
