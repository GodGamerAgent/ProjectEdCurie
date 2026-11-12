import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, jsonBody } from "./api";

const weekdays=["","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const zone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||"Asia/Kolkata";
type ClassEvent={id:string;title:string;weekday:number;startTime:string;endTime:string;startsOn:string;endsOn:string;timezone:string;status:string;exceptions:string[]};
type Interval={weekday:number;startTime:string;endTime:string};
type Concept={id:string;name:string};
function today(){return new Date().toISOString().slice(0,10);}
function defaultEnd(){const d=new Date();d.setMonth(d.getMonth()+3);return d.toISOString().slice(0,10);}
function DateLabel({value,timezone}:{value:string;timezone:string}) {
  return <>{new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short",timeZone:timezone}).format(new Date(value))} ({timezone})</>;
}

export function TeacherTimetable({courseId,concepts}:{courseId:string|number;concepts:Concept[]}) {
  const [events,setEvents]=useState<ClassEvent[]>([]),[title,setTitle]=useState("");
  const [weekday,setWeekday]=useState("1"),[startTime,setStartTime]=useState("09:00"),[endTime,setEndTime]=useState("10:00");
  const [startsOn,setStartsOn]=useState(today()),[endsOn,setEndsOn]=useState(defaultEnd()),[timezone,setTimezone]=useState(zone());
  const [estimates,setEstimates]=useState<{id:string;name:string;learningMinutes:number;practiceMinutes:number;revisionMinutes:number;difficulty:number}[]>([]);
  const [selectedEstimate,setSelectedEstimate]=useState(""),[learningMinutes,setLearningMinutes]=useState("30"),[practiceMinutes,setPracticeMinutes]=useState("20"),[revisionMinutes,setRevisionMinutes]=useState("10"),[difficulty,setDifficulty]=useState("3");
  const [exceptions,setExceptions]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const load=useCallback(async()=>{
    const [data,work]=await Promise.all([
      api<{events:ClassEvent[]}>(`/api/courses/${courseId}/timetable`),
      api<{concepts:typeof estimates}>(`/api/courses/${courseId}/estimates`)
    ]);
    setEvents(data.events);setEstimates(work.concepts);
    if(work.concepts.length){const current=work.concepts.find(x=>x.id===selectedEstimate)||work.concepts[0];setSelectedEstimate(current.id);
      setLearningMinutes(String(current.learningMinutes));setPracticeMinutes(String(current.practiceMinutes));setRevisionMinutes(String(current.revisionMinutes));setDifficulty(String(current.difficulty));}
  },[courseId,selectedEstimate]);
  useEffect(()=>{void load().catch(e=>setError(e.message));},[load]);
  async function run(action:()=>Promise<void>,message:string){setBusy(true);setError("");setNotice("");try{await action();await load();setNotice(message);}catch(e){setError(e instanceof Error?e.message:"Could not save the class schedule.");}finally{setBusy(false);}}
  function create(event:FormEvent){event.preventDefault();void run(async()=>{await api(`/api/courses/${courseId}/timetable`,{method:"POST",body:jsonBody({title,weekday:Number(weekday),startTime,endTime,startsOn,endsOn,timezone})});setTitle("");},"Weekly class added.");}
  function chooseEstimate(id:string){setSelectedEstimate(id);const item=estimates.find(x=>x.id===id);if(item){setLearningMinutes(String(item.learningMinutes));setPracticeMinutes(String(item.practiceMinutes));setRevisionMinutes(String(item.revisionMinutes));setDifficulty(String(item.difficulty));}}
  function saveEstimate(event:FormEvent){event.preventDefault();void run(async()=>{
    await api(`/api/concepts/${selectedEstimate}/estimate`,{method:"PATCH",body:jsonBody({learningMinutes:Number(learningMinutes),practiceMinutes:Number(practiceMinutes),revisionMinutes:Number(revisionMinutes),difficulty:Number(difficulty)})});
  },"Workload estimate saved.");}
  return <section className="study-section" aria-labelledby="teacher-timetable-heading"><div className="divider"/><div className="eyebrow">Class schedule</div><h3 id="teacher-timetable-heading">Teacher timetable</h3>
    <p className="muted">Set a weekly class and its active date range. Times use the selected timezone. Students can see class times, but not their classmates’ personal commitments.</p>
    {error&&<div className="notice error" role="alert">{error}</div>}{notice&&<div className="notice success" role="status">{notice}</div>}
    <form className="form-grid" onSubmit={create}>
      <div className="field"><label htmlFor="class-title">Class or session</label><input id="class-title" required maxLength={160} value={title} onChange={e=>setTitle(e.target.value)}/></div>
      <div className="field"><label htmlFor="class-weekday">Repeats every</label><select id="class-weekday" value={weekday} onChange={e=>setWeekday(e.target.value)}>{weekdays.slice(1).map((d,i)=><option key={d} value={i+1}>{d}</option>)}</select></div>
      <div className="field"><label htmlFor="class-start">Start time</label><input id="class-start" type="time" required value={startTime} onChange={e=>setStartTime(e.target.value)}/></div>
      <div className="field"><label htmlFor="class-end">End time</label><input id="class-end" type="time" required value={endTime} onChange={e=>setEndTime(e.target.value)}/></div>
      <div className="field"><label htmlFor="class-starts-on">First week starts</label><input id="class-starts-on" type="date" required value={startsOn} onChange={e=>setStartsOn(e.target.value)}/></div>
      <div className="field"><label htmlFor="class-ends-on">Last week ends</label><input id="class-ends-on" type="date" required value={endsOn} onChange={e=>setEndsOn(e.target.value)}/></div>
      <div className="field full"><label htmlFor="class-timezone">IANA timezone</label><input id="class-timezone" required value={timezone} onChange={e=>setTimezone(e.target.value)} placeholder="Asia/Kolkata"/></div>
      <div className="field"><button className="button primary" disabled={busy}>Add weekly class</button></div>
    </form>
    <div className="stack" style={{marginTop:18}}>{events.map(e=><div className="course-card" key={e.id}>
      <div className="row"><div><strong>{e.title}</strong><p>{weekdays[e.weekday]} · {e.startTime}–{e.endTime} · {e.timezone}</p><p className="muted">{e.startsOn} through {e.endsOn} · {e.status}</p>
        {e.exceptions.length>0&&<p className="muted">Cancelled dates: {e.exceptions.join(", ")}</p>}</div>
        {e.status==="active"&&<button className="button small" type="button" disabled={busy||!exceptions[e.id]} onClick={()=>void run(async()=>{
          await api(`/api/courses/${courseId}/timetable/${e.id}/cancel-date`,{method:"POST",body:jsonBody({date:exceptions[e.id]})});
        },"Class occurrence cancelled.")} title={exceptions[e.id]?"Cancel this date":"Choose a date to cancel"}>Cancel date</button>}
        {e.status==="active"&&<button className="button small" type="button" disabled={busy} onClick={()=>void run(async()=>{await api(`/api/courses/${courseId}/timetable/${e.id}`,{method:"DELETE"});},"Weekly class cancelled.")}>Cancel series</button>}
      </div>
      {e.status==="active"&&<div className="field" style={{marginTop:10}}><label htmlFor={`exception-${e.id}`}>Occurrence date to cancel</label><input id={`exception-${e.id}`} type="date" min={e.startsOn} max={e.endsOn} value={exceptions[e.id]||""} onChange={event=>setExceptions(old=>({...old,[e.id]:event.target.value}))}/></div>}
    </div>)}{events.length===0&&!error&&<p className="muted">No class timetable entries yet.</p>}</div>
    <div className="divider"/><h3>Planning estimates</h3><p className="muted">Set transparent teacher estimates for learning, practice, and revision. These values affect study-plan workload and feasibility, not student grades.</p>
    {estimates.length===0?<p className="muted">Add a concept before editing its planning estimates.</p>:<form className="form-grid" onSubmit={saveEstimate}>
      <div className="field full"><label htmlFor="estimate-concept">Concept</label><select id="estimate-concept" value={selectedEstimate} onChange={e=>chooseEstimate(e.target.value)}>{estimates.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div className="field"><label htmlFor="estimate-learning">Learning minutes</label><input id="estimate-learning" type="number" min="5" max="180" value={learningMinutes} onChange={e=>setLearningMinutes(e.target.value)}/></div>
      <div className="field"><label htmlFor="estimate-practice">Practice minutes</label><input id="estimate-practice" type="number" min="5" max="120" value={practiceMinutes} onChange={e=>setPracticeMinutes(e.target.value)}/></div>
      <div className="field"><label htmlFor="estimate-revision">Revision minutes</label><input id="estimate-revision" type="number" min="5" max="90" value={revisionMinutes} onChange={e=>setRevisionMinutes(e.target.value)}/></div>
      <div className="field"><label htmlFor="estimate-difficulty">Difficulty from 1 to 5</label><input id="estimate-difficulty" type="number" min="1" max="5" value={difficulty} onChange={e=>setDifficulty(e.target.value)}/></div>
      <div className="field"><button className="button" disabled={busy}>Save estimates</button></div>
    </form>}
  </section>;
}

type PlanBlock={id:string;conceptId:string;conceptName:string;phase:string;startsAt:string;endsAt:string;state:string;explanation:string};
type PlanSummary={id:string;deadline:string;version:number;feasibility_score:number;required_minutes:number;capacity_minutes:number;explanation:string};
export function StudentSchedule({courseId,baselineReady,refreshKey,onStartBlock}:{courseId:string|number;baselineReady:boolean;refreshKey:number;onStartBlock:(conceptId:string,phase:string)=>void}) {
  const [timezone,setTimezone]=useState(zone()),[availability,setAvailability]=useState<Interval[]>([]);
  const [sessionMinutes,setSessionMinutes]=useState(30);
  const [commitments,setCommitments]=useState<{id:string;title:string;courseId:string|null;startsAt:string;endsAt:string;timezone:string}[]>([]);
  const [title,setTitle]=useState(""),[startsAt,setStartsAt]=useState(""),[endsAt,setEndsAt]=useState("");
  const [events,setEvents]=useState<ClassEvent[]>([]);
  const [goalSaved,setGoalSaved]=useState(false),[feasibility,setFeasibility]=useState<{score:number;deadline:string;requiredMinutes:number;capacityMinutes:number;explanation:string}|null>(null);
  const [plan,setPlan]=useState<PlanSummary|null>(null),[blocks,setBlocks]=useState<PlanBlock[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const load=useCallback(async()=>{
    const [a,c,t,g]=await Promise.all([
      api<{availability:{timezone:string;sessionMinutes:number;intervals:Interval[]}}>(`/api/courses/${courseId}/availability`),
      api<{commitments:typeof commitments}>(`/api/courses/${courseId}/commitments`),
      api<{events:ClassEvent[]}>(`/api/courses/${courseId}/timetable`),
      api<{goal:{goal:string;deadline:string}|null}>(`/api/courses/${courseId}/goal`)
    ]);
    setTimezone(a.availability.timezone);setSessionMinutes(a.availability.sessionMinutes);setAvailability(a.availability.intervals);setCommitments(c.commitments);setEvents(t.events);setGoalSaved(Boolean(g.goal));
    if(baselineReady&&g.goal){
      const [f,p]=await Promise.all([
        api<{score:number;deadline:string;requiredMinutes:number;capacityMinutes:number;explanation:string}>(`/api/courses/${courseId}/feasibility`),
        api<{plan:PlanSummary|null;blocks:PlanBlock[]}>(`/api/courses/${courseId}/plan`)
      ]);
      setFeasibility(f);setPlan(p.plan);setBlocks(p.blocks);
    }else{setFeasibility(null);setPlan(null);setBlocks([]);}
  },[courseId,baselineReady,refreshKey]);
  useEffect(()=>{void load().catch(e=>setError(e.message));},[load]);
  async function run(action:()=>Promise<void>,message:string){setBusy(true);setError("");setNotice("");try{await action();await load();setNotice(message);}catch(e){setError(e instanceof Error?e.message:"Could not save your schedule.");}finally{setBusy(false);}}
  function updateInterval(index:number,key:keyof Interval,value:string){setAvailability(old=>old.map((item,i)=>i===index?{...item,[key]:key==="weekday"?Number(value):value}:item));}
  function saveAvailability(event:FormEvent){event.preventDefault();void run(async()=>{
    await api(`/api/courses/${courseId}/availability`,{method:"PUT",body:jsonBody({timezone,sessionMinutes,intervals:availability})});
  },"Availability saved privately.");}
  function buildPlan(){void run(async()=>{
    const data=await api<{plan:PlanSummary;blocks:PlanBlock[]}>(`/api/courses/${courseId}/plan`,{method:"POST",body:jsonBody({requestKey:crypto.randomUUID()})});
    setPlan(data.plan);setBlocks(data.blocks);
  },plan?"Plan recalculated. Completed sessions and the original deadline were kept.":"Study plan created.");}
  function updateBlock(id:string,patch:Partial<PlanBlock>){setBlocks(old=>old.map(b=>b.id===id?{...b,...patch}:b));}
  async function startBlock(block:PlanBlock){
    const next=await api<{state:string}>(`/api/study-blocks/${block.id}/start`,{method:"POST"});
    updateBlock(block.id,{state:next.state});onStartBlock(block.conceptId,block.phase);
  }
  async function completeBlock(block:PlanBlock){
    await api(`/api/study-blocks/${block.id}/complete`,{method:"POST"});updateBlock(block.id,{state:"completed"});
  }
  function addCommitment(event:FormEvent){event.preventDefault();void run(async()=>{
    if(!startsAt||!endsAt)throw new Error("Choose both a start and end time.");
    await api(`/api/courses/${courseId}/commitments`,{method:"POST",body:jsonBody({title,startsAt:new Date(startsAt).toISOString(),endsAt:new Date(endsAt).toISOString(),timezone:zone(),courseId:String(courseId)})});
    setTitle("");setStartsAt("");setEndsAt("");
  },"Private commitment saved.");}
  return <section className="study-section" aria-labelledby="student-schedule-heading"><div className="divider"/><div className="eyebrow">Your time</div><h3 id="student-schedule-heading">Availability and commitments</h3>
    <p className="muted">Your weekly availability and personal commitments are private. Only class timetable events are shared with the course.</p>
    {error&&<div className="notice error" role="alert">{error}</div>}{notice&&<div className="notice success" role="status">{notice}</div>}
    <form onSubmit={saveAvailability}><div className="field"><label htmlFor="availability-zone">Your timezone</label><input id="availability-zone" value={timezone} onChange={e=>setTimezone(e.target.value)}/></div>
      <div className="field"><label htmlFor="availability-session-length">Preferred study session</label><select id="availability-session-length" value={sessionMinutes} onChange={e=>setSessionMinutes(Number(e.target.value))}>{[15,25,30,45,60,90,120].map(n=><option key={n} value={n}>{n} minutes</option>)}</select></div>
      {availability.map((item,index)=><div className="form-grid" key={index} style={{marginTop:10}}>
        <div className="field"><label htmlFor={`availability-day-${index}`}>Day</label><select id={`availability-day-${index}`} value={item.weekday} onChange={e=>updateInterval(index,"weekday",e.target.value)}>{weekdays.slice(1).map((d,i)=><option key={d} value={i+1}>{d}</option>)}</select></div>
        <div className="field"><label htmlFor={`availability-start-${index}`}>Available from</label><input id={`availability-start-${index}`} type="time" value={item.startTime} onChange={e=>updateInterval(index,"startTime",e.target.value)}/></div>
        <div className="field"><label htmlFor={`availability-end-${index}`}>Available until</label><input id={`availability-end-${index}`} type="time" value={item.endTime} onChange={e=>updateInterval(index,"endTime",e.target.value)}/></div>
        <button type="button" className="button small" onClick={()=>setAvailability(old=>old.filter((_,i)=>i!==index))}>Remove</button>
      </div>)}
      <div className="card-actions" style={{marginTop:12}}><button type="button" className="button small" onClick={()=>setAvailability(old=>[...old,{weekday:1,startTime:"16:00",endTime:"18:00"}])} disabled={availability.length>=21}>Add time window</button>
        <button className="button primary small" disabled={busy}>Save availability</button></div>
    </form>
    <div className="divider"/><h3>Personal commitments</h3><p className="muted">Times use your device timezone ({zone()}); they are saved as absolute times.</p>
    <form className="form-grid" onSubmit={addCommitment}>
      <div className="field"><label htmlFor="commitment-title">Commitment</label><input id="commitment-title" required maxLength={160} value={title} onChange={e=>setTitle(e.target.value)}/></div>
      <div className="field"><label htmlFor="commitment-start">Starts</label><input id="commitment-start" type="datetime-local" required value={startsAt} onChange={e=>setStartsAt(e.target.value)}/></div>
      <div className="field"><label htmlFor="commitment-end">Ends</label><input id="commitment-end" type="datetime-local" required value={endsAt} onChange={e=>setEndsAt(e.target.value)}/></div>
      <div className="field"><button className="button" disabled={busy}>Save commitment</button></div>
    </form>
    <div className="stack" style={{marginTop:14}}>{commitments.map(item=><div className="course-card row" key={item.id}>
      <div><strong>{item.title}</strong><p><DateLabel value={item.startsAt} timezone={item.timezone}/> – <DateLabel value={item.endsAt} timezone={item.timezone}/></p></div>
      <button type="button" className="button small" disabled={busy} onClick={()=>void run(async()=>{await api(`/api/courses/${courseId}/commitments/${item.id}`,{method:"DELETE"});},"Commitment removed.")}>Remove</button>
    </div>)}{!commitments.length&&<p className="muted">No personal commitments saved.</p>}</div>
    <div className="divider"/><h3>Class timetable</h3>
    <div className="stack">{events.map(item=><div className="course-card" key={item.id}><strong>{item.title}</strong><p>{weekdays[item.weekday]} · {item.startTime}–{item.endTime} · {item.timezone}</p><p className="muted">{item.startsOn} through {item.endsOn}{item.exceptions.length?` · Cancelled: ${item.exceptions.join(", ")}`:""}</p></div>)}
      {!events.length&&<p className="muted">No class schedule has been added.</p>}</div>
    <div className="divider"/><h3>Feasibility and study plan</h3>
    {!baselineReady?<p className="muted">Complete the course baseline to plan study sessions.</p>:!goalSaved?<p className="muted">Save a goal and deadline above before building a study plan.</p>:<>
      {feasibility&&<div className="notice"><strong>Feasibility: {feasibility.score}/10</strong><p>{feasibility.explanation}</p>
        <p>Estimated work: {feasibility.requiredMinutes} minutes · available before deadline: {feasibility.capacityMinutes} minutes · deadline: {feasibility.deadline}</p></div>}
      <p className="muted">The plan uses teacher workload estimates, your availability, class events, and private commitments. Replanning preserves completed work and the original deadline. Early starts are allowed.</p>
      <button className="button primary" type="button" disabled={busy} onClick={buildPlan}>{plan?"Replan without moving the deadline":"Build study plan"}</button>
      {plan&&<div className="stack" style={{marginTop:14}}>
        {blocks.map(block=><div className="course-card row" key={block.id}><div><strong>{block.conceptName||"Study session"} · {block.phase}</strong>
          <p><DateLabel value={block.startsAt} timezone={timezone}/> – <DateLabel value={block.endsAt} timezone={timezone}/></p><p className="muted">{block.explanation} · {block.state}</p>
        </div>
        {block.state==="planned"?<button className="button small" disabled={busy} onClick={()=>void run(()=>startBlock(block),`${block.phase} session started.`)}>Start early</button>
          :block.state==="started"?<button className="button small" disabled={busy} onClick={()=>void run(()=>completeBlock(block),"Study session completed.")}>Mark complete</button>
          :null}
        {block.state==="started"&&<button className="button small" onClick={()=>onStartBlock(block.conceptId,block.phase)}>Open concept</button>}
        </div>)}
        {!blocks.length&&<p className="muted">No sessions fit the current availability and deadline. Add availability or review teacher estimates.</p>}
      </div>}
    </>}
  </section>;
}
