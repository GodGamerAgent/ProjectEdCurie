// Independent QA regression tests (Claude verification branch).
//
// Isolation: this file never touches the development or production database.
// It requires the disposable cluster started by `npm run test:isolated`, then
// creates its OWN throwaway database on that cluster (so it cannot interfere
// with foundation.test.ts, which runs in parallel and asserts empty tables),
// applies the checked-in Drizzle migrations to it, and drops it afterwards.
//
// Provider: every Groq interaction below is a MOCKED fetch. No live Groq call
// is made, and live provider behaviour remains unverified by these tests.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createApi } from "../server/routes";
import { HttpError, type AppUser } from "../server/auth";
import { groqLesson } from "../server/routes-study";

const base = process.env.TEST_DATABASE_URL;
if (!base || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\/edcurie_test$/.test(base)) {
  throw new Error("QA tests require the disposable local edcurie_test cluster. Run npm run test:isolated.");
}
const dbName = `edcurie_test_qa_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const maintenance = new Pool({ connectionString: base });
let db: Pool;
let app: ReturnType<typeof createApi>;
const actors: Record<string, AppUser> = {};
const as = (name: string) => ({ "x-test-actor": name });

type Ready = { courseId: string; resourceId: string; conceptId: string; assessmentId: string; questionId: string };
let ready: Ready;
let foreign: Ready; // a second course in the same institute, same teacher

const validLesson = (resourceId: string) => JSON.stringify({ choices: [{ message: { content: JSON.stringify({
  explanation: "Forces change motion, per the notes.",
  citations: [{ resourceId, location: "Page 1" }],
  checks: [{ prompt: "What changes motion?", options: ["Force", "Colour", "Smell", "Name"], correctOption: 0, citations: [{ resourceId, location: "Page 1" }] }]
}) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
const providerResponse = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "application/json" } });

async function makeCourse(title: string, enroll: string[]): Promise<Ready> {
  const course = await request(app).post("/api/courses").set(as("teacher")).send({ title });
  expect(course.status).toBe(201);
  const courseId = course.body.id;
  for (const actor of enroll) expect((await request(app).post(`/api/courses/${courseId}/enrollments`).set(as("teacher")).send({ email: actors[actor].email })).status).toBe(201);
  const resource = await request(app).post(`/api/courses/${courseId}/resources`).set(as("teacher"))
    .field("title", `${title} notes`).field("text", "[Page 1]\nForces change motion.\n\n[Page 2]\nMomentum is mass times velocity.");
  expect(resource.status).toBe(201);
  expect((await request(app).post(`/api/resources/${resource.body.id}/publish`).set(as("teacher"))).status).toBe(200);
  const concept = await request(app).post(`/api/courses/${courseId}/concepts`).set(as("teacher")).send({ name: `${title} forces`, resourceId: resource.body.id });
  expect(concept.status).toBe(201);
  const assessment = await request(app).post(`/api/courses/${courseId}/assessments`).set(as("teacher")).send({ title: "Baseline" });
  const question = await request(app).post(`/api/assessments/${assessment.body.id}/questions`).set(as("teacher"))
    .send({ prompt: "What changes motion?", answer: "force", resourceId: resource.body.id, conceptId: concept.body.id });
  expect(question.status).toBe(201);
  expect((await request(app).post(`/api/assessments/${assessment.body.id}/publish`).set(as("teacher"))).status).toBe(200);
  return { courseId, resourceId: resource.body.id, conceptId: concept.body.id, assessmentId: assessment.body.id, questionId: question.body.id };
}
async function submitBaseline(actor: string, courseId: string, questionId: string, answer = "force") {
  const start = await request(app).post(`/api/courses/${courseId}/assessment/start`).set(as(actor));
  expect(start.status).toBe(200);
  const submit = await request(app).post(`/api/courses/${courseId}/assessment/submit`).set(as(actor)).send({ sessionId: start.body.sessionId, answers: { [questionId]: answer } });
  expect(submit.status).toBe(201);
  return start.body.sessionId as string;
}
async function makeProblem(r: Ready, prompt: string, answer: string) {
  const problem = await request(app).post(`/api/concepts/${r.conceptId}/problems`).set(as("teacher"))
    .send({ questionId: r.questionId, prompt, answer, hints: ["Hint one.", "Hint two.", "Hint three."] });
  expect(problem.status).toBe(201);
  return problem.body.id as string;
}
const mastery = async (actor: string, r: Ready) =>
  (await request(app).get(`/api/courses/${r.courseId}/mastery`).set(as(actor))).body.concepts.find((c: any) => c.id === r.conceptId);

beforeAll(async () => {
  await maintenance.query(`CREATE DATABASE ${dbName}`);
  db = new Pool({ connectionString: base.replace(/\/edcurie_test$/, `/${dbName}`) });
  await migrate(drizzle(db), { migrationsFolder: "drizzle" });
  const empty = await db.query("SELECT (SELECT count(*) FROM users) AS users,(SELECT count(*) FROM courses) AS courses");
  expect(empty.rows[0]).toEqual({ users: "0", courses: "0" });
  app = createApi(db, async (req) => {
    const user = actors[String(req.headers["x-test-actor"])];
    if (!user) throw new HttpError(401, "Sign in is required.");
    return user;
  }, async () => {});
  const a = (await db.query("INSERT INTO institutes (display_name) VALUES ('QA Institute A') RETURNING id")).rows[0].id;
  const b = (await db.query("INSERT INTO institutes (display_name) VALUES ('QA Institute B') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO approved_domains (domain,institute_id) VALUES ('qa-a.edu',$1),('qa-b.edu',$2)", [a, b]);
  for (const [name, email, role, inst] of [
    ["admin", "admin@personal.example", "admin", null],
    ["teacher", "teacher@qa-a.edu", "teacher", a],
    ["unassignedTeacher", "unassigned@qa-a.edu", "teacher", a],
    ["student", "student@qa-a.edu", "student", a],
    ["peer", "peer@qa-a.edu", "student", a],
    ["unenrolled", "unenrolled@qa-a.edu", "student", a],
    ["otherInstituteTeacher", "teacher@qa-b.edu", "teacher", b],
    ["otherInstituteStudent", "student@qa-b.edu", "student", b]
  ] as const) {
    actors[name] = (await db.query(`INSERT INTO users (provider_id,email,role,institute_id) VALUES ($1,$2,$3,$4)
      RETURNING id,email,role,institute_id AS "instituteId"`, [`qa-${name}`, email, role, inst])).rows[0];
  }
  ready = await makeCourse("Mechanics", ["student", "peer"]);
  foreign = await makeCourse("Optics", ["student"]);
  // Corrupt cross-institute rows in the disposable DB must still grant nothing.
  await db.query("INSERT INTO enrollments (course_id,email) VALUES ($1,$2)", [ready.courseId, actors.otherInstituteStudent.email]);
  await db.query("INSERT INTO course_teachers (course_id,user_id) VALUES ($1,$2)", [ready.courseId, actors.otherInstituteTeacher.id]);
}, 60_000);
afterAll(async () => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
  await db?.end();
  await maintenance.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await maintenance.end();
});

describe("QA: access control sweep", () => {
  it("rejects unauthenticated, wrong-role, unenrolled, unassigned and cross-institute actors", async () => {
    const { courseId, resourceId, conceptId, assessmentId } = ready;
    const studentOnly: [string, string][] = [
      ["get", `/api/courses/${courseId}/onboarding`], ["post", `/api/courses/${courseId}/assessment/start`],
      ["get", `/api/courses/${courseId}/mastery`], ["post", `/api/concepts/${conceptId}/lesson`],
      ["post", `/api/concepts/${conceptId}/practice`], ["get", `/api/courses/${courseId}/targeted-practice`],
      ["get", `/api/courses/${courseId}/reviews`], ["post", `/api/courses/${courseId}/mocks/start`],
      ["get", `/api/courses/${courseId}/goal`], ["get", `/api/courses/${courseId}/rewards`]
    ];
    const teacherOnly: [string, string][] = [
      ["get", `/api/courses/${courseId}/progress`], ["get", `/api/courses/${courseId}/practice-problems`],
      ["get", `/api/courses/${courseId}/analytics`], ["get", `/api/courses/${courseId}/mocks/results`],
      ["post", `/api/courses/${courseId}/concepts`], ["post", `/api/courses/${courseId}/assessments`],
      ["post", `/api/resources/${resourceId}/publish`], ["post", `/api/assessments/${assessmentId}/publish`],
      ["post", `/api/concepts/${conceptId}/problems`], ["get", `/api/resources/${resourceId}/versions`],
      ["post", `/api/courses/${courseId}/enrollments`]
    ];
    const shared: [string, string][] = [
      ["get", `/api/courses/${courseId}`], ["get", `/api/courses/${courseId}/concepts`],
      ["get", `/api/resources/${resourceId}/file`], ["get", `/api/resources/${resourceId}/excerpt?location=Page%201`]
    ];
    const call = (method: string, url: string, actor?: string) => {
      const r = (request(app) as any)[method](url);
      return actor ? r.set(as(actor)).send({}) : r.send({});
    };
    const failures: string[] = [];
    const check = async (method: string, url: string, actor: string | undefined, expected: number) => {
      const status = (await call(method, url, actor)).status;
      if (status !== expected) failures.push(`${actor ?? "anonymous"} ${method.toUpperCase()} ${url} -> ${status} (expected ${expected})`);
    };
    for (const [m, u] of [...studentOnly, ...teacherOnly, ...shared]) await check(m, u, undefined, 401);
    for (const [m, u] of studentOnly) for (const actor of ["teacher", "admin", "unenrolled", "otherInstituteStudent"]) await check(m, u, actor, 403);
    for (const [m, u] of teacherOnly) for (const actor of ["student", "admin", "unassignedTeacher", "otherInstituteTeacher"]) await check(m, u, actor, 403);
    for (const [m, u] of shared) for (const actor of ["admin", "unenrolled", "unassignedTeacher", "otherInstituteStudent", "otherInstituteTeacher"]) await check(m, u, actor, 403);
    expect(failures).toEqual([]);
  });
});

describe("QA: cross-course references", () => {
  it("rejects questions, concepts, prerequisites, problems and twins that point at another course or concept", async () => {
    const t = as("teacher");
    expect((await request(app).post(`/api/courses/${ready.courseId}/concepts`).set(t).send({ name: "X", resourceId: foreign.resourceId })).status).toBe(400);
    expect((await request(app).post(`/api/concepts/${ready.conceptId}/prerequisites`).set(t).send({ prerequisiteId: foreign.conceptId })).status).toBe(400);
    expect((await request(app).post(`/api/assessments/${ready.assessmentId}/questions`).set(t).send({ prompt: "Q", answer: "A", resourceId: ready.resourceId, conceptId: foreign.conceptId })).status).toBe(400);
    expect((await request(app).patch(`/api/questions/${ready.questionId}`).set(t).send({ prompt: "Q", answer: "force", resourceId: foreign.resourceId })).status).toBe(400);
    expect((await request(app).patch(`/api/questions/${ready.questionId}`).set(t).send({ prompt: "Q", answer: "force", conceptId: foreign.conceptId })).status).toBe(400);
    // A practice problem must be built on a baseline question of the same concept and course.
    expect((await request(app).post(`/api/concepts/${ready.conceptId}/problems`).set(t)
      .send({ questionId: foreign.questionId, prompt: "P", answer: "A", hints: ["1", "2", "3"] })).status).toBe(400);
    // Twin of a different concept in the same course is rejected.
    const second = (await request(app).post(`/api/courses/${ready.courseId}/concepts`).set(t).send({ name: "Momentum", resourceId: ready.resourceId })).body;
    const q2 = (await request(app).post(`/api/assessments/${ready.assessmentId}/questions`).set(t)
      .send({ prompt: "What is momentum?", answer: "mass times velocity", resourceId: ready.resourceId, conceptId: second.id })).body;
    expect((await request(app).post(`/api/assessments/${ready.assessmentId}/publish`).set(t)).status).toBe(200);
    const original = await makeProblem(ready, "Name what changes motion.", "force");
    const otherConcept = (await request(app).post(`/api/concepts/${second.id}/problems`).set(t)
      .send({ questionId: q2.id, prompt: "Momentum formula?", answer: "mv", hints: ["1", "2", "3"] })).body.id;
    expect((await request(app).put(`/api/practice-problems/${original}/twin`).set(t).send({ twinProblemId: otherConcept })).status).toBe(400);
    // Questions from the other course never appear in this course's teacher view.
    const detail = await request(app).get(`/api/courses/${ready.courseId}`).set(t);
    expect(JSON.stringify(detail.body)).not.toContain(foreign.questionId);
    // A resource version id belonging to another resource cannot be used to read source text.
    const foreignVersion = (await db.query("SELECT id FROM resource_versions WHERE resource_id=$1", [foreign.resourceId])).rows[0].id;
    expect((await request(app).get(`/api/resources/${ready.resourceId}/excerpt?location=Page%201&version=${foreignVersion}`).set(as("student"))).status).toBe(404);
  });
});

describe("QA: baseline idempotency", () => {
  it("starts a single active baseline session when Start is double-clicked", async () => {
    const course = await makeCourse("Double click", ["student"]);
    const starts = await Promise.all([1, 2].map(() => request(app).post(`/api/courses/${course.courseId}/assessment/start`).set(as("student"))));
    expect(starts.map((s) => s.status)).toEqual([200, 200]);
    expect(starts[1].body.sessionId).toBe(starts[0].body.sessionId);
  });
});

describe("QA: Groq failure handling (MOCKED provider, not a live call)", () => {
  const excerpts = [{ resourceId: "r1", resourceVersionId: "v1", title: "Notes", location: "Page 1", text: "Forces change motion." }];
  const good = JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    explanation: "Forces change motion.", citations: [{ resourceId: "r1", location: "Page 1" }],
    checks: [{ prompt: "What changes motion?", options: ["Force", "Colour", "Smell", "Name"], correctOption: 0, citations: [{ resourceId: "r1", location: "Page 1" }] }]
  }) } }] });
  const statusOf = async (p: Promise<unknown>) => p.then(() => 200, (e) => e instanceof HttpError ? e.status : `non-HttpError ${(e as Error)?.name}: ${(e as Error)?.message}`);
  it("returns actionable HttpErrors for missing key, auth, rate-limit, transport and malformed bodies", async () => {
    try {
      vi.stubEnv("GROQ_API_KEY", "");
      await expect(groqLesson("Forces", excerpts, {})).rejects.toMatchObject({ status: 503, message: expect.stringContaining("GROQ_API_KEY") });
      vi.stubEnv("GROQ_API_KEY", "mock-key");
      const cases: [string, () => Promise<Response>, number][] = [
        ["401", async () => providerResponse("{}", 401), 503],
        ["429 twice", async () => providerResponse("{}", 429), 429],
        ["network failure twice", async () => { throw new TypeError("fetch failed"); }, 503],
        ["non-JSON body", async () => providerResponse("<html>gateway</html>"), 502],
        ["no choices", async () => providerResponse(JSON.stringify({ error: "x" })), 502],
        ["content not JSON", async () => providerResponse(JSON.stringify({ choices: [{ message: { content: "Sure! Here is a lesson" } }] })), 502],
        ["uncited explanation", async () => providerResponse(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ explanation: "x", citations: [{ resourceId: "r1", location: "Page 9" }], checks: [] }) } }] })), 502]
      ];
      for (const [label, impl, expected] of cases) {
        vi.stubGlobal("fetch", vi.fn(impl));
        expect(await statusOf(groqLesson("Forces", excerpts, {})), label).toBe(expected);
      }
      const flaky = vi.fn().mockResolvedValueOnce(providerResponse("{}", 503)).mockResolvedValueOnce(providerResponse(good));
      vi.stubGlobal("fetch", flaky);
      await expect(groqLesson("Forces", excerpts, {})).resolves.toMatchObject({ explanation: "Forces change motion." });
      expect(flaky).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
});

describe("QA: study loop regressions", () => {
  it("does not let a student retake a submitted baseline and duplicate baseline evidence", async () => {
    const course = await makeCourse("Retake", ["peer"]);
    const completedId = await submitBaseline("peer", course.courseId, course.questionId, "wrong");
    const evidence = () => db.query(`SELECT (SELECT count(*) FROM baseline_submissions b JOIN assessments a ON a.id=b.assessment_id WHERE a.course_id=$1 AND b.user_id=$2) AS submissions,
      (SELECT count(*) FROM study_attempts WHERE course_id=$1 AND user_id=$2 AND kind='baseline') AS attempts`, [course.courseId, actors.peer.id]);
    const before = (await evidence()).rows[0];
    expect(before).toEqual({ submissions: "1", attempts: "1" });
    const retake = await request(app).post(`/api/courses/${course.courseId}/assessment/start`).set(as("peer"));
    if (retake.status === 200 && retake.body.sessionId) {
      await request(app).post(`/api/courses/${course.courseId}/assessment/submit`).set(as("peer"))
        .send({ sessionId: retake.body.sessionId, answers: { [retake.body.questions[0].id]: "force" } });
    }
    expect((await evidence()).rows[0]).toEqual(before);
    expect(retake.status).toBe(409);

    // An active retake created before the upgrade must also be unable to submit.
    const stale = await db.query(`INSERT INTO assessment_sessions(user_id,course_id,assessment_id,questions)
      SELECT user_id,course_id,assessment_id,questions FROM assessment_sessions WHERE id=$1 RETURNING id`, [completedId]);
    const staleSubmit = await request(app).post(`/api/courses/${course.courseId}/assessment/submit`).set(as("peer"))
      .send({ sessionId: stale.rows[0].id, answers: { [course.questionId]: "force" } });
    expect(staleSubmit.status).toBe(409);
    expect((await evidence()).rows[0]).toEqual(before);
    const result = await request(app).get(`/api/courses/${course.courseId}/assessment/result`).set(as("peer"));
    expect(result.body.result).toMatchObject({ score: 0, total: 1 });
  });

  it("keeps hint use on a practice problem from being laundered into independent evidence via a second session", async () => {
    const course = await makeCourse("Laundering", ["student"]);
    await submitBaseline("student", course.courseId, course.questionId);
    await makeProblem(course, "Which quantity changes motion? (practice)", "force");
    const a = await request(app).post(`/api/concepts/${course.conceptId}/practice`).set(as("student"));
    const b = await request(app).post(`/api/concepts/${course.conceptId}/practice`).set(as("student"));
    expect(a.status).toBe(201);
    for (let i = 0; i < 3; i++) expect((await request(app).post(`/api/practice/${a.body.sessionId}/hint`).set(as("student"))).status).toBe(200);
    const revealed = await request(app).post(`/api/practice/${a.body.sessionId}/answer`).set(as("student")).send({ answer: "no idea" });
    expect(revealed.body.walkthrough).toBe("force");
    if (b.status === 201 && b.body.sessionId !== a.body.sessionId) {
      await request(app).post(`/api/practice/${b.body.sessionId}/answer`).set(as("student")).send({ answer: revealed.body.walkthrough });
    }
    const m = await mastery("student", course);
    expect(m.independent_correct).toBe(0);
  });

  it("awards practice XP and attempts at most once per problem, however many sessions are opened", async () => {
    const course = await makeCourse("Farming", ["student"]);
    await submitBaseline("student", course.courseId, course.questionId);
    const problemId = await makeProblem(course, "Which quantity changes motion? (farm)", "force");
    const sessions = [];
    for (let i = 0; i < 4; i++) sessions.push((await request(app).post(`/api/concepts/${course.conceptId}/practice`).set(as("student"))).body.sessionId);
    for (const id of new Set(sessions.filter(Boolean))) await request(app).post(`/api/practice/${id}/answer`).set(as("student")).send({ answer: "force" });
    const xp = await db.query("SELECT COALESCE(sum(points),0)::int AS points FROM xp_ledger WHERE user_id=$1 AND course_id=$2 AND event_key LIKE 'practice:%'", [actors.student.id, course.courseId]);
    const attempts = await db.query("SELECT count(*)::int AS n FROM study_attempts WHERE user_id=$1 AND problem_id=$2", [actors.student.id, problemId]);
    expect({ xp: xp.rows[0].points, attempts: attempts.rows[0].n }).toEqual({ xp: 10, attempts: 1 });
  });

  it("stops serving source excerpts to students once the teacher archives the resource", async () => {
    const course = await makeCourse("Archive", ["student"]);
    const url = `/api/resources/${course.resourceId}/excerpt?location=Page%201`;
    expect((await request(app).get(url).set(as("student"))).status).toBe(200);
    expect((await request(app).post(`/api/resources/${course.resourceId}/archive`).set(as("teacher"))).status).toBe(200);
    expect((await request(app).get(`/api/resources/${course.resourceId}/file`).set(as("student"))).status).toBe(404);
    expect((await request(app).get(`/api/courses/${course.courseId}/onboarding`).set(as("student"))).body.state).toBe("no_resource");
    expect((await request(app).get(url).set(as("student"))).status).toBe(404);
  });

  it("maps a provider message whose content is JSON null to a 502 for lessons and follow-ups (MOCKED provider)", async () => {
    try {
      vi.stubEnv("GROQ_API_KEY", "mock-key");
      const nullContent = JSON.stringify({ choices: [{ message: { content: "null" } }] });
      // Direct call should raise an HttpError (502), not a raw TypeError.
      vi.stubGlobal("fetch", vi.fn(async () => providerResponse(nullContent)));
      const direct = await groqLesson("Forces", [{ resourceId: "r1", resourceVersionId: "v1", title: "N", location: "Page 1", text: "t" }], {})
        .then(() => "resolved", (e) => e instanceof HttpError ? e.status : `${e?.name}`);
      // Route level: lesson and tutor follow-up should return 502 with a user-facing message.
      const course = await makeCourse("Malformed", ["student"]);
      await submitBaseline("student", course.courseId, course.questionId);
      const lessonRes = await request(app).post(`/api/concepts/${course.conceptId}/lesson`).set(as("student"));
      vi.stubGlobal("fetch", vi.fn(async () => providerResponse(validLesson(course.resourceId))));
      const lesson = await request(app).post(`/api/concepts/${course.conceptId}/lesson`).set(as("student"));
      expect(lesson.status).toBe(200);
      vi.stubGlobal("fetch", vi.fn(async () => providerResponse(nullContent)));
      const followup = await request(app).post(`/api/lessons/${lesson.body.id}/messages`).set(as("student")).send({ message: "Explain more" });
      expect({ direct, lesson: lessonRes.status, followup: followup.status }).toEqual({ direct: 502, lesson: 502, followup: 502 });
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
});
