import { Router } from "express";
import type { Pool } from "pg";
import { HttpError } from "./auth";
import { cleanString, courseAccess, currentUser, teacherCourse, uuid } from "./access";

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
function dateWeekday(date:string){const n=new Date(`${date}T00:00:00Z`).getUTCDay();return n===0?7:n;}
function intervals(value:unknown,timezone:string) {
  if(!Array.isArray(value)||value.length>21)throw new HttpError(400,"Add at most 21 weekly availability intervals.");
  const result=value.map((item:any)=>{
    if(!item||!Number.isInteger(item.weekday)||item.weekday<1||item.weekday>7)throw new HttpError(400,"Weekdays use ISO numbering: Monday 1 through Sunday 7.");
    const startTime=validTime(item.startTime,"Start time"),endTime=validTime(item.endTime,"End time");
    if(minutes(startTime)>=minutes(endTime))throw new HttpError(400,"Each availability interval must end after it starts on the same day.");
    return {weekday:item.weekday,startTime,endTime};
  }).sort((a,b)=>a.weekday-b.weekday||minutes(a.startTime)-minutes(b.startTime));
  for(let i=1;i<result.length;i++)if(result[i].weekday===result[i-1].weekday&&minutes(result[i].startTime)<minutes(result[i-1].endTime))
    throw new HttpError(400,"Availability intervals on the same day cannot overlap.");
  return {timezone,intervals:result};
}
function instants(value:unknown,label:string) {
  if(typeof value!=="string"||!/(Z|[+-]\d{2}:\d{2})$/i.test(value)||!Number.isFinite(Date.parse(value)))
    throw new HttpError(400,`${label} must be an ISO date-time with a timezone.`);
  return new Date(value).toISOString();
}

