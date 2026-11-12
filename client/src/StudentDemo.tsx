import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, jsonBody } from "./api";
import Markdown from "./Markdown";
import MarkdownEditor from "./MarkdownEditor";
import ResourceReview from "./ResourceReview";
import CodingPractice, { type StudentCoding } from "./CodingPractice";
import { isMultipleChoice } from "../../shared/baseline";

const CodeEditor = lazy(() => import("./CodeEditor"));
type Topic={id:string;title:string};
type Material={id:string;title:string;text:string;summary:string;hasFile:boolean};
type PracticeQuestion={id:string;resourceId:string;origin:string;kind:"text"|"coding";prompt:string;sourceRef:string;coding:StudentCoding|null};
const originText=(q:PracticeQuestion)=>q.kind==="coding"?"Coding exercise":q.origin==="extracted"?"From the course material":q.origin==="theory"?"AI-generated from theory":q.origin==="manual"?"Added by your teacher":"Practice question";
type CourseState={
  course:{title:string}; revision:number|null; completed:boolean; score:number|null; total:number|null;
  questions:{id:string;kind:"academic"|"preferences";prompt:string}[]; topics:Topic[]; message:string;
};
type Turn={role:"student"|"tutor";text:string};

/** Option text per letter when each option sits on its own line ("A) 15"); otherwise just the letters. */
function choices(prompt:string) {
  const found=new Map<string,string>();
  for (const line of prompt.split("\n")) {
    const match=/^\s*\(?\**([A-D])\**[).:]\s+(.+)$/.exec(line);
    if (match && !found.has(match[1])) found.set(match[1],match[2].trim());
  }
  return ["A","B","C","D"].map(letter=>({letter,text:found.size>=2?found.get(letter)??"":""}));
}
/** Hides the option lines from the prompt when they are shown as choices instead. */
function stem(prompt:string) {
  const lines=prompt.split("\n");
  const options=lines.filter(line=>/^\s*\(?\**[A-D]\**[).:]\s+/.test(line)).length;
  return options>=2?lines.filter(line=>!/^\s*\(?\**[A-D]\**[).:]\s+/.test(line)).join("\n").trim():prompt;
}
type TutorReply={reply:string;suggestions:string[];coding:boolean;transcript:string};

