import { FormEvent,useCallback,useEffect,useState } from "react";
import { api,jsonBody } from "./api";
type Milestone={id:string;title:string;targetDate:string;targetScore:number|null;completedAt:string|null};
export default function MilestonesPanel({courseId}:{courseId:string|number}) {
  const [items,setItems]=useState<Milestone[]>([]),[title,setTitle]=useState(""),[date,setDate]=useState(""),[score,setScore]=useState("");
  const [error,setError]=useState(""),[busy,setBusy]=useState(false);
  const load=useCallback(async()=>{setItems((await api<{milestones:Milestone[]}>(`/api/courses/${courseId}/milestones`)).milestones);},[courseId]);
  useEffect(()=>{void load().catch(e=>setError(e.message));},[load]);
  async function add(event:FormEvent){event.preventDefault();setBusy(true);setError("");try{
    await api(`/api/courses/${courseId}/milestones`,{method:"POST",body:jsonBody({title,targetDate:date,targetScore:score===""?null:Number(score)})});
    setTitle("");setDate("");setScore("");await load();
  }catch(e){setError(e instanceof Error?e.message:"Milestone could not be saved.");}finally{setBusy(false);}}
  async function mark(item:Milestone,completed:boolean){setBusy(true);setError("");try{
    await api(`/api/courses/${courseId}/milestones/${item.id}`,{method:"PATCH",body:jsonBody({completed})});await load();
  }catch(e){setError(e instanceof Error?e.message:"Milestone could not be updated.");}finally{setBusy(false);}}
  async function remove(item:Milestone){setBusy(true);setError("");try{
    await api(`/api/courses/${courseId}/milestones/${item.id}`,{method:"DELETE"});await load();
  }catch(e){setError(e instanceof Error?e.message:"Milestone could not be deleted.");}finally{setBusy(false);}}
  return <section className="course-card" style={{marginTop:14}}><h4>Course milestones</h4>
    <p className="muted">Add dated checkpoints toward your goal. These are private to you, do not change teacher-set deadlines, and earn 5 XP once when completed.</p>
    {error&&<div className="notice error" role="alert">{error}</div>}
    <form className="form-grid" onSubmit={add}>
      <div className="field"><label htmlFor="milestone-title">Milestone</label><input id="milestone-title" required maxLength={160} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Finish the first unit"/></div>
      <div className="field"><label htmlFor="milestone-date">Target date</label><input id="milestone-date" type="date" required value={date} onChange={e=>setDate(e.target.value)}/></div>
      <div className="field"><label htmlFor="milestone-score">Target score (optional)</label><input id="milestone-score" type="number" min={0} max={100} value={score} onChange={e=>setScore(e.target.value)}/></div>
      <div className="field"><button className="button small" disabled={busy||items.length>=20}>Add milestone</button></div>
    </form>
    {items.length?<ul className="stack">{items.map(item=><li className="course-card row" key={item.id}><span><strong>{item.title}</strong><small>{item.targetDate}{item.targetScore!==null?` · target ${item.targetScore}%`:""}{item.completedAt?" · Completed":""}</small></span>
      <span className="card-actions">{item.completedAt?<button className="button small" disabled={busy} onClick={()=>void mark(item,false)}>Reopen</button>:<button className="button small" disabled={busy} onClick={()=>void mark(item,true)}>Mark complete</button>}<button className="button small" disabled={busy} onClick={()=>void remove(item)}>Delete</button></span></li>)}</ul>:<p className="muted">No milestones yet.</p>}
  </section>;
}