export function planningRoutes(db:Pool) {
  const router=Router();
  router.get("/api/courses/:id/timetable",async(req,res)=>{
    const user=currentUser(res);
    if(user.role==="teacher")await teacherCourse(db,user,req.params.id);
    else await courseAccess(db,user,req.params.id);
    const result=await db.query(`SELECT e.id,e.title,e.weekday,e.start_time AS "startTime",e.end_time AS "endTime",
      e.starts_on AS "startsOn",e.ends_on AS "endsOn",e.timezone,e.status,
      COALESCE((SELECT json_agg(x.exception_date ORDER BY x.exception_date) FROM class_timetable_exceptions x WHERE x.event_id=e.id),'[]'::json) AS exceptions
      FROM class_timetable_events e WHERE e.course_id=$1 ORDER BY e.weekday,e.start_time`,[req.params.id]);
    res.json({events:result.rows});
  });
  router.post("/api/courses/:id/timetable",async(req,res)=>{
    const user=currentUser(res);await teacherCourse(db,user,req.params.id);
    const title=cleanString(req.body?.title,"Class title",160),weekday=req.body?.weekday;
    if(!Number.isInteger(weekday)||weekday<1||weekday>7)throw new HttpError(400,"Weekdays use ISO numbering: Monday 1 through Sunday 7.");
    const startTime=validTime(req.body?.startTime,"Start time"),endTime=validTime(req.body?.endTime,"End time");
    if(minutes(startTime)>=minutes(endTime))throw new HttpError(400,"Class end time must be after its start time.");
    const startsOn=validDate(req.body?.startsOn,"Start date"),endsOn=validDate(req.body?.endsOn,"End date");
    if(startsOn>endsOn)throw new HttpError(400,"The class schedule must end on or after it starts.");
    const timezone=validTimezone(req.body?.timezone);
    const overlap=await db.query(`SELECT 1 FROM class_timetable_events e WHERE e.course_id=$1 AND e.status='active' AND e.weekday=$2 AND e.timezone=$3
      AND daterange(e.starts_on::date,e.ends_on::date,'[]') && daterange($4::date,$5::date,'[]')
      AND e.start_time<$7 AND $6<e.end_time LIMIT 1`,[req.params.id,weekday,timezone,startsOn,endsOn,startTime,endTime]);
    if(overlap.rowCount)throw new HttpError(409,"This class overlaps another active class in the same course.");
    const saved=await db.query(`INSERT INTO class_timetable_events(course_id,teacher_id,title,weekday,start_time,end_time,starts_on,ends_on,timezone)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,title,weekday,start_time AS "startTime",end_time AS "endTime",starts_on AS "startsOn",ends_on AS "endsOn",timezone,status`,
    [req.params.id,user.id,title,weekday,startTime,endTime,startsOn,endsOn,timezone]);
    res.status(201).json({event:saved.rows[0]});
  });
  router.post("/api/courses/:id/timetable/:eventId/cancel-date",async(req,res)=>{
    const user=currentUser(res);await teacherCourse(db,user,req.params.id);
    const eventId=uuid(req.params.eventId),date=validDate(req.body?.date,"Exception date");
    const event=(await db.query("SELECT id,weekday,starts_on,ends_on,status FROM class_timetable_events WHERE id=$1 AND course_id=$2",[eventId,req.params.id])).rows[0];
    if(!event)throw new HttpError(404,"Class event not found.");
    if(event.status!=="active"||date<event.starts_on||date>event.ends_on||dateWeekday(date)!==event.weekday)
      throw new HttpError(400,"Choose an active occurrence date in the class schedule.");
    await db.query("INSERT INTO class_timetable_exceptions(event_id,exception_date,created_by) VALUES($1,$2,$3) ON CONFLICT(event_id,exception_date) DO NOTHING",[eventId,date,user.id]);
    res.json({saved:true,date});
  });
  router.delete("/api/courses/:id/timetable/:eventId",async(req,res)=>{
    const user=currentUser(res);await teacherCourse(db,user,req.params.id);
    const result=await db.query("UPDATE class_timetable_events SET status='cancelled' WHERE id=$1 AND course_id=$2 RETURNING id",[uuid(req.params.eventId),req.params.id]);
    if(!result.rowCount)throw new HttpError(404,"Class event not found.");
    res.json({cancelled:true});
  });
  router.get("/api/courses/:id/availability",async(req,res)=>{
    const user=currentUser(res);await courseAccess(db,user,req.params.id);
    if(user.role!=="student")throw new HttpError(403,"Availability belongs to an enrolled student.");
    const data=await db.query(`SELECT timezone,intervals FROM student_availability WHERE user_id=$1 AND course_id=$2`,[user.id,req.params.id]);
    res.json({availability:data.rows[0]??{timezone:"Asia/Kolkata",intervals:[]}});
  });
  router.put("/api/courses/:id/availability",async(req,res)=>{
    const user=currentUser(res);await courseAccess(db,user,req.params.id);
    if(user.role!=="student")throw new HttpError(403,"Availability belongs to an enrolled student.");
    const value=intervals(req.body?.intervals,validTimezone(req.body?.timezone));
    const saved=await db.query(`INSERT INTO student_availability(user_id,course_id,timezone,intervals) VALUES($1,$2,$3,$4::jsonb)
      ON CONFLICT(user_id,course_id) DO UPDATE SET timezone=$3,intervals=$4::jsonb RETURNING timezone,intervals`,
    [user.id,req.params.id,value.timezone,JSON.stringify(value.intervals)]);
    res.json({availability:saved.rows[0]});
  });
  router.get("/api/courses/:id/commitments",async(req,res)=>{
    const user=currentUser(res);await courseAccess(db,user,req.params.id);
    if(user.role!=="student")throw new HttpError(403,"Personal commitments are private to each student.");
    const data=await db.query(`SELECT id,title,course_id AS "courseId",starts_at AS "startsAt",ends_at AS "endsAt",timezone
      FROM student_commitments WHERE user_id=$1 AND (course_id IS NULL OR course_id=$2) ORDER BY starts_at`,[user.id,req.params.id]);
    res.json({commitments:data.rows});
  });
  router.post("/api/courses/:id/commitments",async(req,res)=>{
    const user=currentUser(res);await courseAccess(db,user,req.params.id);
    if(user.role!=="student")throw new HttpError(403,"Personal commitments are private to each student.");
    const title=cleanString(req.body?.title,"Commitment title",160),startsAt=instants(req.body?.startsAt,"Start"),endsAt=instants(req.body?.endsAt,"End");
    if(Date.parse(startsAt)>=Date.parse(endsAt))throw new HttpError(400,"Commitment end time must be after its start time.");
    const timezone=validTimezone(req.body?.timezone),courseId=req.body?.courseId?uuid(String(req.body.courseId)):null;
    if(courseId)await courseAccess(db,user,courseId);
    const overlap=await db.query(`SELECT 1 FROM student_commitments WHERE user_id=$1 AND starts_at<$3 AND $2<ends_at
      AND (course_id IS NULL OR $4::uuid IS NULL OR course_id=$4) LIMIT 1`,[user.id,startsAt,endsAt,courseId]);
    if(overlap.rowCount)throw new HttpError(409,"This conflicts with a commitment you already saved.");
    const saved=await db.query(`INSERT INTO student_commitments(user_id,course_id,title,starts_at,ends_at,timezone)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id,title,course_id AS "courseId",starts_at AS "startsAt",ends_at AS "endsAt",timezone`,
    [user.id,courseId,title,startsAt,endsAt,timezone]);
    res.status(201).json({commitment:saved.rows[0]});
  });
  router.delete("/api/courses/:id/commitments/:commitmentId",async(req,res)=>{
    const user=currentUser(res);await courseAccess(db,user,req.params.id);
    if(user.role!=="student")throw new HttpError(403,"Personal commitments are private to each student.");
    const result=await db.query(`DELETE FROM student_commitments WHERE id=$1 AND user_id=$2 AND (course_id IS NULL OR course_id=$3) RETURNING id`,
      [uuid(req.params.commitmentId),user.id,req.params.id]);
    if(!result.rowCount)throw new HttpError(404,"Personal commitment not found.");
    res.json({deleted:true});
  });
  return router;
}
