import { Router } from "express";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { HttpError } from "./auth";
import { currentUser, uuid } from "./access";
import { studentReady } from "./routes-study";
import { awardXp } from "./xp";

type Window={weekday:number;startTime:string;endTime:string};
type Candidate={id:string;name:string;learning_minutes:number;practice_minutes:number;revision_minutes:number;difficulty:number;errors:number;prerequisites:string[]};
type Local={date:string;weekday:number;minute:number};
const DAY:Record<string,number>={Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:7};
const hm=(value:string)=>Number(value.slice(0,2))*60+Number(value.slice(3));
const local=(stamp:number,timezone:string):Local=>{
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(stamp));
  const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return {date:`${v.year}-${v.month}-${v.day}`,weekday:DAY[v.weekday],minute:Number(v.hour)*60+Number(v.minute)};
};
function deadlineInstant(date:string,timezone:string){
  const target=Date.parse(`${date}T23:59:00Z`);let guess=target;
  for(let i=0;i<3;i++){
    const current=local(guess,timezone),hour=Math.floor(current.minute/60),minute=current.minute%60;
    const wall=Date.parse(`${current.date}T${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}:00Z`);
    guess+=target-wall;
  }
  return guess+59999;
}
function overlap(start:number,end:number,start2:number,end2:number){return start<end2&&start2<end;}
function planResponse(plan:any,blocks:any[]){return {plan,blocks};}

