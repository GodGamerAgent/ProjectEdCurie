import Markdown from "./Markdown";
import { FormEvent,useCallback,useEffect,useState } from "react";
import { api,jsonBody } from "./api";
type Citation={resourceId:string;resourceVersionId:string;title:string;location:string};
type Message={id:string;role:"student"|"tutor";content:string;citations:Citation[];createdAt:string};
export default function TutorConversation({lessonId}:{lessonId:string}) {
  const [messages,setMessages]=useState<Message[]>([]),[draft,setDraft]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [source,setSource]=useState<{location:string;text:string}|null>(null);
  const load=useCallback(async()=>{setMessages((await api<{messages:Message[]}>(`/api/lessons/${lessonId}/messages`)).messages);},[lessonId]);
  useEffect(()=>{void load().catch(e=>setError(e.message));},[load]);
  async function send(event:FormEvent){event.preventDefault();setBusy(true);setError("");try{
    const result=await api<{messages:Message[]}>(`/api/lessons/${lessonId}/messages`,{method:"POST",body:jsonBody({message:draft})});
    setMessages(old=>[...old,...result.messages]);setDraft("");
  }catch(e){setError(e instanceof Error?e.message:"Your follow-up could not be sent.");}finally{setBusy(false);}}
  return <section className="course-card" style={{marginTop:16}}><h4>Ask a follow-up</h4>
    <p className="muted">The tutor answers from the cited course material and keeps this conversation with the lesson.</p>
    {error&&<div className="notice error" role="alert">{error}<button className="button small" onClick={()=>void load()}>Retry</button></div>}
    {messages.length>0&&<ol className="stack" aria-label="Lesson conversation">{messages.map(message=><li className={`course-card ${message.role==="student"?"":"conversation-reply"}`} key={message.id}>
      <strong>{message.role==="student"?"You":"EdCurie tutor"}</strong><Markdown text={message.content} />
      {message.citations?.length>0&&<ul>{message.citations.map((citation,index)=><li key={`${citation.resourceVersionId}-${index}`}><button className="button small" type="button" onClick={()=>void api<{text:string;location:string}>(`/api/resources/${citation.resourceId}/excerpt?version=${citation.resourceVersionId}&location=${encodeURIComponent(citation.location)}`).then(data=>setSource(data)).catch(e=>setError(e.message))}>Open {citation.title} · {citation.location}</button></li>)}</ul>}
    </li>)}</ol>}
    {source&&<div className="notice" role="region" aria-label="Follow-up source excerpt"><strong>{source.location}</strong><Markdown text={source.text} /><button className="button small" type="button" onClick={()=>setSource(null)}>Close source</button></div>}
    <form onSubmit={send}><div className="field"><label htmlFor={`followup-${lessonId}`}>Your question</label><textarea id={`followup-${lessonId}`} rows={2} maxLength={1200} required value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Ask about a step in the explanation"/></div>
      <button className="button small" disabled={busy||!draft.trim()}>{busy?"Thinking…":"Send follow-up"}</button>
    </form>
  </section>;
}
