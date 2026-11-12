import { lazy, Suspense, useEffect, useState } from "react";
import { api, jsonBody } from "./api";
import Markdown from "./Markdown";
import MarkdownEditor from "./MarkdownEditor";
import { ResourceEditor, type Resource } from "./DemoResource";

const CodeEditor = lazy(() => import("./CodeEditor"));

export type ProcessingMode = "questions" | "theory" | "both";
export type TestCase = { name: string; input: string; expected: string; hidden: boolean; category: "normal" | "boundary" | "edge" };
export type Validation = { verdict: string; passed?: number; total?: number; message?: string; checkedAt?: string;
  results?: { name: string; verdict: string; stdout?: string; stderr?: string; expected?: string; input?: string }[] };
export type CodingSpec = { language: string; statement: string; starterCode: string; inputFormat: string; outputFormat: string;
  tests: TestCase[]; referenceSolution: string; checker: string | null; validation?: Validation | null };
export type BankQuestion = {
  id: string; resourceId: string; origin: "extracted" | "theory" | "manual" | "ai"; kind: "text" | "coding"; prompt: string; quote: string;
  sourceRef: string; answer: string; answerSource: "document" | "ai" | "teacher" | "pending" | "none"; coding: CodingSpec | null;
  codingStatus: "ready" | "needs_review" | null; edited: boolean;
};
export type Material = Resource & {
  topicId: string; sectionCount: number; isPdf: boolean; processingMode: ProcessingMode | null; summary: string; summaryEdited: boolean;
  pendingSteps: number; parts: { page?: number; summary: string; problems: unknown[] }[] | null; questions: BankQuestion[];
};
type Task = (action: () => Promise<void>) => Promise<void>;

export const modeLabels: Record<ProcessingMode, { title: string; help: string }> = {
  questions: { title: "Only questions", help: "Extract the exercises and worked questions in the document, with proposed answers." },
  theory: { title: "Only theory", help: "Write a full Markdown summary with concepts, definitions, formulas, examples and page references." },
  both: { title: "Both", help: "Summary plus any exercises. Without exercises, a few practice questions are generated from the theory." },
};
export const originLabel = (q: Pick<BankQuestion, "origin" | "kind">) => q.kind === "coding" ? "AI-generated coding exercise"
  : q.origin === "extracted" ? "Extracted from document" : q.origin === "theory" ? "AI-generated from theory" : q.origin === "manual" ? "Teacher-added" : "AI-generated";
const answerLabel: Record<BankQuestion["answerSource"], [string, string]> = {
  document: ["Answer from document", "green"], ai: ["AI-proposed answer · review before use", "amber"],
  teacher: ["Teacher-reviewed answer", "green"], pending: ["Proposed answer pending", "amber"], none: ["No answer yet", "red"],
};

export function ModePicker({ name, value, onChange, disabled }: { name: string; value?: ProcessingMode | null; onChange?: (mode: ProcessingMode) => void; disabled?: boolean }) {
  return <fieldset className="mode-picker field full" disabled={disabled}>
    <legend className="field-label">How should EdCurie process this resource? (required)</legend>
    {(Object.keys(modeLabels) as ProcessingMode[]).map(mode => <label key={mode} className="mode-option">
      <input type="radio" name={name} value={mode} required {...(onChange ? { checked: value === mode, onChange: () => onChange(mode) } : { defaultChecked: value === mode })} />
      <span><strong>{modeLabels[mode].title}</strong><span className="muted">{modeLabels[mode].help}</span></span>
    </label>)}
  </fieldset>;
}

