import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, jsonBody } from "./api";
import Markdown from "./Markdown";
import MarkdownEditor from "./MarkdownEditor";
import DemoTimetable from "./DemoTimetable";
import { applySuggestions, baselineIssues } from "../../shared/baseline";
import { ModePicker, originLabel, TeacherResourceCard, type Material } from "./TeacherResource";

type Topic = {id:string;title:string};
type Student = {email:string;name:string|null;dateOfBirth:string|null;enrolledOn:string|null};
type Kind = "academic" | "preferences";
type Question = {id:string;kind:Kind;prompt:string;answer:string;resourceId?:string};
type Suggestion = {status:"answered"|"needs_review";answer:string;reason:string};
type Baseline = {draft:Question[];revision:number;published:boolean;draftVersion:number};
type Course = {course:{title:string;description:string};topics:Topic[];resources:Material[];students:Student[];baseline:Baseline};
type Task = (action:()=>Promise<void>)=>Promise<void>;

function Generator({ label, onGenerate, busy }: { label: string; onGenerate:(count:number,instructions:string)=>void; busy:boolean }) {
  const [open,setOpen]=useState(false);
  return <div>
    <button type="button" className="button small" disabled={busy} onClick={()=>setOpen(!open)} aria-expanded={open}>{label}</button>
    {open && <form className="form-grid" onSubmit={event=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      onGenerate(Number(form.get("count")),String(form.get("instructions")??""));
    }}>
      <label className="field">Number of questions<input name="count" type="number" required min={1} max={8} defaultValue={2} /></label>
      <MarkdownEditor label="Custom instructions" name="instructions" compact maxLength={1200} rows={3} placeholder="Optional. For example: focus on recursion, keep it to one step." />
      <div><button className="button small primary" disabled={busy}>Generate</button></div>
    </form>}
  </div>;
}

function Students({base,students,reload,run,busy}:{base:string;students:Student[];reload:()=>Promise<void>;run:Task;busy:boolean}) {
  const [selected,setSelected]=useState<Student|null>(null);
  function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form=event.currentTarget;
    const data=Object.fromEntries(new FormData(form));
    void run(async()=>{
      await api(base+"/students",{method:"PUT",body:jsonBody({...data,previousEmail:selected?.email})});
      setSelected(null);
      form.reset();
      await reload();
    });
  }
  return <section className="stack">
    <h3>Students</h3>
    <form key={selected?.email??"new"} className="form-grid" onSubmit={save}>
      <label className="field">Name<input name="name" required maxLength={160} defaultValue={selected?.name??""}/></label>
      <label className="field">Email ID<input name="email" required type="email" defaultValue={selected?.email}/></label>
      <label className="field">Date of birth<input name="dateOfBirth" type="date" required defaultValue={selected?.dateOfBirth??""}/></label>
      <label className="field">Enrollment date<input name="enrolledOn" type="date" required defaultValue={selected?.enrolledOn??""}/></label>
      <div className="card-actions">
        <button className="button small primary" disabled={busy}>{selected?"Save student":"Add student"}</button>
        {selected && <button type="button" className="button small" onClick={()=>setSelected(null)}>Cancel</button>}
      </div>
    </form>
    {students.map(student=><article className="course-card row" key={student.email}>
      <div><strong>{student.name||student.email}</strong><p>{student.email}{student.dateOfBirth && ` · DOB ${student.dateOfBirth}`}{student.enrolledOn && ` · Enrolled ${student.enrolledOn}`}</p></div>
      <div className="card-actions">
        <button className="button small" disabled={busy} onClick={()=>setSelected(student)}>Edit</button>
        <button className="button small" disabled={busy} onClick={()=>{
          if (!confirm(`Remove ${student.name || student.email} from this course?`)) return;
          void run(async()=>{await api(base+"/students/"+encodeURIComponent(student.email),{method:"DELETE"});if(selected?.email===student.email)setSelected(null);await reload();});
        }}>Delete</button>
      </div>
    </article>)}
  </section>;
}

