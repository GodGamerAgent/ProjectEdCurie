import { useCallback,useEffect,useState } from "react";
import { api,jsonBody } from "./api";

type Rewards={points:number;optIn:boolean;displayName:string;recent:{points:number;reason:string;createdAt:string}[];
  leaderboard:{name:string;points:number;rank:number;you:boolean}[]};
export default function RewardsPanel({courseId}:{courseId:string|number}) {
  const [data,setData]=useState<Rewards|null>(null),[name,setName]=useState("Learner"),[optIn,setOptIn]=useState(false);
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
  const load=useCallback(async()=>{const d=await api<Rewards>(`/api/courses/${courseId}/rewards`);setData(d);setName(d.displayName||"Learner");setOptIn(d.optIn);},[courseId]);
  useEffect(()=>{void load().catch(e=>setError(e.message));},[load]);
  async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");setNotice("");try{
    await api(`/api/courses/${courseId}/leaderboard-preference`,{method:"PUT",body:jsonBody({optIn,displayName:name})});await load();setNotice(optIn?"You opted in to this course leaderboard.":"You are hidden from this course leaderboard.");
  }catch(e){setError(e instanceof Error?e.message:"Preference could not be saved.");}finally{setBusy(false);}}
  return <section className="study-section"><div className="divider"/><div className="eyebrow">Recognition</div><h3>XP and course leaderboard</h3>
    {error&&<div className="notice error" role="alert">{error}</div>}{notice&&<div className="notice success" role="status">{notice}</div>}
    {data&&<><div className="course-card"><strong>{data.points} XP</strong><p className="muted">Earn XP for practice, comprehension, reviews, and completing scheduled sessions.</p></div>
      <form className="form-grid" onSubmit={save} style={{marginTop:14}}>
        <div className="field"><label htmlFor="leaderboard-name">Display name</label><input id="leaderboard-name" maxLength={40} required value={name} onChange={e=>setName(e.target.value)}/></div>
        <div className="field"><label><input type="checkbox" checked={optIn} onChange={e=>setOptIn(e.target.checked)}/> Show me on this course leaderboard</label></div>
        <div className="field"><button className="button small" disabled={busy}>Save leaderboard choice</button></div>
      </form>
      <p className="muted">Opt-in is off by default. The board shows only your chosen display name and XP, never your email. The choice applies to this course.</p>
      <h4>Leaderboard</h4>{data.leaderboard.length?<ol className="stack">{data.leaderboard.map(x=><li className="course-card row" key={`${x.rank}-${x.name}`}><span>{x.rank}. {x.name}{x.you?" · You":""}</span><strong>{x.points} XP</strong></li>)}</ol>:<p className="muted">No students have opted in yet.</p>}
      <h4>Recent XP</h4>{data.recent.length?<ul>{data.recent.map((x,i)=><li key={`${x.createdAt}-${i}`}>{x.reason} · +{x.points} XP</li>)}</ul>:<p className="muted">Your learning activity will appear here.</p>}
    </>}
  </section>;
}
