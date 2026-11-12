import { Router } from "express";
import type { Pool } from "pg";
import { currentUser,teacherCourse,uuid } from "./access";

export function analyticsRoutes(db:Pool) {
  const router=Router();
  router.get("/api/courses/:id/analytics",async(req,res)=>{
    const user=currentUser(res),courseId=uuid(req.params.id);await teacherCourse(db,user,courseId);
    const days=Number(req.query.days??30);
    if(![7,30,90].includes(days))return res.status(400).json({error:"Days must be 7, 30, or 90."});
    const [students,activity,blocks,assignments,concepts]=await Promise.all([
      db.query(`SELECT count(DISTINCT u.id)::int AS enrolled,
        count(DISTINCT sa.user_id) FILTER(WHERE sa.created_at>=now()-($2::int*interval '1 day'))::int AS active
        FROM enrollments e JOIN courses c ON c.id=e.course_id
        JOIN users u ON u.email=e.email AND u.role='student' AND u.institute_id=c.institute_id
        LEFT JOIN study_attempts sa ON sa.user_id=u.id AND sa.course_id=e.course_id
        WHERE e.course_id=$1`,[courseId,days]),
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
        count(sa.id) FILTER(WHERE sa.kind IN('practice','twin','review') AND sa.correct=false)::int AS "incorrectAttempts"
        FROM concepts c LEFT JOIN study_attempts sa ON sa.concept_id=c.id AND sa.course_id=c.course_id
        WHERE c.course_id=$1 GROUP BY c.id ORDER BY c.name`,[courseId])
    ]);
    const sessionMap=Object.fromEntries(blocks.rows.map(x=>[x.state,x.count]));
    const plannedSessions=Object.values(sessionMap).reduce<number>((sum,n)=>sum+Number(n),0);
    const completedSessions=Number(sessionMap.completed||0);
    res.json({days,students:students.rows[0],activity:activity.rows,studySessions:{total:plannedSessions,completed:completedSessions,
      started:Number(sessionMap.started||0),planned:Number(sessionMap.planned||0),missed:Number(sessionMap.missed||0),
      completionRate:plannedSessions?Math.round(100*completedSessions/plannedSessions):0},
      assignments:assignments.rows[0],concepts:concepts.rows});
  });
  return router;
}
