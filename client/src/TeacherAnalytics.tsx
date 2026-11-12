import { useCallback,useEffect,useState } from "react";
import { api } from "./api";

type Analytics={days:number;students:{enrolled:number;active:number};activity:{day:string;attempts:number;correct:number;assisted:number}[];
  studySessions:{total:number;completed:number;started:number;planned:number;missed:number;completionRate:number};
  assignments:{assignments:number;submissions:number;reviewed:number};
  concepts:{conceptId:string;name:string;independentProblems:number;reviewAttempts:number;assistedAttempts:number;incorrectAttempts:number;verifiedAssignments:number}[];
  studentOptions:{id:string;email:string}[]};
type Timeline={student:{id:string;email:string};days:number;summary:{attempts:number;correct:number;assisted:number};
  timeline:{type:string;concept:string;correct:boolean;assisted:boolean;occurredAt:string;errorCategory:string|null}[]};
export default function TeacherAnalytics({courseId}:{courseId:string|number}) {
  const [days,setDays]=useState(30),[data,setData]=useState<Analytics|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [selectedStudent,setSelectedStudent]=useState(""),[activityFilter,setActivityFilter]=useState("all"),[timeline,setTimeline]=useState<Timeline|null>(null),[timelineError,setTimelineError]=useState("");
  const load=useCallback(async()=>{setBusy(true);setError("");try{const next=await api<Analytics>(`/api/courses/${courseId}/analytics?days=${days}`);setData(next);setSelectedStudent(current=>current||next.studentOptions[0]?.id||"");}catch(e){setError(e instanceof Error?e.message:"Analytics could not be loaded.");}finally{setBusy(false);}},[courseId,days]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{if(!selectedStudent){setTimeline(null);return;}let active=true;setTimelineError("");
    void api<Timeline>(`/api/courses/${courseId}/analytics/students/${selectedStudent}?days=${days}&kind=${activityFilter}`)
      .then(d=>{if(active)setTimeline(d);}).catch(e=>{if(active)setTimelineError(e instanceof Error?e.message:"Learner timeline could not be loaded.");});
    return()=>{active=false;};
  },[courseId,selectedStudent,days,activityFilter]);
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
     <h4 style={{marginTop:18}}>Learner evidence timeline</h4>{data.studentOptions.length?<div className="form-grid">
       <div className="field"><label htmlFor="analytics-student">Student</label><select id="analytics-student" value={selectedStudent} onChange={e=>setSelectedStudent(e.target.value)}>{data.studentOptions.map(s=><option value={s.id} key={s.id}>{s.email}</option>)}</select></div>
       <div className="field"><label htmlFor="analytics-kind">Activity type</label><select id="analytics-kind" value={activityFilter} onChange={e=>setActivityFilter(e.target.value)}>{[["all","All activity"],["baseline","Baseline"],["practice","Practice"],["twin","Twin problems"],["review","FSRS review"],["comprehension","Comprehension"],["diagnostic","Diagnostics"],["assignment","Verified assignments"]].map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></div>
     </div>:<p className="muted">No enrolled students are available for a timeline.</p>}
     {timelineError&&<div className="notice error" role="alert">{timelineError}</div>}
     {timeline&&<><p className="muted">{timeline.student.email} · {timeline.summary.attempts} attempts · {timeline.summary.correct} correct · {timeline.summary.assisted} assisted · last {timeline.days} days</p>
       {timeline.timeline.length?<ol className="stack">{timeline.timeline.map((event,i)=><li className="course-card row" key={`${event.occurredAt}-${i}`}><span><strong>{event.concept}</strong><small>{event.type}{event.errorCategory?` · ${event.errorCategory.replaceAll("_"," ")}`:""} · {event.assisted?"assisted":"independent"} · {new Date(event.occurredAt).toLocaleString()}</small></span><span className={`badge ${event.correct?"green":"yellow"}`}>{event.correct?"Correct":"Review"}</span></li>)}</ol>:<p className="muted">No matching activity in this window.</p>}</>}
    <p className="muted">Counts describe recorded activity, not a diagnosis. Review assignment responses in the teacher panel before using them to change a student's mastery status.</p>
    </>}
    {busy&&<p className="muted" role="status">Refreshing analytics…</p>}
  </section>;
}
