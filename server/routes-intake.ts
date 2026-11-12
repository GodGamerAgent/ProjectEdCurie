import { Router } from "express";
import type { Pool } from "pg";
import { HttpError } from "./auth";
import { cleanString,courseAccess,currentUser,requireRole,uuid } from "./access";

const optional=(value:unknown,label:string,max:number)=>value==null||value===""?null:cleanString(value,label,max);
export function intakeRoutes(db:Pool) {
  const router=Router();
  router.get("/api/courses/:id/intake",async(req,res)=>{
    const user=currentUser(res);requireRole(user,"student");const courseId=uuid(req.params.id);await courseAccess(db,user,courseId);
    const result=await db.query(`SELECT background,confidence,"target_assessment" AS "targetAssessment",
      to_char(target_date,'YYYY-MM-DD') AS "targetDate",goals,updated_at AS "updatedAt" FROM student_intakes WHERE user_id=$1 AND course_id=$2`,[user.id,courseId]);
    res.json(result.rows[0]??{background:"",confidence:null,targetAssessment:"",targetDate:null,goals:""});
  });
  router.put("/api/courses/:id/intake",async(req,res)=>{
    const user=currentUser(res);requireRole(user,"student");const courseId=uuid(req.params.id);await courseAccess(db,user,courseId);
    const background=optional(req.body?.background,"Background",2000),targetAssessment=optional(req.body?.targetAssessment,"Target assessment",160);
    const goals=optional(req.body?.goals,"Learning goals",1000),confidence=req.body?.confidence===""||req.body?.confidence==null?null:Number(req.body.confidence);
    if(confidence!==null&&(!Number.isInteger(confidence)||confidence<1||confidence>5))throw new HttpError(400,"Confidence must be from 1 to 5.");
    const rawDate=req.body?.targetDate;
    const targetDate=rawDate?String(rawDate):null;
    if(targetDate&&!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))throw new HttpError(400,"Target date must be a calendar date.");
    if(targetDate&&Number.isNaN(Date.parse(`${targetDate}T00:00:00Z`)))throw new HttpError(400,"Target date is invalid.");
    const result=await db.query(`INSERT INTO student_intakes(user_id,course_id,background,confidence,target_assessment,target_date,goals)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,course_id) DO UPDATE SET background=excluded.background,
      confidence=excluded.confidence,target_assessment=excluded.target_assessment,target_date=excluded.target_date,
      goals=excluded.goals,updated_at=now()
      RETURNING background,confidence,target_assessment AS "targetAssessment",to_char(target_date,'YYYY-MM-DD') AS "targetDate",goals,updated_at AS "updatedAt"`,
      [user.id,courseId,background,confidence,targetAssessment,targetDate,goals]);
    res.json(result.rows[0]);
  });
  router.delete("/api/courses/:id/intake",async(req,res)=>{
    const user=currentUser(res);requireRole(user,"student");const courseId=uuid(req.params.id);await courseAccess(db,user,courseId);
    await db.query("DELETE FROM student_intakes WHERE user_id=$1 AND course_id=$2",[user.id,courseId]);res.json({deleted:true});
  });
  return router;
}
