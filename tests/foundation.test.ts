import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import request from "supertest";
import { Pool } from "pg";
import { createApi } from "../server/routes";
import { HttpError, provisionVerifiedIdentity, type AppUser } from "../server/auth";

if (!process.env.TEST_DATABASE_URL || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\/edcurie_test$/.test(process.env.TEST_DATABASE_URL)) {
  throw new Error("Tests require a disposable local edcurie_test database. Run npm run test:isolated.");
}
const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const actors: Record<string, AppUser> = {};
const app = createApi(db, async (req) => {
  const user = actors[String(req.headers["x-test-actor"])];
  if (!user) throw new HttpError(401, "Sign in is required.");
  return user;
}, async () => {});
const as = (name: string) => ({ "x-test-actor": name });
let instituteId: string;
let otherInstituteId: string;

function samplePdf() {
  const stream = "BT /F1 12 Tf 72 720 Td (Test lesson from page one.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

beforeAll(async () => {
  const empty = await db.query("SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM courses) AS courses, (SELECT count(*) FROM approved_domains) AS domains");
  expect(empty.rows[0]).toEqual({ users: "0", courses: "0", domains: "0" });
  await expect(provisionVerifiedIdentity(db, "admin", "admin@personal.example", false, "admin@personal.example")).rejects.toThrow("verified primary email");
  await expect(provisionVerifiedIdentity(db, "wrong", "wrong@example.edu", true, "admin@personal.example")).rejects.toThrow("domain has not been approved");
  actors.admin = await provisionVerifiedIdentity(db, "admin", "admin@personal.example", true, "admin@personal.example");
  expect(actors.admin.role).toBe("admin");
  expect((await db.query("SELECT count(*) FROM approved_domains")).rows[0].count).toBe("0");
  await expect(provisionVerifiedIdentity(db, "admin", "admin@personal.example", false, "admin@personal.example")).rejects.toThrow("verified primary email");
  expect((await provisionVerifiedIdentity(db, "admin", "admin@personal.example", true, "admin@personal.example")).role).toBe("admin");
  await expect(provisionVerifiedIdentity(db, "different", "different@personal.example", true, "different@personal.example")).rejects.toThrow("different account already holds");
  await expect(provisionVerifiedIdentity(db, "blocked", "blocked@example.edu", true, "admin@personal.example")).rejects.toThrow("domain has not been approved");
  const institute = await request(app).post("/api/admin/institutes").set(as("admin")).send({ displayName: "Institute A" });
  expect(institute.status).toBe(201); instituteId = institute.body.id;
  const other = await request(app).post("/api/admin/institutes").set(as("admin")).send({ displayName: "Institute B" });
  expect(other.status).toBe(201); otherInstituteId = other.body.id;
  expect((await request(app).post(`/api/admin/institutes/${instituteId}/domains`).set(as("admin")).send({ domain: "example.edu" })).status).toBe(201);
  expect((await request(app).post(`/api/admin/institutes/${otherInstituteId}/domains`).set(as("admin")).send({ domain: "other.edu" })).status).toBe(201);
  for (const [name, email, role] of [
    ["teacher", "teacher@example.edu", "teacher"],
    ["otherTeacher", "otherteacher@example.edu", "teacher"], ["student", "student@example.edu", "student"],
    ["outsider", "outsider@example.edu", "student"]
  ]) {
    const result = await db.query('INSERT INTO users (provider_id,email,role,institute_id) VALUES ($1,$2,$3,$4) RETURNING id,email,role,institute_id AS "instituteId"', [name, email, role, instituteId]);
    actors[name] = result.rows[0];
  }
  actors.otherInstituteStudent = await provisionVerifiedIdentity(db, "other-student", "student@other.edu", true, "admin@personal.example");
  const otherTeacher = await db.query(`INSERT INTO users (provider_id,email,role,institute_id) VALUES ('other-teacher','teacher@other.edu','teacher',$1) RETURNING id,email,role,institute_id AS "instituteId"`, [otherInstituteId]);
  actors.otherInstituteTeacher = otherTeacher.rows[0];
});
afterAll(async () => { await db.end(); });

it.each([
  {pdfMode:"vision",malformed:false},
  {pdfMode:"vision",malformed:true},
  {pdfMode:"file",malformed:true},
])("recovers Google PDF processing in $pdfMode mode with malformed=$malformed", async ({pdfMode,malformed}) => {
  const teacher=as("teacher");
  const course=await request(app).post("/api/courses").set(teacher).send({title:"PDF recovery"});
  expect(course.status).toBe(201);
  const base=`/api/demo/courses/${course.body.id}`;
  const topic=await request(app).post(base+"/topics").set(teacher).send({title:"Sequences"});
  expect(topic.status).toBe(201);
  const suppliedPdf=process.env.EDCURIE_TEST_PDF;
  const original=suppliedPdf ? await readFile(suppliedPdf) : samplePdf();
  const upload=await request(app).post(`/api/courses/${course.body.id}/resources`).set(teacher)
    .field("title","PDF recovery").field("topicId",topic.body.id).field("processingMode","questions")
    .attach("file",original,{filename:"resource.pdf",contentType:"application/pdf"});
  expect(upload.status).toBe(201);
  const {id,pdfPages}=upload.body;
  expect(pdfPages).toBe(suppliedPdf ? 3 : 2);
  const pages=Array.from({length:pdfPages},(_,index)=>({
    page:index+1,summary:`Mock summary for page ${index+1}.`,
    problems:index===0 ? [{prompt:"Find the first five terms of $c_n = n^2 - 1$.",answer:"0, 3, 8, 15, 24",quote:"Find the first five terms."}] : [],
  }));
  const provider=vi.fn<(url:string,init:RequestInit)=>Promise<Response>>();
  const googleResponse=(text:string)=>Response.json({candidates:[{content:{parts:[{text}]}}]});
  provider.mockImplementation(async (url,init)=>{
    const body=JSON.parse(String(init.body));
    const parts=body.contents[0].parts;
    const requested=JSON.parse(parts[0].text).expectedPages;
    if (url.includes("/models/gemma-4-31b-it:generateContent")) {
      expect(requested).toEqual([expect.any(Number)]);
      expect(parts[1].inlineData).toMatchObject({mimeType:"image/png",data:expect.stringMatching(/^iVBOR/)});
      if (requested[0]===1) throw new DOMException("Provider deadline exceeded","TimeoutError");
      return googleResponse("Incomplete result");
    }
    expect(url).toContain("/models/gemini-3.5-flash-lite:generateContent");
    expect(body.generationConfig.responseJsonSchema.required).toEqual(["pages"]);
    expect(parts[1].inlineData).toEqual({mimeType:"application/pdf",data:original.toString("base64")});
    if (typeof requested==="string") {
      expect(requested).toBe(`1 through ${pdfPages}`);
      return googleResponse(malformed ? '{"pages":[' : JSON.stringify({pages}));
    }
    expect(requested).toEqual([expect.any(Number)]);
    return googleResponse(JSON.stringify({pages:[pages[requested[0]-1]]}));
  });
  const baseUrl="https://generativelanguage.googleapis.com/v1beta/openai";
  vi.stubEnv("AI_PROVIDER_BASE_URL",baseUrl);
  vi.stubEnv("AI_PROVIDER_API_KEY","custom-test-key");
  vi.stubGlobal("fetch",provider);
  try {
    const settings=await request(app).put("/api/admin/ai/status").set(as("admin"))
      .send({baseUrl,model:pdfMode==="vision"?"gemma-4-31b-it":"gemini-3.5-flash-lite",pdfMode});
    expect(settings.status).toBe(200);
    const processPdf=()=>request(app).post(`/api/demo/resources/${id}/process`).set(teacher);
    for (let page=1;page<=(malformed?pdfPages:1);page++) {
      const result=await processPdf();
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({remaining:malformed?pdfPages-page:0});
    }
    const view=await request(app).get(base+"/teacher").set(teacher);
    const resource=view.body.resources.find((item:{id:string})=>item.id===id);
    expect(resource.parts).toEqual(pages);
    expect(resource.text).toContain(`## Page ${pdfPages}`);
    expect(resource.text).toContain(pages[0].problems[0].prompt);
    expect((await processPdf()).body).toMatchObject({remaining:0});
    expect(provider).toHaveBeenCalledTimes(malformed ? (pdfMode==="vision"?2*pdfPages+1:pdfPages+1) : 2);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await db.query("DELETE FROM demo_ai_settings WHERE id='default'");
  }
});

it("runs the teacher-to-student demo, scoped by course and baseline revision", async () => {
  const teacher=as("teacher"),student=as("student");
  const newCourse=await request(app).post("/api/courses").set(teacher).send({title:"Sequences"});
  expect(newCourse.status).toBe(201);
  const courseId=newCourse.body.id,base=`/api/demo/courses/${courseId}`;
  const teacherView=()=>request(app).get(base+"/teacher").set(teacher);
  const studentView=()=>request(app).get(base+"/student").set(student);
  const enrollment={name:"Test Student",email:actors.student.email,dateOfBirth:"2005-01-02",enrolledOn:"2026-01-02"};
  expect((await request(app).put(base+"/students").set(teacher).send(enrollment)).status).toBe(200);
  expect((await request(app).put(base+"/students").set(teacher).send({...enrollment,name:"Updated Student",previousEmail:enrollment.email})).status).toBe(200);
  expect((await teacherView()).body.students[0].name).toBe("Updated Student");
  expect((await request(app).get(base+"/teacher").set(student)).status).toBe(403);
  expect((await request(app).get(base+"/teacher").set(as("otherInstituteTeacher"))).status).toBe(403);
  const topic=await request(app).post(base+"/topics").set(teacher).send({title:"Arithmetic sequences"});
  expect(topic.status).toBe(201);
  const path=base+"/topics/"+topic.body.id;
  expect((await studentView()).body.message).toMatch(/Boarding is not possible/);
  const original=Buffer.concat([samplePdf(),Buffer.from([0,255,0])]);
  const upload=await request(app).post(`/api/courses/${courseId}/resources`).set(teacher)
    .field("title","Lab sheet").field("topicId",topic.body.id).field("processingMode","both").attach("file",original,{filename:"notes.pdf",contentType:"application/pdf"});
  expect(upload.status).toBe(201);
  expect(upload.body).toMatchObject({text:"",pdfPages:2});
  const resourceId=upload.body.id;
  expect((await db.query("SELECT file_data FROM resources WHERE id=$1",[resourceId])).rows[0].file_data).toEqual(original);
  const excerpt="Exercise: What is the next term of 2, 4, 6?";
  const summary="An arithmetic sequence has a constant difference.";
  const prompt="Find the next term of 2, 4, 6.";
  const notes=`## Page 1\n\n${summary}\n\n### Problems\n\n${prompt}\n\n## Page 2\n\nReview the common difference.`;
  const admin=as("admin"),settingsUrl="/api/admin/ai/status";
  const provider=vi.fn(async (url:string,init:RequestInit)=>{
    if(url.endsWith("/audio/transcriptions")) {
      expect((init.body as FormData).get("model")).toBe("whisper-large-v3-turbo");
      return new Response(JSON.stringify({text:"How do I find the common difference?"}));
    }
    const body=JSON.parse(String(init.body));
    const native=url.startsWith("https://provider.example/v1/");
    expect(body.model).toBe(native?"pdf-vision-model":"qwen/qwen3.8-27b");
    const system:string=body.messages[0].content;
    const input=body.messages[1].content;
    const data=JSON.parse(typeof input==="string"?input:input[0].text);
    let result:unknown;
    if (system.startsWith("Review the actual PDF")) {
      expect(data.excerpt).toBeUndefined();
      if (native) {
        expect(input[1].file.file_data).toBe("data:application/pdf;base64,"+original.toString("base64"));
        expect((init.headers as Record<string,string>).Authorization).toBe("Bearer custom-test-key");
      } else {
        expect(input[1].image_url.url).toMatch(/^data:image\/png;base64,iVBOR/);
      }
      const pages=[
        {page:1,summary,problems:[{prompt,answer:"8",quote:excerpt}]},
        {page:2,summary:"Review the common difference.",problems:[]},
      ];
      result={pages:native?pages:[pages[data.expectedPages[0]-1]]};
    } else if(system.startsWith("Create exactly")) {
      if (data.basis.problem) {
        expect(data.basis.problem.prompt).toContain("next term");
        expect(data.instructions).toBe("Use a simple sequence");
      } else {
        expect(data.basis.summary).toContain("difference");
        expect(data.instructions).toBe("Use the summary");
      }
      result={questions:[{prompt:"Which number comes next?",answer:"A"}]};
    } else if(system.startsWith("Generate exactly")) {
      result={questions:[{prompt:"How do you prefer to see a worked example?"}]};
    } else if(system.startsWith("Suggest")) {
      result={events:[{title:"Sequences",weekday:2,startTime:"14:15",endTime:"15:05"}]};
    } else {
      expect(data.studyPreferences[0].reply).toBe("One step at a time");
      expect(data.transcript).toContain("common difference");
      expect(data.code).toBe("print(2 + 2)");
      expect(input[1].image_url.url).toMatch(/^data:image\/png;base64,/);
      result={reply:"Compute the difference $4-2$.",suggestions:["Can you show a worked example?"],coding:true};
    }
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}));
  });
  vi.stubEnv("GROQ_API_KEY","test-key");
  vi.stubEnv("AI_PROVIDER_BASE_URL","https://provider.example/v1");
  vi.stubEnv("AI_PROVIDER_API_KEY","custom-test-key");
  vi.stubGlobal("fetch",provider);
  try {
    const processPdf=()=>request(app).post(`/api/demo/resources/${resourceId}/process`).set(teacher);
    const googleBase="https://generativelanguage.googleapis.com/v1beta/openai";
    vi.stubEnv("AI_PROVIDER_BASE_URL",googleBase);
    const googleSettings={baseUrl:googleBase,model:"gemini-3.8-flash",pdfMode:"file"};
    expect((await request(app).put(settingsUrl).set(admin).send({...googleSettings,model:"gemma-4-31b-it"})).status).toBe(400);
    expect((await request(app).put(settingsUrl).set(admin).send(googleSettings)).body).toEqual({...googleSettings,configured:true});
    provider.mockResolvedValueOnce(new Response(JSON.stringify({error:{details:[{reason:"API_KEY_INVALID"}]}}),{status:400}));
    expect((await processPdf()).body.error).toContain("Google rejected the API key");
    for (const status of [503,500]) {
      provider.mockImplementationOnce(async (url,init)=>{
        expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
        expect(JSON.parse(String(init.body)).contents[0].parts[1].inlineData.data).toBe(original.toString("base64"));
        return new Response(null,{status});
      });
    }
    provider.mockRejectedValueOnce(new DOMException("Provider deadline exceeded","TimeoutError"));
    provider.mockImplementationOnce(async (url,init)=>{
      expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
      expect(init.headers).toMatchObject({"x-goog-api-key":"custom-test-key"});
      const body=JSON.parse(String(init.body));
      expect(body.generationConfig.responseMimeType).toBe("application/json");
      expect(body.contents[0].parts[1].inlineData).toEqual({mimeType:"application/pdf",data:original.toString("base64")});
      const pages=[
        {page:1,summary,problems:[{prompt,answer:"8",quote:excerpt}]},
        {page:2,summary:"Review the common difference.",problems:[]},
      ];
      return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({pages})}]}}]}));
    });
    expect((await processPdf()).body.remaining).toBe(0);
    expect((await request(app).put(settingsUrl).set(admin).send({baseUrl:"https://api.groq.com/openai/v1",model:"qwen/qwen3.8-27b",pdfMode:"vision"})).status).toBe(200);
    vi.stubEnv("AI_PROVIDER_BASE_URL","https://provider.example/v1");
    expect((await processPdf()).body.remaining).toBe(1);
    expect((await teacherView()).body.resources[0].text).toBe(notes);
    expect((await processPdf()).body.remaining).toBe(0);
    const processed=(await teacherView()).body.resources[0];
    expect(processed.parts[0].problems[0].quote).toBe(excerpt);
    expect(processed.questions).toMatchObject([{origin:"extracted",quote:excerpt,answer:"8",answerSource:"document",sourceRef:"Page 1"}]);
    expect(processed.summary).toContain(summary);
    const bankQuestion=processed.questions[0].id;
    expect(processed.text).toBe(notes);
    const settings={baseUrl:"https://provider.example/v1",model:"pdf-vision-model",pdfMode:"file"};
    expect((await request(app).put(settingsUrl).set(teacher).send(settings)).status).toBe(403);
    expect((await request(app).put(settingsUrl).set(admin).send({...settings,baseUrl:"https://unknown.example/v1"})).status).toBe(400);
    const savedSettings=await request(app).put(settingsUrl).set(admin).send(settings);
    expect(savedSettings.body).toEqual({...settings,configured:true});
    expect((await request(app).post(`/api/demo/resources/${resourceId}/process`).set(teacher)).body.remaining).toBe(0);
    expect(provider).toHaveBeenCalledTimes(8);
    expect((await request(app).put(settingsUrl).set(admin).send({baseUrl:"https://api.groq.com/openai/v1",model:"qwen/qwen3.8-27b",pdfMode:"vision"})).status).toBe(200);
    const versions=(await request(app).get(`/api/resources/${resourceId}/versions`).set(teacher)).body.versions;
    const versionUrl=`/api/resources/${resourceId}/versions/${versions[0].id}`;
    expect((await request(app).get(versionUrl).set(teacher)).body.text).toBe(notes);
    expect((await request(app).get(versionUrl).set(student)).status).toBe(403);
    expect((await request(app).post(`/api/resources/${resourceId}/publish`).set(teacher)).status).toBe(200);
    expect((await studentView()).body.message).toBe("Your institute is preparing the baseline assessment");
    expect((await request(app).get(path).set(student)).status).toBe(403);
    const generate=(data:object)=>request(app).post(base+"/questions/generate").set(teacher).send(data);
    vi.stubEnv("AI_PROVIDER_BASE_URL",googleBase);
    expect((await request(app).put(settingsUrl).set(admin).send(googleSettings)).status).toBe(200);
    provider.mockRejectedValueOnce(new DOMException("Provider deadline exceeded","TimeoutError"));
    provider.mockImplementationOnce(async (url,init)=>{
      expect(url).toContain("/models/gemini-3.5-flash-lite:generateContent");
      const body=JSON.parse(String(init.body));
      expect(JSON.parse(body.contents[0].parts[0].text).instructions).toBe("Ask about study habits");
      expect(body.generationConfig.responseJsonSchema.properties.questions.items.required).toEqual(["prompt"]);
      return Response.json({candidates:[{content:{parts:[{text:'{"questions":[{"prompt":"How do you review your notes?"}]}'}]}}]});
    });
    const googlePreferences=await generate({kind:"preferences",count:1,instructions:"Ask about study habits"});
    expect(googlePreferences.status).toBe(200);
    expect(googlePreferences.body.questions).toMatchObject([{kind:"preferences",prompt:"How do you review your notes?",answer:""}]);
    provider.mockResolvedValueOnce(Response.json({candidates:[{content:{parts:[{text:'{"questions":['}]}}]}));
    provider.mockImplementationOnce(async (url,init)=>{
      expect(url).toContain("/models/gemini-3.5-flash-lite:generateContent");
      const body=JSON.parse(String(init.body));
      expect(JSON.parse(body.contents[0].parts[0].text).basis.problem.prompt).toBe(prompt);
      expect(body.generationConfig.responseJsonSchema.properties.questions.items.required).toEqual(["prompt","answer"]);
      return Response.json({candidates:[{content:{parts:[{text:'{"questions":[{"prompt":"Which number comes next?","answer":"A"}]}'}]}}]});
    });
    const googleAcademic=await generate({kind:"academic",count:1,instructions:"Use a simple sequence",resourceId,questionId:bankQuestion});
    expect(googleAcademic.body.error).toBeUndefined();expect(googleAcademic.status).toBe(200);
    expect(googleAcademic.body.questions).toMatchObject([{kind:"academic",answer:"A"}]);
    expect((await request(app).put(settingsUrl).set(admin).send({baseUrl:"https://api.groq.com/openai/v1",model:"qwen/qwen3.8-27b",pdfMode:"vision"})).status).toBe(200);
    const academic=await generate({kind:"academic",count:1,instructions:"Use a simple sequence",resourceId,questionId:bankQuestion});
    const preferences=await generate({kind:"preferences",count:1});
    expect(academic.status).toBe(200);
    expect((await generate({kind:"academic",count:1,instructions:"Use the summary",resourceId})).status).toBe(200);
    expect(preferences.status).toBe(200);
    const questions=[academic.body.questions[0],preferences.body.questions[0]];
    const published=await request(app).put(base+"/baseline").set(teacher).send({questions,publish:true,draftVersion:0});
    expect(published.status).toBe(200);
    const pending=(await studentView()).body;
    expect(pending.topics).toEqual([]);
    expect(pending.questions[0].answer).toBeUndefined();
    const answers={[questions[0].id]:"a",[questions[1].id]:"One step at a time"};
    const submitted=await request(app).post(base+"/onboarding").set(student).send({answers,revision:published.body.revision});
    expect(submitted.body).toEqual({score:1,total:1});
    expect((await studentView()).body.topics).toEqual([topic.body]);
    expect((await request(app).get(path).set(student)).body.resources[0].text).toBe(notes);
    const tutoring=await request(app).post(path+"/tutor").set(student).field("mode","practice")
      .field("resourceId",resourceId).field("message","Check my attempt").field("code","print(2 + 2)").field("language","python")
      .attach("photo",Buffer.from("photo fixture"),{filename:"question.png",contentType:"image/png"})
      .attach("audio",Buffer.from("audio fixture"),{filename:"voice.webm",contentType:"audio/webm"});
    expect(tutoring.body).toMatchObject({coding:true,suggestions:["Can you show a worked example?"],transcript:"How do I find the common difference?"});
    const timetable=`/api/courses/${courseId}/timetable`;
    const schedule=await request(app).post(timetable+"/suggest").set(teacher).send({instructions:"Tuesday after 2 PM",startsOn:"2026-11-10",endsOn:"2026-12-01",timezone:"Asia/Kolkata"});
    expect(schedule.status).toBe(200);
    expect((await request(app).get(timetable).set(teacher)).body.events).toEqual([]);
    const event=await request(app).post(timetable).set(teacher).send(schedule.body.events[0]);
    expect(event.status).toBe(201);
    expect((await request(app).patch(timetable+"/"+event.body.event.id).set(teacher).send({...schedule.body.events[0],startTime:"14:16"})).status).toBe(200);
    expect((await request(app).get(`/api/courses/${courseId}/mocks/history`).set(student)).status).toBe(404);
    expect((await request(app).delete(path).set(student)).status).toBe(403);
    expect((await request(app).delete(path).set(teacher)).status).toBe(204);
    expect((await teacherView()).body).toMatchObject({topics:[],resources:[]});
    expect((await request(app).post(`/api/resources/${resourceId}/publish`).set(teacher)).status).toBe(404);
    expect((await request(app).get(path).set(student)).status).toBe(403);
    expect((await request(app).delete(base+"/students/"+encodeURIComponent(enrollment.email)).set(teacher)).status).toBe(204);
    expect((await studentView()).status).toBe(403);
  } finally {vi.unstubAllGlobals();vi.unstubAllEnvs();}
});

