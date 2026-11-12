import { Router } from "express";
import type { Pool } from "pg";
import { HttpError } from "./auth";
import { courseAccess,currentUser,requireRole,uuid } from "./access";
export function durationRoutes(db:Pool) {
  const router=Router();
  router.get("/api/courses/:id/study-duration",async(req,res)=>{
    const user=currentUser(res);requireRole(user,"student");const courseId=uuid(req.params.id);await courseAccess(db,user,courseId);
    const total=await db.query(`SELECT COALESCE(sum(duration_seconds),0)::int AS seconds,
      count(*)::int AS sessions FROM study_duration_events WHERE user_id=$1 AND course_id=$2 AND created_at>=now()-interval '14 days'`,[user.id,courseId]);
    res.json({seconds:total.rows[0].seconds,sessions:total.rows[0].sessions});
  });
  router.post("/api/courses/:id/study-duration",async(req,res)=>{
    const user=currentUser(res);requireRole(user,"student");const courseId=uuid(req.params.id);await courseAccess(db,user,courseId);
    const eventKey=uuid(req.body?.eventKey),durationSeconds=Number(req.body?.durationSeconds);
    if(!Number.isInteger(durationSeconds)||durationSeconds<60||durationSeconds>7200)throw new HttpError(400,"A focus session must be between 1 minute and 2 hours.");
    const saved=await db.query(`INSERT INTO study_duration_events(user_id,course_id,event_key,duration_seconds)
      VALUES($1,$2,$3,$4) ON CONFLICT(user_id,event_key) DO NOTHING RETURNING id`,[user.id,courseId,eventKey,durationSeconds]);
    const total=await db.query(`SELECT COALESCE(sum(duration_seconds),0)::int AS seconds,
      count(*)::int AS sessions FROM study_duration_events WHERE user_id=$1 AND course_id=$2 AND created_at>=now()-interval '14 days'`,[user.id,courseId]);
    res.status(saved.rowCount?201:200).json({recorded:Boolean(saved.rowCount),seconds:total.rows[0].seconds,sessions:total.rows[0].sessions});
  });
  return router;
}
