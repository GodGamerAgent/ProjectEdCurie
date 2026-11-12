import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, jsonBody } from "./api";
import { ResourceEditor, type Resource } from "./DemoResource";
import ResourceReview from "./ResourceReview";
import Markdown from "./Markdown";
import DemoTimetable from "./DemoTimetable";

type Topic = {id:string;title:string};
type Student = {email:string;name:string|null;dateOfBirth:string|null;enrolledOn:string|null};
type Problem = {prompt:string;answer:string;quote:string};
type Material = Resource & {topicId:string;sectionCount:number;isPdf:boolean;parts:{page?:number;summary:string;problems:Problem[]}[]|null};
type Kind = "academic" | "preferences";
type Question = {id:string;kind:Kind;prompt:string;answer:string};
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
      <label className="field">Custom instructions<textarea name="instructions" maxLength={1200} rows={2} /></label>
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
  const add=(question:Omit<Question,"id">)=>setQuestions(q=>[...q,{...question,id:crypto.randomUUID()}]);
  function generate(kind:Kind,count:number,instructions:string,resourceId?:string,partIndex?:number,problemIndex?:number) {
    void run(async()=>{
      const data=await api<{questions:Question[]}>(base+"/questions/generate",{method:"POST",body:jsonBody({kind,count,instructions,resourceId,partIndex,problemIndex})});
      setQuestions(q=>[...q,...data.questions]);setView("questions");
    });
  }
  function save(publish:boolean) {
    void run(async()=>{
      await api(base+"/baseline",{method:"PUT",body:jsonBody({questions,publish,draftVersion:baseline.draftVersion})});
      await reload();
    });
  }
  return <section className="stack">
    <div className="row"><h3>Course onboarding</h3><span className="badge">{baseline.published?`Published · revision ${baseline.revision}`:"Draft"}</span></div>
    <div className="card-actions">
      <button className="button small" aria-pressed={view==="bank"} onClick={()=>setView("bank")}>Academic problem bank</button>
      <button className="button small" aria-pressed={view==="questions"} onClick={()=>setView("questions")}>Baseline questions ({questions.length})</button>
    </div>
    {view==="bank" && <>
      <label className="field">Resource<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All processed resources</option>
        {resources.filter(r=>r.parts?.length).map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</select></label>
      {!resources.some(r=>r.parts?.length) && <p>Process a topic resource to populate the academic problem bank.</p>}
      {resources.filter(r=>!filter || filter===r.id).map(r=>r.parts?.map((part,i)=><article className="resource-card stack" key={r.id+i}>
        <h4>{r.title} · {part.page?`Page ${part.page}`:`Section ${i+1}`}</h4>
        {part.problems.length===0 && <p>No problems were found in this section.</p>}
        {part.problems.map((problem,j)=><div className="course-card stack" key={j}>
          <Markdown text={problem.prompt}/>
          {part.page && <details><summary>Extracted source · page {part.page}</summary><Markdown text={problem.quote}/></details>}
          <div className="card-actions"><button className="button small primary" disabled={busy} onClick={()=>{add({kind:"academic",prompt:problem.prompt,answer:problem.answer});setView("questions");}}>Add to baseline</button>
          <Generator label="Generate from this problem" busy={busy} onGenerate={(count,instructions)=>generate("academic",count,instructions,r.id,i,j)}/></div>
        </div>)}
        <details><summary>View section summary</summary><Markdown text={part.summary}/></details>
        <Generator label="Generate from this summary" busy={busy} onGenerate={(count,instructions)=>generate("academic",count,instructions,r.id,i)}/>
      </article>))}
    </>}
    {view==="questions" && <>
      <Generator label="Generate learning preference questions" busy={busy} onGenerate={(count,instructions)=>generate("preferences",count,instructions)}/>
      <div className="card-actions"><label className="field">Custom question type<select value={kind} onChange={e=>setKind(e.target.value as Kind)}>
        <option value="academic">Academic</option><option value="preferences">Learning preferences</option>
      </select></label><button className="button small" onClick={()=>add({kind,prompt:"",answer:""})}>Add custom question</button></div>
      {questions.map((q,i)=><article className="course-card stack" key={q.id}>
        <strong>{i+1}. {q.kind==="academic"?"Academic":"Learning preferences"}</strong>
        <label className="field">Question<textarea value={q.prompt} maxLength={5000} onChange={e=>setQuestions(all=>all.map(x=>x.id===q.id?{...x,prompt:e.target.value}:x))}/></label>
        {q.kind==="academic" && <label className="field">Expected answer<input value={q.answer} maxLength={1500} onChange={e=>setQuestions(all=>all.map(x=>x.id===q.id?{...x,answer:e.target.value}:x))}/></label>}
        <button className="button small" onClick={()=>setQuestions(all=>all.filter(x=>x.id!==q.id))}>Remove question</button>
      </article>)}
      <div className="card-actions"><button className="button small" disabled={busy} onClick={()=>save(false)}>Save draft</button>
        <button className="button small primary" disabled={busy} onClick={()=>save(true)}>Publish baseline</button></div>
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
  const [summary,setSummary]=useState<Material|null>(null);
  const reload=useCallback(async()=>setData(await api<Course>(base+"/teacher")),[base]);
  useEffect(()=>{void reload().catch(e=>setError(e.message));},[reload]);
  async function run(action:()=>Promise<void>) {
    setBusy(true);setError("");setProgress("");
    try { await action(); }
    catch(e) {setError(e instanceof Error?e.message:"The action failed.");}
    finally {setBusy(false);setProgress("");}
  }
  async function processResource(id:string) {
    try {
      let remaining:number;
      do {
        setProgress("Processing resource with AI…");
        ({remaining}=await api<{remaining:number}>(`/api/demo/resources/${id}/process`,{method:"POST"}));
        setProgress(`Processing resource · ${remaining} sections remaining`);
      } while(remaining>0);
    } finally { await reload(); }
  }
  const selected=data?.topics.find(topic=>topic.id===topicId);
  return <div className="stack">
    <div className="row"><div><h2>{data?.course.title||"Course workspace"}</h2><p>{data?.course.description}</p></div><button className="button small" onClick={onBack}>All courses</button></div>
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
            <label className="field">PDF, Markdown or text<input name="file" type="file" accept=".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain"/></label>
            <label className="field full">Resource text<textarea name="text" rows={3}/></label>
            <div><button className="button small primary" disabled={busy}>Save and process resource</button></div>
          </form>
          {data.resources.filter(resource=>resource.topicId===topicId).map(resource=><div key={resource.id} className="course-card stack">
            <ResourceEditor resource={resource} busy={busy} refresh={reload}
              onPublish={()=>void run(async()=>{await api(`/api/resources/${resource.id}/publish`,{method:"POST"});await reload();})}
              onArchive={()=>{if(confirm(`Delete ${resource.title} from this topic?`))void run(async()=>{await api(`/api/resources/${resource.id}/archive`,{method:"POST"});await reload();});}}/>
            <div className="card-actions">
              <span>{resource.parts?.length||0} of {resource.sectionCount} {resource.isPdf?"pages":"sections"} processed</span>
              {(resource.parts?.length||0)<resource.sectionCount && <button className="button small" disabled={busy} onClick={()=>void run(()=>processResource(resource.id))}>Process with AI</button>}
              {!!resource.parts?.length && <button className="button small" onClick={()=>setSummary(resource)}>Review AI summary</button>}
            </div>
          </div>)}
        </section>}
      </>}
      {tab==="Students" && <Students base={base} students={data.students} run={run} busy={busy} reload={reload}/>}
      <div hidden={tab!=="Onboarding"}><BaselineEditor base={base} resources={data.resources} baseline={data.baseline} run={run} busy={busy} reload={reload}/></div>
      {tab==="Timetable" && <DemoTimetable courseId={courseId}/>}
    </>}
    {summary && <ResourceReview title={summary.title+" · AI summary"} text={summary.parts?.map((part,i)=>`## ${part.page?`Page ${part.page}`:`Section ${i+1}`}\n\n${part.summary}\n\n### Extracted problems\n\n${part.problems.map(p=>p.prompt).join("\n\n")||"None found."}`).join("\n\n")||""} onClose={()=>setSummary(null)}/>}
  </div>;
}
