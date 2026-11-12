import { Router } from "express";
import type { Pool } from "pg";
import { HttpError } from "./auth";
import { cleanString,courseAccess,currentUser,requireRole,uuid } from "./access";
import { awardXp } from "./xp";
export function milestoneRoutes(db:Pool) {
  const router=Router();
  router.get("/api/courses/:id/milestones",async(req,res)=>{
    const user=currentUser(res);requireRole(user,"student");const courseId=uuid(req.params.id);await courseAccess(db,user,courseId);
    const rows=await db.query(`SELECT id,title,to_char(target_date,'YYYY-MM-DD') AS "targetDate",target_score AS "targetScore",
      completed_at AS "completedAt" FROM goal_milestones WHERE user_id=$1 AND course_id=$2 ORDER BY target_date,id`,[user.id,courseId]);
    res.json({milestones:rows.rows});
  });
  router.post("/api/courses/:id/milestones",async(req,res)=>{
    const user=currentUser(res);requireRole(user,"student");const courseId=uuid(req.params.id);await courseAccess(db,user,courseId);
    const title=cleanString(req.body?.title,"Milestone",160),rawDate=String(req.body?.targetDate??"");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)||Number.isNaN(Date.parse(`${rawDate}T00:00:00Z`)))throw new HttpError(400,"Choose a valid target date.");
    const targetScore=req.body?.targetScore==null||req.body.targetScore===""?null:Number(req.body.targetScore);
    if(targetScore!==null&&(!Number.isInteger(targetScore)||targetScore<0||targetScore>100))throw new HttpError(400,"Target score must be from 0 to 100.");
    const count=await db.query("SELECT count(*)::int AS n FROM goal_milestones WHERE user_id=$1 AND course_id=$2",[user.id,courseId]);
    if(count.rows[0].n>=20)throw new HttpError(400,"Keep no more than 20 milestones in one course.");
    const saved=await db.query(`INSERT INTO goal_milestones(user_id,course_id,title,target_date,target_score)
      VALUES($1,$2,$3,$4,$5) RETURNING id,title,to_char(target_date,'YYYY-MM-DD') AS "targetDate",
      target_score AS "targetScore",completed_at AS "completedAt"`,[user.id,courseId,title,rawDate,targetScore]);
    res.status(201).json(saved.rows[0]);
  });
  router.patch("/api/courses/:id/milestones/:milestoneId",async(req,res)=>{
    const user=currentUser(res);requireRole(user,"student");const courseId=uuid(req.params.id),id=uuid(req.params.milestoneId);await courseAccess(db,user,courseId);
    if(typeof req.body?.completed!=="boolean")throw new HttpError(400,"Choose whether the milestone is completed.");
    const saved=await db.query(`UPDATE goal_milestones SET completed_at=CASE WHEN $4 THEN COALESCE(completed_at,now()) ELSE NULL END
      WHERE id=$1 AND course_id=$2 AND user_id=$3 RETURNING id,title,to_char(target_date,'YYYY-MM-DD') AS "targetDate",
      target_score AS "targetScore",completed_at AS "completedAt"`,[id,courseId,user.id,req.body.completed]);
    if(!saved.rowCount)throw new HttpError(404,"Milestone not found.");
    if(req.body.completed)await awardXp(db,user.id,courseId,`milestone:${id}`,5,"Course milestone completed");
    res.json(saved.rows[0]);
  });
  router.delete("/api/courses/:id/milestones/:milestoneId",async(req,res)=>{
    const user=currentUser(res);requireRole(user,"student");const courseId=uuid(req.params.id),id=uuid(req.params.milestoneId);await courseAccess(db,user,courseId);
    const removed=await db.query("DELETE FROM goal_milestones WHERE id=$1 AND course_id=$2 AND user_id=$3",[id,courseId,user.id]);
    if(!removed.rowCount)throw new HttpError(404,"Milestone not found.");
    res.json({deleted:true});
  });
  return router;
}
