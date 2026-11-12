import { Router } from "express";
import type { Pool } from "pg";
import { currentUser, teacherCourse, uuid } from "./access";
import { HttpError } from "./auth";
import { availableLanguages, verifySpec, type CodingSpec } from "./code-runner";
import { codingQuestion, proposeAnswers } from "./demo-ai";

const text = (value: unknown, label: string, max: number, required = true) => {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new HttpError(400, `${label} is required and must be at most ${max} characters.`);
  return value.replaceAll("\u0000", "").trim();
};
export const QUESTION_FIELDS = `q.id,q.resource_id AS "resourceId",q.origin,q.kind,q.prompt,q.quote,q.source_ref AS "sourceRef",q.answer,
  q.answer_source AS "answerSource",q.coding,q.coding_status AS "codingStatus",q.edited`;

/** Fields a student may see. Answers, reference solutions, checkers and hidden tests stay on the server. */
export function studentQuestion(row: { id: string; resourceId: string; origin: string; kind: string; prompt: string; sourceRef: string; coding: CodingSpec | null }) {
  const coding = row.kind === "coding" && row.coding ? {
    language: row.coding.language, statement: row.coding.statement, inputFormat: row.coding.inputFormat, outputFormat: row.coding.outputFormat,
    starterCode: row.coding.starterCode,
    samples: row.coding.tests.filter(test => !test.hidden).map(({ name, input, expected }) => ({ name, input, expected })),
    hiddenTests: row.coding.tests.filter(test => test.hidden).length,
  } : null;
  return { id: row.id, resourceId: row.resourceId, origin: row.origin, kind: row.kind, prompt: row.prompt, sourceRef: row.sourceRef, coding };
}

