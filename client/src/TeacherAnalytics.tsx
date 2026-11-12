import { useCallback,useEffect,useState } from "react";
import { api } from "./api";

type Analytics={days:number;students:{enrolled:number;active:number};activity:{day:string;attempts:number;correct:number;assisted:number}[];
  studySessions:{total:number;completed:number;started:number;planned:number;missed:number;completionRate:number};
  assignments:{assignments:number;submissions:number;reviewed:number};
  concepts:{conceptId:string;name:string;independentProblems:number;reviewAttempts:number;assistedAttempts:number;incorrectAttempts:number;verifiedAssignments:number}[]};
export default function TeacherAnalytics({courseId}:{courseId:string|number}) {
  const [days,setDays]=useState(30),[data,setData]=useState<Analytics|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const load=useCallback(async()=>{setBusy(true);setError("");try{setData(await api<Analytics>(`/api/courses/${courseId}/analytics?days=${days}`));}catch(e){setError(e instanceof Error?e.message:"Analytics could not be loaded.");}finally{setBusy(false);}},[courseId,days]);
  useEffect(()=>{void load();},[load]);
  return <section className="study-section"><div className="divider"/><div className="eyebrow">Course analytics</div><div className="row"><h3>Learning activity</h3><label>Window <select value={days} onChange={e=>setDays(Number(e.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></label></div>
    {error&&<div className="notice error" role="alert">{error}<button className="button small" onClick={()=>void load()}>Retry</button></div>}
    {data&&<><div className="card-grid" style={{marginTop:14}}>
      <div className="course-card"><strong>{data.students.enrolled}</strong><p>Enrolled students</p></div>
      <div className="course-card"><strong>{data.students.active}</strong><p>Active in {data.days} days</p></div>
      <div className="course-card"><strong>{data.studySessions.completed}/{data.studySessions.total}</strong><p>Study sessions completed · {data.studySessions.completionRate}%</p></div>
      <div className="course-card"><strong>{data.assignments.reviewed}/{data.assignments.submissions}</strong><p>Assignments reviewed · {data.assignments.assignments} published</p></div>
    </div>
    <h4 style={{marginTop:18}}>Daily attempts</h4><div className="table-wrap"><table><thead><tr><th>Date</th><th>Attempts</th><th>Correct</th><th>Assisted</th></tr></thead><tbody>{data.activity.map(day=><tr key={day.day}><td>{day.day}</td><td>{day.attempts}</td><td>{day.correct}</td><td>{day.assisted}</td></tr>)}</tbody></table></div>
    <h4 style={{marginTop:18}}>Concept evidence</h4><div className="table-wrap"><table><thead><tr><th>Concept</th><th>Distinct independent questions</th><th>Review attempts</th><th>Assisted attempts</th><th>Teacher-verified assignments</th><th>Incorrect outcomes</th></tr></thead><tbody>{data.concepts.map(c=><tr key={c.conceptId}><td>{c.name}</td><td>{c.independentProblems}</td><td>{c.reviewAttempts}</td><td>{c.assistedAttempts}</td><td>{c.verifiedAssignments}</td><td>{c.incorrectAttempts}</td></tr>)}</tbody></table></div>
    <p className="muted">Counts describe recorded activity, not a diagnosis. Review assignment responses in the teacher panel before using them to change a student's mastery status.</p>
    </>}
    {busy&&<p className="muted" role="status">Refreshing analytics…</p>}
  </section>;
}
