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
    await db.query("UPDATE questions SET resource_id=$1,resource_version_id=(SELECT id FROM resource_versions WHERE resource_id=$1 AND version=1) WHERE assessment_id=$2", [other.body.id, assessmentId]);
    expect((await request(app).get(`/api/courses/${courseId}/onboarding`).set(as("student"))).body.state).toBe("no_baseline");
    await db.query("UPDATE questions SET resource_id=$1,resource_version_id=(SELECT id FROM resource_versions WHERE resource_id=$1 AND version=1),prompt=' ' WHERE assessment_id=$2", [extra.body.id, assessmentId]);
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
    const sourceV1=await db.query("SELECT id,text,status FROM resource_versions WHERE resource_id=$1 AND version=1",[resource.body.id]);
    expect(sourceV1.rowCount).toBe(1);expect(sourceV1.rows[0].status).toBe("published");
    const makeConcept = async (name:string) => request(app).post(`/api/courses/${id}/concepts`).set(as("teacher")).send({name,resourceId:resource.body.id});
    const a = await makeConcept("First"); const b = await makeConcept("Second"); const c = await makeConcept("Third"); const d = await makeConcept("Fourth"); const unassessed = await makeConcept("Unassessed");
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    expect((await request(app).post(`/api/concepts/${b.body.id}/prerequisites`).set(as("teacher")).send({prerequisiteId:a.body.id})).status).toBe(201);
    expect((await request(app).post(`/api/concepts/${a.body.id}/prerequisites`).set(as("teacher")).send({prerequisiteId:c.body.id})).status).toBe(201);
    expect((await request(app).post(`/api/concepts/${c.body.id}/prerequisites`).set(as("teacher")).send({prerequisiteId:d.body.id})).status).toBe(201);
    expect((await request(app).post(`/api/concepts/${a.body.id}/prerequisites`).set(as("teacher")).send({prerequisiteId:b.body.id})).status).toBe(400);
    expect((await request(app).post(`/api/courses/${id}/concepts`).set(as("otherInstituteTeacher")).send({name:"Forbidden",resourceId:resource.body.id})).status).toBe(403);
    const assessment = await request(app).post(`/api/courses/${id}/assessments`).set(as("teacher")).send({title:"Objective baseline"});
    const addQuestion = async (conceptId:string, answer:string) => request(app).post(`/api/assessments/${assessment.body.id}/questions`).set(as("teacher")).send({prompt:"What is the value?",answer,resourceId:resource.body.id,conceptId});
    const qa=await addQuestion(a.body.id,"alpha"); const qb=await addQuestion(b.body.id,"beta");const qc=await addQuestion(c.body.id,"gamma");const qd=await addQuestion(d.body.id,"delta");
    expect((await request(app).post(`/api/assessments/${assessment.body.id}/publish`).set(as("teacher"))).status).toBe(200);
    const addProblem = async (conceptId:string,questionId:string,prompt="Twin question?") => request(app).post(`/api/concepts/${conceptId}/problems`).set(as("teacher")).send({questionId,prompt,answer:"solution",hints:["First hint","Second hint","Third hint"]});
    expect((await addProblem(a.body.id,qa.body.id)).status).toBe(201);
    expect((await addProblem(c.body.id,qc.body.id,"Third prerequisite question?")).status).toBe(201);
    expect((await addProblem(d.body.id,qd.body.id,"Fourth prerequisite question?")).status).toBe(201);
    expect((await addProblem(b.body.id,qb.body.id)).status).toBe(201);
    expect((await addProblem(b.body.id,qb.body.id,"Second independent variation?")).status).toBe(201);
    expect((await addProblem(b.body.id,qb.body.id,"Third independent variation?")).status).toBe(201);
    expect((await request(app).post(`/api/concepts/${b.body.id}/practice`).set(as("student"))).status).toBe(403);
    expect((await request(app).post(`/api/concepts/${b.body.id}/lesson`).set(as("otherInstituteStudent"))).status).toBe(403);
    const baselineStart=await request(app).post(`/api/courses/${id}/assessment/start`).set(as("student"));
    const baseline=await request(app).post(`/api/courses/${id}/assessment/submit`).set(as("student")).send({sessionId:baselineStart.body.sessionId,answers:{[qa.body.id]:" ALPHA ",[qb.body.id]:"wrong",[qc.body.id]:"gamma",[qd.body.id]:"delta"}});
    expect(baseline.status).toBe(201); expect(baseline.body.score).toBe(3); expect(baseline.body.total).toBe(4);
    const baselineOnly=(await request(app).get(`/api/courses/${id}/mastery`).set(as("student"))).body.concepts.find((x:any)=>x.id===b.body.id);
    expect(baselineOnly.independent_attempts).toBe(0);
    expect(baselineOnly.status).toBe("Baseline checked; independent practice not yet assessed");
    const targets=await request(app).get(`/api/courses/${id}/targeted-practice`).set(as("student"));
    expect(targets.body.targets.find((x:any)=>x.conceptId===b.body.id).reason).toContain("baseline answer");
    const snapshot=await db.query("SELECT questions FROM assessment_sessions WHERE id=$1",[baselineStart.body.sessionId]);
    expect(snapshot.rows[0].questions[0].questionVersion).toBe(1);expect(snapshot.rows[0].questions[0].resourceVersionId).toBe(sourceV1.rows[0].id);
    expect((await request(app).get(`/api/resources/${resource.body.id}/excerpt?version=${sourceV1.rows[0].id}&location=Page%201`).set(as("student"))).body.text).toContain("course-specific explanation");
    expect((await request(app).get(`/api/courses/${id}/mastery`).set(as("student"))).body.concepts.find((x:any)=>x.id===unassessed.body.id).status).toBe("Not assessed");
    expect((await request(app).put(`/api/courses/${id}/goal`).set(as("student")).send({goal:"Understand",deadline:"2027-01-01",availability:"Evenings"})).status).toBe(200);
    expect((await request(app).get(`/api/courses/${id}/goal`).set(as("otherInstituteStudent"))).status).toBe(403);
    const practice=await request(app).post(`/api/concepts/${b.body.id}/practice`).set(as("student"));
    expect(practice.status).toBe(201); expect(practice.body.answer).toBeUndefined();
    for (let i=1;i<=3;i++) expect((await request(app).post(`/api/practice/${practice.body.sessionId}/hint`).set(as("student"))).body.number).toBe(i);
    expect((await request(app).post(`/api/practice/${practice.body.sessionId}/hint`).set(as("student"))).status).toBe(400);
    const wrong=await request(app).post(`/api/practice/${practice.body.sessionId}/answer`).set(as("student")).send({answer:"incorrect"});
    expect(wrong.body.assisted).toBe(true); expect(wrong.body.diagnostic).toBeTruthy();expect(wrong.body.walkthrough).toBe("solution");
    const diagnostic1=await request(app).post(`/api/practice/${wrong.body.diagnostic.sessionId}/answer`).set(as("student")).send({answer:"incorrect"});
    expect(diagnostic1.body.correct).toBe(false);expect(diagnostic1.body.diagnostic.concept).toBe("Third");
    const diagnostic2=await request(app).post(`/api/practice/${diagnostic1.body.diagnostic.sessionId}/answer`).set(as("student")).send({answer:"incorrect"});
    expect(diagnostic2.body.correct).toBe(false);expect(diagnostic2.body.diagnostic.concept).toBe("Fourth");
    const diagnostic3=await request(app).post(`/api/practice/${diagnostic2.body.diagnostic.sessionId}/answer`).set(as("student")).send({answer:"incorrect"});
    expect(diagnostic3.body.correct).toBe(false);expect(diagnostic3.body.diagnostic).toBeNull();
    expect((await db.query("SELECT max(diagnostic_depth) AS depth FROM practice_sessions WHERE user_id=$1 AND kind='diagnostic'",[actors.student.id])).rows[0].depth).toBe(3);
    const independent=await request(app).post(`/api/concepts/${b.body.id}/practice`).set(as("student"));
    expect((await request(app).post(`/api/practice/${independent.body.sessionId}/answer`).set(as("student")).send({answer:"solution"})).body.assisted).toBe(false);
    const editQuestion=await request(app).patch(`/api/questions/${qb.body.id}`).set(as("teacher")).send({prompt:"Updated baseline question",answer:"beta",conceptId:b.body.id,resourceId:resource.body.id});
    expect(editQuestion.status).toBe(200);expect(editQuestion.body.version).toBe(2);
    const questionHistory=await request(app).get(`/api/questions/${qb.body.id}/versions`).set(as("teacher"));
    expect(questionHistory.body.versions.map((v:any)=>v.version)).toEqual([2,1]);
    expect((await request(app).get(`/api/questions/${qb.body.id}/versions`).set(as("student"))).status).toBe(403);
    expect((await request(app).post(`/api/assessments/${assessment.body.id}/publish`).set(as("teacher"))).status).toBe(200);
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
      vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({explanation:"Explanation",citations:[{resourceId:resource.body.id,location:"Page 1"}],checks:[{prompt:"What does the material say?",options:["One","Two","Three","Four"],correctOption:2,citations:[{resourceId:resource.body.id,location:"Page 1"}]}]})}}]}),{status:200,headers:{"Content-Type":"application/json"}})));
      const lesson=await request(app).post(`/api/concepts/${b.body.id}/lesson`).set(as("student"));
      expect(lesson.status).toBe(200); expect(lesson.body.citations[0].location).toBe("Page 1");
      expect(lesson.body.checks).toHaveLength(1);expect(lesson.body.checks[0].options).toEqual(["One","Two","Three","Four"]);
      expect(lesson.body.checks[0]).not.toHaveProperty("correctOption");
      expect((await request(app).get(`/api/concepts/${b.body.id}/lessons`).set(as("teacher"))).status).toBe(403);
      const history=await request(app).get(`/api/concepts/${b.body.id}/lessons`).set(as("student"));
      expect(history.body.lessons).toHaveLength(1);
      const check=history.body.lessons[0].checks[0];
      expect(check.correctOption).toBeNull();
      expect((await request(app).post(`/api/lessons/${lesson.body.id}/checks/${check.id}/answer`).set(as("student")).send({selectedOption:5})).status).toBe(400);
      expect((await request(app).post(`/api/lessons/${lesson.body.id}/checks/${check.id}/answer`).set(as("teacher")).send({selectedOption:2})).status).toBe(403);
      expect((await request(app).post(`/api/lessons/${lesson.body.id}/checks/${check.id}/answer`).set(as("otherInstituteStudent")).send({selectedOption:2})).status).toBe(404);
      const before=(await request(app).get(`/api/courses/${id}/mastery`).set(as("student"))).body.concepts.find((x:any)=>x.id===b.body.id);
      const checkResults=await Promise.all([2,0].map(selectedOption=>request(app).post(`/api/lessons/${lesson.body.id}/checks/${check.id}/answer`).set(as("student")).send({selectedOption})));
      const checkResult=checkResults[0];
      expect(checkResults[1].body).toEqual(checkResult.body);
      expect(checkResult.body).toMatchObject({selectedOption:expect.any(Number),correctOption:2});
      expect(checkResult.body.correct).toBe(checkResult.body.selectedOption===2);
      expect(checkResult.body.message).toContain("assisted comprehension evidence");
      const after=(await request(app).get(`/api/courses/${id}/mastery`).set(as("student"))).body.concepts.find((x:any)=>x.id===b.body.id);
      expect(after.independent_attempts).toBe(before.independent_attempts);
      expect(after.assisted_correct-before.assisted_correct).toBe(1);
      const saved=(await request(app).get(`/api/concepts/${b.body.id}/lessons`).set(as("student"))).body.lessons[0].checks[0];
      expect(saved).toMatchObject({answered:true,selectedOption:checkResult.body.selectedOption,correct:checkResult.body.correct,correctOption:2});
      expect((await db.query("SELECT count(*) FROM study_attempts WHERE kind='comprehension' AND lesson_check_id=$1",[check.id])).rows[0].count).toBe("1");
      const unsupportedCheck=JSON.stringify({choices:[{message:{content:JSON.stringify({
        explanation:"Unsupported check",citations:[{resourceId:resource.body.id,location:"Page 1"}],
        checks:[{prompt:"Outside text?",options:["A","B","C","D"],correctOption:0,citations:[{resourceId:resource.body.id,location:"Page 99"}]}]
      })}}]});
      vi.stubGlobal("fetch",vi.fn(async()=>new Response(unsupportedCheck,{status:200})));
      expect((await request(app).post(`/api/concepts/${b.body.id}/lesson`).set(as("student"))).status).toBe(502);
      vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({explanation:"Bad source",citations:[{resourceId:resource.body.id,location:"Page 99"}]})}}]}),{status:200})));
      expect((await request(app).post(`/api/concepts/${b.body.id}/lesson`).set(as("student"))).status).toBe(502);
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
  it("links a fresh twin and records independent evidence only when it is answered without hints", async () => {
    const course=(await request(app).post("/api/courses").set(as("teacher")).send({title:"Isolated linked twin workflow"})).body;
    for(const actor of ["student","outsider"])expect((await request(app).post(`/api/courses/${course.id}/enrollments`).set(as("teacher")).send({email:actors[actor].email})).status).toBe(201);
    const resource=(await request(app).post(`/api/courses/${course.id}/resources`).set(as("teacher")).field("title","Addition").field("text","Addition combines two quantities.")).body;
    expect((await request(app).post(`/api/resources/${resource.id}/publish`).set(as("teacher"))).status).toBe(200);
    const concept=(await request(app).post(`/api/courses/${course.id}/concepts`).set(as("teacher")).send({name:"Addition",resourceId:resource.id})).body;
    const assessment=(await request(app).post(`/api/courses/${course.id}/assessments`).set(as("teacher")).send({title:"Baseline"})).body;
    const question=(await request(app).post(`/api/assessments/${assessment.id}/questions`).set(as("teacher")).send({prompt:"1 + 1?",answer:"2",resourceId:resource.id,conceptId:concept.id})).body;
    expect((await request(app).post(`/api/assessments/${assessment.id}/publish`).set(as("teacher"))).status).toBe(200);
    const makeProblem=async(prompt:string,answer:string)=>request(app).post(`/api/concepts/${concept.id}/problems`).set(as("teacher")).send({questionId:question.id,prompt,answer,hints:["Combine quantities.","Count forward.","Use addition."]});
    const original=(await makeProblem("2 + 3?","5")).body, twin=(await makeProblem("3 + 4?","7")).body;
    const pairUrl=`/api/practice-problems/${original.id}/twin`;
    expect((await request(app).put(pairUrl).set(as("student")).send({twinProblemId:twin.id})).status).toBe(403);
    expect((await request(app).put(pairUrl).set(as("otherTeacher")).send({twinProblemId:twin.id})).status).toBe(403);
    expect((await request(app).put(pairUrl).set(as("otherInstituteTeacher")).send({twinProblemId:twin.id})).status).toBe(403);
    expect((await request(app).put(pairUrl).set(as("teacher")).send({twinProblemId:original.id})).status).toBe(400);
    const foreignProblem=(await db.query(`SELECT p.id FROM practice_problems p JOIN concepts c ON c.id=p.concept_id WHERE c.course_id<>$1 LIMIT 1`,[course.id])).rows[0];
    expect((await request(app).put(pairUrl).set(as("teacher")).send({twinProblemId:foreignProblem.id})).status).toBe(400);
    expect((await request(app).put(pairUrl).set(as("teacher")).send({twinProblemId:twin.id})).status).toBe(200);
    expect((await request(app).put(pairUrl).set(as("teacher")).send({twinProblemId:twin.id})).status).toBe(200);
    expect((await request(app).put(`/api/practice-problems/${twin.id}/twin`).set(as("teacher")).send({twinProblemId:original.id})).status).toBe(409);
    const teacherList=await request(app).get(`/api/courses/${course.id}/practice-problems`).set(as("teacher"));
    expect(teacherList.body.problems.find((p:any)=>p.id===original.id).twinProblemId).toBe(twin.id);
    expect((await request(app).get(`/api/courses/${course.id}/practice-problems`).set(as("student"))).status).toBe(403);
    for(const actor of ["student","outsider"]){
      const baseline=await request(app).post(`/api/courses/${course.id}/assessment/start`).set(as(actor));
      expect((await request(app).post(`/api/courses/${course.id}/assessment/submit`).set(as(actor)).send({sessionId:baseline.body.sessionId,answers:{[question.id]:"2"}})).status).toBe(201);
    }
    const first=await request(app).post(`/api/concepts/${concept.id}/practice`).set(as("student"));
    expect(first.body.prompt).toBe("2 + 3?");
    expect((await request(app).post(`/api/practice/${first.body.sessionId}/twin`).set(as("student"))).status).toBe(409);
    expect((await request(app).post(`/api/practice/${first.body.sessionId}/twin`).set(as("outsider"))).status).toBe(404);
    // Assistance on the original must not contaminate a fresh, unassisted twin.
    expect((await request(app).post(`/api/practice/${first.body.sessionId}/hint`).set(as("student"))).status).toBe(200);
    expect((await request(app).post(`/api/practice/${first.body.sessionId}/answer`).set(as("student")).send({answer:"5"})).body.assisted).toBe(true);
    const pending=await request(app).get(`/api/courses/${course.id}/twin-followups`).set(as("student"));
    expect(pending.body.followups[0].status).toBe("available");
    expect((await request(app).post(`/api/concepts/${concept.id}/practice`).set(as("student"))).status).toBe(400);
    const starts=await Promise.all([1,2].map(()=>request(app).post(`/api/practice/${first.body.sessionId}/twin`).set(as("student"))));
    expect(starts[0].status).toBe(200);expect(starts[1].body.sessionId).toBe(starts[0].body.sessionId);
    const fresh=starts[0].body;
    expect(fresh.kind).toBe("twin");expect(fresh.prompt).toBe("3 + 4?");
    expect(fresh.answer).toBeUndefined();expect(fresh.hints).toEqual([]);
    expect((await request(app).post(`/api/practice/${fresh.sessionId}/answer`).set(as("outsider")).send({answer:"7"})).status).toBe(404);
    const before=(await request(app).get(`/api/courses/${course.id}/mastery`).set(as("student"))).body.concepts[0];
    expect(before.independent_attempts).toBe(0);
    const results=await Promise.all([1,2].map(()=>request(app).post(`/api/practice/${fresh.sessionId}/answer`).set(as("student")).send({answer:"7"})));
    expect(results[0].body).toEqual(results[1].body);
    expect(results[0].body).toMatchObject({kind:"twin",correct:true,assisted:false});
    const after=(await request(app).get(`/api/courses/${course.id}/mastery`).set(as("student"))).body.concepts[0];
    expect(after.independent_correct-before.independent_correct).toBe(1);
    expect(after.status).toBe("Developing");
    for(const [prompt,expected] of [["5 + 6?","11"],["6 + 7?","13"]]){
      const extra=(await makeProblem(prompt,expected)).body;
      expect(extra.id).toBeTruthy();
    }
    for(const expected of ["11","13"]){
      const extra=await request(app).post(`/api/concepts/${concept.id}/practice`).set(as("student"));
      expect(extra.status).toBe(201);
      expect((await request(app).post(`/api/practice/${extra.body.sessionId}/answer`).set(as("student")).send({answer:expected})).body.assisted).toBe(false);
    }
    const demonstrated=(await request(app).get(`/api/courses/${course.id}/mastery`).set(as("student"))).body.concepts[0];
    expect(demonstrated.independent_attempts).toBe(3);
    expect(demonstrated.independent_correct).toBe(3);
    expect(demonstrated.status).toBe("Demonstrated understanding");
    expect((await db.query("SELECT count(*) FROM study_attempts WHERE session_id=$1",[fresh.sessionId])).rows[0].count).toBe("1");
    const resumed=await request(app).post(`/api/practice/${first.body.sessionId}/twin`).set(as("student"));
    expect(resumed.body.submitted).toBe(true);expect(resumed.body.result.assisted).toBe(false);
    expect((await request(app).get(`/api/courses/${course.id}/twin-followups`).set(as("student"))).body.followups[0].status).toBe("completed");
    const reviewCard=(await db.query("SELECT id FROM review_cards WHERE user_id=$1 AND course_id=$2 ORDER BY id LIMIT 1",[actors.student.id,course.id])).rows[0];
    expect(reviewCard).toBeTruthy();
    await db.query("UPDATE review_cards SET due_at=now()-interval '1 minute' WHERE id=$1",[reviewCard.id]);
    const due=await request(app).get(`/api/courses/${course.id}/reviews`).set(as("student"));
    expect(due.status).toBe(200);expect(due.body.cards.find((c:any)=>c.id===reviewCard.id).due).toBe(true);
    expect(JSON.stringify(due.body)).not.toContain('"answer"');
    expect((await request(app).post(`/api/review-cards/${reviewCard.id}/start`).set(as("outsider"))).status).toBe(404);
    const reviewStarts=await Promise.all([1,2].map(()=>request(app).post(`/api/review-cards/${reviewCard.id}/start`).set(as("student"))));
    expect(reviewStarts.every(x=>[200,201].includes(x.status))).toBe(true);expect(reviewStarts[0].body.sessionId).toBe(reviewStarts[1].body.sessionId);
    expect(reviewStarts[0].body.prompt).toBeTruthy();expect(reviewStarts[0].body.expectedAnswer).toBeUndefined();
    const sessionId=reviewStarts[0].body.sessionId;
    const reviewAnswers=await Promise.all(["wrong","another"].map(answer=>request(app).post(`/api/review-sessions/${sessionId}/answer`).set(as("student")).send({answer})));
    expect(reviewAnswers[0].body).toEqual(reviewAnswers[1].body);
    expect(reviewAnswers[0].body).toMatchObject({correct:false,expectedAnswer:expect.any(String),dueAt:expect.any(String)});
    expect((await db.query("SELECT count(*) FROM review_events WHERE session_id=$1",[sessionId])).rows[0].count).toBe("1");
    expect((await request(app).post(`/api/review-cards/${reviewCard.id}/start`).set(as("student"))).status).toBe(409);
    await db.query(`UPDATE review_cards SET due_at=now()-interval '2 days',
      card=jsonb_set(jsonb_set(card,'{dueAt}',to_jsonb((now()-interval '2 days')::text)),'{lastReviewAt}',to_jsonb((now()-interval '2 days')::text)) WHERE id=$1`,[reviewCard.id]);
    const nextReview=(await request(app).post(`/api/review-cards/${reviewCard.id}/start`).set(as("student"))).body;
    const recalled=await request(app).post(`/api/review-sessions/${nextReview.sessionId}/answer`).set(as("student")).send({answer:reviewAnswers[0].body.expectedAnswer});
    expect(recalled.body.correct).toBe(true);expect(recalled.body.intervalDays).toBeGreaterThan(0);
    expect(new Date(recalled.body.dueAt).getTime()).toBeGreaterThan(Date.now());
    expect((await db.query("SELECT rating FROM review_events WHERE session_id=$1",[nextReview.sessionId])).rows[0].rating).toBe(3);
    expect((await db.query("SELECT kind,assisted FROM study_attempts WHERE review_session_id=$1",[nextReview.sessionId])).rows[0]).toEqual({kind:"review",assisted:false});
    // A second student uses a hint on the twin: only assisted evidence increases.
    const other=await request(app).post(`/api/concepts/${concept.id}/practice`).set(as("outsider"));
    await request(app).post(`/api/practice/${other.body.sessionId}/answer`).set(as("outsider")).send({answer:"5"});
    const hinted=await request(app).post(`/api/practice/${other.body.sessionId}/twin`).set(as("outsider"));
    await request(app).post(`/api/practice/${hinted.body.sessionId}/hint`).set(as("outsider"));
    const resumeHinted=await request(app).post(`/api/practice/${other.body.sessionId}/twin`).set(as("outsider"));
    expect(resumeHinted.body.sessionId).toBe(hinted.body.sessionId);expect(resumeHinted.body.hints).toEqual(["Combine quantities."]);
    const prior=(await request(app).get(`/api/courses/${course.id}/mastery`).set(as("outsider"))).body.concepts[0];
    const assisted=await request(app).post(`/api/practice/${hinted.body.sessionId}/answer`).set(as("outsider")).send({answer:"7"});
    expect(assisted.body).toMatchObject({kind:"twin",correct:true,assisted:true});
    const later=(await request(app).get(`/api/courses/${course.id}/mastery`).set(as("outsider"))).body.concepts[0];
    expect(later.independent_attempts).toBe(prior.independent_attempts);
    expect(later.independent_correct).toBe(prior.independent_correct);
    expect(later.assisted_correct-prior.assisted_correct).toBe(1);
    const progress=await request(app).get(`/api/courses/${course.id}/progress`).set(as("teacher"));
    expect(progress.body.progress.find((p:any)=>p.studentId===actors.outsider.id).assisted_correct).toBe(later.assisted_correct);
    const duplicate=(await makeProblem("  2   + 3?  ","5")).body;
    expect((await request(app).put(pairUrl).set(as("teacher")).send({twinProblemId:duplicate.id})).status).toBe(400);
    await request(app).post(`/api/resources/${resource.id}/archive`).set(as("teacher"));
    expect((await request(app).post(`/api/practice/${first.body.sessionId}/twin`).set(as("student"))).status).toBe(403);
  });
  it("builds an adaptive mock from published questions and keeps its score separate",async()=>{
    const course=(await request(app).post("/api/courses").set(as("teacher")).send({title:"Isolated adaptive mock"})).body;
    expect((await request(app).post(`/api/courses/${course.id}/enrollments`).set(as("teacher")).send({email:actors.student.email})).status).toBe(201);
    const resource=(await request(app).post(`/api/courses/${course.id}/resources`).set(as("teacher")).field("title","Mock source").field("text","Published material for a mock.")).body;
    expect((await request(app).post(`/api/resources/${resource.id}/publish`).set(as("teacher"))).status).toBe(200);
    const weak=(await request(app).post(`/api/courses/${course.id}/concepts`).set(as("teacher")).send({name:"Needs work",resourceId:resource.id})).body;
    const untouched=(await request(app).post(`/api/courses/${course.id}/concepts`).set(as("teacher")).send({name:"New topic",resourceId:resource.id})).body;
    const assessment=(await request(app).post(`/api/courses/${course.id}/assessments`).set(as("teacher")).send({title:"Mock question bank"})).body;
    const questions=[];
    for(const [concept,prompt,answer] of [[weak,"Weak one?","yes"],[weak,"Weak two?","yes"],[untouched,"New one?","yes"],[untouched,"New two?","yes"]]){
      questions.push((await request(app).post(`/api/assessments/${assessment.id}/questions`).set(as("teacher")).send({prompt,answer,resourceId:resource.id,conceptId:concept.id})).body);
    }
    expect((await request(app).post(`/api/assessments/${assessment.id}/publish`).set(as("teacher"))).status).toBe(200);
    const baseline=(await request(app).post(`/api/courses/${course.id}/assessment/start`).set(as("student"))).body;
    const baselineAnswers=Object.fromEntries(questions.map((q:any,i:number)=>[q.id,i===0?"wrong":"yes"]));
    expect((await request(app).post(`/api/courses/${course.id}/assessment/submit`).set(as("student")).send({sessionId:baseline.sessionId,answers:baselineAnswers})).status).toBe(201);
    const before=(await request(app).get(`/api/courses/${course.id}/mastery`).set(as("student"))).body.concepts;
    const starts=await Promise.all([1,2].map(()=>request(app).post(`/api/courses/${course.id}/mocks/start`).set(as("student"))));
    expect(starts[0].body.id).toBe(starts[1].body.id);
    const mock=starts[0].body;
    expect(mock.status).toBe("active");expect(mock.questions).toHaveLength(4);
    expect(mock.questions[0].conceptId).toBe(weak.id);
    expect(mock.questions[0].expectedAnswer).toBeUndefined();
    expect((await request(app).get(`/api/mock-sessions/${mock.id}`).set(as("outsider"))).status).toBe(404);
    expect((await request(app).post(`/api/mock-sessions/${mock.id}/submit`).set(as("student"))).status).toBe(400);
    expect((await request(app).post(`/api/mock-sessions/${mock.id}/answer`).set(as("student")).send({questionId:"d7f7f6f9-02ce-4dcc-bef2-34124a4774e8",answer:"yes"})).status).toBe(400);
    const saved=await request(app).post(`/api/mock-sessions/${mock.id}/answer`).set(as("student")).send({questionId:mock.questions[0].id,answer:"yes"});
    expect(saved.body.saved).toBe(true);
    expect((await request(app).get(`/api/mock-sessions/${mock.id}`).set(as("student"))).body.questions[0].expectedAnswer).toBeUndefined();
    for(const q of mock.questions.slice(1))await request(app).post(`/api/mock-sessions/${mock.id}/answer`).set(as("student")).send({questionId:q.id,answer:"yes"});
    const submitted=await request(app).post(`/api/mock-sessions/${mock.id}/submit`).set(as("student"));
    expect(submitted.body).toMatchObject({score:100,correctCount:4,questionCount:4});
    expect(submitted.body.details[0].expectedAnswer).toBe("yes");
    expect((await request(app).post(`/api/mock-sessions/${mock.id}/submit`).set(as("student"))).body).toEqual(submitted.body);
    const after=(await request(app).get(`/api/courses/${course.id}/mastery`).set(as("student"))).body.concepts;
    expect(after.map((c:any)=>c.independent_attempts)).toEqual(before.map((c:any)=>c.independent_attempts));
  });
  it("routes assignment submissions through teacher review before exposing diagnosis",async()=>{
    const course=(await request(app).post("/api/courses").set(as("teacher")).send({title:"Isolated assignment review"})).body;
    expect((await request(app).post(`/api/courses/${course.id}/enrollments`).set(as("teacher")).send({email:actors.student.email})).status).toBe(201);
    const created=await request(app).post(`/api/courses/${course.id}/assignments`).set(as("teacher")).send({
      title:"Explain the result",instructions:"Show your reasoning and cite the class notes.",rubric:["Reasoning uses course material"],dueAt:"2026-12-10T17:00:00.000Z"
    });
    expect(created.status).toBe(201);
    expect((await request(app).get(`/api/courses/${course.id}/assignments`).set(as("student"))).body.assignments).toHaveLength(0);
    expect((await request(app).post(`/api/assignments/${created.body.id}/submissions`).set(as("student")).send({response:"My answer",confidence:4})).status).toBe(404);
    expect((await request(app).post(`/api/assignments/${created.body.id}/publish`).set(as("teacher"))).status).toBe(200);
    const visible=(await request(app).get(`/api/courses/${course.id}/assignments`).set(as("student"))).body.assignments[0];
    expect(visible).toMatchObject({title:"Explain the result",submissionId:null});
    const baselineBefore=(await db.query("SELECT count(*) FROM study_attempts WHERE user_id=$1 AND course_id=$2 AND kind='practice'",[actors.student.id,course.id])).rows[0].count;
    const submission=await request(app).post(`/api/assignments/${created.body.id}/submissions`).set(as("student")).send({response:"The response",diagnosis:"I was unsure about the units.",confidence:2});
    expect(submission.status).toBe(201);
    const pending=(await request(app).get(`/api/courses/${course.id}/assignments`).set(as("student"))).body.assignments[0];
    expect(pending).toMatchObject({submissionStatus:"submitted",score:null,teacherFeedback:null});
    const teacherRows=await request(app).get(`/api/assignments/${created.body.id}/submissions`).set(as("teacher"));
    expect(teacherRows.body.submissions[0]).toMatchObject({email:actors.student.email,diagnosis:"I was unsure about the units.",confidence:2});
    expect((await request(app).post(`/api/assignment-submissions/${submission.body.id}/review`).set(as("otherTeacher")).send({score:80,feedback:"Reviewed",rubricScores:[3]})).status).toBe(403);
    expect((await request(app).post(`/api/assignment-submissions/${submission.body.id}/review`).set(as("teacher")).send({score:80,feedback:"Reviewed",rubricScores:[5]})).status).toBe(400);
    const reviewed=await request(app).post(`/api/assignment-submissions/${submission.body.id}/review`).set(as("teacher")).send({
      score:86,feedback:"Your explanation is clear; check the units.",rubricScores:[3],misconception:"Unit conversion"
    });
    expect(reviewed.status).toBe(200);
    const privateResult=(await request(app).get(`/api/courses/${course.id}/assignments`).set(as("student"))).body.assignments[0];
    expect(privateResult).toMatchObject({submissionStatus:"reviewed",score:86,teacherFeedback:"Your explanation is clear; check the units.",misconception:"Unit conversion"});
    expect((await request(app).post(`/api/assignments/${created.body.id}/submissions`).set(as("student")).send({response:"replace",confidence:5})).status).toBe(409);
    expect((await db.query("SELECT count(*) FROM study_attempts WHERE user_id=$1 AND course_id=$2 AND kind='practice'",[actors.student.id,course.id])).rows[0].count).toBe(baselineBefore);
    const analytics=await request(app).get(`/api/courses/${course.id}/analytics?days=7`).set(as("teacher"));
    expect(analytics.status).toBe(200);expect(analytics.body.students).toMatchObject({enrolled:1,active:0});
    expect(analytics.body.assignments).toMatchObject({assignments:1,submissions:1,reviewed:1});
    expect(analytics.body.activity).toHaveLength(7);
    expect((await request(app).get(`/api/courses/${course.id}/analytics`).set(as("otherTeacher"))).status).toBe(403);
    expect((await request(app).get(`/api/courses/${course.id}/analytics?days=3`).set(as("teacher"))).status).toBe(400);
  });
  it("keeps weekly timetable, student availability, and personal commitments correctly scoped", async()=>{
    const course=(await request(app).post("/api/courses").set(as("teacher")).send({title:"Isolated timetable"})).body;
    expect((await request(app).post(`/api/courses/${course.id}/enrollments`).set(as("teacher")).send({email:actors.student.email})).status).toBe(201);
    expect((await request(app).post(`/api/courses/${course.id}/enrollments`).set(as("teacher")).send({email:actors.outsider.email})).status).toBe(201);
    const url=`/api/courses/${course.id}/timetable`;
    const classBody={title:"Physics class",weekday:2,startTime:"09:00",endTime:"10:00",startsOn:"2026-11-10",endsOn:"2027-01-05",timezone:"Asia/Kolkata"};
    expect((await request(app).post(url).set(as("student")).send(classBody)).status).toBe(403);
    expect((await request(app).post(url).set(as("otherInstituteTeacher")).send(classBody)).status).toBe(403);
    expect((await request(app).post(url).set(as("teacher")).send({...classBody,timezone:"Mars/Olympus"})).status).toBe(400);
    expect((await request(app).post(url).set(as("teacher")).send({...classBody,endTime:"09:00"})).status).toBe(400);
    const created=await request(app).post(url).set(as("teacher")).send(classBody);
    expect(created.status).toBe(201);
    expect((await request(app).post(url).set(as("teacher")).send({...classBody,startTime:"09:30",endTime:"10:30"})).status).toBe(409);
    expect((await request(app).get(url).set(as("student"))).body.events[0]).toMatchObject({title:"Physics class",timezone:"Asia/Kolkata",exceptions:[]});
    const exceptions=`${url}/${created.body.event.id}/cancel-date`;
    expect((await request(app).post(exceptions).set(as("teacher")).send({date:"2026-11-18"})).status).toBe(400);
    expect((await request(app).post(exceptions).set(as("teacher")).send({date:"2026-11-17"})).status).toBe(200);
    expect((await request(app).post(exceptions).set(as("teacher")).send({date:"2026-11-17"})).status).toBe(200);
    expect((await request(app).get(url).set(as("student"))).body.events[0].exceptions).toEqual(["2026-11-17"]);
    expect((await request(app).delete(`${url}/${created.body.event.id}`).set(as("teacher"))).status).toBe(200);
    expect((await request(app).get(url).set(as("student"))).body.events[0].status).toBe("cancelled");

    const availability=`/api/courses/${course.id}/availability`;
    expect((await request(app).get(availability).set(as("student"))).body.availability.intervals).toEqual([]);
    const saved=await request(app).put(availability).set(as("student")).send({timezone:"Asia/Kolkata",sessionMinutes:30,intervals:[
      {weekday:1,startTime:"09:00",endTime:"12:00"},{weekday:1,startTime:"12:00",endTime:"13:00"},{weekday:3,startTime:"16:00",endTime:"18:00"}
    ]});
    expect(saved.status).toBe(200);expect(saved.body.availability.intervals).toHaveLength(3);
    expect((await request(app).put(availability).set(as("student")).send({timezone:"Invalid/Zone",intervals:[]})).status).toBe(400);
    expect((await request(app).put(availability).set(as("student")).send({timezone:"Asia/Kolkata",sessionMinutes:30,intervals:[
      {weekday:1,startTime:"09:00",endTime:"11:00"},{weekday:1,startTime:"10:30",endTime:"12:00"}
    ]})).status).toBe(400);
    expect((await request(app).get(availability).set(as("teacher"))).status).toBe(403);
    expect((await request(app).get(availability).set(as("outsider"))).body.availability.intervals).toEqual([]);

    const commitments=`/api/courses/${course.id}/commitments`;
    expect((await request(app).get(commitments).set(as("teacher"))).status).toBe(403);
    const meeting={title:"Private appointment",startsAt:"2026-11-20T08:00:00.000Z",endsAt:"2026-11-20T09:00:00.000Z",timezone:"Asia/Kolkata",courseId:course.id};
    expect((await request(app).post(commitments).set(as("student")).send({...meeting,startsAt:"2026-11-20T08:00:00"})).status).toBe(400);
    const commitment=await request(app).post(commitments).set(as("student")).send(meeting);
    expect(commitment.status).toBe(201);
    expect((await request(app).post(commitments).set(as("student")).send({...meeting,startsAt:"2026-11-20T08:30:00.000Z",endsAt:"2026-11-20T09:30:00.000Z"})).status).toBe(409);
    expect((await request(app).get(commitments).set(as("student"))).body.commitments).toHaveLength(1);
    expect((await request(app).get(commitments).set(as("outsider"))).body.commitments).toEqual([]);
    expect((await request(app).delete(`${commitments}/${commitment.body.commitment.id}`).set(as("student"))).status).toBe(200);
  });
  it("builds a deadline-fixed study plan around classes and private commitments",async()=>{
    const day=(offset:number)=>{const d=new Date();d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
    const today=day(0),deadline=day(20),blockedDate=day(5),weekday=(date:string)=>{const n=new Date(`${date}T00:00:00Z`).getUTCDay();return n===0?7:n;};
    const course=(await request(app).post("/api/courses").set(as("teacher")).send({title:"Plan workflow"})).body;
    expect((await request(app).post(`/api/courses/${course.id}/enrollments`).set(as("teacher")).send({email:actors.student.email})).status).toBe(201);
    const resource=(await request(app).post(`/api/courses/${course.id}/resources`).set(as("teacher")).field("title","Planning source").field("text","Study the concept in stages.")).body;
    expect((await request(app).post(`/api/resources/${resource.id}/publish`).set(as("teacher"))).status).toBe(200);
    const concept=(await request(app).post(`/api/courses/${course.id}/concepts`).set(as("teacher")).send({name:"Planning concept",resourceId:resource.id})).body;
    const assessment=(await request(app).post(`/api/courses/${course.id}/assessments`).set(as("teacher")).send({title:"Planning baseline"})).body;
    const question=(await request(app).post(`/api/assessments/${assessment.id}/questions`).set(as("teacher")).send({prompt:"What is planned?",answer:"study",resourceId:resource.id,conceptId:concept.id})).body;
    expect((await request(app).post(`/api/assessments/${assessment.id}/publish`).set(as("teacher"))).status).toBe(200);
    expect((await request(app).patch(`/api/concepts/${concept.id}/estimate`).set(as("teacher")).send({learningMinutes:30,practiceMinutes:20,revisionMinutes:10,difficulty:4})).status).toBe(200);
    const baseline=await request(app).post(`/api/courses/${course.id}/assessment/start`).set(as("student"));
    expect((await request(app).post(`/api/courses/${course.id}/assessment/submit`).set(as("student")).send({sessionId:baseline.body.sessionId,answers:{[question.id]:"study"}})).status).toBe(201);
    const goal=`/api/courses/${course.id}/goal`,availability=`/api/courses/${course.id}/availability`;
    expect((await request(app).get(`/api/courses/${course.id}/feasibility`).set(as("student"))).status).toBe(400);
    expect((await request(app).patch(`/api/concepts/${concept.id}/estimate`).set(as("student")).send({learningMinutes:10,practiceMinutes:10,revisionMinutes:10,difficulty:2})).status).toBe(403);
    expect((await request(app).put(goal).set(as("student")).send({goal:"Prepare steadily",deadline,availability:""})).status).toBe(200);
    const noTime=await request(app).get(`/api/courses/${course.id}/feasibility`).set(as("student"));
    expect(noTime.body).toMatchObject({score:1,capacityMinutes:0});
    expect((await request(app).put(availability).set(as("student")).send({timezone:"Asia/Kolkata",sessionMinutes:30,
      intervals:[1,2,3,4,5,6,7].map(weekday=>({weekday,startTime:"09:00",endTime:"12:00"}))})).status).toBe(200);
    const event=await request(app).post(`/api/courses/${course.id}/timetable`).set(as("teacher")).send({
      title:"Recurring class",weekday:weekday(blockedDate),startTime:"09:30",endTime:"10:30",startsOn:today,endsOn:deadline,timezone:"Asia/Kolkata"
    });
    expect(event.status).toBe(201);
    const commitment=await request(app).post(`/api/courses/${course.id}/commitments`).set(as("student")).send({
      title:"Private appointment",startsAt:`${blockedDate}T10:45:00+05:30`,endsAt:`${blockedDate}T11:15:00+05:30`,timezone:"Asia/Kolkata",courseId:course.id
    });
    expect(commitment.status).toBe(201);
    const feasibility=await request(app).get(`/api/courses/${course.id}/feasibility`).set(as("student"));
    expect(feasibility.status).toBe(200);expect(feasibility.body.requiredMinutes).toBe(60);expect(feasibility.body.capacityMinutes).toBeGreaterThan(0);
    const requestKey="41126392-20cb-4d69-82a4-f1a376c98310";
    const created=await request(app).post(`/api/courses/${course.id}/plan`).set(as("student")).send({requestKey});
    expect(created.status).toBe(200);expect(created.body.plan.deadline).toBe(deadline);
    expect(created.body.blocks.map((b:any)=>b.phase)).toEqual(expect.arrayContaining(["learning","practice","revision"]));
    expect(created.body.blocks.every((b:any)=>new Date(b.endsAt)<=new Date(`${deadline}T23:59:59Z`))).toBe(true);
    const repeated=await request(app).post(`/api/courses/${course.id}/plan`).set(as("student")).send({requestKey});
    expect(repeated.body).toEqual(created.body);
    const when=(stamp:string)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",weekday:"short",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(stamp));
    for(const block of created.body.blocks){
      const start=Date.parse(block.startsAt),end=Date.parse(block.endsAt);
      expect(start).toBeGreaterThanOrEqual(Date.now());
      expect(start<Date.parse(commitment.body.commitment.endsAt)&&Date.parse(commitment.body.commitment.startsAt)<end).toBe(false);
      const parts=Object.fromEntries(when(block.startsAt).map((p:any)=>[p.type,p.value]));
      const endParts=Object.fromEntries(when(block.endsAt).map((p:any)=>[p.type,p.value]));
      if(parts.year+"-"+parts.month+"-"+parts.day===blockedDate){
        const a=Number(parts.hour)*60+Number(parts.minute),b=Number(endParts.hour)*60+Number(endParts.minute);
        expect(b<=570||a>=630).toBe(true);
        expect(b<=645||a>=675).toBe(true);
      }
    }
    expect((await request(app).get(`/api/courses/${course.id}/plan`).set(as("otherInstituteStudent"))).status).toBe(403);
    const first=created.body.blocks[0];
    expect((await request(app).post(`/api/study-blocks/${first.id}/start`).set(as("outsider"))).status).toBe(404);
    expect((await request(app).post(`/api/study-blocks/${first.id}/complete`).set(as("student"))).status).toBe(409);
    expect((await request(app).post(`/api/study-blocks/${first.id}/start`).set(as("student"))).status).toBe(200);
    expect((await request(app).post(`/api/study-blocks/${first.id}/complete`).set(as("student"))).status).toBe(200);
    expect((await request(app).put(goal).set(as("student")).send({goal:"A later target",deadline:day(25),availability:""})).status).toBe(200);
    const replanned=await request(app).post(`/api/courses/${course.id}/plan`).set(as("student")).send({requestKey:"b8fb6a30-4e9f-46e3-8a38-1cdf03991d77"});
    expect(replanned.body.plan.deadline).toBe(deadline);
    expect(replanned.body.plan.version).toBe(2);expect(replanned.body.plan.required_minutes).toBe(30);
    expect((await request(app).get(`/api/courses/${course.id}/plan`).set(as("student"))).body.blocks.some((b:any)=>b.id===first.id&&b.state==="completed")).toBe(true);
    await db.query(`INSERT INTO study_attempts(user_id,course_id,concept_id,kind,correct,assisted) VALUES($1,$2,$3,'diagnostic',false,true)`,
      [actors.student.id,course.id,concept.id]);
    const automatic=await request(app).get(`/api/courses/${course.id}/plan`).set(as("student"));
    expect(automatic.body.recalibrated).toBe(true);expect(automatic.body.plan.version).toBe(3);expect(automatic.body.plan.deadline).toBe(deadline);
    const stable=await request(app).get(`/api/courses/${course.id}/plan`).set(as("student"));
    expect(stable.body.recalibrated).toBe(false);expect(stable.body.plan.version).toBe(3);
  });
});
