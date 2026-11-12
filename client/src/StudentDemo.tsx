import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, jsonBody } from "./api";
import Markdown from "./Markdown";
import ResourceReview from "./ResourceReview";

type Topic={id:string;title:string};
type Material={id:string;title:string;text:string;hasFile:boolean};
type CourseState={
  course:{title:string}; revision:number|null; completed:boolean; score:number|null; total:number|null;
  questions:{id:string;kind:"academic"|"preferences";prompt:string}[]; topics:Topic[]; message:string;
};
type Turn={role:"student"|"tutor";text:string};
type TutorReply={reply:string;suggestions:string[];coding:boolean;transcript:string};

function TopicTutor({base,topic,onBack}:{base:string;topic:Topic;onBack:()=>void}) {
  const path=base+"/topics/"+topic.id;
  const [resources,setResources]=useState<Material[]>([]);
  const [selected,setSelected]=useState("");
  const [section,setSection]=useState(0);
  const [preview,setPreview]=useState(false);
  const [mode,setMode]=useState<"learn"|"practice"|null>(null);
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
    void api<{resources:Material[]}>(path).then(data=>{
      if(!cancelled){setResources(data.resources);setSelected(data.resources[0]?.id||"");}
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

  async function send(nextMode:"learn"|"practice",message:string,start=false,includeCode=false) {
    if(busy || recording || !selected)return;
    setBusy(true);setError("");setMode(nextMode);
    if(start){setTurns([]);setSuggestions([]);}
    const payload=new FormData();
    payload.set("mode",nextMode);payload.set("resourceId",selected);payload.set("section",String(section));
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
  return <section className="stack">
    <div className="row"><h2>{topic.title}</h2><button className="button small" onClick={onBack}>All topics</button></div>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="form-grid">
      <label className="field">Course resource<select value={selected} disabled={busy || recording} onChange={e=>{setSelected(e.target.value);setSection(0);setMode(null);setTurns([]);setSuggestions([]);}}>
        {resources.map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</select></label>
      {resource && Math.ceil(resource.text.length/4400)>1 && <label className="field">Resource section<select value={section} disabled={busy || recording}
        onChange={e=>{setSection(Number(e.target.value));setMode(null);setTurns([]);setSuggestions([]);}}>
        {Array.from({length:Math.ceil(resource.text.length/4400)},(_,i)=><option key={i} value={i}>Section {i+1}</option>)}
      </select></label>}
    </div>
    <div className="card-actions">
      <button className="button primary" disabled={!selected || busy || recording} onClick={()=>void send("learn","",true)}>Learn</button>
      <button className="button" disabled={!selected || busy || recording} onClick={()=>void send("practice","",true)}>Practice</button>
      <button className="button small" disabled={!resource} onClick={()=>setPreview(true)}>Preview resource</button>
    </div>
    {preview && resource && <ResourceReview title={resource.title} text={resource.text} onClose={()=>setPreview(false)}/>}
    <div className="stack" aria-live="polite">
      {turns.map((turn,i)=><article className="course-card" key={i}><strong>{turn.role==="student"?"You":"EdCurie tutor"}</strong><Markdown text={turn.text}/>{turn.role==="tutor" && resource && <p className="muted">Course source: {resource.title} · Section {section+1}</p>}</article>)}
      {busy && <p role="status">EdCurie is working on your reply…</p>}
    </div>
    {mode && turns.length>0 && <>
      <div className="card-actions" aria-label="Suggested replies">{suggestions.map((suggestion,i)=><button className="button small" type="button" disabled={busy || recording} key={i} onClick={()=>void send(mode,suggestion)}>{suggestion}</button>)}</div>
      <form className="stack" onSubmit={submit}>
        <label className="field">Your question or answer<textarea rows={3} maxLength={2000} value={draft} onChange={e=>setDraft(e.target.value)} disabled={busy}/></label>
        <label><input type="checkbox" checked={coding} onChange={e=>setCoding(e.target.checked)}/> Use code editor</label>
        {coding && <>
          <label className="field">Language<select value={language} onChange={e=>setLanguage(e.target.value)}>
            {["python","javascript","typescript","java","cpp","c","sql","text"].map(item=><option value={item} key={item}>{item}</option>)}
          </select></label>
          <label className="field">Code<textarea className="demo-code" rows={10} spellCheck={false} maxLength={2400} value={code} disabled={busy}
            onChange={e=>setCode(e.target.value)}/></label>
        </>}
        <div className="form-grid">
          <label className="field">Attach photo<input ref={photoInput} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>setPhoto(e.target.files?.[0]??null)}/></label>
          <label className="field">Attach audio<input ref={audioInput} type="file" accept="audio/*,.webm" disabled={busy || recording} onChange={e=>setAudio(e.target.files?.[0]??null)}/></label>
        </div>
        <div className="card-actions">
          <button className="button small" type="button" disabled={busy} onClick={()=>void record()}>{recording?"Stop recording":"Record voice message"}</button>
          {audio && <button className="button small" type="button" onClick={()=>{setAudio(null);if(audioInput.current)audioInput.current.value="";}}>Remove {audio.name}</button>}
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
    <div className="row"><h2>{state?.course.title||"Course"}</h2><button className="button small" onClick={onBack}>My courses</button></div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!state && !error && <p role="status">Loading course…</p>}
    {state?.message && <p className="notice">{state.message}</p>}
    {state && !state.completed && !!state.questions.length && <form className="stack" onSubmit={submit}>
      <h3>Course onboarding</h3>
      {(["academic","preferences"] as const).map(kind=><section className="stack" key={kind}>
        <h4>{kind==="academic"?"Academic baseline":"Learning preferences"}</h4>
        {kind==="preferences" && <p className="muted">Share study preferences only. Your tutor uses these answers to adapt explanations. You can answer “Prefer not to say”.</p>}
        {state.questions.filter(q=>q.kind===kind).map((q,i)=><div className="course-card stack" key={q.id}>
          <Markdown text={q.prompt}/>
          <label className="field">Answer {i+1}<textarea required maxLength={2000} rows={2} value={answers[q.id]??""} onChange={e=>setAnswers(a=>({...a,[q.id]:e.target.value}))}/></label>
        </div>)}
      </section>)}
      <div><button className="button primary" disabled={busy}>Complete onboarding</button></div>
    </form>}
    {state?.completed && <>
      <h3>Topics</h3>
      <p className="muted">Academic baseline completed · {state.score}/{state.total}</p>
      {state.topics.map(item=><article className="course-card row" key={item.id}><h4>{item.title}</h4><button className="button small" onClick={()=>setTopic(item)}>Open topic</button></article>)}
    </>}
  </div>;
}
