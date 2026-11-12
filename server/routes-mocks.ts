import { Router } from "express";
import type { Pool } from "pg";
import { HttpError } from "./auth";
import { cleanString, currentUser, requireRole, uuid } from "./access";
import { studentReady } from "./routes-study";

const normalize=(value:string)=>value.trim().replace(/\s+/g," ").toLocaleLowerCase("en-US");
function clientView(session:any) {
  const questions=Array.isArray(session.questions)?session.questions.map((q:any)=>({id:q.id,conceptId:q.conceptId,conceptName:q.conceptName,
    prompt:q.prompt,sourceTitle:q.sourceTitle,sourceLocation:q.sourceLocation})):session.questions;
  return {id:session.id,status:session.status,questions,answers:session.answers||{},result:session.status==="completed"?session.result:null};
}
export function mockRoutes(db:Pool) {
  const router=Router();
  router.post("/api/courses/:id/mocks/start",async(req,res)=>{
    const user=currentUser(res);requireRole(user,"student");const courseId=uuid(req.params.id);
    await studentReady(db,user,courseId);
    const client=await db.connect();
    try{
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`${user.id}:${courseId}:adaptive-mock`]);
      const existing=(await client.query("SELECT * FROM adaptive_mock_sessions WHERE user_id=$1 AND course_id=$2 AND status='active' FOR UPDATE",[user.id,courseId])).rows[0];
      if(existing){await client.query("COMMIT");return res.json(clientView(existing));}
      const questions=(await client.query(`SELECT qv.question_id AS id,qv.concept_id AS "conceptId",c.name AS "conceptName",qv.prompt,qv.answer AS "expectedAnswer",
          r.title AS "sourceTitle",'Published course material'::text AS "sourceLocation",
          CASE WHEN EXISTS(SELECT 1 FROM study_attempts sa WHERE sa.user_id=$2 AND sa.concept_id=c.id AND sa.correct=false) THEN 0
               WHEN EXISTS(SELECT 1 FROM study_attempts sa WHERE sa.user_id=$2 AND sa.concept_id=c.id) THEN 1 ELSE 2 END AS priority
        FROM assessments a JOIN questions q ON q.assessment_id=a.id
        JOIN question_versions qv ON qv.question_id=q.id AND qv.version=q.version
        JOIN concepts c ON c.id=qv.concept_id AND c.course_id=a.course_id
        JOIN resource_versions rv ON rv.id=qv.resource_version_id AND rv.status='published' AND length(btrim(rv.text))>0
        JOIN resources r ON r.id=rv.resource_id AND r.course_id=a.course_id AND r.status='published'
        WHERE a.course_id=$1 AND a.status='published' AND length(btrim(qv.answer))>0
        ORDER BY priority,c.name,qv.question_id LIMIT 10`,[courseId,user.id])).rows;
      if(!questions.length)throw new HttpError(400,"No published, source-linked questions are available for a mock.");
      const session=(await client.query(`INSERT INTO adaptive_mock_sessions(user_id,course_id,questions,question_count)
        VALUES($1,$2,$3::jsonb,$4) RETURNING *`,[user.id,courseId,JSON.stringify(questions),questions.length])).rows[0];
      await client.query("COMMIT");res.status(201).json(clientView(session));
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  });
  router.get("/api/mock-sessions/:id",async(req,res)=>{
    const user=currentUser(res);requireRole(user,"student");const id=uuid(req.params.id);
    const session=(await db.query("SELECT * FROM adaptive_mock_sessions WHERE id=$1 AND user_id=$2",[id,user.id])).rows[0];
    if(!session)throw new HttpError(404,"Mock session not found.");
    await studentReady(db,user,session.course_id);
    res.json(clientView(session));
  });
  router.post("/api/mock-sessions/:id/answer",async(req,res)=>{
    const user=currentUser(res);requireRole(user,"student");const id=uuid(req.params.id);
    const questionId=uuid(req.body?.questionId),answer=cleanString(req.body?.answer,"Answer",5000);
    const client=await db.connect();
    try{
      await client.query("BEGIN");
      const session=(await client.query("SELECT * FROM adaptive_mock_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE",[id,user.id])).rows[0];
      if(!session)throw new HttpError(404,"Mock session not found.");
      await studentReady(db,user,session.course_id);
      if(session.status!=="active")throw new HttpError(409,"This mock is already submitted.");
      const questions=Array.isArray(session.questions)?session.questions:JSON.parse(session.questions);
      if(!questions.some((q:any)=>q.id===questionId))throw new HttpError(400,"That question is not part of this mock.");
      const answers=typeof session.answers==="string"?JSON.parse(session.answers):session.answers||{};
      answers[questionId]=answer;
      await client.query("UPDATE adaptive_mock_sessions SET answers=$2::jsonb WHERE id=$1",[id,JSON.stringify(answers)]);
      await client.query("COMMIT");res.json({saved:true,answered:Object.keys(answers).length});
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  });
  router.post("/api/mock-sessions/:id/submit",async(req,res)=>{
    const user=currentUser(res);requireRole(user,"student");const id=uuid(req.params.id),client=await db.connect();
    try{
      await client.query("BEGIN");
      const session=(await client.query("SELECT * FROM adaptive_mock_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE",[id,user.id])).rows[0];
      if(!session)throw new HttpError(404,"Mock session not found.");
      await studentReady(db,user,session.course_id);
      if(session.status==="completed"){await client.query("COMMIT");return res.json(session.result);}
      const questions=Array.isArray(session.questions)?session.questions:JSON.parse(session.questions);
      const answers=typeof session.answers==="string"?JSON.parse(session.answers):session.answers||{};
      if(questions.some((q:any)=>typeof answers[q.id]!=="string"))throw new HttpError(400,"Answer every question before submitting.");
      const details=questions.map((q:any)=>({questionId:q.id,conceptName:q.conceptName,prompt:q.prompt,answer:answers[q.id],
        expectedAnswer:q.expectedAnswer,correct:normalize(answers[q.id])===normalize(q.expectedAnswer)}));
      const correctCount=details.filter((q:any)=>q.correct).length,score=Math.round(100*correctCount/questions.length);
      const result={score,correctCount,questionCount:questions.length,details,
        message:"Mock submitted. This score is stored separately and does not change mastery evidence."};
      await client.query(`UPDATE adaptive_mock_sessions SET status='completed',score=$2,correct_count=$3,result=$4::jsonb,completed_at=now() WHERE id=$1`,
        [id,score,correctCount,JSON.stringify(result)]);
      await client.query("COMMIT");res.json(result);
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  });
  return router;
}
