import { Router } from "express";
import type { Pool } from "pg";
import { DefaultScheduler, Rating } from "ts-fsrs";
import { HttpError } from "./auth";
import { cleanString, currentUser, requireRole, uuid } from "./access";
import { studentReady } from "./routes-study";
import { awardXp } from "./xp";

const normalize=(value:string)=>value.trim().replace(/\s+/g," ").toLocaleLowerCase("en-US");
let schedulerPromise:ReturnType<typeof DefaultScheduler>|undefined;
const scheduler=()=>schedulerPromise??=(DefaultScheduler({version:"FSRS-7",desiredRetention:0.9,enableFuzz:false}));
export function reviewRoutes(db:Pool) {
  const router=Router();
  router.get("/api/courses/:id/reviews",async(req,res)=>{
    const user=currentUser(res);await studentReady(db,user,req.params.id);
    const data=await db.query(`SELECT rc.id,rc.concept_id AS "conceptId",c.name AS "conceptName",rc.due_at AS "dueAt",
      rc.last_reviewed_at AS "lastReviewedAt",rc.due_at<=now() AS due
      FROM review_cards rc JOIN concepts c ON c.id=rc.concept_id JOIN practice_problems p ON p.id=rc.problem_id
      JOIN questions q ON q.id=p.question_id JOIN question_versions qv ON qv.id=p.question_version_id AND qv.question_id=q.id
      JOIN resource_versions rv ON rv.id=qv.resource_version_id AND rv.status='published' AND length(btrim(rv.text))>0
      JOIN resources r ON r.id=rv.resource_id AND r.course_id=rc.course_id AND r.status='published'
      JOIN assessments a ON a.id=q.assessment_id AND a.course_id=rc.course_id AND a.status='published'
      WHERE rc.user_id=$2 AND rc.course_id=$1 ORDER BY rc.due_at`,[req.params.id,user.id]);
    res.json({cards:data.rows});
  });
  router.post("/api/review-cards/:id/start",async(req,res)=>{
    const user=currentUser(res);requireRole(user,"student");
    const cardId=uuid(req.params.id),row=(await db.query(`SELECT rc.id,rc.course_id AS "courseId",rc.due_at AS "dueAt",p.prompt,p.answer
      FROM review_cards rc JOIN practice_problems p ON p.id=rc.problem_id
      JOIN concepts c ON c.id=rc.concept_id JOIN questions q ON q.id=p.question_id
      JOIN question_versions qv ON qv.id=p.question_version_id AND qv.question_id=q.id AND qv.concept_id=c.id
      JOIN resource_versions rv ON rv.id=qv.resource_version_id AND rv.status='published' AND length(btrim(rv.text))>0
      JOIN resources r ON r.id=rv.resource_id AND r.course_id=rc.course_id AND r.status='published'
      JOIN assessments a ON a.id=q.assessment_id AND a.course_id=rc.course_id AND a.status='published'
      WHERE rc.id=$1 AND rc.user_id=$2`,[cardId,user.id])).rows[0];
    if(!row)throw new HttpError(404,"Review card not found.");
    await studentReady(db,user,row.courseId);
    if(new Date(row.dueAt).getTime()>Date.now())throw new HttpError(409,"This review is not due yet.");
    const client=await db.connect();
    try{
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`review-card:${cardId}`]);
      const current=(await client.query("SELECT * FROM review_sessions WHERE card_id=$1 AND user_id=$2 AND status='active' FOR UPDATE",[cardId,user.id])).rows[0];
      if(current){await client.query("COMMIT");return res.json({sessionId:current.id,prompt:current.prompt});}
      const inserted=await client.query("INSERT INTO review_sessions(card_id,user_id,prompt,expected_answer) VALUES($1,$2,$3,$4) RETURNING id,prompt",
        [cardId,user.id,row.prompt,row.answer]);
      await client.query("COMMIT");res.status(201).json({sessionId:inserted.rows[0].id,prompt:inserted.rows[0].prompt});
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  });
  router.post("/api/review-sessions/:id/answer",async(req,res)=>{
    const user=currentUser(res);requireRole(user,"student");
    const sessionId=uuid(req.params.id),answer=cleanString(req.body?.answer,"Answer",5000);
    const owner=(await db.query(`SELECT s.id,rc.course_id AS "courseId" FROM review_sessions s JOIN review_cards rc ON rc.id=s.card_id
      WHERE s.id=$1 AND s.user_id=$2`,[sessionId,user.id])).rows[0];
    if(!owner)throw new HttpError(404,"Review session not found.");
    await studentReady(db,user,owner.courseId);
    const client=await db.connect();
    try{
      await client.query("BEGIN");
      const session=(await client.query("SELECT * FROM review_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE",[sessionId,user.id])).rows[0];
      if(!session)throw new HttpError(404,"Review session not found.");
      if(session.status==="answered"){
        await client.query("COMMIT");return res.json(session.result);
      }
      const cardRow=(await client.query("SELECT * FROM review_cards WHERE id=$1 AND user_id=$2 FOR UPDATE",[session.card_id,user.id])).rows[0];
      if(!cardRow)throw new HttpError(404,"Review card not found.");
      const correct=normalize(answer)===normalize(session.expected_answer),grade=correct?Rating.Good:Rating.Again,now=new Date();
      const f=await scheduler(),card=typeof cardRow.card==="string"?JSON.parse(cardRow.card):structuredClone(cardRow.card);
      card.dueAt=new Date(card.dueAt);if(card.lastReviewAt)card.lastReviewAt=new Date(card.lastReviewAt);
      const next=f.review({card:card as any,grade,now}),dueAt=next.card.dueAt;
      const result={correct,expectedAnswer:session.expected_answer,dueAt:dueAt.toISOString(),
        intervalDays:next.card.scheduledDays,message:correct?"Correct. FSRS scheduled your next review.":"Not quite. FSRS scheduled an earlier review."};
      await client.query(`UPDATE review_cards SET card=$2::jsonb,due_at=$3,last_reviewed_at=$4 WHERE id=$1`,
        [cardRow.id,JSON.stringify(next.card),dueAt,now]);
      await client.query(`UPDATE review_sessions SET selected_answer=$2,correct=$3,result=$4::jsonb,status='answered',answered_at=$5 WHERE id=$1`,
        [sessionId,answer,correct,JSON.stringify(result),now]);
      await client.query(`INSERT INTO study_attempts(user_id,course_id,concept_id,review_session_id,problem_id,kind,correct,assisted)
        SELECT rc.user_id,rc.course_id,rc.concept_id,$2,rc.problem_id,'review',$3,false
        FROM review_cards rc WHERE rc.id=$1`,
        [cardRow.id,sessionId,correct]);
      await client.query(`INSERT INTO review_events(session_id,card_id,user_id,rating,correct,previous_due_at,next_due_at,review_log)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [sessionId,cardRow.id,user.id,grade,correct,cardRow.due_at,dueAt,JSON.stringify(next.revlog)]);
      await awardXp(client,user.id,owner.courseId,`review:${sessionId}`,correct?5:2,correct?"Review recalled":"Review attempted");
      await client.query("COMMIT");res.json(result);
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  });
  return router;
}
