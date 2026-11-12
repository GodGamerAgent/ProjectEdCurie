import { Router } from "express";
import type { Pool } from "pg";
import { currentUser,teacherCourse,uuid } from "./access";

export function analyticsRoutes(db:Pool) {
  const router=Router();
  router.get("/api/courses/:id/analytics",async(req,res)=>{
    const user=currentUser(res),courseId=uuid(req.params.id);await teacherCourse(db,user,courseId);
    const days=Number(req.query.days??30);
    if(![7,30,90].includes(days))return res.status(400).json({error:"Days must be 7, 30, or 90."});
    const [students,studentList,activity,blocks,assignments,concepts]=await Promise.all([
      db.query(`SELECT count(DISTINCT u.id)::int AS enrolled,
        count(DISTINCT sa.user_id) FILTER(WHERE sa.created_at>=now()-($2::int*interval '1 day'))::int AS active
        FROM enrollments e JOIN courses c ON c.id=e.course_id
        JOIN users u ON u.email=e.email AND u.role='student' AND u.institute_id=c.institute_id
        LEFT JOIN study_attempts sa ON sa.user_id=u.id AND sa.course_id=e.course_id
        WHERE e.course_id=$1`,[courseId,days]),
      db.query(`SELECT u.id,u.email FROM enrollments e JOIN courses c ON c.id=e.course_id
        JOIN users u ON u.email=e.email AND u.role='student' AND u.institute_id=c.institute_id
        WHERE e.course_id=$1 ORDER BY u.email`,[courseId]),
      db.query(`SELECT to_char(day,'YYYY-MM-DD') AS day,COALESCE(count(sa.id),0)::int AS attempts,
        count(sa.id) FILTER(WHERE sa.correct)::int AS correct,count(sa.id) FILTER(WHERE sa.assisted)::int AS assisted
        FROM generate_series(current_date-($2::int-1),current_date,interval '1 day') day
        LEFT JOIN study_attempts sa ON sa.course_id=$1 AND date_trunc('day',sa.created_at)=day
        GROUP BY day ORDER BY day`,[courseId,days]),
      db.query(`SELECT state,count(*)::int AS count FROM study_blocks WHERE course_id=$1 GROUP BY state`,[courseId]),
      db.query(`SELECT count(DISTINCT a.id)::int AS assignments,count(s.id)::int AS submissions,
        count(s.id) FILTER(WHERE s.status='reviewed')::int AS reviewed
        FROM assignments a LEFT JOIN assignment_submissions s ON s.assignment_id=a.id
        WHERE a.course_id=$1 AND a.status='published'`,[courseId]),
      db.query(`SELECT c.id AS "conceptId",c.name,
        count(DISTINCT sa.problem_id) FILTER(WHERE sa.kind IN('practice','twin','review') AND NOT sa.assisted)::int AS "independentProblems",
        count(sa.id) FILTER(WHERE sa.kind='review')::int AS "reviewAttempts",
        count(sa.id) FILTER(WHERE sa.assisted)::int AS "assistedAttempts",
        count(sa.id) FILTER(WHERE sa.kind IN('practice','twin','review') AND sa.correct=false)::int AS "incorrectAttempts",
        (SELECT count(*)::int FROM assignment_evidence ae WHERE ae.course_id=c.course_id AND ae.concept_id=c.id) AS "verifiedAssignments"
        FROM concepts c LEFT JOIN study_attempts sa ON sa.concept_id=c.id AND sa.course_id=c.course_id
        WHERE c.course_id=$1 GROUP BY c.id ORDER BY c.name`,[courseId])
    ]);
    const sessionMap=Object.fromEntries(blocks.rows.map(x=>[x.state,x.count]));
    const plannedSessions=Object.values(sessionMap).reduce<number>((sum,n)=>sum+Number(n),0);
    const completedSessions=Number(sessionMap.completed||0);
    res.json({days,students:students.rows[0],activity:activity.rows,studySessions:{total:plannedSessions,completed:completedSessions,
      started:Number(sessionMap.started||0),planned:Number(sessionMap.planned||0),missed:Number(sessionMap.missed||0),
      completionRate:plannedSessions?Math.round(100*completedSessions/plannedSessions):0},
       assignments:assignments.rows[0],concepts:concepts.rows,studentOptions:studentList.rows});
  });
  router.get("/api/courses/:id/analytics/students/:studentId",async(req,res)=>{
    const user=currentUser(res),courseId=uuid(req.params.id),studentId=uuid(req.params.studentId);await teacherCourse(db,user,courseId);
    const days=Number(req.query.days??30),kind=String(req.query.kind??"all");
    if(![7,30,90].includes(days))return res.status(400).json({error:"Days must be 7, 30, or 90."});
    const kinds=["all","baseline","practice","twin","review","comprehension","diagnostic","assignment"];
    if(!kinds.includes(kind))return res.status(400).json({error:"Choose a supported activity filter."});
    const student=(await db.query(`SELECT u.id,u.email FROM enrollments e JOIN courses c ON c.id=e.course_id
      JOIN users u ON u.email=e.email AND u.role='student' AND u.institute_id=c.institute_id
      WHERE e.course_id=$1 AND u.id=$2`,[courseId,studentId])).rows[0];
    if(!student)return res.status(404).json({error:"Student is not enrolled in this course."});
    const [summary,timeline]=await Promise.all([
      db.query(`SELECT count(*)::int AS attempts,count(*) FILTER(WHERE correct)::int AS correct,
        count(*) FILTER(WHERE assisted)::int AS assisted FROM study_attempts
        WHERE course_id=$1 AND user_id=$2 AND created_at>=now()-($3::int*interval '1 day')`,[courseId,studentId,days]),
      db.query(`WITH events AS (
        SELECT sa.kind AS type,c.name AS concept,sa.correct,sa.assisted,sa.created_at AS "occurredAt",
          NULL::text AS "errorCategory" FROM study_attempts sa JOIN concepts c ON c.id=sa.concept_id
        WHERE sa.course_id=$1 AND sa.user_id=$2 AND sa.created_at>=now()-($3::int*interval '1 day')
        UNION ALL
        SELECT 'assignment' AS type,c.name AS concept,ae.score>=70 AS correct,true AS assisted,ae.created_at AS "occurredAt",
          ae.misconception_code AS "errorCategory" FROM assignment_evidence ae JOIN concepts c ON c.id=ae.concept_id
        WHERE ae.course_id=$1 AND ae.user_id=$2 AND ae.created_at>=now()-($3::int*interval '1 day')
      ) SELECT type,concept,correct,assisted,"occurredAt","errorCategory" FROM events
        WHERE $4='all' OR type=$4 ORDER BY "occurredAt" DESC LIMIT 100`,[courseId,studentId,days,kind])
    ]);
    res.json({student,days,kind,summary:summary.rows[0],timeline:timeline.rows});
  });
  return router;
}
