import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, jsonBody } from "./api";

type Problem = {id:string;prompt:string;conceptId:string;twinProblemId:string|null};
export default function TwinLinker({courseId,revision}:{courseId:string|number;revision:unknown}) {
  const [problems,setProblems]=useState<Problem[]>([]);
  const [original,setOriginal]=useState(""),[twin,setTwin]=useState("");
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [error,setError]=useState(""),[notice,setNotice]=useState("");
  const load=useCallback(async()=>{
    setLoading(true);
    try{const data=await api<{problems:Problem[]}>(`/api/courses/${courseId}/practice-problems`);setProblems(data.problems);}
    catch(e){setError(e instanceof Error?e.message:"Could not load practice problems.");}
    finally{setLoading(false);}
  },[courseId]);
  useEffect(()=>{void load();},[load,revision]);
  const originalProblem=problems.find(p=>p.id===original);
  const targets=new Set(problems.flatMap(p=>p.twinProblemId?[p.twinProblemId]:[]));
  const choices=problems.filter(p=>p.id!==original&&p.conceptId===originalProblem?.conceptId&&!p.twinProblemId&&(!targets.has(p.id)||p.id===originalProblem?.twinProblemId));
  async function save(event:FormEvent){
    event.preventDefault();setBusy(true);setError("");setNotice("");
    try{
      await api(`/api/practice-problems/${original}/twin`,{method:"PUT",body:jsonBody({twinProblemId:twin})});
      await load();setNotice("Twin linked. Students can open it after submitting the original problem.");
    }catch(e){setError(e instanceof Error?e.message:"Could not link the twin.");}finally{setBusy(false);}
  }
  return <section style={{marginTop:24}} aria-labelledby="link-twin-heading">
    <h3 id="link-twin-heading">Link an independent twin</h3>
    <p className="muted">Create two different practice questions for the same concept above, then pair them here. The twin stays out of ordinary practice until the original is submitted. Choose a meaningful variation that checks the same reasoning skill.</p>
    {error&&<div className="notice error" role="alert">{error}<button type="button" className="button small" onClick={()=>void load()}>Retry loading</button></div>}
    {notice&&<div className="notice success" role="status">{notice}</div>}
    {loading?<p role="status">Loading practice questions…</p>:problems.length<2?<p className="muted">Add two practice questions for the same concept to create a pair.</p>:<form className="form-grid" onSubmit={save}>
      <div className="field"><label htmlFor="original-problem">Original practice problem</label><select id="original-problem" required value={original} onChange={e=>{setOriginal(e.target.value);setTwin(problems.find(p=>p.id===e.target.value)?.twinProblemId||"");setNotice("");}}>
        <option value="">Choose original</option>{problems.filter(p=>!targets.has(p.id)).map(p=><option key={p.id} value={p.id}>{p.prompt}</option>)}
      </select></div>
      <div className="field"><label htmlFor="linked-twin">Twin question</label><select id="linked-twin" required disabled={!original} value={twin} onChange={e=>setTwin(e.target.value)}>
        <option value="">Choose a different variation</option>{choices.map(p=><option key={p.id} value={p.id}>{p.prompt}</option>)}
      </select></div>
      <button className="button primary" disabled={busy||!original||!twin}>{busy?"Saving…":"Save twin link"}</button>
      {original&&!choices.length&&<p className="muted">Add another unpaired question for this concept first.</p>}
    </form>}
    {problems.some(p=>p.twinProblemId)&&<ul>{problems.filter(p=>p.twinProblemId).map(p=><li key={p.id}>{p.prompt} → {problems.find(t=>t.id===p.twinProblemId)?.prompt}</li>)}</ul>}
  </section>;
}