export function questionRoutes(db: Pool) {
  const router = Router();

  async function resourceFor(res: Parameters<typeof currentUser>[0], resourceId: string) {
    const resource = (await db.query(`SELECT id,course_id,title,text,summary FROM resources WHERE id=$1 AND status<>'archived'`, [uuid(resourceId)])).rows[0];
    if (!resource) throw new HttpError(404, "Resource not found.");
    await teacherCourse(db, currentUser(res), resource.course_id);
    return resource as { id: string; course_id: string; title: string; text: string; summary: string };
  }
  async function questionFor(res: Parameters<typeof currentUser>[0], questionId: string) {
    const question = (await db.query(`SELECT ${QUESTION_FIELDS},r.course_id AS "courseId",r.title,r.summary,r.text FROM demo_resource_questions q
      JOIN resources r ON r.id=q.resource_id WHERE q.id=$1 AND r.status<>'archived'`, [uuid(questionId)])).rows[0];
    if (!question) throw new HttpError(404, "Question not found.");
    await teacherCourse(db, currentUser(res), question.courseId);
    return question;
  }
  const one = async (id: string) => (await db.query(`SELECT ${QUESTION_FIELDS} FROM demo_resource_questions q WHERE q.id=$1`, [id])).rows[0];

  router.get("/api/demo/code/languages", (_req, res) => {
    res.json({ languages: availableLanguages() });
  });

  router.post("/api/demo/resources/:id/questions", async (req, res) => {
    const resource = await resourceFor(res, String(req.params.id));
    const prompt = text(req.body.prompt, "Question", 8000);
    const answer = text(req.body.answer ?? "", "Answer", 8000, false);
    const sourceRef = text(req.body.sourceRef ?? "", "Source reference", 120, false);
    const saved = await db.query(`INSERT INTO demo_resource_questions(resource_id,position,origin,prompt,source_ref,answer,answer_source,edited)
      VALUES($1,200000+(SELECT count(*) FROM demo_resource_questions WHERE resource_id=$1),'manual',$2,$3,$4,$5,true) RETURNING id`,
    [resource.id, prompt, sourceRef, answer, answer ? "teacher" : "none"]);
    res.status(201).json(await one(saved.rows[0].id));
  });

  router.patch("/api/demo/questions/:id", async (req, res) => {
    const question = await questionFor(res, String(req.params.id));
    const prompt = req.body.prompt === undefined ? question.prompt : text(req.body.prompt, "Question", 8000);
    const answer = req.body.answer === undefined ? question.answer : text(req.body.answer, "Answer", 8000, false);
    const sourceRef = req.body.sourceRef === undefined ? question.sourceRef : text(req.body.sourceRef, "Source reference", 120, false);
    const answerSource = answer === question.answer ? question.answerSource : answer ? "teacher" : "none";
    await db.query(`UPDATE demo_resource_questions SET prompt=$2,answer=$3,source_ref=$4,answer_source=$5,edited=true,updated_at=now() WHERE id=$1`,
      [question.id, prompt, answer, sourceRef, answerSource]);
    res.json(await one(question.id));
  });

  router.delete("/api/demo/questions/:id", async (req, res) => {
    const question = await questionFor(res, String(req.params.id));
    await db.query("DELETE FROM demo_code_submissions WHERE question_id=$1", [question.id]);
    await db.query("DELETE FROM demo_resource_questions WHERE id=$1", [question.id]);
    res.status(204).end();
  });

  router.post("/api/demo/questions/:id/propose-answer", async (req, res) => {
    const question = await questionFor(res, String(req.params.id));
    if (question.kind !== "text") throw new HttpError(400, "Coding questions use a reference solution instead.");
    const answers = await proposeAnswers(db, { resource: question.title, context: (question.summary || question.text).slice(0, 6000), questions: [{ index: 0, prompt: question.prompt }] });
    await db.query("UPDATE demo_resource_questions SET answer=$2,answer_source='ai',updated_at=now() WHERE id=$1", [question.id, answers.get(0)]);
    res.json(await one(question.id));
  });

  router.post("/api/demo/resources/:id/coding", async (req, res) => {
    const resource = await resourceFor(res, String(req.params.id));
    const language = req.body.language;
    if (!availableLanguages().includes(language)) throw new HttpError(400, `Choose a supported language: ${availableLanguages().join(", ")}.`);
    const count = req.body.count ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 3) throw new HttpError(400, "Choose 1 to 3 coding questions.");
    const instructions = text(req.body.instructions ?? "", "Custom instructions", 1200, false);
    let basis = resource.summary || resource.text;
    if (req.body.questionId) {
      const source = (await db.query("SELECT prompt FROM demo_resource_questions WHERE id=$1 AND resource_id=$2", [uuid(String(req.body.questionId)), resource.id])).rows[0];
      if (!source) throw new HttpError(400, "Choose a question from this resource.");
      basis = `Base the exercise on this problem from the resource:\n\n${source.prompt}\n\nResource summary:\n\n${basis.slice(0, 3000)}`;
    }
    if (!basis.trim()) throw new HttpError(400, "Process the resource before generating a coding question.");
    const created = [];
    for (let i = 0; i < count; i++) {
      const draft = await codingQuestion(db, { language, resource: resource.title, basis: basis.slice(0, 7000),
        instructions: count > 1 ? `${instructions}\nThis is exercise ${i + 1} of ${count}; make it distinct from the others.`.trim() : instructions });
      let coding: unknown = draft, status = "needs_review", report: unknown = null;
      try {
        const verified = await verifySpec(draft);
        coding = verified.spec; status = verified.ready ? "ready" : "needs_review"; report = verified.report;
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 400) throw error;
        report = { verdict: "invalid", message: error.message };
      }
      const statement = typeof (coding as CodingSpec).statement === "string" ? (coding as CodingSpec).statement : "Coding exercise";
      const saved = await db.query(`INSERT INTO demo_resource_questions(resource_id,position,origin,kind,prompt,answer,answer_source,coding,coding_status)
        VALUES($1,300000+(SELECT count(*) FROM demo_resource_questions WHERE resource_id=$1),'ai','coding',$2,'','ai',$3,$4) RETURNING id`,
      [resource.id, statement, JSON.stringify({ ...(coding as object), validation: report }), status]);
      created.push(await one(saved.rows[0].id));
    }
    res.status(201).json({ questions: created });
  });

  router.put("/api/demo/questions/:id/coding", async (req, res) => {
    const question = await questionFor(res, String(req.params.id));
    if (question.kind !== "coding") throw new HttpError(400, "This is not a coding question.");
    const verified = await verifySpec(req.body.spec);
    await db.query(`UPDATE demo_resource_questions SET prompt=$2,coding=$3,coding_status=$4,edited=true,updated_at=now() WHERE id=$1`,
      [question.id, verified.spec.statement, JSON.stringify({ ...verified.spec, validation: verified.report }), verified.ready ? "ready" : "needs_review"]);
    res.json(await one(question.id));
  });
  return router;
}
