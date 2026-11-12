import { Router } from "express";
import type { Pool } from "pg";
import { HttpError } from "./auth";
import { cleanString,courseAccess,currentUser,requireRole,uuid } from "./access";

export function xpRoutes(db:Pool) {
  const router=Router();
  router.get("/api/courses/:id/rewards",async(req,res)=>{
    const user=currentUser(res);requireRole(user,"student");const courseId=uuid(req.params.id);await courseAccess(db,user,courseId);
    const [total,preference,recent,board]=await Promise.all([
      db.query("SELECT COALESCE(sum(points),0)::int AS points FROM xp_ledger WHERE user_id=$1 AND course_id=$2",[user.id,courseId]),
      db.query("SELECT opt_in AS \"optIn\",display_name AS \"displayName\" FROM leaderboard_preferences WHERE user_id=$1 AND course_id=$2",[user.id,courseId]),
      db.query(`SELECT points,reason,created_at AS "createdAt" FROM xp_ledger WHERE user_id=$1 AND course_id=$2 ORDER BY created_at DESC LIMIT 10`,[user.id,courseId]),
      db.query(`WITH scores AS (
        SELECT lp.user_id,lp.display_name,COALESCE(sum(x.points),0)::int AS points,
          row_number() OVER(ORDER BY COALESCE(sum(x.points),0) DESC,lower(lp.display_name),lp.user_id) AS rank
        FROM leaderboard_preferences lp JOIN enrollments e ON e.course_id=lp.course_id
        JOIN courses c ON c.id=e.course_id JOIN users u ON u.id=lp.user_id AND u.email=e.email AND u.role='student' AND u.institute_id=c.institute_id
        LEFT JOIN xp_ledger x ON x.user_id=lp.user_id AND x.course_id=lp.course_id
        WHERE lp.course_id=$1 AND lp.opt_in=true GROUP BY lp.user_id,lp.display_name
      ) SELECT display_name AS name,points,rank,user_id=$2 AS you FROM scores WHERE rank<=10 OR user_id=$2 ORDER BY rank`,
      [courseId,user.id])
    ]);
    res.json({points:total.rows[0].points,optIn:preference.rows[0]?.optIn??false,displayName:preference.rows[0]?.displayName??"",
      recent:recent.rows,leaderboard:board.rows});
  });
  router.put("/api/courses/:id/leaderboard-preference",async(req,res)=>{
    const user=currentUser(res);requireRole(user,"student");const courseId=uuid(req.params.id);await courseAccess(db,user,courseId);
    if(typeof req.body?.optIn!=="boolean")throw new HttpError(400,"Choose whether to appear on the leaderboard.");
    const displayName=cleanString(req.body?.displayName,"Display name",40);
    const result=await db.query(`INSERT INTO leaderboard_preferences(user_id,course_id,opt_in,display_name)
      VALUES($1,$2,$3,$4) ON CONFLICT(user_id,course_id) DO UPDATE SET opt_in=excluded.opt_in,display_name=excluded.display_name,updated_at=now()
      RETURNING opt_in AS "optIn",display_name AS "displayName"`,[user.id,courseId,req.body.optIn,displayName]);
    res.json(result.rows[0]);
  });
  return router;
}
