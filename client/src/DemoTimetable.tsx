import { useCallback,useEffect,useState,type FormEvent } from "react";
import { api,jsonBody } from "./api";

type Slot={title:string;weekday:number;startTime:string;endTime:string;startsOn:string;endsOn:string;timezone:string};
type Event=Slot & {id:string;status:string};
const days=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const blank:Slot={title:"",weekday:1,startTime:"",endTime:"",startsOn:"",endsOn:"",timezone:"Asia/Kolkata"};

export default function DemoTimetable({courseId}:{courseId:string}) {
  const path=`/api/courses/${courseId}/timetable`;
  const [events,setEvents]=useState<Event[]>([]);
  const [form,setForm]=useState<Slot>(blank);
  const [editing,setEditing]=useState<string|null>(null);
  const [suggestions,setSuggestions]=useState<Slot[]>([]);
  const [instructions,setInstructions]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [aiOpen,setAiOpen]=useState(false);
  const reload=useCallback(async()=>setEvents((await api<{events:Event[]}>(path)).events.filter(item=>item.status==="active")),[path]);
  useEffect(()=>{void reload().catch(e=>setError(e.message));},[reload]);
  async function run(task:()=>Promise<void>) {
    setBusy(true);setError("");
    try {await task();}catch(e){setError(e instanceof Error?e.message:"Timetable action failed.");}finally{setBusy(false);}
  }
  function save(event:FormEvent) {
    event.preventDefault();
    void run(async()=>{
      await api(editing?path+"/"+editing:path,{method:editing?"PATCH":"POST",body:jsonBody(form)});
      setEditing(null);setForm(previous=>({...previous,title:"",startTime:"",endTime:""}));await reload();
    });
  }
  function set<K extends keyof Slot>(key:K,value:Slot[K]){setForm(old=>({...old,[key]:value}));}
  return <section className="stack">
    <h3>Weekly timetable</h3>
    {error && <p className="notice error" role="alert">{error}</p>}
    <form className="form-grid" onSubmit={save}>
      <label className="field">Class title<input required maxLength={160} value={form.title} onChange={e=>set("title",e.target.value)}/></label>
      <label className="field">Day<select value={form.weekday} onChange={e=>set("weekday",Number(e.target.value))}>{days.map((day,i)=><option value={i+1} key={day}>{day}</option>)}</select></label>
      <label className="field">Start time<input type="time" step={60} required value={form.startTime} onChange={e=>set("startTime",e.target.value)}/></label>
      <label className="field">End time<input type="time" step={60} required value={form.endTime} onChange={e=>set("endTime",e.target.value)}/></label>
      <label className="field">First date<input type="date" required value={form.startsOn} onChange={e=>set("startsOn",e.target.value)}/></label>
      <label className="field">Last date<input type="date" required value={form.endsOn} onChange={e=>set("endsOn",e.target.value)}/></label>
      <label className="field">Timezone<input required value={form.timezone} onChange={e=>set("timezone",e.target.value)}/></label>
      <div className="card-actions">
        <button className="button small primary" disabled={busy}>{editing?"Save class":"Add class"}</button>
        {editing && <button className="button small" type="button" onClick={()=>{setForm(blank);setEditing(null);}}>Cancel edit</button>}
        <button className="button small" type="button" aria-expanded={aiOpen} onClick={()=>setAiOpen(!aiOpen)}>Get AI help</button>
      </div>
    </form>
    {aiOpen && <div className="course-card stack">
      <label className="field">Scheduling instructions<textarea maxLength={1400} rows={3} value={instructions} onChange={e=>setInstructions(e.target.value)} placeholder="For example, two 50-minute sessions, Tuesday and Thursday after 2:15 PM."/></label>
      <div><button className="button small primary" disabled={busy || !instructions.trim() || !form.startsOn || !form.endsOn} onClick={()=>void run(async()=>{
        const data=await api<{events:Slot[]}>(path+"/suggest",{method:"POST",body:jsonBody({instructions,startsOn:form.startsOn,endsOn:form.endsOn,timezone:form.timezone})});
        setSuggestions(data.events);
        if(!data.events.length)setError("No suggestions fit those instructions. Try changing the constraints.");
      })}>{busy?"Working…":"Suggest times"}</button></div>
      {suggestions.map((event,i)=><div className="row" key={i}><span>{event.title} · {days[event.weekday-1]} · {event.startTime}–{event.endTime}</span>
        <button className="button small" onClick={()=>{setEditing(null);setForm(event);}}>Use in form</button></div>)}
    </div>}
    {events.length===0 && <p>No classes scheduled.</p>}
    {events.map(event=><article className="course-card row" key={event.id}>
      <div><strong>{event.title}</strong><p>{days[event.weekday-1]} · {event.startTime}–{event.endTime} · {event.timezone}</p><p>{event.startsOn} to {event.endsOn}</p></div>
      <div className="card-actions"><button className="button small" disabled={busy} onClick={()=>{setForm(event);setEditing(event.id);}}>Edit</button>
        <button className="button small" disabled={busy} onClick={()=>{if(confirm("Remove this class from the timetable?"))void run(async()=>{await api(path+"/"+event.id,{method:"DELETE"});if(editing===event.id){setEditing(null);setForm(blank);}await reload();});}}>Delete</button></div>
    </article>)}
  </section>;
}
