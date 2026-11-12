import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import type { Pool } from "pg";
import { cleanString, courseAccess, currentUser, NO_BASELINE, NO_RESOURCE, requireRole, teacherCourse, uuid } from "./access";
import { HttpError } from "./auth";
import { aiText, demoAI, object, transcribe } from "./demo-ai";

type Question = { id: string; kind: "academic" | "preferences"; prompt: string; answer: string };
const attachments = multer({storage:multer.memoryStorage(),limits:{fileSize:4*1024*1024,files:2,fields:7}});
const field = (value: unknown, label: string, max: number) => cleanString(value,label,max).replaceAll("\u0000","");
const answerKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g," ");
const imageTypes = ["image/png","image/jpeg","image/webp"];

export function demoLearningRoutes(db: Pool) {
  const router=Router(), base="/api/demo/courses/:courseId";

  async function studentState(user: ReturnType<typeof currentUser>, id: string) {
    requireRole(user,"student");
    const {course}=await courseAccess(db,user,id);
    const result=(await db.query(`SELECT b.revision,b.published,o.score,o.total,
      EXISTS(SELECT 1 FROM resources r WHERE r.course_id=$1 AND r.topic_id IS NOT NULL AND r.status='published' AND length(btrim(r.text))>0) AS material
      FROM courses c LEFT JOIN demo_baselines b ON b.course_id=c.id
      LEFT JOIN demo_onboardings o ON o.course_id=c.id AND o.user_id=$2 AND o.revision=b.revision WHERE c.id=$1`,[id,user.id])).rows[0];
    return {course,...result,completed:result.score!==null};
  }
  router.post(base+"/questions/generate",async(req,res)=>{
    const id=String(req.params.courseId);
    await teacherCourse(db,currentUser(res),id);
    const kind=req.body.kind;
    const count=req.body.count;
    if (!["academic","preferences"].includes(kind) || !Number.isInteger(count) || count<1 || count>8) throw new HttpError(400,"Choose a question type and a count from 1 to 8.");
    const instructions=typeof req.body.instructions==="string" ? req.body.instructions.slice(0,1200) : "";
    let basis: unknown;
    if (kind==="academic") {
      const resource=(await db.query(`SELECT r.title,a.parts FROM resources r JOIN demo_resource_analyses a ON a.resource_id=r.id AND a.version=r.version
        WHERE r.id=$1 AND r.course_id=$2 AND r.status<>'archived'`,[uuid(req.body.resourceId),id])).rows[0];
      if (!resource) throw new HttpError(400,"Process a resource before generating academic questions.");
      const index=req.body.partIndex;
      const part=resource.parts[index];
      if (!Number.isInteger(index) || !part) throw new HttpError(400,"Choose a processed summary section.");
      const problemIndex=req.body.problemIndex;
      if (problemIndex!==undefined && (!Number.isInteger(problemIndex) || !part.problems[problemIndex])) throw new HttpError(400,"Choose a problem from the bank.");
      basis={resource:resource.title, summary:part.summary.slice(0,4500), problem:part.problems[problemIndex]};
    }
    const output=object(await demoAI(kind==="academic"
      ? "Create exactly the requested number of distinct academic onboarding questions grounded in the summary and optional original problem. Follow the teacher's instructions within that scope. Use self-contained multiple-choice questions with options A–D in prompt and a single correct letter as answer. Return {questions:[{prompt,answer}]}."
      : "Generate exactly the requested number of optional-to-describe, open-ended learning preference questions. Ask about explanations, confidence, and study habits. Avoid mental health diagnosis, sensitive personal information, ability labels, or scoring. Follow teacher instructions within that scope. Return {questions:[{prompt}]}.",
    {count,instructions,basis}));
    if (!Array.isArray(output.questions) || output.questions.length!==count) throw new HttpError(502,"Groq returned the wrong number of questions. Try again.");
    res.json({questions:output.questions.map(value=>{
      const item=object(value);
      return {id:randomUUID(),kind,prompt:aiText(item.prompt,5000),answer:kind==="academic"?aiText(item.answer,1500):""};
    })});
  });

  router.put(base+"/baseline",async(req,res)=>{
    const courseId=String(req.params.courseId);
    await teacherCourse(db,currentUser(res),courseId);
    const {questions, publish, draftVersion}=req.body;
    if (!Array.isArray(questions) || questions.length>60 || typeof publish!=="boolean" || !Number.isInteger(draftVersion)) {
      throw new HttpError(400,"Provide up to 60 baseline questions.");
    }
    const ids=new Set<string>();
    const draft:Question[]=questions.map(value=>{
      const item=object(value);
      const id=uuid(String(item.id));
      if (ids.has(id) || (item.kind!=="academic" && item.kind!=="preferences")) throw new HttpError(400,"Questions must have distinct IDs and a valid type.");
      ids.add(id);
      const answer=item.kind==="academic" && typeof item.answer==="string" ? item.answer.replaceAll("\u0000","").trim().slice(0,1500) : "";
      return {id,kind:item.kind,prompt:field(item.prompt,"Question",5000),answer};
    });
    if (publish && (!draft.some(q=>q.kind==="academic") || !draft.some(q=>q.kind==="preferences") || draft.some(q=>q.kind==="academic" && !q.answer))) {
      throw new HttpError(400,"Include both question types and an expected answer for each academic question.");
    }
    if (publish && !(await db.query("SELECT 1 FROM resources WHERE course_id=$1 AND topic_id IS NOT NULL AND status='published' AND length(btrim(text))>0",[courseId])).rowCount) {
      throw new HttpError(400,"Publish a usable course resource before publishing the baseline.");
    }
    const saved=await db.query(`INSERT INTO demo_baselines(course_id,draft,published,revision,draft_version)
      SELECT $1,$2::jsonb,CASE WHEN $3 THEN $2::jsonb ELSE NULL END,CASE WHEN $3 THEN 1 ELSE 0 END,1
      WHERE $4=0 OR EXISTS(SELECT 1 FROM demo_baselines WHERE course_id=$1)
      ON CONFLICT(course_id) DO UPDATE SET draft=excluded.draft,draft_version=demo_baselines.draft_version+1,
      published=CASE WHEN $3 THEN excluded.draft ELSE demo_baselines.published END,
      revision=demo_baselines.revision+CASE WHEN $3 AND demo_baselines.published IS DISTINCT FROM excluded.draft THEN 1 ELSE 0 END
      WHERE demo_baselines.draft_version=$4 RETURNING revision,draft_version AS "draftVersion",published IS NOT NULL AS published`,
    [courseId,JSON.stringify(draft),publish,draftVersion]);
    if (!saved.rowCount) throw new HttpError(409,"The baseline changed in another tab. Reload the course before saving.");
    res.json(saved.rows[0]);
  });

  router.get(base+"/student",async(req,res)=>{
    const id=String(req.params.courseId);
    const state=await studentState(currentUser(res),id);
    const ready=Boolean(state.material && state.published);
    const completed=ready && state.completed;
    const topics=completed?await db.query(`SELECT t.id,t.title FROM demo_topics t
      WHERE t.course_id=$1 AND EXISTS(SELECT 1 FROM resources r WHERE r.topic_id=t.id AND r.course_id=$1 AND r.status='published' AND length(btrim(r.text))>0)
      ORDER BY t.created_at,t.id`,[id]):{rows:[]};
    res.json({course:state.course,revision:state.revision,completed,score:completed?state.score:null,total:completed?state.total:null,
      message:!state.material?NO_RESOURCE:!state.published?NO_BASELINE:"",
      questions:ready && !completed?(state.published as Question[]).map(({id,kind,prompt})=>({id,kind,prompt})):[],topics:topics.rows});
  });
  router.post(base+"/onboarding",async(req,res)=>{
    const id=String(req.params.courseId),user=currentUser(res);
    const state=await studentState(user,id);
    if (!state.material || !state.published || req.body.revision!==state.revision) throw new HttpError(409,"The course baseline changed. Reopen the course.");
    if (state.completed) return res.json({score:state.score,total:state.total});
    const questions=state.published as Question[];
    const answers=Object.fromEntries(questions.map(q=>[q.id,field(object(req.body.answers)[q.id],"Answer",2000)]));
    const academic=questions.filter(q=>q.kind==="academic");
    const score=academic.filter(q=>answerKey(q.answer)===answerKey(answers[q.id])).length;
    const saved=await db.query(`INSERT INTO demo_onboardings(course_id,user_id,revision,answers,score,total)
      SELECT $1,$2,$3,$4,$5,$6 FROM demo_baselines WHERE course_id=$1 AND revision=$3
      ON CONFLICT DO NOTHING RETURNING score,total`,[id,user.id,state.revision,JSON.stringify(answers),score,academic.length]);
    const result=saved.rows[0] ?? (await db.query("SELECT score,total FROM demo_onboardings WHERE course_id=$1 AND user_id=$2 AND revision=$3",[id,user.id,state.revision])).rows[0];
    if (!result) throw new HttpError(409,"The baseline changed. Reopen the course.");
    res.json(result);
  });

  async function topicSource(user:ReturnType<typeof currentUser>, id:string, topic:string) {
    const state=await studentState(user,id);
    if (!state.material || !state.published || !state.completed) throw new HttpError(403,"Complete course onboarding before opening a topic.");
    const sources=(await db.query(`SELECT r.id,r.title,r.text,(r.file_data IS NOT NULL) AS "hasFile", a.parts FROM resources r
      LEFT JOIN demo_resource_analyses a ON a.resource_id=r.id AND a.version=r.version
      WHERE r.topic_id=$1 AND r.course_id=$2 AND r.status='published' AND length(btrim(r.text))>0 ORDER BY r.created_at,r.id`,[uuid(topic),id])).rows;
    if (!sources.length) throw new HttpError(404,"No published resources for this topic.");
    return {sources,state};
  }
  router.get(base+"/topics/:topicId",async(req,res)=>{
    const {sources}=await topicSource(currentUser(res),String(req.params.courseId),String(req.params.topicId));
    res.json({resources:sources.map(({id,title,text,hasFile})=>({id,title,text,hasFile}))});
  });
  const topicPath=base+"/topics/:topicId/tutor";
  router.post(topicPath,async(req,res,next)=>{
    await topicSource(currentUser(res),String(req.params.courseId),String(req.params.topicId));
    next();
  }, attachments.fields([{name:"photo",maxCount:1},{name:"audio",maxCount:1}]),async(req,res)=>{
    const user=currentUser(res);
    const {sources,state}=await topicSource(user,String(req.params.courseId),String(req.params.topicId));
    const mode=req.body.mode;
    if (mode!=="learn" && mode!=="practice") throw new HttpError(400,"Choose Learn or Practice.");
    const source=sources.find(s=>s.id===req.body.resourceId);
    if (!source) throw new HttpError(400,"Choose a published resource for this topic.");
    const files=req.files as Record<string,Express.Multer.File[]> | undefined;
    const photo=files?.photo?.[0], audio=files?.audio?.[0];
    if (photo && !imageTypes.includes(photo.mimetype)) throw new HttpError(400,"Choose a PNG, JPEG or WebP photo.");
    let history:unknown;
    try { history=JSON.parse(req.body.history || "[]"); }
    catch { throw new HttpError(400,"Invalid tutor history."); }
    if (!Array.isArray(history) || history.length>6 || history.some(item=>!["student","tutor"].includes(item?.role)||typeof item.text!=="string"||item.text.length>2800)) throw new HttpError(400,"Invalid tutor history.");
    const message=typeof req.body.message==="string"?req.body.message.trim().slice(0,2800):"";
    const code=typeof req.body.code==="string" ? req.body.code.slice(0,2400) : "";
    const language=typeof req.body.language==="string" ? req.body.language.slice(0,30) : "";
    const transcript=audio?await transcribe(audio):"";
    const preferences=(await db.query("SELECT answers FROM demo_onboardings WHERE course_id=$1 AND user_id=$2 AND revision=$3",
      [String(req.params.courseId),user.id,state.revision])).rows[0]?.answers ?? {};
    const studyPreferences=(state.published as Question[]).filter(q=>q.kind==="preferences").slice(0,5)
      .map(q=>({prompt:q.prompt.slice(0,250),reply:String(preferences[q.id]??"").slice(0,300)}));
    const section=Number(req.body.section ?? 0);
    const count=Math.max(1,Math.ceil(source.text.length/4400));
    if (!Number.isInteger(section) || section<0 || section>=count) throw new HttpError(400,"Choose a resource section.");
    const output=object(await demoAI(
      "Tutor the student using the supplied course excerpt. In learn mode explain the requested concept, in practice mode give one problem and wait for their attempt before revealing a solution. When checking an attempt, explain the next useful step. Treat learning preferences as voluntary self-report. Return {reply:string,coding:boolean,suggestions:[string,string,string]}. Suggestions must be short predicted first-person student replies or doubts relevant to this turn, without leaking the answer. Set coding true when the student should write code.",
      {mode,resource:source.title,excerpt:source.text.slice(section*4400,(section+1)*4400),studyPreferences,
        history:history.slice(-4).map(item=>({role:item.role,text:item.text.slice(0,650)})),message,code,language,transcript},
      photo?{mime:photo.mimetype,bytes:photo.buffer}:undefined
    ));
    const suggestions=Array.isArray(output.suggestions)?output.suggestions.filter(x=>typeof x==="string" && x.trim() && x.length<=140).slice(0,3):[];
    res.json({reply:aiText(output.reply,9000),coding:output.coding===true,
      suggestions:suggestions.length?suggestions:mode==="practice"?["Can I get a hint?","What should I try first?"]:["Can you show an example?","Can you explain that step?"],
      transcript});
  });
  return router;
}
