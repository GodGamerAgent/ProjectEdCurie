import { useCallback,useEffect,useState } from "react";
import { api,jsonBody } from "./api";
type MockResult={score:number;correctCount:number;questionCount:number;details:{questionId:string;prompt:string;answer:string;expectedAnswer:string;correct:boolean}[]};
type Entry={id:string;email:string;score:number;correctCount:number;questionCount:number;completedAt:string;result:MockResult;teacherReview:string|null};
export default function TeacherMockReviews({courseId}:{courseId:string|number}) {
  const [items,setItems]=useState<Entry[]>([]),[drafts,setDrafts]=useState<Record<string,string>>({});
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
  const load=useCallback(async()=>{const result=await api<{results:Entry[]}>(`/api/courses/${courseId}/mocks/results`);setItems(result.results);setDrafts(Object.fromEntries(result.results.map(item=>[item.id,item.teacherReview||""])));},[courseId]);
  useEffect(()=>{void load().catch(e=>setError(e.message));},[load]);
  async function review(item:Entry){setBusy(true);setError("");setNotice("");try{
    await api(`/api/mock-sessions/${item.id}/review`,{method:"POST",body:jsonBody({feedback:drafts[item.id]||""})});await load();setNotice("Mock feedback saved.");
  }catch(e){setError(e instanceof Error?e.message:"Feedback could not be saved.");}finally{setBusy(false);}}
  return <section className="study-section"><div className="divider"/><div className="eyebrow">Teacher review</div><h3>Adaptive mock results</h3>
    <p className="muted">Mock scores stay separate from mastery. Teacher comments are shown to the student on their saved result.</p>
    {error&&<div className="notice error" role="alert">{error}</div>}{notice&&<div className="notice success" role="status">{notice}</div>}
    {items.length?<div className="stack">{items.map(item=><article className="course-card" key={item.id}>
      <div className="row"><div><strong>{item.email}</strong><p>{item.score}% · {item.correctCount}/{item.questionCount} correct · {new Date(item.completedAt).toLocaleString()}</p></div><span className="badge">{item.id.slice(0,8)}</span></div>
      <details><summary>Review answers</summary>{item.result.details.map((q,index)=><div className="notice" key={q.questionId}><strong>{index+1}. {q.correct?"Correct":"Review"}</strong><p>{q.prompt}</p><p>Student: {q.answer} · Expected: {q.expectedAnswer}</p></div>)}</details>
      <div className="field"><label htmlFor={`mock-review-${item.id}`}>Teacher feedback</label><textarea id={`mock-review-${item.id}`} rows={3} maxLength={2000} value={drafts[item.id]??""} onChange={e=>setDrafts({...drafts,[item.id]:e.target.value})}/></div>
      <button className="button small" disabled={busy||!String(drafts[item.id]||"").trim()} onClick={()=>void review(item)}>Save feedback</button>
    </article>)}</div>:<p className="muted">Submitted mocks appear here for teacher review.</p>}
  </section>;
}