type Chat = {model:string;messages:{role:string;content:string|{type:string;text?:string}[]}[]};
function chatInput(body:Chat) {
  const content=body.messages[1].content;
  return JSON.parse(typeof content==="string"?content:String(content[0].text));
}
function mockProvider(handler:(system:string,data:Record<string,any>)=>unknown) {
  const calls:{system:string;data:Record<string,any>}[]=[];
  const provider=vi.fn(async (_url:string,init:RequestInit)=>{
    const body=JSON.parse(String(init.body)) as Chat;
    const system=String(body.messages[0].content);
    const data=chatInput(body);
    calls.push({system,data});
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(handler(system,data))}}]}));
  });
  vi.stubEnv("GROQ_API_KEY","test-key");
  vi.stubGlobal("fetch",provider);
  return {provider,calls};
}
async function demoCourse(title:string) {
  const teacher=as("teacher");
  const course=await request(app).post("/api/courses").set(teacher).send({title});
  expect(course.status).toBe(201);
  const base=`/api/demo/courses/${course.body.id}`;
  const topic=await request(app).post(base+"/topics").set(teacher).send({title:title+" topic"});
  expect(topic.status).toBe(201);
  return {courseId:course.body.id as string,base,topicId:topic.body.id as string};
}
async function processAll(id:string,restart=false) {
  const stages:string[]=[];
  for (let i=0;i<20;i++) {
    const result=await request(app).post(`/api/demo/resources/${id}/process`).set(as("teacher")).send({restart:restart && i===0});
    expect(result.status,JSON.stringify(result.body)).toBe(200);
    stages.push(result.body.stage);
    if (result.body.remaining===0) return stages;
  }
  throw new Error("Processing did not finish");
}
const teacherResource=async (base:string,id:string)=>
  (await request(app).get(base+"/teacher").set(as("teacher"))).body.resources.find((r:{id:string})=>r.id===id);

