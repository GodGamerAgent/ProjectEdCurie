import { afterAll, beforeAll, expect, it, vi } from "vitest";
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
    .field("title","Lab sheet").field("topicId",topic.body.id).attach("file",original,{filename:"notes.pdf",contentType:"application/pdf"});
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
        {page:1,summary,problems:[{prompt,answer:"",quote:excerpt}]},
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
        {page:1,summary,problems:[{prompt,answer:"",quote:excerpt}]},
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
    const academic=await generate({kind:"academic",count:1,instructions:"Use a simple sequence",resourceId,partIndex:0,problemIndex:0});
    const preferences=await generate({kind:"preferences",count:1});
    expect(academic.status).toBe(200);
    expect((await generate({kind:"academic",count:1,instructions:"Use the summary",resourceId,partIndex:0})).status).toBe(200);
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
