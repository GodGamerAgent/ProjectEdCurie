import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
let courseId: string;
let resourceId: string;
let assessmentId: string;
let instituteId: string;
let otherInstituteId: string;

function samplePdf() {
  const stream = "BT /F1 12 Tf 72 720 Td (Test lesson from page one.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
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

describe("foundation access and onboarding", () => {
  it("creates a teacher-assigned course and enrolls only the intended student", async () => {
    expect((await request(app).get("/api/admin/ai/status").set(as("admin"))).body.model).toBe("qwen/qwen3.8-27b");
    expect((await request(app).get("/api/admin/ai/status").set(as("student"))).status).toBe(403);
    const newStudent = await provisionVerifiedIdentity(db, "prospective", "prospective@example.edu", true, "admin@personal.example");
    expect(newStudent.role).toBe("student");
    expect((await request(app).post(`/api/admin/institutes/${instituteId}/invitations`).set(as("admin")).send({ email: "prospective@example.edu" })).status).toBe(201);
    expect((await provisionVerifiedIdentity(db, "prospective", "prospective@example.edu", true, "admin@personal.example")).role).toBe("teacher");
    expect((await request(app).post(`/api/admin/institutes/${instituteId}/domains`).set(as("student")).send({ domain: "third.edu" })).status).toBe(403);
    const course = await request(app).post("/api/courses").set(as("teacher")).send({ title: "Test course", description: "" });
    expect(course.status).toBe(201);
    courseId = course.body.id;
    expect((await request(app).post(`/api/courses/${courseId}/enrollments`).set(as("teacher")).send({ email: actors.student.email })).status).toBe(201);
    expect((await request(app).get(`/api/courses/${courseId}/onboarding`).set(as("outsider"))).status).toBe(403);
    expect((await request(app).get(`/api/courses/${courseId}`).set(as("otherTeacher"))).status).toBe(403);
  });
  it("requires explicit institute assignment for a legacy teacher", async () => {
    await db.query("INSERT INTO users (provider_id,email,role) VALUES ('legacy-teacher','legacy@example.edu','teacher')");
    await db.query("INSERT INTO teacher_invitations (email,invited_by) VALUES ('legacy@example.edu',$1)", [actors.admin.id]);
    await expect(provisionVerifiedIdentity(db, "legacy-teacher", "legacy@example.edu", true, "admin@personal.example")).rejects.toThrow("not assigned to this institute");
    expect((await request(app).post(`/api/admin/institutes/${instituteId}/invitations`).set(as("admin")).send({ email: "legacy@example.edu" })).status).toBe(201);
    const teacher = await provisionVerifiedIdentity(db, "legacy-teacher", "legacy@example.edu", true, "admin@personal.example");
    expect(teacher.role).toBe("teacher");
    expect(teacher.instituteId).toBe(instituteId);
  });
  it("blocks the no-resource and draft-resource states on both UI API and assessment API", async () => {
    const empty = await request(app).get(`/api/courses/${courseId}/onboarding`).set(as("student"));
    expect(empty.body).toEqual({ state: "no_resource", message: "Boarding is not possible as your institute haven't added any resource to question you from." });
    expect((await request(app).post(`/api/courses/${courseId}/assessment/start`).set(as("student"))).status).toBe(403);
    const resource = await request(app).post(`/api/courses/${courseId}/resources`).set(as("teacher"))
      .field("title", "Notes").attach("file", Buffer.from("Real study material for test."), { filename: "notes.txt", contentType: "text/plain" });
    expect(resource.status).toBe(201);
    resourceId = resource.body.id;
    expect((await request(app).get(`/api/courses/${courseId}/onboarding`).set(as("student"))).body.state).toBe("no_resource");
    expect((await request(app).get(`/api/resources/${resourceId}/file`).set(as("student"))).status).toBe(404);
    expect((await request(app).get(`/api/resources/${resourceId}/file`).set(as("outsider"))).status).toBe(403);
    expect((await request(app).get(`/api/resources/${resourceId}/file`).set(as("otherTeacher"))).status).toBe(403);
    expect((await request(app).get(`/api/resources/${resourceId}/file`).set(as("teacher"))).status).toBe(200);
    const pref = await request(app).put("/api/preferences").set(as("student")).send({ availability: "Evenings", feedback: "Direct", hints: "On request", formats: ["worked examples"] });
    expect(pref.status).toBe(200);
  });
  it("requires published material and a published baseline with a valid linked question", async () => {
    expect((await request(app).post(`/api/resources/${resourceId}/publish`).set(as("teacher"))).status).toBe(200);
    const gate = await request(app).get(`/api/courses/${courseId}/onboarding`).set(as("student"));
    expect(gate.body).toEqual({ state: "no_baseline", message: "Your institute is preparing the baseline assessment" });
    expect((await request(app).post(`/api/courses/${courseId}/assessment/start`).set(as("student"))).status).toBe(403);
    const assessment = await request(app).post(`/api/courses/${courseId}/assessments`).set(as("teacher")).send({ title: "Baseline" });
    assessmentId = assessment.body.id;
    expect((await request(app).post(`/api/assessments/${assessmentId}/publish`).set(as("teacher"))).status).toBe(400);
    const question = await request(app).post(`/api/assessments/${assessmentId}/questions`).set(as("teacher")).send({ prompt: "What is the concept?", answer: "An answer", resourceId });
    expect(question.status).toBe(201);
    expect((await request(app).get(`/api/courses/${courseId}/onboarding`).set(as("student"))).body.state).toBe("no_baseline");
    expect((await request(app).post(`/api/assessments/${assessmentId}/publish`).set(as("teacher"))).status).toBe(200);
  });
  it("opens only for the enrolled student and never exposes answer keys", async () => {
    expect((await request(app).get(`/api/courses/${courseId}/onboarding`).set(as("student"))).body.state).toBe("ready");
    expect((await request(app).get(`/api/courses/${courseId}/onboarding`).set(as("outsider"))).status).toBe(403);
    expect((await request(app).post(`/api/courses/${courseId}/assessment/start`).set(as("outsider"))).status).toBe(403);
    expect((await request(app).get(`/api/resources/${resourceId}/file`).set(as("student"))).status).toBe(200);
    const excerpt=await request(app).get(`/api/resources/${resourceId}/excerpt?location=Section%201`).set(as("student"));
    expect(excerpt.status).toBe(200);expect(excerpt.body.text).toContain("Real study material");
    const start = await request(app).post(`/api/courses/${courseId}/assessment/start`).set(as("student"));
    expect(start.status).toBe(200);
    expect(start.body.questions).toHaveLength(1);
    expect(start.body.questions[0].answer).toBeUndefined();
    expect((await request(app).put(`/api/assessment-sessions/${start.body.sessionId}/answers`).set(as("student")).send({answers:{[start.body.questions[0].id]:"My answer"}})).status).toBe(200);
    const resumed=await request(app).post(`/api/courses/${courseId}/assessment/start`).set(as("student"));
    expect(resumed.body.sessionId).toBe(start.body.sessionId);
    expect(resumed.body.answers[start.body.questions[0].id]).toBe("My answer");
    const submit = await request(app).post(`/api/courses/${courseId}/assessment/submit`).set(as("student")).send({ sessionId:start.body.sessionId,answers: { [start.body.questions[0].id]: "My answer" } });
    expect(submit.status).toBe(201);
    expect((await request(app).post(`/api/courses/${courseId}/assessment/submit`).set(as("student")).send({sessionId:start.body.sessionId,answers:{[start.body.questions[0].id]:"Different"}})).body.score).toBe(submit.body.score);
    expect((await db.query("SELECT count(*) FROM baseline_submissions WHERE assessment_id=$1 AND user_id=$2",[assessmentId,actors.student.id])).rows[0].count).toBe("1");
  });
  it("isolates institute branding, domains, invitations, courses and files", async () => {
    expect((await request(app).get("/api/me").set(as("admin"))).body.institute).toBeNull();
    expect((await request(app).get("/api/me").set(as("student"))).body.institute.displayName).toBe("Institute A");
    expect((await request(app).get("/api/me").set(as("otherInstituteStudent"))).body.institute.displayName).toBe("Institute B");
    expect((await request(app).post(`/api/admin/institutes/${otherInstituteId}/domains`).set(as("admin")).send({ domain: "example.edu" })).status).toBe(409);
    expect((await request(app).post(`/api/admin/institutes/${otherInstituteId}/invitations`).set(as("admin")).send({ email: "teacher@example.edu" })).status).toBe(400);
    const logo = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1kAAAAASUVORK5CYII=", "base64");
    expect((await request(app).post(`/api/admin/institutes/${instituteId}/logo`).set(as("admin")).attach("logo", logo, { filename: "logo.png", contentType: "image/png" })).status).toBe(200);
    expect((await request(app).get("/api/institute/logo").set(as("student"))).status).toBe(200);
    expect((await request(app).get("/api/institute/logo").set(as("otherInstituteStudent"))).status).toBe(404);
    expect((await request(app).get("/api/institute/logo").set(as("admin"))).status).toBe(404);
    expect((await request(app).get(`/api/admin/institutes/${instituteId}/logo`).set(as("student"))).status).toBe(403);
    expect((await request(app).get("/api/institute/logo")).status).toBe(401);
    // Even corrupted cross-institute enrollment and assignment rows grant no access.
    await db.query("INSERT INTO enrollments (course_id,email) VALUES ($1,$2)", [courseId, actors.otherInstituteStudent.email]);
    await db.query("INSERT INTO course_teachers (course_id,user_id) VALUES ($1,$2)", [courseId, actors.otherInstituteTeacher.id]);
    for (const actor of ["otherInstituteStudent", "otherInstituteTeacher"]) {
      expect((await request(app).get("/api/courses").set(as(actor))).body.courses).toEqual([]);
      expect((await request(app).get(`/api/courses/${courseId}`).set(as(actor))).status).toBe(403);
      expect((await request(app).get(`/api/courses/${courseId}/onboarding`).set(as(actor))).status).toBe(403);
      expect((await request(app).get(`/api/resources/${resourceId}/file`).set(as(actor))).status).toBe(403);
    }
  });
  it("rechecks source publication and rejects cross-course sources", async () => {
    const second = await request(app).post("/api/courses").set(as("teacher")).send({ title: "Second course" });
    const other = await request(app).post(`/api/courses/${second.body.id}/resources`).set(as("teacher")).field("title", "Other").field("text", "Other course material.");
    expect((await request(app).post(`/api/resources/${other.body.id}/publish`).set(as("teacher"))).status).toBe(200);
    expect((await request(app).post(`/api/assessments/${assessmentId}/questions`).set(as("teacher")).send({ prompt: "Question", answer: "Answer", resourceId: other.body.id })).status).toBe(400);
    const extra = await request(app).post(`/api/courses/${courseId}/resources`).set(as("teacher")).field("title", "Second resource").field("text", "Usable material.");
    expect((await request(app).post(`/api/resources/${extra.body.id}/publish`).set(as("teacher"))).status).toBe(200);
    expect((await request(app).patch(`/api/resources/${resourceId}`).set(as("teacher")).send({ title: "Notes", text: "Updated content" })).status).toBe(200);
    expect((await request(app).get(`/api/courses/${courseId}/onboarding`).set(as("student"))).body.state).toBe("no_baseline");
    expect((await request(app).post(`/api/courses/${courseId}/assessment/start`).set(as("student"))).status).toBe(403);
    // Simulate corrupt or legacy records directly in the disposable DB: the gate
    // must remain closed even when a published assessment bypasses authoring checks.
    await db.query("UPDATE questions SET resource_id=$1 WHERE assessment_id=$2", [other.body.id, assessmentId]);
    expect((await request(app).get(`/api/courses/${courseId}/onboarding`).set(as("student"))).body.state).toBe("no_baseline");
    await db.query("UPDATE questions SET resource_id=$1,prompt=' ' WHERE assessment_id=$2", [extra.body.id, assessmentId]);
    expect((await request(app).get(`/api/courses/${courseId}/onboarding`).set(as("student"))).body.state).toBe("no_baseline");
    await db.query("UPDATE questions SET prompt='A valid question',answer=' ' WHERE assessment_id=$1", [assessmentId]);
    expect((await request(app).get(`/api/courses/${courseId}/onboarding`).set(as("student"))).body.state).toBe("no_baseline");
    await db.query("UPDATE questions SET answer='A valid answer' WHERE assessment_id=$1", [assessmentId]);
    expect((await request(app).get(`/api/courses/${courseId}/onboarding`).set(as("student"))).body.state).toBe("ready");
  });
  it("extracts PDF pages and permits manual recovery from a failed extraction", async () => {
    const pdf = await request(app).post(`/api/courses/${courseId}/resources`).set(as("teacher"))
      .field("title", "PDF notes").attach("file", samplePdf(), { filename: "notes.pdf", contentType: "application/pdf" });
    expect(pdf.status).toBe(201);
    expect(pdf.body.extractionStatus).toBe("complete");
    expect(pdf.body.text).toContain("[Page 1]");
    expect(pdf.body.text).toContain("Test lesson from page one.");
    const broken = await request(app).post(`/api/courses/${courseId}/resources`).set(as("teacher"))
      .field("title", "Unextractable PDF").attach("file", Buffer.from("%PDF-broken"), { filename: "broken.pdf", contentType: "application/pdf" });
    expect(broken.status).toBe(201);
    expect(broken.body.extractionStatus).toBe("error");
    expect((await request(app).post(`/api/resources/${broken.body.id}/publish`).set(as("teacher"))).status).toBe(400);
    expect((await request(app).patch(`/api/resources/${broken.body.id}`).set(as("teacher")).send({ title: "Unextractable PDF", text: "Manual section: teacher supplied text." })).status).toBe(200);
    expect((await request(app).post(`/api/resources/${broken.body.id}/publish`).set(as("teacher"))).status).toBe(200);
  });
  it("runs the isolated study loop with source validation and institute isolation", async () => {
    const course = await request(app).post("/api/courses").set(as("teacher")).send({title:"Study loop"});
    const id = course.body.id;
    expect((await request(app).post(`/api/courses/${id}/enrollments`).set(as("teacher")).send({email:actors.student.email})).status).toBe(201);
    const resource = await request(app).post(`/api/courses/${id}/resources`).set(as("teacher")).field("title","Material").field("text","[Page 1]\nA course-specific explanation.");
    expect((await request(app).post(`/api/resources/${resource.body.id}/publish`).set(as("teacher"))).status).toBe(200);
    const makeConcept = async (name:string) => request(app).post(`/api/courses/${id}/concepts`).set(as("teacher")).send({name,resourceId:resource.body.id});
    const a = await makeConcept("First"); const b = await makeConcept("Second"); const unassessed = await makeConcept("Unassessed");
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    expect((await request(app).post(`/api/concepts/${b.body.id}/prerequisites`).set(as("teacher")).send({prerequisiteId:a.body.id})).status).toBe(201);
    expect((await request(app).post(`/api/concepts/${a.body.id}/prerequisites`).set(as("teacher")).send({prerequisiteId:b.body.id})).status).toBe(400);
    expect((await request(app).post(`/api/courses/${id}/concepts`).set(as("otherInstituteTeacher")).send({name:"Forbidden",resourceId:resource.body.id})).status).toBe(403);
    const assessment = await request(app).post(`/api/courses/${id}/assessments`).set(as("teacher")).send({title:"Objective baseline"});
    const addQuestion = async (conceptId:string, answer:string) => request(app).post(`/api/assessments/${assessment.body.id}/questions`).set(as("teacher")).send({prompt:"What is the value?",answer,resourceId:resource.body.id,conceptId});
    const qa=await addQuestion(a.body.id,"alpha"); const qb=await addQuestion(b.body.id,"beta");
    expect((await request(app).post(`/api/assessments/${assessment.body.id}/publish`).set(as("teacher"))).status).toBe(200);
    const addProblem = async (conceptId:string,questionId:string,prompt="Twin question?") => request(app).post(`/api/concepts/${conceptId}/problems`).set(as("teacher")).send({questionId,prompt,answer:"solution",hints:["First hint","Second hint","Third hint"]});
    expect((await addProblem(a.body.id,qa.body.id)).status).toBe(201);
    expect((await addProblem(b.body.id,qb.body.id)).status).toBe(201);
    expect((await addProblem(b.body.id,qb.body.id,"Second independent variation?")).status).toBe(201);
    expect((await addProblem(b.body.id,qb.body.id,"Third independent variation?")).status).toBe(201);
    expect((await request(app).post(`/api/concepts/${b.body.id}/practice`).set(as("student"))).status).toBe(403);
    expect((await request(app).post(`/api/concepts/${b.body.id}/lesson`).set(as("otherInstituteStudent"))).status).toBe(403);
    const baselineStart=await request(app).post(`/api/courses/${id}/assessment/start`).set(as("student"));
    const baseline=await request(app).post(`/api/courses/${id}/assessment/submit`).set(as("student")).send({sessionId:baselineStart.body.sessionId,answers:{[qa.body.id]:" ALPHA ",[qb.body.id]:"wrong"}});
    expect(baseline.status).toBe(201); expect(baseline.body.score).toBe(1); expect(baseline.body.total).toBe(2);
    expect((await request(app).get(`/api/courses/${id}/mastery`).set(as("student"))).body.concepts.find((x:any)=>x.id===unassessed.body.id).status).toBe("Not assessed");
    expect((await request(app).put(`/api/courses/${id}/goal`).set(as("student")).send({goal:"Understand",deadline:"2027-01-01",availability:"Evenings"})).status).toBe(200);
    expect((await request(app).get(`/api/courses/${id}/goal`).set(as("otherInstituteStudent"))).status).toBe(403);
    const practice=await request(app).post(`/api/concepts/${b.body.id}/practice`).set(as("student"));
    expect(practice.status).toBe(201); expect(practice.body.answer).toBeUndefined();
    for (let i=1;i<=3;i++) expect((await request(app).post(`/api/practice/${practice.body.sessionId}/hint`).set(as("student"))).body.number).toBe(i);
    expect((await request(app).post(`/api/practice/${practice.body.sessionId}/hint`).set(as("student"))).status).toBe(400);
    const wrong=await request(app).post(`/api/practice/${practice.body.sessionId}/answer`).set(as("student")).send({answer:"incorrect"});
    expect(wrong.body.assisted).toBe(true); expect(wrong.body.diagnostic).toBeTruthy();expect(wrong.body.walkthrough).toBe("solution");
    expect((await request(app).post(`/api/practice/${wrong.body.diagnostic.sessionId}/answer`).set(as("student")).send({answer:"solution"})).body.correct).toBe(true);
    const independent=await request(app).post(`/api/concepts/${b.body.id}/practice`).set(as("student"));
    expect((await request(app).post(`/api/practice/${independent.body.sessionId}/answer`).set(as("student")).send({answer:"solution"})).body.assisted).toBe(false);
    const staleSession=await request(app).post(`/api/concepts/${b.body.id}/practice`).set(as("student"));
    await db.query("UPDATE resources SET status='draft' WHERE id=$1",[resource.body.id]);
    expect((await request(app).post(`/api/practice/${staleSession.body.sessionId}/hint`).set(as("student"))).status).toBe(404);
    expect((await request(app).post(`/api/practice/${staleSession.body.sessionId}/answer`).set(as("student")).send({answer:"solution"})).status).toBe(404);
    await db.query("UPDATE resources SET status='published' WHERE id=$1",[resource.body.id]);
    const progress=await request(app).get(`/api/courses/${id}/progress`).set(as("teacher"));
    expect(progress.status).toBe(200); expect(progress.body.progress.find((x:any)=>x.conceptId===b.body.id).independent_correct).toBe(1);
    expect(JSON.stringify(progress.body)).not.toContain("Evenings");
    expect((await request(app).get(`/api/courses/${id}/progress`).set(as("otherInstituteTeacher"))).status).toBe(403);
    vi.stubEnv("GROQ_API_KEY","");
    const missingKey=await request(app).post(`/api/concepts/${b.body.id}/lesson`).set(as("student"));
    expect(missingKey.status,JSON.stringify(missingKey.body)).toBe(503);
    vi.stubEnv("GROQ_API_KEY","isolated-test-key");
    try {
      vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({explanation:"Explanation",citations:[{resourceId:resource.body.id,location:"Page 1"}]})}}]}),{status:200,headers:{"Content-Type":"application/json"}})));
      const lesson=await request(app).post(`/api/concepts/${b.body.id}/lesson`).set(as("student"));
      expect(lesson.status).toBe(200); expect(lesson.body.citations[0].location).toBe("Page 1");
      expect((await request(app).get(`/api/concepts/${b.body.id}/lessons`).set(as("teacher"))).status).toBe(403);
      expect((await request(app).get(`/api/concepts/${b.body.id}/lessons`).set(as("student"))).body.lessons).toHaveLength(1);
      vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({explanation:"Bad source",citations:[{resourceId:resource.body.id,location:"Page 99"}]})}}]}),{status:200})));
      expect((await request(app).post(`/api/concepts/${b.body.id}/lesson`).set(as("student"))).status).toBe(502);
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
});
