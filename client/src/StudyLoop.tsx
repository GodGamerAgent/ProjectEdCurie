import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, jsonBody } from "./api";
import TwinLinker from "./TwinLinker";
import { StudentSchedule, TeacherTimetable } from "./Timetable";
import { TeacherAssignments } from "./AssignmentPanels";
import TeacherAnalytics from "./TeacherAnalytics";

type Concept = { id: string; name: string; resourceId: string; prerequisites?: {id:string;name:string}[] };
type Resource = { id: string | number; title: string };
type Assessment = { id: string | number; title: string; questions: { id: string | number; prompt: string; conceptId?: string | null }[] };
type Evidence = { id?: string; studentId?: string; email?: string; conceptId?: string; name: string; status: string; attempts: number; independent_correct: number; independent_attempts: number; assisted_correct: number; assisted_attempts: number };
type LessonCheck = {id:string;prompt:string;options:string[];citations:{resourceId:string;resourceVersionId:string;title?:string;location:string}[];selectedOption?:number|null;correct?:boolean|null;answered?:boolean;answeredAt?:string|null;correctOption?:number|null};
function LessonCheckView({lessonId,check,run}:{lessonId:string;check:LessonCheck;run:(action:()=>Promise<void>)=>void}) {
  const [selected,setSelected]=useState<number|null>(check.selectedOption??null);
  const [result,setResult]=useState<{correct:boolean;correctOption:number;message:string}|null>(
    check.answered&&check.correct!==null&&check.correctOption!==null?{correct:check.correct!,correctOption:check.correctOption!,message:check.correct?"Correct. This check is recorded as assisted comprehension evidence.":"Not quite. Review the explanation and cited course material."}:null);
  return <div className="course-card" style={{marginTop:12}}><strong>Check your understanding</strong><p>{check.prompt}</p>
    {check.citations.map((cite,index)=><p key={index} className="muted">Source: {cite.title||"Course material"} · {cite.location}</p>)}
    <fieldset disabled={Boolean(result)} style={{border:0,padding:0,margin:0}}>
      <legend className="sr-only">Choose an answer</legend>
      {check.options.map((option,index)=><label key={index} className="row" style={{justifyContent:"flex-start",gap:10,margin:"8px 0"}}>
        <input type="radio" name={`check-${check.id}`} checked={selected===index} onChange={()=>setSelected(index)}/><span>{option}</span>
      </label>)}
    </fieldset>
    {!result?<button className="button small" type="button" disabled={selected===null} onClick={()=>run(async()=>{
      const response=await api<{correct:boolean;correctOption:number;message:string}>(`/api/lessons/${lessonId}/checks/${check.id}/answer`,{method:"POST",body:jsonBody({selectedOption:selected})});
      setResult(response);
    })}>Submit check</button>:<div className="notice" role="status" style={{marginTop:10}}>
      <p>{result.message}</p><p>Answer: {check.options[result.correctOption]}</p>
    </div>}
  </div>;
}
function ReviewVault({courseId,baselineReady,refreshKey}:{courseId:string|number;baselineReady:boolean;refreshKey:number}) {
  const [cards,setCards]=useState<{id:string;conceptName:string;dueAt:string;due:boolean}[]>([]);
  const [session,setSession]=useState<{sessionId:string;prompt:string}|null>(null);
  const [answer,setAnswer]=useState(""),[result,setResult]=useState<{correct:boolean;expectedAnswer:string;dueAt:string;intervalDays:number;message:string}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const load=useCallback(async()=>{if(!baselineReady){setCards([]);return;}const data=await api<{cards:typeof cards}>(`/api/courses/${courseId}/reviews`);setCards(data.cards);},[courseId,baselineReady]);
  useEffect(()=>{void load().catch(e=>setError(e.message));},[load,refreshKey]);
  async function act(action:()=>Promise<void>){setBusy(true);setError("");try{await action();}catch(e){setError(e instanceof Error?e.message:"Review could not be saved.");}finally{setBusy(false);}}
  return <section className="study-section" aria-labelledby="review-vault-title"><div className="divider"/><div className="eyebrow">Spaced retrieval</div><h3 id="review-vault-title">Review vault</h3>
    <p className="muted">Due teacher-approved questions appear here. Answer before seeing the expected answer; FSRS schedules the next review from your recall.</p>
    {error&&<div className="notice error" role="alert">{error}</div>}
    {!baselineReady?<p className="muted">Complete the baseline to unlock reviews.</p>:cards.length===0?<p className="muted">No review cards are scheduled yet. Your practice attempts add questions here.</p>:
      <div className="stack">{cards.map(card=><div className="course-card row" key={card.id}>
        <div><strong>{card.conceptName}</strong><p>{card.due?"Due now":`Next review ${new Date(card.dueAt).toLocaleString()}`}</p></div>
        <button className="button small" disabled={busy||!card.due} onClick={()=>void act(async()=>{const next=await api<{sessionId:string;prompt:string}>(`/api/review-cards/${card.id}/start`,{method:"POST"});setSession(next);setAnswer("");setResult(null);})}>Review</button>
      </div>)}</div>}
    {session&&<div className="resource-card" style={{marginTop:16}}><h4>Recall before revealing</h4><p>{session.prompt}</p>
      {!result?<form onSubmit={e=>{e.preventDefault();void act(async()=>{const data=await api<typeof result>(`/api/review-sessions/${session.sessionId}/answer`,{method:"POST",body:jsonBody({answer})});if(data){setResult(data);await load();}});}}>
        <div className="field"><label htmlFor="review-answer">Your answer</label><input id="review-answer" required value={answer} onChange={e=>setAnswer(e.target.value)}/></div>
        <button className="button primary small" disabled={busy} style={{marginTop:10}}>Submit recall</button>
      </form>:<div className="notice" role="status"><p>{result.message}</p><p>Expected answer: {result.expectedAnswer}</p><p>Next interval: {result.intervalDays} days · {new Date(result.dueAt).toLocaleString()}</p></div>}
    </div>}
  </section>;
}
function AdaptiveMock({courseId,baselineReady}:{courseId:string|number;baselineReady:boolean}) {
  type Mock={id:string;status:string;questions:{id:string;conceptId:string;conceptName:string;prompt:string;sourceTitle:string;sourceLocation:string}[];
    answers:Record<string,string>;result:{score:number;correctCount:number;questionCount:number;details:{questionId:string;prompt:string;answer:string;expectedAnswer:string;correct:boolean}[];message:string}|null};
  const [mock,setMock]=useState<Mock|null>(null),[draft,setDraft]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function act(action:()=>Promise<void>){setBusy(true);setError("");try{await action();}catch(e){setError(e instanceof Error?e.message:"Mock could not be saved.");}finally{setBusy(false);}}
  return <section className="study-section"><div className="divider"/><div className="eyebrow">Assessment practice</div><h3>Adaptive mock</h3>
    <p className="muted">A short mock prioritizes topics with incorrect or limited evidence. It uses current published, source-linked questions. Mock scores remain separate from mastery.</p>
    {error&&<div className="notice error" role="alert">{error}</div>}
    {!baselineReady?<p className="muted">Complete the baseline to unlock mocks.</p>:<button className="button" disabled={busy} onClick={()=>void act(async()=>{
      const next=await api<Mock>(`/api/courses/${courseId}/mocks/start`,{method:"POST"});setMock(next);setDraft(next.answers||{});
    })}>{mock?.status==="active"?"Resume mock":"Start adaptive mock"}</button>}
    {mock?.status==="active"&&<div className="stack" style={{marginTop:16}}>{mock.questions.map((q,i)=><div className="course-card" key={q.id}>
      <div className="eyebrow">Question {i+1} · {q.conceptName}</div><p>{q.prompt}</p><p className="muted">Source: {q.sourceTitle} · {q.sourceLocation}</p>
      <div className="field"><label htmlFor={`mock-${q.id}`}>Your answer</label><input id={`mock-${q.id}`} value={draft[q.id]??mock.answers[q.id]??""} onChange={e=>setDraft({...draft,[q.id]:e.target.value})}/></div>
      <button className="button small" disabled={busy||!String(draft[q.id]??mock.answers[q.id]??"").trim()} onClick={()=>void act(async()=>{
        const answer=draft[q.id]??mock.answers[q.id];await api(`/api/mock-sessions/${mock.id}/answer`,{method:"POST",body:jsonBody({questionId:q.id,answer})});
        setMock({...mock,answers:{...mock.answers,[q.id]:answer}});
      })}>Save answer</button>
    </div>)}
      <button className="button primary" disabled={busy||mock.questions.some(q=>!String(mock.answers[q.id]??draft[q.id]??"").trim())} onClick={()=>void act(async()=>{
        for(const q of mock.questions){const answer=mock.answers[q.id]??draft[q.id];await api(`/api/mock-sessions/${mock.id}/answer`,{method:"POST",body:jsonBody({questionId:q.id,answer})});}
        const result=await api<NonNullable<Mock["result"]>>(`/api/mock-sessions/${mock.id}/submit`,{method:"POST"});
        setMock({...mock,status:"completed",result});
      })}>Submit mock</button>
    </div>}
    {mock?.status==="completed"&&mock.result&&<div className="course-card" style={{marginTop:16}}><strong>Mock result: {mock.result.score}%</strong><p>{mock.result.correctCount} of {mock.result.questionCount} correct. Mastery evidence was not changed.</p>
      {mock.result.details.map((d,i)=><div key={d.questionId} className="notice" style={{marginTop:10}}><strong>Question {i+1} · {d.correct?"Correct":"Review"}</strong><p>{d.prompt}</p><p>Your answer: {d.answer}</p><p>Expected answer: {d.expectedAnswer}</p></div>)}
    </div>}
  </section>;
}