function QuestionCard({ question, busy, run, reload, onCoding }: { question: BankQuestion; busy: boolean; run: Task; reload: () => Promise<void>; onCoding: () => void }) {
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(question.prompt);
  const [answer, setAnswer] = useState(question.answer);
  useEffect(() => { setPrompt(question.prompt); setAnswer(question.answer); }, [question.prompt, question.answer]);
  const [label, tone] = answerLabel[question.answerSource];
  return <article className="course-card stack bank-question">
    <div className="card-actions tight">
      <span className={`badge ${question.origin === "extracted" ? "" : "violet"}`}>{originLabel(question)}</span>
      {question.sourceRef && <span className="badge">Source: {question.sourceRef}</span>}
      {question.kind === "text" && <span className={`badge ${tone}`}>{label}</span>}
      {question.kind === "coding" && <span className={`badge ${question.codingStatus === "ready" ? "green" : "amber"}`}>{question.codingStatus === "ready" ? "Ready · reference solution passes all tests" : "Needs review"}</span>}
      {question.edited && question.origin !== "manual" && <span className="badge">Edited by teacher</span>}
    </div>
    {question.kind === "coding" && question.coding
      ? <CodingReview question={question} spec={question.coding} busy={busy} run={run} reload={reload} />
      : editing ? <form className="stack" onSubmit={event => {
        event.preventDefault();
        void run(async () => { await api(`/api/demo/questions/${question.id}`, { method: "PATCH", body: jsonBody({ prompt, answer }) }); setEditing(false); await reload(); });
      }}>
        <MarkdownEditor label="Question" value={prompt} onChange={setPrompt} rows={6} maxLength={8000} required />
        <MarkdownEditor label="Answer or worked solution" value={answer} onChange={setAnswer} rows={6} maxLength={8000} />
        <div className="card-actions"><button className="button small primary" disabled={busy || !prompt.trim()}>Save question</button>
          <button type="button" className="button small" onClick={() => setEditing(false)}>Cancel</button></div>
      </form> : <>
        <Markdown text={question.prompt} />
        {question.quote && question.quote !== question.prompt && <details><summary>Verbatim source text</summary><Markdown text={question.quote} /></details>}
        <details open={question.answerSource === "ai"}><summary>{question.answerSource === "ai" ? "AI-proposed answer (not from the document)" : "Answer"}</summary>
          {question.answer.trim() ? <Markdown text={question.answer} /> : <p className="muted">No answer recorded.</p>}</details>
      </>}
    {!editing && <div className="card-actions">
      {question.kind === "text" && <button type="button" className="button small" disabled={busy} onClick={() => setEditing(true)}>Edit question and answer</button>}
      {question.kind === "text" && !question.answer.trim() && <button type="button" className="button small" disabled={busy}
        onClick={() => void run(async () => { await api(`/api/demo/questions/${question.id}/propose-answer`, { method: "POST" }); await reload(); })}>Propose answer with AI</button>}
      {question.kind === "text" && <button type="button" className="button small" disabled={busy} onClick={onCoding}>Make a coding exercise from this</button>}
      <button type="button" className="button small" disabled={busy} onClick={() => {
        if (confirm("Remove this question from the bank?")) void run(async () => { await api(`/api/demo/questions/${question.id}`, { method: "DELETE" }); await reload(); });
      }}>Delete</button>
    </div>}
  </article>;
}

