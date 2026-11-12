import { useCallback,useEffect,useState } from "react";
import { api,jsonBody } from "./api";

type Assignment={id:string;title:string;instructions:string;dueAt:string|null;rubric:string[];status:string;submissionCount?:number;
  conceptId?:string|null;conceptName?:string|null;
  submissionId?:string|null;response?:string|null;diagnosis?:string|null;confidence?:number|null;submissionStatus?:string|null;fileName?:string|null;extractionStatus?:string;
  score?:number|null;rubricScores?:number[]|null;misconception?:string|null;misconceptionCode?:string|null;verifiedEvidence?:boolean;teacherFeedback?:string|null;};
type Submission={id:string;email:string;response:string;diagnosis:string;confidence:number;status:string;fileName?:string|null;extractionStatus?:string;score:number|null;rubricScores:number[]|null;misconception:string|null;teacherFeedback:string|null};

const errorCategories=[["concept_gap","Concept misunderstanding"],["procedure_error","Procedure or calculation error"],["misread_question","Question misread"],["units_or_notation","Units or notation"],["source_use","Course source not applied"],["other","Other"]];
export function TeacherAssignments({courseId,concepts}:{courseId:string|number;concepts:{id:string;name:string}[]}) {
  const [items,setItems]=useState<Assignment[]>([]),[selected,setSelected]=useState("");
  const [submissions,setSubmissions]=useState<Submission[]>([]),[criteria,setCriteria]=useState("");
  const [title,setTitle]=useState(""),[instructions,setInstructions]=useState(""),[dueAt,setDueAt]=useState(""),[conceptId,setConceptId]=useState("");
  const [grade,setGrade]=useState<Record<string,{score:string;feedback:string;misconception:string;misconceptionCode:string;includeEvidence:boolean;rubricScores:number[]}>>({});
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const load=useCallback(async()=>{const d=await api<{assignments:Assignment[]}>(`/api/courses/${courseId}/assignments`);setItems(d.assignments);},[courseId]);
  const loadSubmissions=useCallback(async(id:string)=>{const d=await api<{submissions:Submission[]}>(`/api/assignments/${id}/submissions`);setSubmissions(d.submissions);},[]);
  useEffect(()=>{void load().catch(e=>setError(e.message));},[load]);
  useEffect(()=>{if(selected)void loadSubmissions(selected).catch(e=>setError(e.message));},[selected,loadSubmissions]);
  async function run(action:()=>Promise<void>){setBusy(true);setError("");setNotice("");try{await action();}catch(e){setError(e instanceof Error?e.message:"Assignment action failed.");}finally{setBusy(false);}}
  return <section className="study-section"><div className="divider"/><div className="eyebrow">Assignments</div><h3>Assignments and review</h3>
    {error&&<div className="notice error" role="alert">{error}</div>}{notice&&<div className="notice success" role="status">{notice}</div>}
    <form className="form-grid" onSubmit={e=>{e.preventDefault();void run(async()=>{
      const assignment=await api<Assignment>(`/api/courses/${courseId}/assignments`,{method:"POST",body:jsonBody({title,instructions,conceptId:conceptId||null,dueAt:dueAt?new Date(dueAt).toISOString():null,rubric:criteria.split("\n").map(x=>x.trim()).filter(Boolean)})});
      await api(`/api/assignments/${assignment.id}/publish`,{method:"POST"});setTitle("");setInstructions("");setCriteria("");setDueAt("");setConceptId("");setSelected(assignment.id);setNotice("Assignment published.");await load();
    });}}>
      <div className="field"><label htmlFor="assignment-title">Title</label><input id="assignment-title" required value={title} onChange={e=>setTitle(e.target.value)}/></div>
      <div className="field"><label htmlFor="assignment-due">Due date and time</label><input id="assignment-due" type="datetime-local" value={dueAt} onChange={e=>setDueAt(e.target.value)}/></div>
      <div className="field"><label htmlFor="assignment-concept">Concept for verified evidence</label><select id="assignment-concept" value={conceptId} onChange={e=>setConceptId(e.target.value)}><option value="">No concept link</option>{concepts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div className="field full"><label htmlFor="assignment-instructions">Instructions</label><textarea id="assignment-instructions" required rows={3} value={instructions} onChange={e=>setInstructions(e.target.value)}/></div>
      <div className="field full"><label htmlFor="assignment-rubric">Rubric criteria, one per line</label><textarea id="assignment-rubric" rows={3} value={criteria} onChange={e=>setCriteria(e.target.value)} placeholder="Reasoning is supported by course material"/></div>
      <div className="field"><button className="button primary" disabled={busy}>Publish assignment</button></div>
    </form>
    <div className="stack" style={{marginTop:16}}>{items.map(item=><button key={item.id} type="button" className={`course-card row ${selected===item.id?"selected":""}`} onClick={()=>setSelected(item.id)}>
      <span><strong>{item.title}</strong><small>{item.conceptName||"No concept link"} · {item.submissionCount||0} submissions · {item.dueAt?new Date(item.dueAt).toLocaleString():"No due date"}</small></span><span className="badge green">{item.status}</span>
    </button>)}</div>
    {selected&&<div className="stack" style={{marginTop:18}}><h4>Student submissions</h4>{submissions.length===0?<p className="muted">No students have submitted yet.</p>:submissions.map(s=>{
      const local=grade[s.id]||{score:s.score===null?"":String(s.score),feedback:s.teacherFeedback||"",misconception:s.misconception||"",misconceptionCode:"",includeEvidence:false,rubricScores:s.rubricScores||items.find(x=>x.id===selected)?.rubric.map(()=>0)||[]};
      return <article className="course-card" key={s.id}><strong>{s.email} · {s.confidence}/5 confidence</strong><p className="muted">Student reflection: {s.diagnosis||"Not provided"}</p><p style={{whiteSpace:"pre-wrap"}}>{s.response}</p>
        {s.fileName&&<p><a className="button small" href={`/api/assignment-submissions/${s.id}/file`}>Open {s.fileName}</a> · {s.extractionStatus}</p>}
        <div className="field"><label htmlFor={`score-${s.id}`}>Teacher score, 0–100</label><input id={`score-${s.id}`} type="number" min="0" max="100" value={local.score} onChange={e=>setGrade({...grade,[s.id]:{...local,score:e.target.value}})}/></div>
        {items.find(x=>x.id===selected)?.rubric.map((criterion,i)=><div className="field" key={i}><label htmlFor={`rubric-${s.id}-${i}`}>{criterion} · 0–4</label><input id={`rubric-${s.id}-${i}`} type="number" min="0" max="4" value={local.rubricScores[i]??0} onChange={e=>setGrade({...grade,[s.id]:{...local,rubricScores:local.rubricScores.map((v,n)=>n===i?Number(e.target.value):v)}})}/></div>)}
        <div className="field"><label htmlFor={`misconception-${s.id}`}>Diagnosis or error category</label><input id={`misconception-${s.id}`} value={local.misconception} onChange={e=>setGrade({...grade,[s.id]:{...local,misconception:e.target.value}})}/></div>
        <div className="field"><label htmlFor={`error-code-${s.id}`}>Structured error category</label><select id={`error-code-${s.id}`} value={local.misconceptionCode} onChange={e=>setGrade({...grade,[s.id]:{...local,misconceptionCode:e.target.value}})}><option value="">Not categorized</option>{errorCategories.map(([code,label])=><option value={code} key={code}>{label}</option>)}</select></div>
        <div className="field"><label htmlFor={`feedback-${s.id}`}>Feedback</label><textarea id={`feedback-${s.id}`} rows={3} value={local.feedback} onChange={e=>setGrade({...grade,[s.id]:{...local,feedback:e.target.value}})}/></div>
        {items.find(x=>x.id===selected)?.conceptId&&<div className="field"><label><input type="checkbox" checked={local.includeEvidence} onChange={e=>setGrade({...grade,[s.id]:{...local,includeEvidence:e.target.checked}})}/> Include as separate teacher-verified concept evidence</label><small>This does not increase distinct independent practice questions.</small></div>}
        <button className="button small" disabled={busy||local.score===""} onClick={()=>void run(async()=>{
          await api(`/api/assignment-submissions/${s.id}/review`,{method:"POST",body:jsonBody({score:Number(local.score),feedback:local.feedback,misconception:local.misconception,misconceptionCode:local.misconceptionCode,includeEvidence:local.includeEvidence,rubricScores:local.rubricScores})});
          setNotice("Teacher review saved.");await loadSubmissions(selected);
        })}>Save teacher review</button>
      </article>;
    })}</div>}
  </section>;
}

export function StudentAssignments({courseId}:{courseId:string|number}) {
  const [items,setItems]=useState<Assignment[]>([]),[drafts,setDrafts]=useState<Record<string,{response:string;diagnosis:string;confidence:number}>>({});
  const [files,setFiles]=useState<Record<string,File|undefined>>({});
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const load=useCallback(async()=>{const d=await api<{assignments:Assignment[]}>(`/api/courses/${courseId}/assignments`);setItems(d.assignments);},[courseId]);
  useEffect(()=>{void load().catch(e=>setError(e.message));},[load]);
  async function submit(id:string,prior?:Assignment){setBusy(true);setError("");setNotice("");try{
    const item=drafts[id]||{response:prior?.response||"",diagnosis:prior?.diagnosis||"",confidence:prior?.confidence||3};
    const body=new FormData();body.set("response",item.response);body.set("diagnosis",item.diagnosis);body.set("confidence",String(item.confidence));
    if(files[id])body.set("file",files[id]!);
    await api(`/api/assignments/${id}/submissions`,{method:"POST",body});setFiles({...files,[id]:undefined});setNotice("Submission saved for teacher review.");await load();
  }catch(e){setError(e instanceof Error?e.message:"Submission failed.");}finally{setBusy(false);}}
  return <section className="study-section"><div className="divider"/><div className="eyebrow">Coursework</div><h3>Assignments</h3>
    {error&&<div className="notice error" role="alert">{error}</div>}{notice&&<div className="notice success" role="status">{notice}</div>}
    {items.length===0?<p className="muted">No published assignments yet.</p>:<div className="stack">{items.map(item=>{
      const d=drafts[item.id]||{response:item.response||"",diagnosis:item.diagnosis||"",confidence:item.confidence||3};
      const locked=item.submissionStatus==="reviewed";
      return <article className="course-card" key={item.id}><h4>{item.title}</h4><p>{item.instructions}</p><p className="muted">{item.conceptName&&`Concept: ${item.conceptName} · `}{item.dueAt?`Due ${new Date(item.dueAt).toLocaleString()}`:"No due date"} · {item.rubric.length} rubric criteria</p>
        {item.fileName&&<p><a className="button small" href={`/api/assignment-submissions/${item.submissionId}/file`}>Open my {item.fileName}</a></p>}
        {locked?<div className="notice" role="status"><strong>Teacher review · {item.score}/100</strong><p>{item.teacherFeedback}</p>{item.misconception&&<p>Diagnosis: {item.misconception}</p>}</div>:
          <>{item.verifiedEvidence&&<p className="notice">Teacher included this reviewed assignment as separate concept evidence.</p>}<div className="field"><label htmlFor={`response-${item.id}`}>Your response</label><textarea id={`response-${item.id}`} rows={5} value={d.response} onChange={e=>setDrafts({...drafts,[item.id]:{...d,response:e.target.value}})}/></div>
            <div className="field"><label htmlFor={`file-${item.id}`}>Attach text PDF or plain text file</label><input id={`file-${item.id}`} type="file" accept=".pdf,.txt,application/pdf,text/plain" onChange={e=>setFiles({...files,[item.id]:e.target.files?.[0]})}/></div>
            <div className="field"><label htmlFor={`reflection-${item.id}`}>What felt difficult?</label><textarea id={`reflection-${item.id}`} rows={2} value={d.diagnosis} onChange={e=>setDrafts({...drafts,[item.id]:{...d,diagnosis:e.target.value}})}/></div>
            <div className="field"><label htmlFor={`confidence-${item.id}`}>Confidence, 1–5</label><select id={`confidence-${item.id}`} value={d.confidence} onChange={e=>setDrafts({...drafts,[item.id]:{...d,confidence:Number(e.target.value)}})}>{[1,2,3,4,5].map(n=><option value={n} key={n}>{n}</option>)}</select></div>
            <button className="button primary small" disabled={busy||(!d.response.trim()&&!files[item.id])} onClick={()=>void submit(item.id,item)}>{item.submissionId?"Update submission":"Submit assignment"}</button>
            {item.submissionStatus==="submitted"&&<p className="muted">Submitted · awaiting teacher review.</p>}
          </>}
      </article>;
    })}</div>}
  </section>;
}