export function TeacherStudy({ courseId, resources, assessments, concepts, refresh }: { courseId: string | number; resources: Resource[]; assessments: Assessment[]; concepts: Concept[]; refresh: () => Promise<void> }) {
  const [name,setName]=useState(""); const [resourceId,setResourceId]=useState("");
  const [selected,setSelected]=useState(""); const [prerequisite,setPrerequisite]=useState("");
  const [questionId,setQuestionId]=useState(""); const [prompt,setPrompt]=useState(""); const [answer,setAnswer]=useState("");
  const [hints,setHints]=useState(["","",""]); const [progress,setProgress]=useState<Evidence[]>([]);
  const [error,setError]=useState(""); const [notice,setNotice]=useState(""); const [busy,setBusy]=useState(false);
  const loadProgress=useCallback(async()=>{const data=await api<{progress:Evidence[]}>(`/api/courses/${courseId}/progress`);setProgress(data.progress);},[courseId]);
  useEffect(()=>{void loadProgress().catch((e)=>setError(e.message));},[loadProgress]);
  async function run(action:()=>Promise<unknown>,message:string) {setBusy(true);setError("");setNotice("");try{await action();await refresh();await loadProgress();setNotice(message);}catch(e){setError(e instanceof Error?e.message:"Could not save.");}finally{setBusy(false);}}
  const related=assessments.flatMap((assessment)=>assessment.questions.filter((q)=>q.conceptId===selected).map((q)=>({...q,assessment:assessment.title})));
  return <section className="study-section">
    <div className="divider"/><div className="eyebrow">Study loop setup</div><h3>Concepts and prerequisites</h3>
    <p className="muted">Create concepts from course material, then connect baseline questions to them. Concepts without evidence remain “Not assessed”.</p>
    {error && <div className="notice error" role="alert">{error}</div>}{notice && <div className="notice success" role="status">{notice}</div>}
    <form className="form-grid" onSubmit={(e)=>{e.preventDefault();void run(async()=>{await api(`/api/courses/${courseId}/concepts`,{method:"POST",body:jsonBody({name,resourceId})});setName("");setResourceId("");},"Concept added.");}}>
      <div className="field"><label htmlFor="concept-name">Concept name</label><input id="concept-name" required value={name} onChange={(e)=>setName(e.target.value)}/></div>
      <div className="field"><label htmlFor="concept-resource">Source material</label><select id="concept-resource" required value={resourceId} onChange={(e)=>setResourceId(e.target.value)}><option value="">Choose resource</option>{resources.map((r)=><option key={r.id} value={r.id}>{r.title}</option>)}</select></div>
      <div className="field"><button className="button primary" disabled={busy}>Add concept</button></div>
    </form>
    {concepts.length>0 && <><div className="field" style={{marginTop:20}}><label htmlFor="teacher-concept">Choose concept</label><select id="teacher-concept" value={selected} onChange={(e)=>{setSelected(e.target.value);setQuestionId("");}}><option value="">Choose a concept</option>{concepts.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      {selected && <><form className="form-grid" style={{marginTop:16}} onSubmit={(e)=>{e.preventDefault();void run(async()=>{await api(`/api/concepts/${selected}/prerequisites`,{method:"POST",body:jsonBody({prerequisiteId:prerequisite})});setPrerequisite("");},"Prerequisite added.");}}>
        <div className="field"><label htmlFor="prerequisite">Prerequisite concept</label><select id="prerequisite" required value={prerequisite} onChange={(e)=>setPrerequisite(e.target.value)}><option value="">Choose prerequisite</option>{concepts.filter((c)=>c.id!==selected).map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div><div className="field" style={{alignSelf:"end"}}><button className="button" disabled={busy}>Add prerequisite</button></div>
      </form>
      <div className="divider"/><h3>Create a practice question</h3><p className="muted">Use a baseline source question for this concept and provide three progressive hints. Create a second variation to link as its twin below.</p>
      <form className="form-grid" onSubmit={(e)=>{e.preventDefault();void run(async()=>{await api(`/api/concepts/${selected}/problems`,{method:"POST",body:jsonBody({questionId,prompt,answer,hints})});setPrompt("");setAnswer("");setHints(["","",""]);},"Practice problem saved.");}}>
        <div className="field full"><label htmlFor="twin-question">Baseline question</label><select id="twin-question" required value={questionId} onChange={(e)=>setQuestionId(e.target.value)}><option value="">Choose a linked question</option>{related.map((q)=><option key={q.id} value={q.id}>{q.assessment}: {q.prompt}</option>)}</select></div>
        <div className="field full"><label htmlFor="twin-prompt">Twin problem</label><textarea id="twin-prompt" required value={prompt} onChange={(e)=>setPrompt(e.target.value)}/></div>
        <div className="field"><label htmlFor="twin-answer">Expected objective answer</label><input id="twin-answer" required value={answer} onChange={(e)=>setAnswer(e.target.value)}/></div>
        {hints.map((hint,i)=><div className="field" key={i}><label htmlFor={`twin-hint-${i}`}>Hint {i+1}</label><input id={`twin-hint-${i}`} required value={hint} onChange={(e)=>setHints(hints.map((x,n)=>n===i?e.target.value:x))}/></div>)}
        <div className="field"><button className="button primary" disabled={busy}>Save twin problem</button></div>
      </form></>}
    </>}
    <TwinLinker courseId={courseId} revision={assessments}/>
    <TeacherTimetable courseId={courseId} concepts={concepts}/>
    <TeacherAssignments courseId={courseId}/>
    <TeacherAnalytics courseId={courseId}/>
    <div className="divider"/><div className="row"><h3>Student progress</h3><button className="button small" type="button" onClick={()=>void loadProgress().catch((e)=>setError(e.message))}>Refresh progress</button></div>
    {progress.length ? <div className="stack">{progress.map((p)=><div className="course-card" key={`${p.studentId}-${p.conceptId}`}><strong>{p.email} · {p.name}</strong><p>{p.status} · Independent {p.independent_correct}/{p.independent_attempts} · Assisted {p.assisted_correct}/{p.assisted_attempts}</p></div>)}</div> : <p className="muted">Progress appears once students and concepts are available.</p>}
  </section>;
}

export function StudentStudy({courseId,baselineReady}:{courseId:string|number;baselineReady:boolean}) {
  const [concepts,setConcepts]=useState<Concept[]>([]); const [evidence,setEvidence]=useState<Evidence[]>([]);
  const [targets,setTargets]=useState<{conceptId:string;name:string;reason:string}[]>([]);
  const [selected,setSelected]=useState(""); const [goal,setGoal]=useState("");const [deadline,setDeadline]=useState("");const [availability,setAvailability]=useState("");
  const [goalRefreshKey,setGoalRefreshKey]=useState(0),[plannedPhase,setPlannedPhase]=useState("");
  const [reviewRefreshKey,setReviewRefreshKey]=useState(0);
  const [lesson,setLesson]=useState<{id:string;explanation:string;citations:{resourceId:string;resourceVersionId:string;title:string;location:string}[];checks:LessonCheck[]}|null>(null);
  const [history,setHistory]=useState<{id:string;explanation:string;citations:{resourceId:string;resourceVersionId?:string;title:string;location:string}[];checks:LessonCheck[]}[]>([]);
  const [session,setSession]=useState<{sessionId:string;prompt:string;concept?:string;kind?:string}|null>(null); const [answer,setAnswer]=useState(""); const [hints,setHints]=useState<string[]>([]);
  const [followups,setFollowups]=useState<{originalSessionId:string;originalPrompt:string;conceptId:string;status:string}[]>([]);
  const [result,setResult]=useState("");const [walkthrough,setWalkthrough]=useState("");const [error,setError]=useState("");const [notice,setNotice]=useState("");const [busy,setBusy]=useState(false);
  const [format,setFormat]=useState("direct");const [source,setSource]=useState<{resourceId:string;location:string;text:string}|null>(null);
  const refresh=useCallback(async()=>{
    const [c,m,g]=await Promise.all([api<{concepts:Concept[]}>(`/api/courses/${courseId}/concepts`),api<{concepts:Evidence[]}>(`/api/courses/${courseId}/mastery`),api<{goal:{goal:string;deadline:string;availability:string}|null}>(`/api/courses/${courseId}/goal`)]);
    setConcepts(c.concepts);setEvidence(m.concepts);if(g.goal){setGoal(g.goal.goal);setDeadline(g.goal.deadline);setAvailability(g.goal.availability);}
    if(baselineReady){
      const [twins,focused]=await Promise.all([
        api<{followups:typeof followups}>(`/api/courses/${courseId}/twin-followups`),
        api<{targets:typeof targets}>(`/api/courses/${courseId}/targeted-practice`)
      ]);
      setFollowups(twins.followups);setTargets(focused.targets);
    }
  },[courseId,baselineReady]);
  useEffect(()=>{void refresh().catch((e)=>setError(e.message));},[refresh]);
  async function run(action:()=>Promise<void>){setBusy(true);setError("");setNotice("");try{await action();}catch(e){setError(e instanceof Error?e.message:"The action could not be completed.");}finally{setBusy(false);}}
  function saveGoal(e:FormEvent){e.preventDefault();void run(async()=>{await api(`/api/courses/${courseId}/goal`,{method:"PUT",body:jsonBody({goal,deadline,availability})});setNotice("Study goal saved.");setGoalRefreshKey(x=>x+1);});}
  function openPlannedConcept(conceptId:string,phase:string){setSelected(conceptId);setLesson(null);setHistory([]);setSession(null);setHints([]);setResult("");setWalkthrough("");setSource(null);setPlannedPhase(phase);}
  return <section className="study-section"><div className="divider"/><div className="eyebrow">Your study loop</div><h3>Goal and concept mastery</h3>
    {error && <div className="notice error" role="alert">{error}</div>}{notice && <div className="notice success" role="status">{notice}</div>}
    <form className="form-grid" onSubmit={saveGoal}><div className="field full"><label htmlFor="study-goal">Study goal</label><input id="study-goal" required value={goal} onChange={(e)=>setGoal(e.target.value)}/></div>
      <div className="field"><label htmlFor="study-deadline">Deadline</label><input id="study-deadline" type="date" required value={deadline} onChange={(e)=>setDeadline(e.target.value)}/></div>
      <div className="field"><label htmlFor="study-availability">Availability</label><input id="study-availability" value={availability} onChange={(e)=>setAvailability(e.target.value)}/></div><div className="field"><button className="button" disabled={busy}>Save goal</button></div></form>
    {baselineReady&&targets.length>0&&<div className="course-card" style={{marginTop:16}} aria-label="Suggested practice topics">
      <strong>Practice a focus topic</strong><p className="muted">Suggestions use your saved answers and only include unused, published teacher questions. They are prompts to practice, not a diagnosis.</p>
      {targets.map(target=><div className="row" key={target.conceptId} style={{marginTop:10}}>
        <div><strong>{target.name}</strong><p className="muted">{target.reason}</p></div>
        <button className="button small" disabled={busy} onClick={()=>void run(async()=>{
          setSelected(target.conceptId);setLesson(null);setHistory([]);setResult("");setWalkthrough("");
          const next=await api<{sessionId:string;prompt:string}>(`/api/concepts/${target.conceptId}/practice`,{method:"POST"});
          setSession(next);setAnswer("");setHints([]);
        })}>Start focused practice</button>
      </div>)}
    </div>}
    <p className="muted" style={{marginTop:20}}>Explanation format and hint style can be changed in Preferences.</p>
    {concepts.length?<div className="stack">{concepts.map((c)=>{const e=evidence.find((x)=>x.id===c.id);return <div className="course-card row" key={c.id}><div><strong>{c.name}</strong><p>{e?.status||"Not assessed"} · Independent {e?.independent_correct||0}/{e?.independent_attempts||0} · Assisted {e?.assisted_correct||0}/{e?.assisted_attempts||0}</p></div><button className="button small" onClick={()=>{setSelected(c.id);setLesson(null);setHistory([]);setSession(null);setHints([]);setResult("");setWalkthrough("");setSource(null);}}>Open concept</button></div>;})}</div>:<p className="muted">Your teacher has not added concepts yet.</p>}
    {selected && <div className="resource-card" style={{marginTop:18}}><h3>{concepts.find((x)=>x.id===selected)?.name}</h3>
    {plannedPhase&&<p className="notice">Scheduled phase: {plannedPhase}. Use the matching lesson or practice action below, then mark the session complete in your plan.</p>}
    {followups.filter(f=>f.conceptId===selected).map(f=><div className="notice" key={f.originalSessionId} style={{marginBottom:12}}>
      <strong>Twin follow-up</strong><p>After: {f.originalPrompt}</p>
      {f.status==="completed"?<p>Twin completed. Its independent or assisted result is included in your evidence.</p>:f.status==="already_seen"?<p>You have already seen this variation. Ask your teacher for a fresh twin.</p>:<button className="button" disabled={busy} onClick={()=>void run(async()=>{
        const next=await api<{sessionId:string;prompt:string;kind:string;hints:string[];submitted:boolean;result:{message:string}|null}>(`/api/practice/${f.originalSessionId}/twin`,{method:"POST"});
        setSession(next.submitted?null:next);setHints(next.hints);setAnswer("");setResult(next.result?.message||"");setWalkthrough("");
      })}>{f.status==="in_progress"?"Resume linked twin":"Solve linked twin"}</button>}
    </div>)}
    {concepts.find((x)=>x.id===selected)?.prerequisites?.length?<p className="muted">Prerequisites: {concepts.find((x)=>x.id===selected)?.prerequisites?.map((p)=>p.name).join(", ")}</p>:<p className="muted">No prerequisite relationship is available.</p>}
    <div className="card-actions">
      <button className="button primary" disabled={busy||!baselineReady} title={!baselineReady?"Complete the baseline first.":undefined} onClick={()=>void run(async()=>{setLesson(await api(`/api/concepts/${selected}/lesson`,{method:"POST",body:jsonBody({format})}));})}>Get lesson</button>
      <button className="button" disabled={busy||!baselineReady} title={!baselineReady?"Complete the baseline first.":undefined} onClick={()=>void run(async()=>{setSession(await api(`/api/concepts/${selected}/practice`,{method:"POST"}));setAnswer("");setHints([]);setResult("");setWalkthrough("");})}>{result?"Next independent problem":"Practice question"}</button>
      <button className="button" disabled={busy||!baselineReady} title={!baselineReady?"Complete the baseline first.":undefined} onClick={()=>void run(async()=>{const data=await api<{lessons:typeof history}>(`/api/concepts/${selected}/lessons`);setHistory(data.lessons);})}>Previous lessons</button>
    </div>
    <div className="field" style={{marginTop:14}}><label htmlFor="lesson-format">Explanation style</label><select id="lesson-format" value={format} onChange={(e)=>setFormat(e.target.value)}><option value="direct">Direct explanation</option><option value="intuition">Build intuition</option><option value="analogy">Use an analogy</option><option value="formal">Formal reasoning</option><option value="code_trace">Trace code</option></select></div>
    {!baselineReady&&<p className="muted">Complete the course baseline to unlock lessons and practice. Your goal and availability can be saved now.</p>}
    {lesson && <div style={{marginTop:16}}><p style={{whiteSpace:"pre-wrap"}}>{lesson.explanation}</p><strong>Sources</strong><ul>{lesson.citations.map((c,i)=><li key={i}>{c.title} · {c.location} <button className="button small" type="button" onClick={()=>void run(async()=>{const data=await api<{text:string;location:string}>(`/api/resources/${c.resourceId}/excerpt?version=${c.resourceVersionId}&location=${encodeURIComponent(c.location)}`);setSource({resourceId:c.resourceId,location:data.location,text:data.text});})}>Open source section</button></li>)}</ul>
      {source&&<div className="notice" role="region" aria-label="Source excerpt"><strong>{source.location}</strong><p style={{whiteSpace:"pre-wrap"}}>{source.text}</p></div>}
      <div aria-label="Lesson comprehension checks">{lesson.checks.map(check=><LessonCheckView key={check.id} lessonId={lesson.id} check={check} run={run}/>)}</div></div>}
    {history.map((item)=><div key={item.id} className="notice" style={{marginTop:12}}><p style={{whiteSpace:"pre-wrap"}}>{item.explanation}</p><span>{item.citations.map((c)=>`${c.title} · ${c.location}`).join(", ")}</span>
      {item.checks.map(check=><LessonCheckView key={check.id} lessonId={item.id} check={check} run={run}/>)}</div>)}
      {session && <div style={{marginTop:18}}><h3>{session.kind==="twin"?"Linked twin question":session.concept ? `Prerequisite check: ${session.concept}` : "Teacher-approved practice"}</h3><p>{session.prompt}</p>
      {session.kind==="twin"&&<p className="muted">Answer without hints for independent evidence. Using any hint records this attempt as assisted instead.</p>}
      {hints.map((hint,i)=><p key={i}><strong>Hint {i+1}:</strong> {hint}</p>)}
      {!session.concept && <button className="button small" disabled={busy||hints.length>=3} onClick={()=>void run(async()=>{const r=await api<{hint:string}>(`/api/practice/${session.sessionId}/hint`,{method:"POST"});setHints((old)=>[...old,r.hint]);})}>Get next hint</button>}
      <form onSubmit={(e)=>{e.preventDefault();void run(async()=>{const r=await api<{message:string;walkthrough:string|null;diagnostic:{sessionId:string;prompt:string;concept:string}|null}>(`/api/practice/${session.sessionId}/answer`,{method:"POST",body:jsonBody({answer})});setResult(r.message);setWalkthrough(r.walkthrough||"");setAnswer("");setHints([]);setSession(r.diagnostic);setReviewRefreshKey(x=>x+1);await refresh();});}} style={{marginTop:12}}>
        <div className="field"><label htmlFor="practice-answer">Your answer</label><input id="practice-answer" required value={answer} onChange={(e)=>setAnswer(e.target.value)}/></div><button className="button primary small" disabled={busy} style={{marginTop:10}}>Submit answer</button></form></div>}
      {walkthrough&&<div className="notice" role="status" style={{marginTop:14}}><strong>Supported walkthrough</strong><p>{walkthrough}</p><p>Try the next independent problem when you are ready.</p></div>}
    {result && <div className="notice" role="status" style={{marginTop:16}}>{result}</div>}
    </div>}
    <StudentSchedule courseId={courseId} baselineReady={baselineReady} refreshKey={goalRefreshKey} onStartBlock={openPlannedConcept}/>
    <ReviewVault courseId={courseId} baselineReady={baselineReady} refreshKey={reviewRefreshKey}/>
    <AdaptiveMock courseId={courseId} baselineReady={baselineReady}/>
  </section>;
}