function TopicTutor({base,topic,onBack}:{base:string;topic:Topic;onBack:()=>void}) {
  const path=base+"/topics/"+topic.id;
  const [resources,setResources]=useState<Material[]>([]);
  const [questions,setQuestions]=useState<PracticeQuestion[]>([]);
  const [question,setQuestion]=useState<PracticeQuestion|null>(null);
  const [selected,setSelected]=useState("");
  const [section,setSection]=useState(0);
  const [preview,setPreview]=useState(false);
  const [mode,setMode]=useState<"learn"|"practice"|null>(null);
  const [tab,setTab]=useState<"learn"|"practice"|null>(null);
  const [turns,setTurns]=useState<Turn[]>([]);
  const [suggestions,setSuggestions]=useState<string[]>([]);
  const [draft,setDraft]=useState("");
  const [code,setCode]=useState("");
  const [language,setLanguage]=useState("python");
  const [coding,setCoding]=useState(false);
  const [photo,setPhoto]=useState<File|null>(null);
  const [audio,setAudio]=useState<File|null>(null);
  const [recording,setRecording]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const recorder=useRef<MediaRecorder|null>(null);
  const media=useRef<MediaStream|null>(null);
  const clock=useRef<number|null>(null);
  const active=useRef(false);
  const photoInput=useRef<HTMLInputElement>(null);
  const audioInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    active.current=true;
    let cancelled=false;
    void api<{resources:Material[];questions:PracticeQuestion[]}>(path).then(data=>{
      if(!cancelled){setResources(data.resources);setQuestions(data.questions);setSelected(data.resources[0]?.id||"");}
    }).catch(e=>{if(!cancelled)setError(e.message);});
    return ()=>{
      active.current=false;cancelled=true;
      if(recorder.current?.state==="recording"){recorder.current.onstop=null;recorder.current.stop();}
      media.current?.getTracks().forEach(track=>track.stop());
      if(clock.current!==null)window.clearTimeout(clock.current);
    };
  },[path]);

  async function record() {
    if(recorder.current?.state==="recording"){recorder.current.stop();return;}
    setError("");
    let stream:MediaStream|undefined;
    try {
      stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(!active.current){stream.getTracks().forEach(track=>track.stop());return;}
      media.current=stream;
      const capture=new MediaRecorder(stream);
      recorder.current=capture;
      const chunks:Blob[]=[];
      capture.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
      capture.onstop=()=>{
        stream?.getTracks().forEach(track=>track.stop());
        if(clock.current!==null)window.clearTimeout(clock.current);
        if(!active.current)return;
        setRecording(false);
        const mime=capture.mimeType.split(";")[0] || "audio/webm";
        const file=new File(chunks,mime==="audio/mp4"?"voice.m4a":"voice.webm",{type:mime});
        if(file.size)setAudio(file);
      };
      capture.start();
      setRecording(true);
      clock.current=window.setTimeout(()=>{if(capture.state==="recording")capture.stop();},60000);
    } catch {
      stream?.getTracks().forEach(track=>track.stop());
      setError("Could not record audio. Check microphone permissions or attach an audio file.");
    }
  }

  async function send(nextMode:"learn"|"practice",message:string,start=false,includeCode=false,practice:PracticeQuestion|null=question) {
    if(busy || recording || !selected)return;
    setBusy(true);setError("");setMode(nextMode);
    if(start){setTurns([]);setSuggestions([]);}
    const payload=new FormData();
    payload.set("mode",nextMode);payload.set("resourceId",selected);payload.set("section",String(section));
    if(nextMode==="practice" && practice)payload.set("questionId",practice.id);
    const history = start ? [] : turns.slice(-6).map(t => ({ ...t, text: t.text.slice(0,2800) }));
    payload.set("history",JSON.stringify(history));
    payload.set("message",message);
    if (includeCode) {payload.set("code",code);payload.set("language",language);}
    if(!start && photo)payload.set("photo",photo);
    if(!start && audio)payload.set("audio",audio);
    try {
      const reply=await api<TutorReply>(path+"/tutor",{method:"POST",body:payload});
      const codeBlock = includeCode ? ["````"+language,code,"````"].join("\n") : "";
      const learner=[message,codeBlock,reply.transcript,!start && photo?"Photo attached":""].filter(Boolean).join("\n\n");
      setTurns(previous=>[...(start?[]:previous),...(learner?[{role:"student" as const,text:learner}]:[]),{role:"tutor",text:reply.reply}]);
      setSuggestions(reply.suggestions);setCoding(reply.coding);
      setDraft("");setPhoto(null);setAudio(null);
      if(photoInput.current)photoInput.current.value="";
      if(audioInput.current)audioInput.current.value="";
    } catch(e) {setError(e instanceof Error?e.message:"Could not reach the tutor.");}
    finally {setBusy(false);}
  }

  function submit(event:FormEvent) {
    event.preventDefault();
    if(!mode)return;
    const includeCode = coding && Boolean(code.trim());
    if(draft.trim() || includeCode || photo || audio)void send(mode,draft.trim(),false,includeCode);
  }
  const resource=resources.find(r=>r.id===selected);
  const material=resource?(resource.summary.trim()||resource.text):"";
  const sectionCount=Math.max(1,Math.ceil(material.length/4400));
  const resourceQuestions=questions.filter(q=>q.resourceId===selected);
  const reset=()=>{setMode(null);setTurns([]);setSuggestions([]);setQuestion(null);setTab(null);};
  if(tab==="practice" && question?.kind==="coding" && question.coding) {
    return <CodingPractice path={base} questionId={question.id} coding={question.coding} onBack={()=>setQuestion(null)}/>;
  }
  return <section className="stack">
    <div className="course-head"><div><div className="eyebrow">Topic</div><h2>{topic.title}</h2></div><button className="button small" onClick={onBack}>All topics</button></div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {resources.length===0 && !error && <p className="muted">Your teacher has not published material for this topic yet.</p>}
    <div className="form-grid">
      <label className="field">Course resource<select value={selected} disabled={busy || recording} onChange={e=>{setSelected(e.target.value);setSection(0);reset();}}>
        {resources.map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</select></label>
      {resource && sectionCount>1 && <label className="field">Resource section<select value={section} disabled={busy || recording}
        onChange={e=>{setSection(Number(e.target.value));setMode(null);setTurns([]);setSuggestions([]);}}>
        {Array.from({length:sectionCount},(_,i)=><option key={i} value={i}>Section {i+1}</option>)}
      </select></label>}
    </div>
    <div className="mode-cards">
      <button type="button" className="mode-card" aria-pressed={tab==="learn"} disabled={!selected || busy || recording} onClick={()=>{setTab("learn");setQuestion(null);void send("learn","",true);}}>
        <strong>Learn</strong><span>The tutor walks you through the material step by step.</span></button>
      <button type="button" className="mode-card" aria-pressed={tab==="practice"} disabled={!selected || busy || recording} onClick={()=>{setTab("practice");setQuestion(null);setMode(null);setTurns([]);setSuggestions([]);}}>
        <strong>Practice</strong><span>Solve questions from this resource with hints when you are stuck.</span></button>
    </div>
    <div><button className="button small quiet" disabled={!resource} onClick={()=>setPreview(true)}>Preview source material</button></div>
    {tab==="learn" && resource?.summary.trim() && <details className="course-card" open={turns.length===0}><summary><strong>Resource summary</strong></summary><div className="summary-body"><Markdown text={resource.summary}/></div></details>}
    {tab==="practice" && !question && <section className="stack">
      <div className="section-title"><h3>Practice questions</h3><span className="badge">{resourceQuestions.length}</span></div>
      {resourceQuestions.length===0 && <p className="muted">Your teacher has not added practice questions for this resource yet. The tutor can still set you a problem from the material.</p>}
      {resourceQuestions.map((q,i)=><article className="course-card stack" key={q.id}>
        <div className="card-actions tight"><span className="badge">{originText(q)}</span>{q.sourceRef && <span className="badge">Source: {q.sourceRef}</span>}
          {q.coding && <span className="badge">{q.coding.language==="python"?"Python 3":"JavaScript"}</span>}</div>
        <Markdown text={q.kind==="coding"?q.prompt.split("\n").slice(0,6).join("\n"):q.prompt}/>
        <div className="card-actions end"><button className="button small primary" disabled={busy || recording} onClick={()=>{
          setQuestion(q);
          if(q.kind==="text")void send("practice",`I want to practise question ${i+1}.`,true,false,q);
        }}>{q.kind==="coding"?"Open in code editor":"Practise this question"}</button></div>
      </article>)}
      <div><button className="button small" disabled={busy || recording} onClick={()=>void send("practice","",true,false,null)}>Ask the tutor for a practice problem</button></div>
    </section>}
    {tab==="practice" && question?.kind==="text" && <article className="course-card stack">
      <div className="section-title"><span className="badge">{originText(question)}{question.sourceRef?` · ${question.sourceRef}`:""}</span>
        <button className="button small" onClick={()=>{setQuestion(null);setMode(null);setTurns([]);setSuggestions([]);}}>All practice questions</button></div>
      <Markdown text={question.prompt}/>
    </article>}
    {preview && resource && <ResourceReview title={resource.title} text={resource.text} onClose={()=>setPreview(false)}/>}
    <div className="chat" aria-live="polite">
      {turns.map((turn,i)=><article className={`chat-turn ${turn.role}`} key={i}><span className="chat-who">{turn.role==="student"?"You":"EdCurie tutor"}</span><Markdown text={turn.text}/>{turn.role==="tutor" && resource && <p className="chat-source">Source: {resource.title}{sectionCount>1?` · Section ${section+1}`:""}</p>}</article>)}
      {busy && <p className="typing" role="status">EdCurie is working on your reply…</p>}
    </div>
    {mode && turns.length>0 && <>
      <div className="chip-row" aria-label="Suggested replies">{suggestions.map((suggestion,i)=><button className="button small" type="button" disabled={busy || recording} key={i} onClick={()=>void send(mode,suggestion)}><Markdown compact text={suggestion}/></button>)}</div>
      <form className="stack form-card" onSubmit={submit}>
        <MarkdownEditor label="Your question or answer" compact rows={3} maxLength={2000} value={draft} onChange={setDraft} disabled={busy}/>
        <label className="check"><input type="checkbox" checked={coding} onChange={e=>setCoding(e.target.checked)}/> Use code editor</label>
        {coding && <>
          <label className="field">Language<select value={language} onChange={e=>setLanguage(e.target.value)}>
            {["python","javascript","typescript","java","cpp","c","sql","text"].map(item=><option value={item} key={item}>{item}</option>)}
          </select></label>
          <div className="field"><span className="field-label">Code</span><Suspense fallback={<p className="muted">Loading code editor…</p>}>
            <CodeEditor label="Code for the tutor" language={language} value={code} onChange={value=>setCode(value.slice(0,2400))} minHeight={180}/></Suspense></div>
        </>}
        <div className="form-grid">
          <label className="field">Attach photo<input ref={photoInput} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>setPhoto(e.target.files?.[0]??null)}/></label>
          <label className="field">Attach audio<input ref={audioInput} type="file" accept="audio/*,.webm" disabled={busy || recording} onChange={e=>setAudio(e.target.files?.[0]??null)}/></label>
        </div>
        <div className="card-actions">
          <button className="button small" type="button" disabled={busy} onClick={()=>void record()}>{recording?"● Stop recording":"Record voice message"}</button>
          {audio && <button className="button small quiet" type="button" onClick={()=>{setAudio(null);if(audioInput.current)audioInput.current.value="";}}>Remove {audio.name}</button>}
          <span className="spacer"/>
          <button className="button primary" disabled={busy || recording || !(draft.trim() || coding && code.trim() || photo || audio)}>Send to tutor</button>
        </div>
      </form>
    </>}
  </section>;
}