export function planRoutes(db:Pool) {
  const router=Router();
  async function inputs(user:any,courseId:string,deadlineOverride?:string){
    await studentReady(db,user,courseId);
    const [goalResult,availabilityResult,commitmentResult,eventResult,conceptResult]=await Promise.all([
      db.query("SELECT goal,deadline FROM study_goals WHERE user_id=$1 AND course_id=$2",[user.id,courseId]),
      db.query("SELECT timezone,session_minutes AS \"sessionMinutes\",intervals FROM student_availability WHERE user_id=$1 AND course_id=$2",[user.id,courseId]),
      db.query("SELECT starts_at AS \"startsAt\",ends_at AS \"endsAt\" FROM student_commitments WHERE user_id=$1 AND (course_id IS NULL OR course_id=$2)",[user.id,courseId]),
      db.query(`SELECT e.weekday,e.start_time AS "startTime",e.end_time AS "endTime",e.starts_on AS "startsOn",e.ends_on AS "endsOn",e.timezone,
        COALESCE((SELECT json_agg(x.exception_date) FROM class_timetable_exceptions x WHERE x.event_id=e.id),'[]'::json) AS exceptions
        FROM class_timetable_events e WHERE e.course_id=$1 AND e.status='active'`,[courseId]),
      db.query(`SELECT c.id,c.name,c.learning_minutes,c.practice_minutes,c.revision_minutes,c.difficulty,
        COALESCE((SELECT array_agg(cp.prerequisite_id) FROM concept_prerequisites cp WHERE cp.concept_id=c.id),'{}') AS prerequisites,
        (count(sa.id) FILTER(WHERE sa.kind IN('baseline','practice','twin','review','diagnostic') AND sa.correct=false)
          + COALESCE((SELECT count(*) FROM assignment_evidence ae WHERE ae.user_id=$2 AND ae.course_id=c.course_id AND ae.concept_id=c.id AND ae.score<70),0))::int AS errors
        FROM concepts c JOIN resources r ON r.id=c.resource_id AND r.course_id=c.course_id AND r.status='published'
        JOIN resource_versions rv ON rv.resource_id=r.id AND rv.version=r.version AND rv.status='published' AND length(btrim(rv.text))>0
        LEFT JOIN study_attempts sa ON sa.concept_id=c.id AND sa.user_id=$2 AND sa.course_id=c.course_id
        WHERE c.course_id=$1 AND EXISTS(SELECT 1 FROM questions q JOIN assessments a ON a.id=q.assessment_id
          JOIN question_versions qv ON qv.question_id=q.id AND qv.version=q.version
          JOIN resource_versions src ON src.id=qv.resource_version_id AND src.status='published' AND length(btrim(src.text))>0
          WHERE a.course_id=c.course_id AND a.status='published' AND q.concept_id=c.id)
        GROUP BY c.id ORDER BY c.name`,[courseId,user.id])
    ]);
    const goal=goalResult.rows[0];
    if(!goal)throw new HttpError(400,"Save a study goal and deadline before building a plan.");
    const deadline=deadlineOverride??goal.deadline;
    const day=new Date(`${deadline}T00:00:00Z`),today=new Date();today.setUTCHours(0,0,0,0);
    if(!Number.isFinite(day.getTime()))throw new HttpError(400,"The saved goal deadline is invalid.");
    if(day<today)throw new HttpError(400,"The saved deadline has passed. Choose a new study goal deadline.");
    if(day.getTime()-today.getTime()>366*86400000)throw new HttpError(400,"Choose a deadline within the next 12 months to keep the schedule realistic.");
    const availability=availabilityResult.rows[0]??{timezone:"Asia/Kolkata",sessionMinutes:30,intervals:[]};
    const windows=availability.intervals as Window[];
    const commitments=commitmentResult.rows.map((r:any)=>({start:new Date(r.startsAt).getTime(),end:new Date(r.endsAt).getTime()}));
    const events=eventResult.rows;
    const topics:Candidate[]=conceptResult.rows.map((r:any)=>({...r,prerequisites:r.prerequisites??[]}));
    const candidates=new Set(topics.map(t=>t.id));
    const pending=new Set(topics.map(t=>t.id)),ordered:Candidate[]=[];
    while(pending.size){
      const ready=topics.filter(t=>pending.has(t.id)&&t.prerequisites.every(id=>!candidates.has(id)||!pending.has(id)));
      if(!ready.length)throw new HttpError(409,"The course prerequisite graph cannot be scheduled. Ask your teacher to review it.");
      ready.sort((a,b)=>b.errors-a.errors||b.difficulty-a.difficulty||a.name.localeCompare(b.name));
      for(const topic of ready){ordered.push(topic);pending.delete(topic.id);}
    }
    const work=ordered.reduce((sum,t)=>sum+t.learning_minutes+t.practice_minutes+t.revision_minutes,0);
    return {goal,deadline,timezone:availability.timezone,sessionMinutes:availability.sessionMinutes as number,
      windows,commitments,events,topics:ordered,requiredMinutes:work};
  }
  function hasTime(start:number,duration:number,input:Awaited<ReturnType<typeof inputs>>){
    const end=start+duration*60000,localStart=local(start,input.timezone),localEnd=local(end,input.timezone);
    if(localStart.date!==localEnd.date||localStart.weekday<1||!input.windows.some(w=>w.weekday===localStart.weekday&&hm(w.startTime)<=localStart.minute&&localEnd.minute<=hm(w.endTime)))return false;
    if(input.commitments.some(c=>overlap(start,end,c.start,c.end)))return false;
    for(const e of input.events){
      const eventStart=local(start,e.timezone),eventEnd=local(end,e.timezone);
      if(eventStart.date!==eventEnd.date||eventStart.date<e.startsOn||eventStart.date>e.endsOn||eventStart.weekday!==e.weekday||
        (e.exceptions as string[]).includes(eventStart.date))continue;
      if(overlap(eventStart.minute,eventEnd.minute,hm(e.startTime),hm(e.endTime)))return false;
    }
    return true;
  }
  function capacityFor(input:Awaited<ReturnType<typeof inputs>>){
    const end=deadlineInstant(input.deadline,input.timezone),step=15*60000;
    let total=0;
    for(let stamp=Math.ceil(Date.now()/step)*step;stamp+step<=end;stamp+=step)if(hasTime(stamp,15,input))total+=15;
    return total;
  }
  async function makePlan(user:any,courseId:string,requestKey:string){
    const existing=await db.query("SELECT * FROM study_plans WHERE request_key=$1",[requestKey]);
    if(existing.rowCount){
      if(existing.rows[0].user_id!==user.id||existing.rows[0].course_id!==courseId)throw new HttpError(409,"This plan request key is already in use.");
      const blocks=await db.query(`SELECT id,concept_id AS "conceptId",phase,starts_at AS "startsAt",ends_at AS "endsAt",state,explanation
        FROM study_blocks WHERE plan_id=$1 ORDER BY starts_at`,[existing.rows[0].id]);
      return planResponse(existing.rows[0],blocks.rows);
    }
    const previousPlan=(await db.query("SELECT id,deadline FROM study_plans WHERE user_id=$1 AND course_id=$2 ORDER BY version DESC LIMIT 1",[user.id,courseId])).rows[0];
    const input=await inputs(user,courseId,previousPlan?.deadline);
    const todayStart=Date.now(),deadlineEnd=deadlineInstant(input.deadline,input.timezone);
    const intervalMs=15*60000,first=Math.ceil(todayStart/intervalMs)*intervalMs;
    const prior=await db.query(`SELECT DISTINCT concept_id AS "conceptId",phase FROM study_blocks b JOIN study_plans p ON p.id=b.plan_id
      WHERE b.user_id=$1 AND b.course_id=$2 AND b.state IN('completed','started')`,[user.id,courseId]);
    const done=new Set(prior.rows.map((r:any)=>`${r.conceptId}:${r.phase}`));
    const tasks=input.topics.flatMap(topic=>[
      {topic,phase:"learning",minutes:topic.learning_minutes},
      {topic,phase:"practice",minutes:topic.practice_minutes},
      {topic,phase:"revision",minutes:topic.revision_minutes}
    ]).filter(task=>task.minutes>0&&!done.has(`${task.topic.id}:${task.phase}`));
    const remainingMinutes=tasks.reduce((sum,task)=>sum+task.minutes,0);
    const blocks:{conceptId:string;phase:string;startsAt:Date;endsAt:Date;explanation:string}[]=[];
    let capacity=0,cursor=first;
    for(let slot=first;slot+intervalMs<=deadlineEnd;slot+=intervalMs)if(hasTime(slot,15,input))capacity+=15;
    for(const task of tasks){
      let remaining=task.minutes;
      while(remaining>0){
        const duration=Math.min(input.sessionMinutes,remaining);
        let start=cursor;
        for(;start+duration*60000<=deadlineEnd;start+=intervalMs){
          if(hasTime(start,duration,input))break;
        }
        if(start+duration*60000>deadlineEnd){cursor=deadlineEnd;break;}
        const end=start+duration*60000;
        blocks.push({conceptId:task.topic.id,phase:task.phase,startsAt:new Date(start),endsAt:new Date(end),
          explanation:`${task.phase==="learning"?"Build the concept":task.phase==="practice"?"Practice without hints":"Return to the concept"} · teacher estimate · difficulty ${task.topic.difficulty}/5`});
        remaining-=duration;cursor=end+15*60000;
      }
    }
    const scheduled=blocks.reduce((n,b)=>n+(b.endsAt.getTime()-b.startsAt.getTime())/60000,0);
    const score=remainingMinutes===0?1:Math.max(1,Math.min(10,Math.floor(capacity/remainingMinutes*10)));
    const explanation=input.windows.length===0?"Add weekly availability to make a realistic schedule."
      :remainingMinutes===0?"No unfinished teacher-estimated phases remain for the eligible published concepts."
      :capacity<remainingMinutes?`Only ${capacity} available minutes fit before the unchanged deadline; ${remainingMinutes} minutes remain in the teacher estimates. ${remainingMinutes-scheduled} minutes remain unscheduled.`
      :`The available windows fit the remaining ${remainingMinutes}-minute estimate before the unchanged deadline.`;
    const client=await db.connect();
    try{
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`study-plan:${user.id}:${courseId}`]);
      const duplicate=await client.query("SELECT * FROM study_plans WHERE request_key=$1",[requestKey]);
      if(duplicate.rowCount){
        if(duplicate.rows[0].user_id!==user.id||duplicate.rows[0].course_id!==courseId)throw new HttpError(409,"This plan request key is already in use.");
        const rows=await client.query(`SELECT id,concept_id AS "conceptId",phase,starts_at AS "startsAt",ends_at AS "endsAt",state,explanation
          FROM study_blocks WHERE plan_id=$1 ORDER BY starts_at`,[duplicate.rows[0].id]);
        await client.query("COMMIT");return planResponse(duplicate.rows[0],rows.rows);
      }
      const latest=(await client.query("SELECT id FROM study_plans WHERE user_id=$1 AND course_id=$2 ORDER BY version DESC LIMIT 1",[user.id,courseId])).rows[0];
      if(latest?.id!==previousPlan?.id)throw new HttpError(409,"A newer plan was saved while this one was being prepared. Recalculate from the latest plan.");
      const version=(await client.query("SELECT COALESCE(max(version),0)+1 AS v FROM study_plans WHERE user_id=$1 AND course_id=$2",[user.id,courseId])).rows[0].v;
      const previous=previousPlan;
      const fixedDeadline=previous?.deadline??input.deadline;
      const saved=await client.query(`INSERT INTO study_plans(user_id,course_id,request_key,version,deadline,feasibility_score,required_minutes,capacity_minutes,explanation)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [user.id,courseId,requestKey,version,fixedDeadline,score,remainingMinutes,capacity,explanation]);
      if(previous){
        await client.query("UPDATE study_blocks SET state=CASE WHEN ends_at<now() THEN 'missed' ELSE 'replanned' END WHERE plan_id=$1 AND state='planned'",[previous.id]);
      }
      for(const block of blocks)await client.query(`INSERT INTO study_blocks(plan_id,user_id,course_id,concept_id,phase,starts_at,ends_at,explanation)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [saved.rows[0].id,user.id,courseId,block.conceptId,block.phase,block.startsAt,block.endsAt,block.explanation]);
      const savedBlocks=await client.query(`SELECT id,concept_id AS "conceptId",phase,starts_at AS "startsAt",ends_at AS "endsAt",state,explanation
        FROM study_blocks WHERE plan_id=$1 ORDER BY starts_at`,[saved.rows[0].id]);
      await client.query("COMMIT");
      return planResponse(saved.rows[0],savedBlocks.rows);
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
  router.get("/api/courses/:id/feasibility",async(req,res)=>{
    const user=currentUser(res);
    const previous=await db.query("SELECT deadline FROM study_plans WHERE user_id=$1 AND course_id=$2 ORDER BY version DESC LIMIT 1",[user.id,req.params.id]);
    const input=await inputs(user,req.params.id,previous.rows[0]?.deadline);
    const deadline=input.deadline;
    const prior=await db.query(`SELECT DISTINCT concept_id AS "conceptId",phase FROM study_blocks b JOIN study_plans p ON p.id=b.plan_id
      WHERE b.user_id=$1 AND b.course_id=$2 AND b.state IN('completed','started')`,[user.id,req.params.id]);
    const done=new Set(prior.rows.map((r:any)=>`${r.conceptId}:${r.phase}`));
    const requiredMinutes=input.topics.reduce((sum,topic)=>sum+
      (done.has(`${topic.id}:learning`)?0:topic.learning_minutes)+
      (done.has(`${topic.id}:practice`)?0:topic.practice_minutes)+
      (done.has(`${topic.id}:revision`)?0:topic.revision_minutes),0);
    const capacityMinutes=capacityFor(input);
    const score=requiredMinutes===0?1:Math.max(1,Math.min(10,Math.floor(capacityMinutes/requiredMinutes*10)));
    res.json({deadline,requiredMinutes,capacityMinutes,score,explanation:requiredMinutes===0?"No published concepts are ready to schedule."
      :capacityMinutes===0?"No weekly availability is saved before this deadline."
      :capacityMinutes<requiredMinutes?`Estimated work exceeds weekly availability by ${requiredMinutes-capacityMinutes} minutes in the simple capacity check.`
      :"Saved availability, class events, and personal commitments fit the remaining work."});
  });
  router.post("/api/courses/:id/plan",async(req,res)=>{
    const user=currentUser(res),requestKey=uuid(req.body?.requestKey);
    res.status(200).json(await makePlan(user,req.params.id,requestKey));
  });
  router.get("/api/courses/:id/plan",async(req,res)=>{
    const user=currentUser(res);await studentReady(db,user,req.params.id);
    let plan=(await db.query("SELECT * FROM study_plans WHERE user_id=$1 AND course_id=$2 ORDER BY version DESC LIMIT 1",[user.id,req.params.id])).rows[0];
    if(!plan)return res.json({plan:null,blocks:[]});
    const trigger=(await db.query(`SELECT
      EXISTS(SELECT 1 FROM study_blocks b WHERE b.plan_id=$3 AND b.user_id=$1 AND b.state='planned' AND b.ends_at<now()) OR
      EXISTS(SELECT 1 FROM study_attempts a WHERE a.user_id=$1 AND a.course_id=$2 AND a.created_at>$4
        AND a.kind IN('baseline','practice','twin','review','diagnostic','comprehension')) AS needed`,
      [user.id,req.params.id,plan.id,plan.created_at])).rows[0].needed;
    let recalibrated=false;
    if(trigger){
      try{await makePlan(user,req.params.id,randomUUID());recalibrated=true;}
      catch(error){if(!(error instanceof HttpError&&error.status===409))throw error;}
      plan=(await db.query("SELECT * FROM study_plans WHERE user_id=$1 AND course_id=$2 ORDER BY version DESC LIMIT 1",[user.id,req.params.id])).rows[0];
    }
    const blocks=await db.query(`SELECT b.id,b.concept_id AS "conceptId",c.name AS "conceptName",b.phase,b.starts_at AS "startsAt",b.ends_at AS "endsAt",b.state,b.explanation,b.started_at AS "startedAt",b.completed_at AS "completedAt"
      FROM study_blocks b JOIN concepts c ON c.id=b.concept_id JOIN study_plans p ON p.id=b.plan_id
      WHERE b.user_id=$1 AND b.course_id=$2 AND (b.plan_id=$3 OR b.state IN('completed','started','missed','replanned'))
      ORDER BY b.starts_at`,[user.id,req.params.id,plan.id]);
    res.json({...planResponse(plan,blocks.rows),recalibrated});
  });
  router.post("/api/study-blocks/:id/start",async(req,res)=>{
    const user=currentUser(res),id=uuid(req.params.id);
    const row=(await db.query("SELECT course_id AS \"courseId\",state FROM study_blocks WHERE id=$1 AND user_id=$2",[id,user.id])).rows[0];
    if(!row)throw new HttpError(404,"Study session not found.");
    await studentReady(db,user,row.courseId);
    const started=await db.query(`UPDATE study_blocks SET state='started',started_at=COALESCE(started_at,now())
      WHERE id=$1 AND user_id=$2 AND state='planned' RETURNING id,state,started_at AS "startedAt"`,[id,user.id]);
    if(!started.rowCount){const current=(await db.query("SELECT id,state,started_at AS \"startedAt\" FROM study_blocks WHERE id=$1 AND user_id=$2",[id,user.id])).rows[0];
      if(current?.state!=="started")throw new HttpError(409,"This study session is already completed or replanned.");
      return res.json(current);}
    res.json(started.rows[0]);
  });
  router.post("/api/study-blocks/:id/complete",async(req,res)=>{
    const user=currentUser(res),id=uuid(req.params.id);
    const row=(await db.query("SELECT course_id AS \"courseId\",state FROM study_blocks WHERE id=$1 AND user_id=$2",[id,user.id])).rows[0];
    if(!row)throw new HttpError(404,"Study session not found.");
    await studentReady(db,user,row.courseId);
    if(row.state==="completed")return res.json({completed:true});
    if(row.state!=="started")throw new HttpError(409,"Start the study session before completing it.");
    await db.query("UPDATE study_blocks SET state='completed',completed_at=now() WHERE id=$1 AND user_id=$2 AND state='started'",[id,user.id]);
    await awardXp(db,user.id,row.courseId,`study-block:${id}`,5,"Study session completed");
    res.json({completed:true});
  });
  return router;
}
