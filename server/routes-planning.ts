import { aiText, demoAI, object } from "./demo-ai";
import { Router, type Request, type Response } from "express";
import type { Pool } from "pg";
import { HttpError } from "./auth";
import { cleanString, currentUser, teacherCourse, uuid } from "./access";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
function validDate(value: unknown, label: string) {
  if(typeof value!=="string"||!datePattern.test(value)||!Number.isFinite(Date.parse(`${value}T00:00:00Z`))||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value)
    throw new HttpError(400,`${label} must be a valid YYYY-MM-DD date.`);
  return value;
}
function validTime(value: unknown,label:string) {
  if(typeof value!=="string"||!timePattern.test(value))throw new HttpError(400,`${label} must use 24-hour HH:MM time.`);
  return value;
}
function validTimezone(value:unknown) {
  const zone=cleanString(value,"Timezone",100);
  try{new Intl.DateTimeFormat("en-US",{timeZone:zone}).format(0);}catch{throw new HttpError(400,"Choose a valid IANA timezone.");}
  return zone;
}
const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3));
export function planningRoutes(db:Pool) {
  const router=Router();
  router.get("/api/courses/:id/timetable",async(req,res)=>{
    const user=currentUser(res);
    await teacherCourse(db,user,req.params.id);
    const result=await db.query(`SELECT e.id,e.title,e.weekday,e.start_time AS "startTime",e.end_time AS "endTime",
      e.starts_on AS "startsOn",e.ends_on AS "endsOn",e.timezone,e.status,
      COALESCE((SELECT json_agg(x.exception_date ORDER BY x.exception_date) FROM class_timetable_exceptions x WHERE x.event_id=e.id),'[]'::json) AS exceptions
      FROM class_timetable_events e WHERE e.course_id=$1 ORDER BY e.weekday,e.start_time`,[req.params.id]);
    res.json({events:result.rows});
  });
  router.post("/api/courses/:id/timetable",saveEvent);
  router.patch("/api/courses/:id/timetable/:eventId",saveEvent);
  async function saveEvent(req:Request<{id:string;eventId?:string}>,res:Response){
    const user=currentUser(res);await teacherCourse(db,user,req.params.id);
    const title=cleanString(req.body?.title,"Class title",160),weekday=req.body?.weekday;
    if(!Number.isInteger(weekday)||weekday<1||weekday>7)throw new HttpError(400,"Weekdays use ISO numbering: Monday 1 through Sunday 7.");
    const startTime=validTime(req.body?.startTime,"Start time"),endTime=validTime(req.body?.endTime,"End time");
    if(minutes(startTime)>=minutes(endTime))throw new HttpError(400,"Class end time must be after its start time.");
    const startsOn=validDate(req.body?.startsOn,"Start date"),endsOn=validDate(req.body?.endsOn,"End date");
    if(startsOn>endsOn)throw new HttpError(400,"The class schedule must end on or after it starts.");
    const timezone=validTimezone(req.body?.timezone);
    const eventId=req.params.eventId?uuid(req.params.eventId):null;
    const client=await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`timetable:${req.params.id}`]);
      const overlap=await client.query(`SELECT 1 FROM class_timetable_events e WHERE e.course_id=$1 AND e.status='active'
        AND e.weekday=$2 AND e.timezone=$3 AND ($8::uuid IS NULL OR e.id<>$8)
        AND daterange(e.starts_on::date,e.ends_on::date,'[]') && daterange($4::date,$5::date,'[]')
        AND e.start_time<$7 AND $6<e.end_time LIMIT 1`,[req.params.id,weekday,timezone,startsOn,endsOn,startTime,endTime,eventId]);
      if(overlap.rowCount)throw new HttpError(409,"This class overlaps another active class in the same course.");
      const values=[req.params.id,user.id,title,weekday,startTime,endTime,startsOn,endsOn,timezone];
      const saved=eventId?await client.query(`UPDATE class_timetable_events SET teacher_id=$2,title=$3,weekday=$4,start_time=$5,end_time=$6,
        starts_on=$7,ends_on=$8,timezone=$9 WHERE course_id=$1 AND id=$10 AND status='active' RETURNING id`,[...values,eventId]):
        await client.query(`INSERT INTO class_timetable_events(course_id,teacher_id,title,weekday,start_time,end_time,starts_on,ends_on,timezone)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,values);
      if(!saved.rowCount)throw new HttpError(404,"Active class event not found.");
      await client.query("COMMIT");
      res.status(eventId?200:201).json({event:saved.rows[0]});
    } catch(error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  router.post("/api/courses/:id/timetable/suggest",async(req,res)=>{
    const {course}=await teacherCourse(db,currentUser(res),req.params.id);
    const instructions=cleanString(req.body.instructions,"Timetable instructions",1400);
    const startsOn=validDate(req.body.startsOn,"Start date"),endsOn=validDate(req.body.endsOn,"End date");
    const timezone=validTimezone(req.body.timezone);
    if (startsOn>endsOn) throw new HttpError(400,"Choose an end date on or after the start date.");
    const existing=(await db.query(`SELECT title,weekday,start_time AS "startTime",end_time AS "endTime",starts_on,ends_on,timezone
      FROM class_timetable_events WHERE course_id=$1 AND status='active' ORDER BY weekday,start_time LIMIT 30`,[course.id])).rows;
    const result=object(await demoAI(
      "Suggest up to seven weekly class entries using the teacher's scheduling instructions. Avoid conflicts with existing classes. Return {events:[{title,weekday,startTime,endTime}]}, with weekday 1 (Monday) through 7 (Sunday), 24-hour HH:MM times, and end after start. Return [] if the constraints cannot be met.",
      {course:course.title,instructions,existing,startsOn,endsOn,timezone}
    ));
    if(!Array.isArray(result.events) || result.events.length>7) throw new HttpError(502,"Groq returned an invalid timetable.");
    res.json({events:result.events.map(raw=>{
      const entry=object(raw), weekday=Number(entry.weekday);
      if(!Number.isInteger(weekday)||weekday<1||weekday>7)throw new HttpError(502,"Groq returned an invalid weekday.");
      const startTime=validTime(entry.startTime,"Suggested start time"),endTime=validTime(entry.endTime,"Suggested end time");
      if(startTime>=endTime)throw new HttpError(502,"Groq returned an invalid time range.");
      return {title:aiText(entry.title,160),weekday,startTime,endTime,startsOn,endsOn,timezone};
    })});
  });
  router.delete("/api/courses/:id/timetable/:eventId",async(req,res)=>{
    const user=currentUser(res);await teacherCourse(db,user,req.params.id);
    const result=await db.query("UPDATE class_timetable_events SET status='cancelled' WHERE id=$1 AND course_id=$2 RETURNING id",[uuid(req.params.eventId),req.params.id]);
    if(!result.rowCount)throw new HttpError(404,"Class event not found.");
    res.json({cancelled:true});
  });
  return router;
}