function CodingReview({ question, spec, busy, run, reload }: { question: BankQuestion; spec: CodingSpec; busy: boolean; run: Task; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(question.codingStatus !== "ready");
  const [draft, setDraft] = useState<CodingSpec>(spec);
  useEffect(() => setDraft(spec), [spec]);
  const set = <K extends keyof CodingSpec>(key: K, value: CodingSpec[K]) => setDraft(old => ({ ...old, [key]: value }));
  const setTest = (index: number, patch: Partial<TestCase>) => set("tests", draft.tests.map((test, i) => i === index ? { ...test, ...patch } : test));
  const validation = spec.validation;
  return <div className="stack">
    <Markdown text={spec.statement} />
    <p className="muted">{spec.language} · {spec.tests.filter(t => !t.hidden).length} sample tests · {spec.tests.filter(t => t.hidden).length} hidden tests{spec.checker ? " · custom checker" : ""}</p>
    {validation && <div className={`notice ${validation.verdict === "passed" ? "success" : "warn"}`}>
      {validation.verdict === "passed" ? `Reference solution passed ${validation.passed}/${validation.total} tests in the isolated runner.`
        : validation.message ?? `Reference solution: ${validation.verdict.replace("_", " ")} (${validation.passed ?? 0}/${validation.total ?? 0} tests passed). Fix the tests or solution, then validate again.`}
      {validation.results?.filter(r => r.verdict !== "passed").slice(0, 3).map(r => <details key={r.name}><summary>{r.name}: {r.verdict}</summary>
        <pre className="run-output">{[r.stderr && `stderr:\n${r.stderr}`, `expected:\n${r.expected ?? ""}`, `got:\n${r.stdout ?? ""}`].filter(Boolean).join("\n\n")}</pre></details>)}
    </div>}
    <button type="button" className="button small" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide tests and solution" : "Review tests and solution"}</button>
    {open && <form className="stack" onSubmit={event => {
      event.preventDefault();
      void run(async () => { await api(`/api/demo/questions/${question.id}/coding`, { method: "PUT", body: jsonBody({ spec: { ...draft, validation: undefined } }) }); await reload(); });
    }}>
      <MarkdownEditor label="Problem statement" value={draft.statement} onChange={value => set("statement", value)} rows={8} maxLength={20000} required />
      <div className="form-grid">
        <MarkdownEditor label="Input format and constraints" compact value={draft.inputFormat} onChange={value => set("inputFormat", value)} rows={3} maxLength={4000} required />
        <MarkdownEditor label="Output format" compact value={draft.outputFormat} onChange={value => set("outputFormat", value)} rows={3} maxLength={4000} required />
      </div>
      <Suspense fallback={<p className="muted">Loading code editor…</p>}>
        <div className="field"><span className="field-label">Starter code</span><CodeEditor label="Starter code" language={draft.language} value={draft.starterCode} onChange={value => set("starterCode", value)} minHeight={140} /></div>
        <div className="field"><span className="field-label">Reference solution (never sent to students)</span><CodeEditor label="Reference solution" language={draft.language} value={draft.referenceSolution} onChange={value => set("referenceSolution", value)} minHeight={180} /></div>
      </Suspense>
      <div className="stack">
        <span className="field-label">Tests</span>
        {draft.tests.map((test, index) => <div className="test-row" key={index}>
          <div className="card-actions tight">
            <input aria-label="Test name" value={test.name} maxLength={120} onChange={event => setTest(index, { name: event.target.value })} />
            <select aria-label="Test category" value={test.category} onChange={event => setTest(index, { category: event.target.value as TestCase["category"] })}>
              <option value="normal">Normal</option><option value="boundary">Boundary</option><option value="edge">Edge</option></select>
            <label><input type="checkbox" checked={test.hidden} onChange={event => setTest(index, { hidden: event.target.checked })} /> Hidden</label>
            <button type="button" className="button small" onClick={() => set("tests", draft.tests.filter((_, i) => i !== index))}>Remove</button>
          </div>
          <div className="form-grid">
            <label className="field">Input (stdin)<textarea className="demo-code" rows={3} value={test.input} onChange={event => setTest(index, { input: event.target.value })} /></label>
            <label className="field">Expected output<textarea className="demo-code" rows={3} value={test.expected} onChange={event => setTest(index, { expected: event.target.value })} /></label>
          </div>
        </div>)}
        <div><button type="button" className="button small" onClick={() => set("tests", [...draft.tests, { name: `Test ${draft.tests.length + 1}`, input: "", expected: "", hidden: true, category: "normal" }])}>Add test</button></div>
      </div>
      {draft.checker !== null && <Suspense fallback={null}><div className="field"><span className="field-label">Checker (reads JSON input/expected/actual, prints OK or WRONG)</span>
        <CodeEditor label="Checker" language={draft.language} value={draft.checker} onChange={value => set("checker", value)} minHeight={120} /></div></Suspense>}
      <div className="card-actions">
        <button className="button small primary" disabled={busy}>Validate and save</button>
        <button type="button" className="button small" onClick={() => set("checker", draft.checker === null ? "" : null)}>{draft.checker === null ? "Add a custom checker" : "Remove checker"}</button>
      </div>
    </form>}
  </div>;
}

function CodingGenerator({ resource, basis, busy, run, reload, onDone }: { resource: Material; basis?: BankQuestion; busy: boolean; run: Task; reload: () => Promise<void>; onDone: () => void }) {
  const [languages, setLanguages] = useState<string[]>([]);
  const [language, setLanguage] = useState("python");
  const [instructions, setInstructions] = useState("");
  const [count, setCount] = useState(1);
  useEffect(() => { void api<{ languages: string[] }>("/api/demo/code/languages").then(data => { setLanguages(data.languages); setLanguage(data.languages[0] ?? "javascript"); }).catch(() => setLanguages(["javascript"])); }, []);
  return <form className="course-card stack" onSubmit={event => {
    event.preventDefault();
    void run(async () => {
      await api(`/api/demo/resources/${resource.id}/coding`, { method: "POST", body: jsonBody({ language, count, instructions, questionId: basis?.id }) });
      onDone(); await reload();
    });
  }}>
    <strong>{basis ? "Generate a coding exercise from this question" : "Generate coding exercises from this resource"}</strong>
    <p className="muted">EdCurie drafts the statement, starter code, I/O contract, sample and hidden tests, and a reference solution, then runs the solution in the isolated runner. Only exercises whose solution passes every test are offered to students.</p>
    <div className="form-grid">
      <label className="field">Language<select value={language} onChange={event => setLanguage(event.target.value)}>{languages.map(item => <option key={item} value={item}>{item === "python" ? "Python 3" : "JavaScript (Node.js)"}</option>)}</select></label>
      <label className="field">Number of exercises<input type="number" min={1} max={3} value={count} onChange={event => setCount(Number(event.target.value))} /></label>
    </div>
    <MarkdownEditor label="Custom instructions" compact value={instructions} onChange={setInstructions} rows={3} maxLength={1200} placeholder="For example: focus on string parsing, keep inputs under 10^5." />
    <div className="card-actions"><button className="button small primary" disabled={busy || !languages.length}>Generate and verify</button><button type="button" className="button small" onClick={onDone}>Cancel</button></div>
  </form>;
}

function SummaryPanel({ resource, busy, run, reload }: { resource: Material; busy: boolean; run: Task; reload: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(resource.summary);
  useEffect(() => setSummary(resource.summary), [resource.summary]);
  if (resource.processingMode === "questions" && !resource.summary.trim()) return null;
  return <section className="stack summary-panel">
    <div className="row"><h4>Resource summary {resource.summaryEdited && <span className="badge">Edited by teacher</span>}</h4>
      {!editing && <button type="button" className="button small" disabled={busy} onClick={() => setEditing(true)}>{resource.summary.trim() ? "Edit summary" : "Write summary"}</button>}</div>
    {editing ? <form className="stack" onSubmit={event => {
      event.preventDefault();
      void run(async () => {
        await api(`/api/resources/${resource.id}`, { method: "PATCH", body: jsonBody({ title: resource.title, text: resource.text?.trim() ? resource.text : summary, summary }) });
        setEditing(false); await reload();
      });
    }}>
      <MarkdownEditor label="Summary Markdown" value={summary} onChange={setSummary} rows={18} maxLength={500000} />
      {resource.status === "published" && <p className="muted">Saving creates a new draft. Publish it again so students see the change.</p>}
      <div className="card-actions"><button className="button small primary" disabled={busy}>Save summary</button><button type="button" className="button small" onClick={() => { setSummary(resource.summary); setEditing(false); }}>Cancel</button></div>
    </form> : resource.summary.trim() ? <div className="summary-body"><Markdown text={resource.summary} /></div>
      : <p className="muted">The summary appears here after processing.</p>}
  </section>;
}

export function TeacherResourceCard({ resource, busy, run, reload, processResource }: {
  resource: Material; busy: boolean; run: Task; reload: () => Promise<void>; processResource: (id: string, restart?: boolean) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");
  const [coding, setCoding] = useState<BankQuestion | "resource" | null>(null);
  const processed = resource.parts?.length ?? 0;
  const pagesDone = processed >= resource.sectionCount;
  const complete = pagesDone && resource.pendingSteps === 0;
  const extracted = resource.questions.filter(q => q.origin === "extracted").length;
  const unit = resource.isPdf ? "pages" : "sections";
  return <div className="course-card stack">
    <ResourceEditor resource={resource} busy={busy} refresh={reload}
      onPublish={() => void run(async () => { await api(`/api/resources/${resource.id}/publish`, { method: "POST" }); await reload(); })}
      onArchive={() => { if (confirm(`Delete ${resource.title} from this topic?`)) void run(async () => { await api(`/api/resources/${resource.id}/archive`, { method: "POST" }); await reload(); }); }} />
    <div className="card-actions">
      <span className="badge">{resource.processingMode ? modeLabels[resource.processingMode].title : "Processing mode not set"}</span>
      <span>{Math.min(processed, resource.sectionCount)} of {resource.sectionCount} {unit} processed{pagesDone && resource.pendingSteps ? ` · ${resource.pendingSteps} finishing step${resource.pendingSteps > 1 ? "s" : ""} left` : ""}</span>
      {resource.processingMode && !complete && <button className="button small primary" disabled={busy} onClick={() => void run(() => processResource(resource.id))}>{processed ? "Continue processing" : "Process with AI"}</button>}
      {resource.processingMode && processed > 0 && <button className="button small" disabled={busy} onClick={() => {
        if (confirm("Process the original upload again from the first page? Questions and summaries you have edited are kept.")) void run(() => processResource(resource.id, true));
      }}>Reprocess from start</button>}
    </div>
    {!resource.processingMode && <form className="stack" onSubmit={event => {
      event.preventDefault();
      const mode = new FormData(event.currentTarget).get(`mode-${resource.id}`);
      void run(async () => { await api(`/api/demo/resources/${resource.id}/mode`, { method: "POST", body: jsonBody({ processingMode: mode }) }); await reload(); await processResource(resource.id); });
    }}>
      <p className="notice warn">This resource was added before processing modes existed. Choose a mode to process it again; its existing questions and summary are kept.</p>
      <ModePicker name={`mode-${resource.id}`} />
      <div><button className="button small primary" disabled={busy}>Save mode and process</button></div>
    </form>}
    {complete && resource.processingMode === "questions" && extracted === 0 && <p className="notice warn">No exercises or worked questions were found in this document. Choose “Only theory” or “Both” to get a summary instead, or add questions manually.</p>}
    {complete && resource.processingMode === "theory" && <p className="notice success">Theory summary ready. No questions are needed for this mode — review the summary below and publish when it reads well.</p>}
    {complete && resource.processingMode === "both" && extracted === 0 && resource.questions.some(q => q.origin === "theory") && <p className="notice">The document has no explicit exercises, so EdCurie generated practice questions from its theory. They are labelled “AI-generated from theory”.</p>}
    <SummaryPanel resource={resource} busy={busy} run={run} reload={reload} />
    {(resource.processingMode !== "theory" || resource.questions.length > 0) && <section className="stack">
      <div className="row"><h4>Question bank ({resource.questions.length})</h4>
        <div className="card-actions tight">
          <button type="button" className="button small" disabled={busy} onClick={() => setAdding(!adding)}>Add question</button>
          <button type="button" className="button small" disabled={busy} onClick={() => setCoding("resource")}>Generate coding exercise</button>
        </div></div>
      {adding && <form className="course-card stack" onSubmit={event => {
        event.preventDefault();
        void run(async () => { await api(`/api/demo/resources/${resource.id}/questions`, { method: "POST", body: jsonBody({ prompt, answer }) }); setPrompt(""); setAnswer(""); setAdding(false); await reload(); });
      }}>
        <MarkdownEditor label="Question" value={prompt} onChange={setPrompt} rows={5} maxLength={8000} required />
        <MarkdownEditor label="Answer or worked solution (optional)" value={answer} onChange={setAnswer} rows={5} maxLength={8000} />
        <div className="card-actions"><button className="button small primary" disabled={busy || !prompt.trim()}>Add to question bank</button></div>
      </form>}
      {coding && <CodingGenerator resource={resource} basis={coding === "resource" ? undefined : coding} busy={busy} run={run} reload={reload} onDone={() => setCoding(null)} />}
      {resource.questions.map(question => <QuestionCard key={question.id} question={question} busy={busy} run={run} reload={reload} onCoding={() => setCoding(question)} />)}
    </section>}
  </div>;
}