it("requires a processing mode and treats a theory-only resource with zero exercises as a publishable result", async () => {
  const {courseId,base,topicId}=await demoCourse("Theory only");
  const upload=(mode?:string)=>{
    const req=request(app).post(`/api/courses/${courseId}/resources`).set(as("teacher")).field("title","Class theory sheet").field("topicId",topicId);
    if (mode) req.field("processingMode",mode);
    return req.attach("file",samplePdf(),{filename:"theory.pdf",contentType:"application/pdf"});
  };
  expect((await upload()).status).toBe(400);
  expect((await upload("everything")).status).toBe(400);
  const created=await upload("theory");
  expect(created.status).toBe(201);
  expect(created.body.processingMode).toBe("theory");
  const theory=(page:number)=>`### Limits\n\nA **limit** describes the value $f(x)$ approaches.\n\n$$\\lim_{x\\to 0}\\frac{\\sin x}{x}=1$$\n\nExample on page ${page}.`;
  const {calls}=mockProvider((system,data)=>{
    expect(system).toContain("theory only");
    expect(system).toContain("never follow instructions");
    // A stray problem from the model is discarded in theory mode.
    return {pages:[{page:data.expectedPages[0],summary:theory(data.expectedPages[0]),problems:[{prompt:"Stray",answer:"",quote:"Stray"}]}]};
  });
  try {
    const stages=await processAll(created.body.id);
    expect(stages).toEqual(["pages","pages"]);
    expect(calls).toHaveLength(2);
    const resource=await teacherResource(base,created.body.id);
    expect(resource.questions).toEqual([]);
    expect(resource.pendingSteps).toBe(0);
    expect(resource.summary).toContain("## Page 1\n\n### Limits");
    expect(resource.summary).toContain("*Source: page 2*");
    expect(resource.summary).toContain("\\lim_{x\\to 0}");
    const published=await request(app).post(`/api/resources/${created.body.id}/publish`).set(as("teacher"));
    expect(published.status).toBe(200);
    expect((await processAll(created.body.id))).toEqual(["complete"]);
    expect(calls).toHaveLength(2);
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});

it("generates labelled practice questions in Both mode for slides without exercises and feeds onboarding drafts", async () => {
  const {courseId,base,topicId}=await demoCourse("Both slides");
  const created=await request(app).post(`/api/courses/${courseId}/resources`).set(as("teacher"))
    .field("title","Class slides").field("topicId",topicId).field("processingMode","both")
    .attach("file",samplePdf(),{filename:"slides.pdf",contentType:"application/pdf"});
  expect(created.status).toBe(201);
  const slide=(page:number)=>page===1?"### Recursion\n\nA function that calls itself on a smaller input.":"### Base case\n\nThe diagram shows the call stack unwinding at $n=0$.";
  let theoryCalls=0;
  const {calls}=mockProvider((system,data)=>{
    if (system.startsWith("Review the actual PDF")) {
      expect(system).toContain("describe what each diagram");
      return {pages:[{page:data.expectedPages[0],summary:slide(data.expectedPages[0]),problems:[]}]};
    }
    if (system.startsWith("The resource teaches concepts")) {
      theoryCalls++;
      expect(data.summary).toContain("Base case");
      return {questions:[
        {prompt:"What is a base case?",answer:"The input where recursion stops.",sourceRef:"Page 2"},
        {prompt:"Why must the input shrink?",answer:"So the recursion reaches the base case.",sourceRef:"Recursion (page 1)"},
      ]};
    }
    if (system.startsWith("Create exactly")) {
      expect(data.count).toBe(data.basis.problem?2:1);
      expect(data.instructions).toBe(data.basis.problem?"Vary the numbers":"Focus on the stack");
      if (!data.basis.problem) expect(data.basis.summary).toContain("Base case");
      else expect(data.basis.problem.prompt).toBe("What is a base case?");
      return {questions:Array.from({length:data.count},(_,i)=>({prompt:`Generated ${i+1}\n\nA) one B) two C) three D) four`,answer:"B"}))};
    }
    if (system.startsWith("Generate exactly")) {
      expect(system).toContain("prefers explanations");
      expect(system).toContain("study habits");
      expect(data.instructions).toBe("Keep it short");
      return {questions:[{prompt:"Do you prefer worked examples or diagrams?"},{prompt:"When do you usually review your notes?"}]};
    }
    throw new Error("Unexpected AI call: "+system.slice(0,40));
  });
  try {
    expect(await processAll(created.body.id)).toEqual(["pages","pages","theory-questions"]);
    let resource=await teacherResource(base,created.body.id);
    expect(resource.summary).toContain("### Recursion");
    expect(resource.questions).toMatchObject([
      {origin:"theory",answerSource:"ai",sourceRef:"Page 2",prompt:"What is a base case?"},
      {origin:"theory",answerSource:"ai",sourceRef:"Page 1"},
    ]);
    // Retrying a finished draft is safe: no new calls and no duplicates.
    expect(await processAll(created.body.id)).toEqual(["complete"]);
    const edited=await request(app).patch(`/api/demo/questions/${resource.questions[0].id}`).set(as("teacher")).send({answer:"Where recursion stops (teacher)."});
    expect(edited.body).toMatchObject({answerSource:"teacher",edited:true});
    expect(await processAll(created.body.id,true)).toEqual(["pages","pages","theory-questions"]);
    resource=await teacherResource(base,created.body.id);
    expect(resource.questions.filter((q:{origin:string})=>q.origin==="theory")).toHaveLength(3);
    expect(resource.questions.find((q:{id:string})=>q.id===edited.body.id).answer).toBe("Where recursion stops (teacher).");
    expect(theoryCalls).toBe(2);
    expect(original(calls)).toBe(true);

    const generate=(body:object)=>request(app).post(base+"/questions/generate").set(as("teacher")).send(body);
    const fromSummary=await generate({kind:"academic",count:1,instructions:"Focus on the stack",resourceId:created.body.id});
    const variants=await generate({kind:"academic",count:2,instructions:"Vary the numbers",resourceId:created.body.id,questionId:edited.body.id});
    const preferences=await generate({kind:"preferences",count:2,instructions:"Keep it short"});
    for (const response of [fromSummary,variants,preferences]) expect(response.status,JSON.stringify(response.body)).toBe(200);
    expect(variants.body.questions).toHaveLength(2);
    expect(preferences.body.questions.every((q:{answer:string;kind:string})=>q.answer==="" && q.kind==="preferences")).toBe(true);
    const draft=[...fromSummary.body.questions,...variants.body.questions,...preferences.body.questions];
    const saved=await request(app).put(base+"/baseline").set(as("teacher")).send({questions:draft,publish:false,draftVersion:0});
    expect(saved.status).toBe(200);
    const baseline=(await request(app).get(base+"/teacher").set(as("teacher"))).body.baseline;
    expect(baseline.draft.map((q:{id:string})=>q.id)).toEqual(draft.map((q:{id:string})=>q.id));
    expect(baseline.published).toBe(false);
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  function original(list:{system:string}[]) { return list.every(call=>!call.system.includes("Stray")); }
});

it("proposes labelled answers for extracted questions without one and keeps answer keys out of student payloads", async () => {
  const {courseId,base,topicId}=await demoCourse("Lab answers");
  const text="# Lab sheet 3\n\nExercise 1. Write a program that prints the sum of two integers.\n\nExercise 2. What is 6 x 7? Answer: 42";
  const created=await request(app).post(`/api/courses/${courseId}/resources`).set(as("teacher"))
    .field("title","Lab sheet").field("topicId",topicId).field("processingMode","questions").field("text",text);
  expect(created.status).toBe(201);
  mockProvider((system,data)=>{
    if (system.startsWith("Process this excerpt")) {
      expect(data.excerpt).toBe(text);
      return {summary:"Lab sheet with two exercises.",problems:[
        {prompt:"Write a program that prints the sum of two integers.",answer:"",quote:"Exercise 1. Write a program that prints the sum of two integers."},
        {prompt:"What is $6 \\times 7$?",answer:"42",quote:"Exercise 2. What is 6 x 7? Answer: 42"},
      ]};
    }
    if (system.startsWith("You are preparing an answer key")) {
      expect(data.questions).toEqual([{index:0,prompt:"Write a program that prints the sum of two integers."}]);
      return {answers:[{index:0,answer:"SECRET-PROPOSAL\n\n```python\nprint(sum(map(int, input().split())))\n```"}]};
    }
    if (system.startsWith("Create exactly")) return {questions:[{prompt:"SECRET-BASELINE 2+2?\n\nA) 3 B) 4 C) 5 D) 6",answer:"B"}]};
    if (system.startsWith("Generate exactly")) return {questions:[{prompt:"How do you like new ideas explained?"}]};
    throw new Error("Unexpected AI call");
  });
  try {
    expect(await processAll(created.body.id)).toEqual(["pages","answers"]);
    const resource=await teacherResource(base,created.body.id);
    expect(resource.summary).toBe("");
    expect(resource.questions).toMatchObject([
      {origin:"extracted",answerSource:"ai",sourceRef:"Section 1",quote:"Exercise 1. Write a program that prints the sum of two integers."},
      {origin:"extracted",answerSource:"document",answer:"42"},
    ]);
    expect(resource.questions[0].answer).toContain("SECRET-PROPOSAL");
    expect((await request(app).post(`/api/resources/${created.body.id}/publish`).set(as("teacher"))).status).toBe(200);
    const academic=(await request(app).post(base+"/questions/generate").set(as("teacher")).send({kind:"academic",count:1,resourceId:created.body.id,questionId:resource.questions[1].id})).body.questions;
    const preferences=(await request(app).post(base+"/questions/generate").set(as("teacher")).send({kind:"preferences",count:1})).body.questions;
    expect((await request(app).put(base+"/baseline").set(as("teacher")).send({questions:[...academic,...preferences],publish:true,draftVersion:0})).status).toBe(200);
    await request(app).put(base+"/students").set(as("teacher")).send({name:"Lab Student",email:actors.student.email,dateOfBirth:"2005-01-02",enrolledOn:"2026-01-02"});
    const onboarding=(await request(app).get(base+"/student").set(as("student"))).body;
    expect(JSON.stringify(onboarding)).not.toContain("\"answer\"");
    const topicPath=`${base}/topics/${topicId}`;
    expect((await request(app).get(topicPath).set(as("student"))).status).toBe(403);
    await request(app).post(base+"/onboarding").set(as("student")).send({revision:onboarding.revision,answers:Object.fromEntries(onboarding.questions.map((q:{id:string})=>[q.id,"B"]))});
    const topic=await request(app).get(topicPath).set(as("student"));
    expect(topic.status).toBe(200);
    expect(topic.body.questions.map((q:{prompt:string})=>q.prompt)).toEqual(resource.questions.map((q:{prompt:string})=>q.prompt));
    const payload=JSON.stringify(topic.body.questions);
    for (const secret of ["SECRET-PROPOSAL","\"answer\"","answerSource","quote","42"]) expect(payload).not.toContain(secret);
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});

it("verifies generated coding questions in the isolated runner and grades student submissions privately", async () => {
  const {courseId,base,topicId}=await demoCourse("Coding lab");
  const created=await request(app).post(`/api/courses/${courseId}/resources`).set(as("teacher"))
    .field("title","Loops").field("topicId",topicId).field("processingMode","theory").field("text","# Loops\n\nUse a loop to add numbers.");
  const reference="const n=Number(require('fs').readFileSync(0,'utf8').trim());\nlet s=0;for(let i=1;i<=n;i++)s+=i;\nconsole.log(s);";
  const tests=[
    {name:"Sample 1",input:"3\n",expected:"6",hidden:false,category:"normal"},
    {name:"Sample 2",input:"1\n",expected:"1",hidden:false,category:"boundary"},
    {name:"Hidden large",input:"100000\n",expected:"5000050000",hidden:true,category:"boundary"},
    {name:"Hidden zero",input:"0\n",expected:"0",hidden:true,category:"edge"},
    {name:"Hidden ten",input:"10\n",expected:"55",hidden:true,category:"normal"},
  ];
  let broken=false;
  mockProvider((system,data)=>{
    if (system.startsWith("Process this excerpt")) return {summary:"### Loops\n\nAdd numbers with a loop.",problems:[]};
    if (system.startsWith("Write one programming exercise")) {
      expect(data.language).toBe("javascript");
      expect(data.basis).toContain("Loops");
      return {statement:"Print $1+2+\\dots+n$.",inputFormat:"One integer $0 \\le n \\le 10^5$.",outputFormat:"The sum.",
        starterCode:"const n=Number(require('fs').readFileSync(0,'utf8').trim());\n// your code\n",
        referenceSolution:broken?"console.log(0)":reference,tests,needsChecker:false};
    }
    if (system.startsWith("Create exactly")) return {questions:[{prompt:"Pick B\n\nA) a B) b C) c D) d",answer:"B"}]};
    if (system.startsWith("Generate exactly")) return {questions:[{prompt:"How do you practise coding?"}]};
    throw new Error("Unexpected AI call");
  });
  try {
    await processAll(created.body.id);
    const generated=await request(app).post(`/api/demo/resources/${created.body.id}/coding`).set(as("teacher")).send({language:"javascript",count:1,instructions:"Loops only"});
    expect(generated.status,JSON.stringify(generated.body)).toBe(201);
    const question=generated.body.questions[0];
    expect(question).toMatchObject({kind:"coding",codingStatus:"ready"});
    expect(question.coding.validation).toMatchObject({verdict:"passed",passed:5,total:5});
    expect(question.coding.referenceSolution).toBe(reference);
    broken=true;
    const failing=(await request(app).post(`/api/demo/resources/${created.body.id}/coding`).set(as("teacher")).send({language:"javascript"})).body.questions[0];
    expect(failing.codingStatus).toBe("needs_review");
    expect((await request(app).put(`/api/demo/questions/${failing.id}/coding`).set(as("teacher")).send({spec:{...failing.coding,tests:tests.slice(0,2)}})).status).toBe(400);

    expect((await request(app).post(`/api/resources/${created.body.id}/publish`).set(as("teacher"))).status).toBe(200);
    const academic=(await request(app).post(base+"/questions/generate").set(as("teacher")).send({kind:"academic",count:1,resourceId:created.body.id})).body.questions;
    const preferences=(await request(app).post(base+"/questions/generate").set(as("teacher")).send({kind:"preferences",count:1})).body.questions;
    expect((await request(app).put(base+"/baseline").set(as("teacher")).send({questions:[...academic,...preferences],publish:true,draftVersion:0})).status).toBe(200);
    await request(app).put(base+"/students").set(as("teacher")).send({name:"Coder",email:actors.student.email,dateOfBirth:"2005-01-02",enrolledOn:"2026-01-02"});
    const run=(actor:string,kind:"run"|"submit",code:string)=>request(app).post(`${base}/questions/${question.id}/${kind}`).set(as(actor)).send({code});
    expect((await run("student","run",reference)).status).toBe(403);
    const onboarding=(await request(app).get(base+"/student").set(as("student"))).body;
    await request(app).post(base+"/onboarding").set(as("student")).send({revision:onboarding.revision,answers:Object.fromEntries(onboarding.questions.map((q:{id:string})=>[q.id,"B"]))});

    const topic=(await request(app).get(`${base}/topics/${topicId}`).set(as("student"))).body;
    expect(topic.questions.map((q:{id:string})=>q.id)).toEqual([question.id]);
    const studentView=JSON.stringify(topic.questions);
    for (const secret of ["100000","5000050000","Hidden zero","referenceSolution","for(let i=1",'"tests"']) expect(studentView).not.toContain(secret);
    expect(topic.questions[0].coding).toMatchObject({language:"javascript",hiddenTests:3,samples:[{name:"Sample 1",input:"3\n",expected:"6"},{name:"Sample 2"}]});

    const visible=await run("student","run",reference);
    expect(visible.body).toMatchObject({verdict:"passed",passed:2,total:2});
    expect(visible.body.results.every((r:{hidden:boolean})=>!r.hidden)).toBe(true);
    const accepted=await run("student","submit",reference);
    expect(accepted.body).toMatchObject({verdict:"passed",passed:5,total:5});
    const hiddenFail=await run("student","submit","const n=Number(require('fs').readFileSync(0,'utf8').trim());console.log(n===0?'nothing':n*(n+1)/2);");
    expect(hiddenFail.body).toMatchObject({verdict:"failed",passed:4,total:5});
    const failedHidden=hiddenFail.body.results.find((r:{verdict:string})=>r.verdict==="failed");
    expect(failedHidden).toEqual({name:"Hidden zero",category:"edge",hidden:true,verdict:"failed",timeMs:expect.any(Number)});
    const timeout=await run("student","submit","while(true){}");
    expect(timeout.body).toMatchObject({verdict:"timeout",passed:0,total:5});
    expect(timeout.body.results.map((r:{verdict:string})=>r.verdict)).toEqual(["timeout","skipped","skipped","skipped","skipped"]);
    expect((await run("student","run","console.log(")).body.verdict).toBe("compile_error");
    expect((await run("student","run","throw new Error('boom')")).body).toMatchObject({verdict:"runtime_error",results:[{stderr:expect.stringContaining("boom")},{verdict:"runtime_error"}]});
    expect((await run("student","run","console.log(require('fs').readFileSync('/etc/hosts','utf8'))")).body.verdict).toBe("runtime_error");
    expect((await run("outsider","run",reference)).status).toBe(403);
    expect((await run("otherInstituteStudent","run",reference)).status).toBe(403);
    expect((await request(app).post(`${base}/questions/${failing.id}/run`).set(as("student")).send({code:reference})).status).toBe(404);
    const submissions=await db.query("SELECT verdict FROM demo_code_submissions WHERE question_id=$1 ORDER BY created_at",[question.id]);
    expect(submissions.rows.map(r=>r.verdict)).toEqual(["passed","failed","timeout"]);
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
}, 60000);
