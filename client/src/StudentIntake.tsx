import { FormEvent,useCallback,useEffect,useState } from "react";
import { api,jsonBody } from "./api";

type Intake={background:string;confidence:number|null;targetAssessment:string;targetDate:string|null;goals:string};
const empty:Intake={background:"",confidence:null,targetAssessment:"",targetDate:null,goals:""};
export default function StudentIntake({courseId}:{courseId:string|number}) {
  const [data,setData]=useState<Intake|null>(null),[draft,setDraft]=useState<Intake>(empty);
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
  const load=useCallback(async()=>{const value=await api<Intake>(`/api/courses/${courseId}/intake`);setData(value);setDraft(value);},[courseId]);
  useEffect(()=>{void load().catch(e=>setError(e.message));},[load]);
  async function save(event:FormEvent){event.preventDefault();setBusy(true);setError("");setNotice("");try{const value=await api<Intake>(`/api/courses/${courseId}/intake`,{method:"PUT",body:jsonBody(draft)});setData(value);setDraft(value);setNotice("Your study intake has been saved.");}catch(e){setError(e instanceof Error?e.message:"Intake could not be saved.");}finally{setBusy(false);}}
  async function clear(){setBusy(true);setError("");setNotice("");try{await api(`/api/courses/${courseId}/intake`,{method:"DELETE"});setData(empty);setDraft(empty);setNotice("Your course intake was deleted.");}catch(e){setError(e instanceof Error?e.message:"Intake could not be deleted.");}finally{setBusy(false);}}
  return <section className="study-section"><div className="divider"/><div className="eyebrow">Before you begin</div><h3>Personalize your learning</h3>
    <p className="muted">Share only what helps tailor explanations. This is optional and private to you; when you request an AI explanation, these details are sent to the configured tutoring provider with the course excerpt. You can delete them at any time.</p>
    {error&&<div className="notice error" role="alert">{error}<button className="button small" onClick={()=>void load()}>Retry</button></div>}
    {notice&&<div className="notice success" role="status">{notice}</div>}
    {data&&<form onSubmit={save}><div className="form-grid" style={{marginTop:12}}>
      <div className="field full"><label htmlFor="intake-background">What have you studied already?</label><textarea id="intake-background" maxLength={2000} rows={3} value={draft.background||""} onChange={e=>setDraft({...draft,background:e.target.value})} placeholder="Optional background or topics you already know"/></div>
      <div className="field"><label htmlFor="intake-confidence">How confident do you feel?</label><select id="intake-confidence" value={draft.confidence??""} onChange={e=>setDraft({...draft,confidence:e.target.value?Number(e.target.value):null})}><option value="">No answer</option>{[1,2,3,4,5].map(n=><option value={n} key={n}>{n} — {["Not confident","A little","Somewhat","Confident","Very confident"][n-1]}</option>)}</select></div>
      <div className="field"><label htmlFor="intake-assessment">Target assessment</label><input id="intake-assessment" maxLength={160} value={draft.targetAssessment||""} onChange={e=>setDraft({...draft,targetAssessment:e.target.value})} placeholder="Optional exam or assessment"/></div>
      <div className="field"><label htmlFor="intake-date">Target date</label><input id="intake-date" type="date" value={draft.targetDate?String(draft.targetDate).slice(0,10):""} onChange={e=>setDraft({...draft,targetDate:e.target.value||null})}/></div>
      <div className="field full"><label htmlFor="intake-goals">What would you like to be able to do?</label><textarea id="intake-goals" maxLength={1000} rows={2} value={draft.goals||""} onChange={e=>setDraft({...draft,goals:e.target.value})} placeholder="Optional learning goal"/></div>
      <div className="field"><button className="button primary small" disabled={busy}>Save intake</button> <button type="button" className="button small" disabled={busy} onClick={()=>void clear()}>Delete intake</button></div>
    </div></form>}
  </section>;
}