export default function StudentDemo({courseId,onBack}:{courseId:string;onBack:()=>void}) {
  const base=`/api/demo/courses/${courseId}`;
  const [state,setState]=useState<CourseState|null>(null);
  const [answers,setAnswers]=useState<Record<string,string>>({});
  const [topic,setTopic]=useState<Topic|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const reload=useCallback(async()=>setState(await api<CourseState>(base+"/student")),[base]);
  useEffect(()=>{void reload().catch(e=>setError(e.message));},[reload]);
  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setError("");
    try {await api(base+"/onboarding",{method:"POST",body:jsonBody({answers,revision:state?.revision})});await reload();}
    catch(e){setError(e instanceof Error?e.message:"Could not submit onboarding.");}
    finally {setBusy(false);}
  }
  if(topic && state?.completed)return <TopicTutor base={base} topic={topic} onBack={()=>{setTopic(null);void reload().catch(e=>setError(e.message));}}/>;
  return <div className="stack">
    <div className="course-head"><div><div className="eyebrow">Course</div><h2>{state?.course.title||"Loading course…"}</h2></div><button className="button small" onClick={onBack}>My courses</button></div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!state && !error && <div className="loading-skeleton" role="status" aria-label="Loading course"/>}
    {state?.message && <p className="notice">{state.message}</p>}
    {state && !state.completed && !!state.questions.length && <form className="stack" onSubmit={submit}>
      <div><h3>Course onboarding</h3><p className="muted" style={{margin:0}}>Answer {state.questions.length} short question{state.questions.length===1?"":"s"} so your tutor knows where to start. {state.questions.filter(q=>q.prompt && answers[q.id]?.trim()).length} of {state.questions.length} answered.</p></div>
      {(["academic","preferences"] as const).map(kind=>{
        const list=state.questions.filter(q=>q.kind===kind);
        if(!list.length)return null;
        return <section className="stack" key={kind}>
        <div className="section-title"><h4>{kind==="academic"?"Academic baseline":"Learning preferences"}</h4><span className="badge">{kind==="academic"?"Scored":"Not scored"}</span></div>
        {kind==="preferences" && <p className="muted" style={{margin:0}}>Share study preferences only. Your tutor uses these answers to adapt explanations. You can answer “Prefer not to say”.</p>}
        {list.map((q,i)=>{
          const multiple=kind==="academic" && isMultipleChoice(q.prompt);
          return <div className="course-card stack" key={q.id}>
          <div className="question-head"><span className="question-num">{i+1}</span>{multiple && <span className="badge">Choose one</span>}</div>
          <Markdown text={multiple?stem(q.prompt):q.prompt}/>
          {multiple ? <fieldset className="preferences-group" style={{border:0,padding:0,margin:0}}><legend className="sr-only">Answer for question {i+1}</legend>
            {choices(q.prompt).map(option=><label className="choice mcq" key={option.letter}>
              <input type="radio" name={`answer-${q.id}`} value={option.letter} required checked={answers[q.id]===option.letter} onChange={()=>setAnswers(a=>({...a,[q.id]:option.letter}))}/>
              <span className="choice-letter" aria-hidden>{option.letter}</span>
              <span>{option.text ? <Markdown compact text={option.text}/> : `Option ${option.letter}`}</span>
            </label>)}
          </fieldset>
          : <label className="field">Your answer<textarea required maxLength={2000} rows={kind==="academic"?2:3} value={answers[q.id]??""} onChange={e=>setAnswers(a=>({...a,[q.id]:e.target.value}))}/></label>}
        </div>;})}
      </section>;})}
      <div className="card-actions end"><button className="button primary" disabled={busy}>{busy?"Submitting…":"Complete onboarding"}</button></div>
    </form>}
    {state?.completed && <>
      <div className="section-title"><h3>Topics</h3>{state.total!==null && <span className="score-pill">Baseline completed · {state.score}/{state.total}</span>}</div>
      {state.topics.length===0 && <p className="muted">Your teacher has not published any topics yet.</p>}
      {state.topics.map((item,i)=><article className="course-card list-card" key={item.id}><div className="question-head"><span className="question-num">{i+1}</span><h4 style={{margin:0}}>{item.title}</h4></div><button className="button small primary" onClick={()=>setTopic(item)}>Open topic</button></article>)}
    </>}
  </div>;
}
