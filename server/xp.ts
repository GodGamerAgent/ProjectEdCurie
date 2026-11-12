type XpWriter={query:(text:string,values?:unknown[])=>Promise<unknown>};
export function awardXp(db:XpWriter,userId:string,courseId:string,eventKey:string,points:number,reason:string){
  return db.query(`INSERT INTO xp_ledger(user_id,course_id,event_key,points,reason)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,event_key) DO NOTHING`,[userId,courseId,eventKey,points,reason]);
}