function BaselineEditor({base,resources,baseline,busy,run,reload}:{base:string;resources:Material[];baseline:Baseline;busy:boolean;run:Task;reload:()=>Promise<void>}) {
  const [questions,setQuestions]=useState(baseline.draft);
  const [kind,setKind]=useState<Kind>("academic");
  const [view,setView]=useState<"bank"|"questions">("bank");
  const [filter,setFilter]=useState("");
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [notice,setNotice]=useState("");
  const [issues,setIssues]=useState<string[]>([]);
  const [chosen,setChosen]=useState<Set<string>>(new Set());
  const [suggestions,setSuggestions]=useState<Record<string,Suggestion>>({});
  const [replaceExisting,setReplaceExisting]=useState(false);
  const [answering,setAnswering]=useState(false);
  const [originals,setOriginals]=useState<Record<string,{prompt:string;answer:string}>>({});
  const position=(id:string)=>questions.findIndex(q=>q.id===id)+1;
  const bankResources=resources.filter(r=>r.questions.some(q=>q.kind==="text") || r.summary.trim());
  async function persist(next:Question[],publish=false) {
    await api(base+"/baseline",{method:"PUT",body:jsonBody({questions:next,publish,draftVersion:baseline.draftVersion})});
    await reload();
  }
  function addToDraft(added:Question[],message:string) {
    const next=[...questions,...added];
    setQuestions(next);setView("questions");
    void run(async()=>{await persist(next);setNotice(message);});
  }
  function generate(kind:Kind,count:number,instructions:string,resourceId?:string,questionId?:string) {
    void run(async()=>{
      const data=await api<{questions:Question[]}>(base+"/questions/generate",{method:"POST",body:jsonBody({kind,count,instructions,resourceId,questionId})});
      const next=[...questions,...data.questions];
      setQuestions(next);setView("questions");
      await persist(next);
      setNotice(`${data.questions.length} generated question${data.questions.length>1?"s were":" was"} added to the baseline draft. Review and edit them below.`);
    });
  }
  function save(publish:boolean) {
    // Publish exactly what is in the editor now, including edits that were never saved separately.
    const current=questions;
    const problems=publish?baselineIssues(current):[];
    setIssues(problems);setNotice("");
    if (problems.length) return;
    void run(async()=>{await persist(current,publish);setNotice(publish?"Baseline published.":"Baseline draft saved.");});
  }
  const update=(id:string,patch:Partial<Question>)=>{
    setQuestions(all=>all.map(x=>x.id===id?{...x,...patch}:x));
    if (issues.length) setIssues([]);
  };
  /** Generates expected answers from the current, possibly unsaved, editor values. Never saves or publishes. */
  async function generateAnswers(ids:string[]) {
    const targets=questions.filter(q=>ids.includes(q.id) && q.kind==="academic");
    if (!targets.length) return;
    const untitled=targets.filter(q=>!q.prompt.trim());
    if (untitled.length) { setIssues([`Add question text to question ${untitled.map(q=>position(q.id)).join(", ")} before generating its answer.`]); return; }
    setAnswering(true);setIssues([]);setNotice("");
    try {
      const results:({id:string}&Suggestion)[]=[];
      for (let start=0;start<targets.length;start+=20) {
        const batch=targets.slice(start,start+20);
        const data=await api<{results:({id:string}&Suggestion)[]}>(base+"/baseline/answers",{method:"POST",body:jsonBody({
          questions:batch.map(q=>({id:q.id,prompt:q.prompt,resourceId:q.resourceId,position:position(q.id)}))})});
        results.push(...data.results.filter(r=>batch.some(q=>q.id===r.id)));
      }
      const merged=applySuggestions(questions,results,replaceExisting);
      // Apply against the latest state so typing during generation is not lost.
      setQuestions(all=>applySuggestions(all,results,replaceExisting).questions);
      const label=(positions:number[])=>positions.map(p=>`question ${p}`).join(", ");
      const filled=merged.filled, kept=merged.kept;
      const review=merged.review.map(r=>`question ${r.position}${r.reason?` (${r.reason})`:""}`);
      setSuggestions(old=>({...old,...Object.fromEntries(results.map(r=>[r.id,{status:r.status,answer:r.answer,reason:r.reason}]))}));
      setNotice([filled.length?`Suggested answers filled in for ${label(filled)}. Review and edit them before publishing.`:"",
        kept.length?`Existing answers kept for ${label(kept)}; use “Replace with suggestion” to switch.`:""].filter(Boolean).join(" ")||"No answers were generated.");
      if (review.length) setIssues([`Still needs an answer: ${review.join("; ")}.`]);
      setChosen(new Set());
    } catch(e) {
      setIssues([e instanceof Error?e.message:"Could not generate answers."]);
    } finally { setAnswering(false); }
  }
  /** Rewrites flagged questions as A–D multiple choice in the editor only; the teacher can undo before saving. */
  async function convertToMultipleChoice(ids:string[]) {
    const targets=questions.filter(q=>ids.includes(q.id) && q.kind==="academic" && q.prompt.trim());
    if (!targets.length) return;
    setAnswering(true);setIssues([]);setNotice("");
    try {
      const data=await api<{results:{id:string;status:"converted"|"needs_review";prompt:string;answer:string;reason:string}[]}>(base+"/baseline/multiple-choice",{method:"POST",body:jsonBody({
        questions:targets.map(q=>({id:q.id,prompt:q.prompt,resourceId:q.resourceId,position:position(q.id),reason:suggestions[q.id]?.reason??""}))})});
      const converted=data.results.filter(r=>r.status==="converted" && targets.some(q=>q.id===r.id));
      const still=data.results.filter(r=>r.status!=="converted");
      setOriginals(old=>({...old,...Object.fromEntries(targets.filter(q=>converted.some(r=>r.id===q.id) && !old[q.id]).map(q=>[q.id,{prompt:q.prompt,answer:q.answer}]))}));
      setQuestions(all=>all.map(q=>{const r=converted.find(x=>x.id===q.id);return r?{...q,prompt:r.prompt,answer:r.answer}:q;}));
      setSuggestions(old=>{
        const next={...old};
        for (const r of converted) next[r.id]={status:"answered",answer:r.answer,reason:""};
        for (const r of still) next[r.id]={status:"needs_review",answer:"",reason:r.reason};
        return next;
      });
      if (converted.length) setNotice(`Converted ${converted.map(r=>`question ${position(r.id)}`).join(", ")} to multiple choice. Check the options and the correct letter before publishing.`);
      if (still.length) setIssues([`Could not convert ${still.map(r=>`question ${position(r.id)}${r.reason?` (${r.reason})`:""}`).join("; ")}.`]);
    } catch(e) {
      setIssues([e instanceof Error?e.message:"Could not convert the questions."]);
    } finally { setAnswering(false); }
  }
  const academic=questions.filter(q=>q.kind==="academic");
  const flagged=academic.filter(q=>suggestions[q.id]?.status==="needs_review" && !q.answer.trim());
  const blankAcademic=academic.filter(q=>!q.answer.trim());
  return <section className="stack">
    <div className="row"><h3>Course onboarding</h3><span className="badge">{baseline.published?`Published · revision ${baseline.revision}`:"Draft"}</span></div>
    <div className="card-actions">
      <button className="button small" aria-pressed={view==="bank"} onClick={()=>setView("bank")}>Academic problem bank</button>
      <button className="button small" aria-pressed={view==="questions"} onClick={()=>setView("questions")}>Baseline questions ({questions.length})</button>
    </div>
    {notice && <p className="notice success" role="status">{notice}</p>}
    {issues.length>0 && <div className="notice error" role="alert">{issues.map((issue,i)=><div key={i}>{issue}</div>)}</div>}
    {view==="bank" && <>
      <label className="field">Resource<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All processed resources</option>
        {bankResources.map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</select></label>
      {!bankResources.length && <p>Process a topic resource to populate the academic problem bank.</p>}
      {selected.size>0 && <div className="card-actions sticky-actions"><span>{selected.size} selected</span>
        <button className="button small primary" disabled={busy} onClick={()=>{
          const chosen=resources.flatMap(r=>r.questions).filter(q=>selected.has(q.id));
          setSelected(new Set());
          addToDraft(chosen.map(q=>({id:crypto.randomUUID(),kind:"academic",prompt:q.prompt,answer:q.answer,resourceId:q.resourceId})),`${chosen.length} problem${chosen.length>1?"s":""} added to the baseline draft.`);
        }}>Add selected to baseline</button>
        <button className="button small" onClick={()=>setSelected(new Set())}>Clear selection</button></div>}
      {bankResources.filter(r=>!filter || filter===r.id).map(r=><article className="resource-card stack" key={r.id}>
        <div className="row"><h4>{r.title}</h4>{r.status!=="published" && <span className="badge amber">Resource not published</span>}</div>
        {r.summary.trim() && <>
          <details><summary>View resource summary</summary><div className="summary-body"><Markdown text={r.summary}/></div></details>
          <Generator label="Generate from this summary" busy={busy} onGenerate={(count,instructions)=>generate("academic",count,instructions,r.id)}/>
        </>}
        {r.questions.filter(q=>q.kind==="text").length===0 && <p className="muted">No problems in this resource's bank.</p>}
        {r.questions.filter(q=>q.kind==="text").map(problem=><div className="course-card stack" key={problem.id}>
          <label className="select-row"><input type="checkbox" checked={selected.has(problem.id)} onChange={e=>setSelected(old=>{const next=new Set(old);if(e.target.checked)next.add(problem.id);else next.delete(problem.id);return next;})}/>
            <span className="badge">{originLabel(problem)}</span>{problem.sourceRef && <span className="badge">Source: {problem.sourceRef}</span>}
            {problem.answerSource==="ai" && <span className="badge amber">AI-proposed answer</span>}</label>
          <Markdown text={problem.prompt}/>
          <div className="card-actions"><button className="button small primary" disabled={busy} onClick={()=>addToDraft([{id:crypto.randomUUID(),kind:"academic",prompt:problem.prompt,answer:problem.answer,resourceId:r.id}],"Problem added to the baseline draft.")}>Add to baseline</button>
          <Generator label="Generate variants from this problem" busy={busy} onGenerate={(count,instructions)=>generate("academic",count,instructions,r.id,problem.id)}/></div>
        </div>)}
      </article>)}
    </>}
    {view==="questions" && <>
      <Generator label="Generate learning preference questions" busy={busy} onGenerate={(count,instructions)=>generate("preferences",count,instructions)}/>
      <div className="card-actions"><label className="field">Custom question type<select value={kind} onChange={e=>setKind(e.target.value as Kind)}>
        <option value="academic">Academic</option><option value="preferences">Learning preferences</option>
      </select></label><button className="button small" onClick={()=>setQuestions(q=>[...q,{id:crypto.randomUUID(),kind,prompt:"",answer:""}])}>Add custom question</button></div>
      {questions.length===0 && <p className="muted">Add problems from the bank, generate questions, or write your own. Include at least one academic and one learning preference question before publishing.</p>}
      {academic.length>0 && <div className="card-actions sticky-actions" aria-label="Expected answer generation">
        <span>{chosen.size} academic selected</span>
        <button className="button small primary" disabled={busy || answering || !chosen.size} onClick={()=>void generateAnswers([...chosen])}>Generate answers for selected</button>
        <button className="button small" disabled={busy || answering || !blankAcademic.length} onClick={()=>void generateAnswers(blankAcademic.map(q=>q.id))}>Generate all blank answers ({blankAcademic.length})</button>
        {flagged.length>0 && <button className="button small" disabled={busy || answering} onClick={()=>void convertToMultipleChoice(flagged.map(q=>q.id))}>Convert flagged to multiple choice ({flagged.length})</button>}
        <label className="select-row"><input type="checkbox" checked={replaceExisting} onChange={e=>setReplaceExisting(e.target.checked)}/> Replace existing answers</label>
        {answering && <span role="status">Generating answers…</span>}
      </div>}
      {questions.map((q,i)=>{
        const suggestion=suggestions[q.id];
        return <article className="course-card stack" key={q.id}>
        <div className="select-row">
          {q.kind==="academic" && <input type="checkbox" aria-label={`Select question ${i+1}`} checked={chosen.has(q.id)} onChange={e=>setChosen(old=>{const next=new Set(old);if(e.target.checked)next.add(q.id);else next.delete(q.id);return next;})}/>}
          <strong>{i+1}. {q.kind==="academic"?"Academic":"Learning preferences · open-ended, not scored"}</strong>
        </div>
        <MarkdownEditor label="Question" value={q.prompt} maxLength={5000} rows={5} onChange={value=>update(q.id,{prompt:value})}/>
        {q.kind==="academic" && <>
          <MarkdownEditor label="Expected answer" compact value={q.answer} maxLength={1500} rows={3} onChange={value=>update(q.id,{answer:value})}/>
          {suggestion?.status==="answered" && suggestion.answer===q.answer && !originals[q.id] && <p className="muted">AI-suggested answer · edit it if needed.</p>}
          {suggestion?.status==="answered" && suggestion.answer!==q.answer && q.answer.trim() && <div className="notice">
            AI suggestion: <strong>{suggestion.answer}</strong>
            <div className="card-actions"><button className="button small" onClick={()=>update(q.id,{answer:suggestion.answer})}>Replace with suggestion</button>
              <button className="button small" onClick={()=>setSuggestions(old=>{const next={...old};delete next[q.id];return next;})}>Dismiss</button></div></div>}
          {suggestion?.status==="needs_review" && !q.answer.trim() && <div className="notice warn">Needs teacher review: {suggestion.reason}
            <div className="card-actions"><button className="button small primary" disabled={busy || answering} onClick={()=>void convertToMultipleChoice([q.id])}>Convert to multiple choice with AI</button></div></div>}
          {originals[q.id] && <div className="notice">Converted to multiple choice by AI. Check the options and the correct letter.
            <div className="card-actions"><button className="button small" onClick={()=>{
              const original=originals[q.id];
              update(q.id,original);
              setOriginals(old=>{const next={...old};delete next[q.id];return next;});
              setSuggestions(old=>{const next={...old};delete next[q.id];return next;});
            }}>Undo conversion</button></div></div>}
        </>}
        <div className="card-actions">
          {q.kind==="academic" && <button className="button small" disabled={busy || answering} onClick={()=>void generateAnswers([q.id])}>Generate expected answer</button>}
          <button className="button small" onClick={()=>setQuestions(all=>all.filter(x=>x.id!==q.id))}>Remove question</button>
        </div>
      </article>;})}
      <div className="card-actions"><button className="button small" disabled={busy} onClick={()=>save(false)}>Save draft</button>
        <button className="button small primary" disabled={busy || answering} onClick={()=>save(true)}>Publish baseline</button></div>
    </>}
  </section>;
}

export default function TeacherDemo({courseId,onBack}:{courseId:string;onBack:()=>void}) {
  const base=`/api/demo/courses/${courseId}`;
  const [data,setData]=useState<Course|null>(null);
  const [tab,setTab]=useState("Topics");
  const [topicId,setTopicId]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [progress,setProgress]=useState("");
  const reload=useCallback(async()=>setData(await api<Course>(base+"/teacher")),[base]);
  useEffect(()=>{void reload().catch(e=>setError(e.message));},[reload]);
  async function run(action:()=>Promise<void>) {
    setBusy(true);setError("");setProgress("");
    try { await action(); }
    catch(e) {setError(e instanceof Error?e.message:"The action failed.");}
    finally {setBusy(false);setProgress("");}
  }
  async function processResource(id:string,restart=false) {
    const stages:Record<string,string>={pages:"Reading pages",["theory-questions"]:"Writing practice questions from the theory",answers:"Proposing answers for review",complete:"Finishing"};
    try {
      let remaining:number;
      let first=true;
      do {
        setProgress("Processing resource with AI…");
        const result=await api<{remaining:number;stage:string}>(`/api/demo/resources/${id}/process`,{method:"POST",body:jsonBody({restart:restart&&first})});
        first=false;
        remaining=result.remaining;
        setProgress(`${stages[result.stage]??"Processing"} · ${remaining} step${remaining===1?"":"s"} remaining`);
        await reload();
      } while(remaining>0);
    } finally { await reload(); }
  }
  const selected=data?.topics.find(topic=>topic.id===topicId);
  return <div className="stack">
    <div className="row"><div><h2>{data?.course.title||"Course workspace"}</h2>{data?.course.description && <Markdown text={data.course.description}/>}</div><button className="button small" onClick={onBack}>All courses</button></div>
    <nav className="card-actions" aria-label="Course setup">{["Topics","Onboarding","Timetable","Students"].map(item=><button className="button small" type="button" key={item} aria-pressed={item===tab} disabled={busy} onClick={()=>setTab(item)}>{item}</button>)}</nav>
    {error && <p className="notice error" role="alert">{error}</p>}
    {progress && <p role="status">{progress}</p>}
    {data && <>
      {tab==="Topics" && <>
        <form className="form-grid" onSubmit={e=>{
          e.preventDefault();const form=e.currentTarget;const title=new FormData(form).get("title");
          void run(async()=>{const topic=await api<Topic>(base+"/topics",{method:"POST",body:jsonBody({title})});form.reset();setTopicId(topic.id);await reload();});
        }}><label className="field">Chapter or topic name<input name="title" required maxLength={200}/></label><div><button className="button small primary" disabled={busy}>Add topic</button></div></form>
        <div className="card-actions">{data.topics.map(topic=><button className="button small" key={topic.id} aria-pressed={topic.id===topicId} onClick={()=>setTopicId(topic.id)}>{topic.title}</button>)}</div>
        {selected && <section className="stack">
          <div className="row"><h3>{selected.title}</h3>
            <button type="button" className="button small" disabled={busy} onClick={()=>{
              if (!confirm(`Delete “${selected.title}” and remove all its resources from this course?`)) return;
              void run(async()=>{await api(base+"/topics/"+selected.id,{method:"DELETE"});setTopicId("");await reload();});
            }}>Delete topic</button>
          </div>
          <form key={topicId} className="form-grid" onSubmit={e=>{
            e.preventDefault();const form=e.currentTarget;const upload=new FormData(form);upload.set("topicId",topicId);
            const file=upload.get("file");if(file instanceof File && !file.size)upload.delete("file");
            void run(async()=>{
              const resource=await api<{id:string;text:string;pdfPages:number|null}>(`/api/courses/${courseId}/resources`,{method:"POST",body:upload});
              form.reset();await reload();
              if(resource.pdfPages || resource.text.trim())await processResource(resource.id);
              else setError("The file was saved. Add readable text in Review and edit, then process the resource.");
            });
          }}>
            <label className="field">Resource title<input name="title" required maxLength={200}/></label>
            <label className="field">PDF (slides, theory sheets, lab sheets), Markdown or text<input name="file" type="file" accept=".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain"/></label>
            <ModePicker name="processingMode"/>
            <MarkdownEditor className="full" label="Or paste resource text" name="text" compact rows={4} maxLength={500000}/>
            <div><button className="button small primary" disabled={busy}>Save and process resource</button></div>
          </form>
          {data.resources.filter(resource=>resource.topicId===topicId).map(resource=><TeacherResourceCard key={resource.id} resource={resource} busy={busy} run={run} reload={reload} processResource={processResource}/>)}
        </section>}
      </>}
      {tab==="Students" && <Students base={base} students={data.students} run={run} busy={busy} reload={reload}/>}
      <div hidden={tab!=="Onboarding"}><BaselineEditor base={base} resources={data.resources} baseline={data.baseline} run={run} busy={busy} reload={reload}/></div>
      {tab==="Timetable" && <DemoTimetable courseId={courseId}/>}
    </>}
  </div>;
}
